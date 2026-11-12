-- AcompanhaEscola: esquema inicial
-- Família (pai + filha), matérias, check-ins diários, fotos das folhas,
-- correções feitas pelo Claude, capítulos e provinhas.

create extension if not exists pgcrypto;

-- Famílias e perfis ---------------------------------------------------------
create table public.families (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Família',
  invite_code text not null unique default upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8)),
  timezone text not null default 'America/Sao_Paulo',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  family_id uuid not null references public.families(id) on delete cascade,
  role text not null check (role in ('parent', 'child')),
  name text not null default '',
  created_at timestamptz not null default now()
);
create index on public.profiles(family_id);

-- Helpers usados pelas policies (security definer evita recursão no RLS)
create or replace function public.my_family_id() returns uuid
language sql stable security definer set search_path = public as $$
  select family_id from public.profiles where id = auth.uid()
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- Ao criar usuário: com invite_code entra na família como filho(a);
-- sem código, cria família nova como responsável.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fam uuid;
  code text := nullif(trim(new.raw_user_meta_data->>'invite_code'), '');
  display_name text := coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1));
begin
  if code is not null then
    select id into fam from public.families where invite_code = upper(code);
    if fam is null then
      raise exception 'Código de convite inválido';
    end if;
    insert into public.profiles(id, family_id, role, name) values (new.id, fam, 'child', display_name);
  else
    insert into public.families(name) values ('Família de ' || display_name) returning id into fam;
    insert into public.profiles(id, family_id, role, name) values (new.id, fam, 'parent', display_name);
  end if;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Matérias e capítulos -------------------------------------------------------
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  last_seen_on date,
  unique (family_id, name)
);

create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  title text not null,
  status text not null default 'em_andamento'
    check (status in ('em_andamento', 'finalizado', 'dominado')),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (subject_id, title)
);
create index on public.chapters(family_id);

-- Check-in diário --------------------------------------------------------------
-- status: rascunho -> entregue (filha clica "Entregar o dia") -> corrigindo -> corrigido
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  child_id uuid not null references public.profiles(id) on delete cascade,
  day date not null default (now() at time zone 'America/Sao_Paulo')::date,
  status text not null default 'rascunho'
    check (status in ('rascunho', 'entregue', 'corrigindo', 'corrigido')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (child_id, day)
);
create index on public.checkins(family_id, day);
create index on public.checkins(status) where status in ('entregue', 'corrigindo');

-- Uma linha por matéria do dia
create table public.checkin_items (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  checkin_id uuid not null references public.checkins(id) on delete cascade,
  subject_id uuid not null references public.subjects(id),
  chapter_id uuid references public.chapters(id),
  learned text not null default '',        -- "o que eu aprendi hoje"
  pages text not null default '',          -- "quais folhas/páginas estudei"
  -- resultado da correção
  review_status text not null default 'pendente'
    check (review_status in ('pendente', 'aceito', 'devolvido')),
  created_at timestamptz not null default now()
);
create index on public.checkin_items(checkin_id);
create index on public.checkin_items(family_id);

create table public.photos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  item_id uuid not null references public.checkin_items(id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index on public.photos(item_id);
create index on public.photos(family_id);

-- Correção feita pelo Claude para cada item (matéria do dia)
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  item_id uuid not null unique references public.checkin_items(id) on delete cascade,
  verdict text not null check (verdict in ('aceito', 'devolvido')),
  topics text[] not null default '{}',     -- conteúdos identificados nas folhas
  summary text not null default '',        -- o que ela está aprendendo
  message_to_child text not null default '',
  note_to_parent text not null default '',
  exercises jsonb not null default '[]',   -- [{ref, status: certo|errado|parcial|em_branco, feedback}]
  done_ratio numeric,                      -- 0..1, exercícios feitos
  correct_ratio numeric,                   -- 0..1, acertos entre os feitos
  revision_sheet text not null default '', -- folhinha de revisão (markdown)
  created_at timestamptz not null default now()
);
create index on public.reviews(family_id);

-- Provinhas de fim de capítulo -------------------------------------------------
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  attempt int not null default 1,
  status text not null default 'disponivel'
    check (status in ('disponivel', 'respondida', 'corrigida')),
  -- questions: [{id, type: 'multipla'|'aberta', prompt, options?: [..]}] (sem gabarito)
  questions jsonb not null,
  answers jsonb,                -- {question_id: resposta}
  score numeric,                -- 0..10
  feedback jsonb,               -- {question_id: {correct, comment}}
  answered_at timestamptz,
  graded_at timestamptz,
  created_at timestamptz not null default now(),
  unique (chapter_id, attempt)
);
create index on public.quizzes(family_id);
create index on public.quizzes(status) where status = 'respondida';

-- Gabarito fica separado e sem nenhuma policy: só o Claude (service role) lê.
create table public.quiz_keys (
  quiz_id uuid primary key references public.quizzes(id) on delete cascade,
  answer_key jsonb not null
);

-- Registro das rodadas de correção (auditoria e painel)
create table public.correction_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  checkins_processed int not null default 0,
  quizzes_graded int not null default 0,
  notes text
);

-- RLS ------------------------------------------------------------------------
alter table public.families enable row level security;
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.chapters enable row level security;
alter table public.checkins enable row level security;
alter table public.checkin_items enable row level security;
alter table public.photos enable row level security;
alter table public.reviews enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_keys enable row level security;
alter table public.correction_runs enable row level security;

create policy "família lê a própria família" on public.families
  for select to authenticated using (id = (select public.my_family_id()));

create policy "família lê perfis" on public.profiles
  for select to authenticated using (family_id = (select public.my_family_id()));
create policy "atualiza o próprio nome" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "família lê matérias" on public.subjects
  for select to authenticated using (family_id = (select public.my_family_id()));
create policy "família cria matérias" on public.subjects
  for insert to authenticated with check (family_id = (select public.my_family_id()));
create policy "família edita matérias" on public.subjects
  for update to authenticated using (family_id = (select public.my_family_id()));

create policy "família lê capítulos" on public.chapters
  for select to authenticated using (family_id = (select public.my_family_id()));
create policy "família cria capítulos" on public.chapters
  for insert to authenticated with check (family_id = (select public.my_family_id()));
create policy "família edita capítulos" on public.chapters
  for update to authenticated using (family_id = (select public.my_family_id()));

create policy "família lê check-ins" on public.checkins
  for select to authenticated using (family_id = (select public.my_family_id()));
create policy "filha cria check-in" on public.checkins
  for insert to authenticated
  with check (family_id = (select public.my_family_id()) and child_id = (select auth.uid()) and status = 'rascunho');
create policy "filha entrega ou reabre o próprio check-in" on public.checkins
  for update to authenticated
  using (child_id = (select auth.uid()) and status in ('rascunho', 'corrigido'))
  with check (child_id = (select auth.uid()) and status in ('rascunho', 'entregue'));

create policy "família lê itens" on public.checkin_items
  for select to authenticated using (family_id = (select public.my_family_id()));
create policy "filha mexe nos itens do rascunho" on public.checkin_items
  for all to authenticated
  using (exists (select 1 from public.checkins c where c.id = checkin_id and c.child_id = (select auth.uid()) and c.status = 'rascunho'))
  with check (family_id = (select public.my_family_id())
    and exists (select 1 from public.checkins c where c.id = checkin_id and c.child_id = (select auth.uid()) and c.status = 'rascunho'));

create policy "família lê fotos" on public.photos
  for select to authenticated using (family_id = (select public.my_family_id()));
create policy "filha mexe nas fotos do rascunho" on public.photos
  for all to authenticated
  using (exists (select 1 from public.checkin_items i join public.checkins c on c.id = i.checkin_id
                 where i.id = item_id and c.child_id = (select auth.uid()) and c.status = 'rascunho'))
  with check (family_id = (select public.my_family_id())
    and exists (select 1 from public.checkin_items i join public.checkins c on c.id = i.checkin_id
                where i.id = item_id and c.child_id = (select auth.uid()) and c.status = 'rascunho'));

create policy "família lê correções" on public.reviews
  for select to authenticated using (family_id = (select public.my_family_id()));

create policy "família lê provinhas" on public.quizzes
  for select to authenticated using (family_id = (select public.my_family_id()));

-- A filha só pode gravar respostas (via função abaixo), nunca nota/feedback.
create or replace function public.submit_quiz(p_quiz_id uuid, p_answers jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.quizzes
     set answers = p_answers, status = 'respondida', answered_at = now()
   where id = p_quiz_id
     and status = 'disponivel'
     and family_id = public.my_family_id()
     and public.my_role() = 'child';
  if not found then
    raise exception 'Provinha não encontrada ou já respondida';
  end if;
end $$;
revoke all on function public.submit_quiz(uuid, jsonb) from public, anon;
grant execute on function public.submit_quiz(uuid, jsonb) to authenticated;

-- Marca a data da última vez que cada matéria apareceu (detectar abandono)
create or replace function public.touch_subject() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.subjects s set last_seen_on = c.day
    from public.checkins c
   where s.id = new.subject_id and c.id = new.checkin_id
     and (s.last_seen_on is null or s.last_seen_on < c.day);
  return new;
end $$;
create trigger checkin_items_touch_subject
  after insert on public.checkin_items
  for each row execute function public.touch_subject();

revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.touch_subject() from public, anon, authenticated;

-- Storage: bucket privado para as fotos das folhas -----------------------------
-- Caminho: {family_id}/{checkin_id}/{item_id}/{arquivo}
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('folhas', 'folhas', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "família vê fotos das folhas" on storage.objects
  for select to authenticated
  using (bucket_id = 'folhas' and (storage.foldername(name))[1] = (select public.my_family_id())::text);

create policy "filha envia fotos das folhas" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'folhas'
    and (storage.foldername(name))[1] = (select public.my_family_id())::text
    and (select public.my_role()) = 'child');

create policy "filha apaga foto enviada" on storage.objects
  for delete to authenticated
  using (bucket_id = 'folhas' and owner_id = (select auth.uid())::text);
