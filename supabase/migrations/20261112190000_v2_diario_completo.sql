-- v2: trimestres, grade horária, livros/capítulos com páginas, alertas (só pai),
-- tarefinhas, perfil privado, revisões por bloco e funções seguras para as rodadas.

-- Trimestres ------------------------------------------------------------------
create table public.terms (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  unique (family_id, name),
  check (ends_on >= starts_on)
);

-- Livros (Bernoulli: ~3 por trimestre, cada um com várias matérias) ---------
create table public.books (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  term_id uuid references public.terms(id) on delete set null,
  title text not null,
  status text not null default 'aguardando_leitura'
    check (status in ('aguardando_leitura', 'cadastrado', 'com_problema')),
  review_note text not null default '',
  created_at timestamptz not null default now()
);
create index on public.books(family_id);

create table public.book_photos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  book_id uuid not null references public.books(id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index on public.book_photos(book_id);

alter table public.chapters
  add column book_id uuid references public.books(id) on delete set null,
  add column start_page int,
  add column end_page int,
  add column position int,
  add column summary_sheet text not null default '',   -- revisão obrigatória do capítulo
  add column ai_prompt text not null default '';       -- prompt para ela usar em outra IA

-- Grade horária ------------------------------------------------------------------
create table public.timetables (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  valid_from date not null default (now() at time zone 'America/Sao_Paulo')::date,
  status text not null default 'aguardando_leitura'
    check (status in ('aguardando_leitura', 'ativa', 'bloqueada', 'substituida')),
  child_reason text not null default '',   -- por que mudou (ela explica)
  review_note text not null default '',    -- o que a correção achou
  created_at timestamptz not null default now()
);
create index on public.timetables(family_id);

create table public.timetable_photos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  timetable_id uuid not null references public.timetables(id) on delete cascade,
  storage_path text not null unique,
  created_at timestamptz not null default now()
);
create index on public.timetable_photos(timetable_id);

create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  timetable_id uuid not null references public.timetables(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 6),
  position smallint not null,
  subject_id uuid not null references public.subjects(id),
  unique (timetable_id, weekday, position)
);
create index on public.timetable_slots(timetable_id);

-- Diário: páginas e "não teve aula" ------------------------------------------
alter table public.checkin_items
  add column book_id uuid references public.books(id) on delete set null,
  add column page_from int,
  add column page_to int,
  add column no_class_reason text,   -- preenchido = não teve aula/conteúdo dessa matéria hoje
  add constraint pages_ok check (page_from is null or page_to is null or page_to >= page_from);

alter table public.photos
  add column page_number int,  -- definido pela correção ao ler a foto
  add column sort int;         -- ordem certa das páginas

-- Observação para o pai NÃO é mais gravada em reviews (a aluna lê essa tabela);
-- vai para alerts (kind 'observacao'), que só o responsável vê. Coluna antiga fica vazia.
comment on column public.reviews.note_to_parent is 'obsoleto: usar alerts';

-- Provinhas também para "blocos de ideia" ------------------------------------
alter table public.quizzes
  add column kind text not null default 'capitulo' check (kind in ('capitulo', 'bloco')),
  add column subject_id uuid references public.subjects(id),
  add column title text not null default '',
  add column due_on date,
  add column ai_prompt text not null default '';
-- Toda provinha (inclusive de bloco) pertence a um capítulo; 'attempt' é um contador único por capítulo.

-- Tarefinhas (o que ela vê como pendência) ------------------------------------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null check (kind in ('fotografar_paginas', 'revisao_bloco', 'revisao_capitulo', 'refazer', 'horario', 'livro', 'outro')),
  subject_id uuid references public.subjects(id),
  chapter_id uuid references public.chapters(id) on delete cascade,
  quiz_id uuid references public.quizzes(id) on delete set null,
  title text not null,
  instructions text not null default '',
  due_on date,
  status text not null default 'pendente' check (status in ('pendente', 'feita', 'cancelada')),
  created_at timestamptz not null default now(),
  done_at timestamptz,
  late_alerted boolean not null default false
);
create index on public.tasks(family_id, status);

-- Alertas: SÓ o responsável vê -------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  kind text not null check (kind in ('paginas_faltando', 'horario_estranho', 'materia_faltando', 'exercicios_em_branco',
                                      'dificuldade', 'revisao_atrasada', 'livro', 'observacao')),
  severity text not null default 'atencao' check (severity in ('info', 'atencao', 'bloqueio')),
  subject_id uuid references public.subjects(id),
  chapter_id uuid references public.chapters(id) on delete set null,
  title text not null,
  details text not null default '',
  status text not null default 'aberto' check (status in ('aberto', 'resolvido')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on public.alerts(family_id, status);

-- Perfil de aprendizagem: SÓ o responsável vê (a correção lê via função) ----
create table public.learner_profile (
  family_id uuid primary key references public.families(id) on delete cascade,
  notes text not null default '',
  updated_at timestamptz not null default now()
);

-- RLS -------------------------------------------------------------------------
alter table public.terms enable row level security;
alter table public.books enable row level security;
alter table public.book_photos enable row level security;
alter table public.timetables enable row level security;
alter table public.timetable_photos enable row level security;
alter table public.timetable_slots enable row level security;
alter table public.tasks enable row level security;
alter table public.alerts enable row level security;
alter table public.learner_profile enable row level security;

create policy "família lê trimestres" on public.terms for select to authenticated
  using (family_id = (select public.my_family_id()));
create policy "responsável cuida dos trimestres" on public.terms for all to authenticated
  using (family_id = (select public.my_family_id()) and (select public.my_role()) = 'parent')
  with check (family_id = (select public.my_family_id()) and (select public.my_role()) = 'parent');

create policy "família lê livros" on public.books for select to authenticated
  using (family_id = (select public.my_family_id()));
create policy "família cadastra livro" on public.books for insert to authenticated
  with check (family_id = (select public.my_family_id()) and status = 'aguardando_leitura');
create policy "família lê fotos de livro" on public.book_photos for select to authenticated
  using (family_id = (select public.my_family_id()));
create policy "família envia foto de livro" on public.book_photos for insert to authenticated
  with check (family_id = (select public.my_family_id()));

create policy "família lê grades" on public.timetables for select to authenticated
  using (family_id = (select public.my_family_id()));
create policy "família envia grade" on public.timetables for insert to authenticated
  with check (family_id = (select public.my_family_id()) and status = 'aguardando_leitura');
create policy "família lê fotos de grade" on public.timetable_photos for select to authenticated
  using (family_id = (select public.my_family_id()));
create policy "família envia foto de grade" on public.timetable_photos for insert to authenticated
  with check (family_id = (select public.my_family_id()));
create policy "família lê aulas" on public.timetable_slots for select to authenticated
  using (family_id = (select public.my_family_id()));

create policy "família lê tarefas" on public.tasks for select to authenticated
  using (family_id = (select public.my_family_id()));
create policy "responsável cancela tarefa" on public.tasks for update to authenticated
  using (family_id = (select public.my_family_id()) and (select public.my_role()) = 'parent')
  with check (family_id = (select public.my_family_id()));

create policy "responsável lê alertas" on public.alerts for select to authenticated
  using (family_id = (select public.my_family_id()) and (select public.my_role()) = 'parent');
create policy "responsável resolve alerta" on public.alerts for update to authenticated
  using (family_id = (select public.my_family_id()) and (select public.my_role()) = 'parent')
  with check (family_id = (select public.my_family_id()));

create policy "responsável lê perfil" on public.learner_profile for select to authenticated
  using (family_id = (select public.my_family_id()) and (select public.my_role()) = 'parent');
create policy "responsável cria perfil" on public.learner_profile for insert to authenticated
  with check (family_id = (select public.my_family_id()) and (select public.my_role()) = 'parent');
create policy "responsável edita perfil" on public.learner_profile for update to authenticated
  using (family_id = (select public.my_family_id()) and (select public.my_role()) = 'parent')
  with check (family_id = (select public.my_family_id()));

-- Storage: responsável também pode enviar (livros, grade, calendário)
create policy "família envia fotos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'folhas' and (storage.foldername(name))[1] = (select public.my_family_id())::text);

-- =============================================================================
-- Funções da rodada de correção. Só o dono do banco (rodada via conector) executa.
-- Cada uma faz uma coisa só; a rodada não precisa de SQL de escrita solto.
-- =============================================================================

create or replace function public.w_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'dias_entregues', (select count(*) from checkins where status = 'entregue'
                         or (status = 'corrigindo' and submitted_at < now() - interval '2 hours')),
    'provinhas_respondidas', (select count(*) from quizzes where status = 'respondida'),
    'capitulos_sem_provinha', (select count(*) from chapters c where status = 'finalizado'
        and not exists (select 1 from quizzes q where q.chapter_id = c.id and q.kind = 'capitulo' and q.status in ('disponivel', 'respondida'))),
    'grades_para_ler', (select count(*) from timetables where status = 'aguardando_leitura'),
    'livros_para_ler', (select count(*) from books where status = 'aguardando_leitura'),
    'tarefas_vencidas', (select count(*) from tasks where status = 'pendente' and not late_alerted
        and due_on < (now() at time zone 'America/Sao_Paulo')::date)
  )
$$;

create or replace function public.w_open_run() returns uuid
language sql security definer set search_path = public as $$
  insert into correction_runs default values returning id
$$;

create or replace function public.w_close_run(p_run uuid, p_checkins int, p_quizzes int, p_notes text) returns void
language sql security definer set search_path = public as $$
  update correction_runs set finished_at = now(), checkins_processed = p_checkins,
         quizzes_graded = p_quizzes, notes = p_notes where id = p_run;
$$;

create or replace function public.w_new_token() returns text
language sql security definer set search_path = public as $$
  insert into worker_tokens default values returning token
$$;

create or replace function public.w_learner_profile() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(string_agg(notes, E'\n'), '') from learner_profile
$$;

-- Reivindica os dias entregues e devolve tudo que a correção precisa saber.
create or replace function public.w_claim_checkins() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  update checkins set status = 'corrigindo'
   where status = 'entregue' or (status = 'corrigindo' and submitted_at < now() - interval '2 hours');

  select coalesce(jsonb_agg(jsonb_build_object(
    'checkin_id', c.id, 'dia', c.day,
    'itens', (select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'materia', s.name, 'subject_id', s.id,
        'capitulo', ch.title, 'chapter_id', ch.id, 'paginas_capitulo', case when ch.id is null then null else jsonb_build_array(ch.start_page, ch.end_page) end,
        'livro', b.title, 'paginas', jsonb_build_array(i.page_from, i.page_to),
        'sem_aula', i.no_class_reason, 'aprendi', i.learned, 'folhas_texto', i.pages,
        'status', i.review_status,
        'fotos', (select count(*) from photos p where p.item_id = i.id),
        -- histórico de páginas dessa matéria (para achar buracos)
        'historico', (select coalesce(jsonb_agg(jsonb_build_array(c2.day, i2.page_from, i2.page_to, i2.no_class_reason) order by c2.day), '[]')
                        from checkin_items i2 join checkins c2 on c2.id = i2.checkin_id
                       where i2.subject_id = i.subject_id and c2.day < c.day and c2.day > c.day - 120)
      ) order by s.name), '[]')
      from checkin_items i join subjects s on s.id = i.subject_id
      left join chapters ch on ch.id = i.chapter_id left join books b on b.id = i.book_id
      where i.checkin_id = c.id and i.review_status = 'pendente'),
    -- matérias da grade que ela não lançou no dia
    'faltando_na_grade', (select coalesce(jsonb_agg(distinct s.name), '[]')
        from timetables t join timetable_slots ts on ts.timetable_id = t.id join subjects s on s.id = ts.subject_id
       where t.family_id = c.family_id and t.status = 'ativa' and ts.weekday = extract(isodow from c.day)
         and not exists (select 1 from checkin_items i where i.checkin_id = c.id and i.subject_id = ts.subject_id))
  ) order by c.day), '[]') into v_out
  from checkins c where c.status = 'corrigindo';
  return v_out;
end $$;

-- Grava a correção de um item: {item_id, verdict, topics[], summary, message_to_child,
-- exercises[], done_ratio, correct_ratio, revision_sheet, pages:[{photo_id, page_number, sort}]}
create or replace function public.w_save_review(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_item uuid := (p->>'item_id')::uuid; pg jsonb;
begin
  insert into reviews (family_id, item_id, verdict, topics, summary, message_to_child, exercises,
                       done_ratio, correct_ratio, revision_sheet)
  select family_id, id, p->>'verdict',
         coalesce(array(select jsonb_array_elements_text(p->'topics')), '{}'),
         coalesce(p->>'summary', ''), coalesce(p->>'message_to_child', ''),
         coalesce(p->'exercises', '[]'::jsonb), (p->>'done_ratio')::numeric, (p->>'correct_ratio')::numeric,
         coalesce(p->>'revision_sheet', '')
    from checkin_items where id = v_item
  on conflict (item_id) do update set verdict = excluded.verdict, topics = excluded.topics, summary = excluded.summary,
    message_to_child = excluded.message_to_child, exercises = excluded.exercises, done_ratio = excluded.done_ratio,
    correct_ratio = excluded.correct_ratio, revision_sheet = excluded.revision_sheet, created_at = now();
  update checkin_items set review_status = p->>'verdict' where id = v_item;
  for pg in select * from jsonb_array_elements(coalesce(p->'pages', '[]'::jsonb)) loop
    update photos set page_number = (pg->>'page_number')::int, sort = (pg->>'sort')::int
     where id = (pg->>'photo_id')::uuid and item_id = v_item;
  end loop;
end $$;

create or replace function public.w_finish_checkins() returns int
language sql security definer set search_path = public as $$
  with u as (update checkins set status = 'corrigido', reviewed_at = now() where status = 'corrigindo' returning 1)
  select count(*)::int from u
$$;

-- {kind, severity, subject_id?, chapter_id?, title, details}
create or replace function public.w_add_alert(p jsonb) returns uuid
language sql security definer set search_path = public as $$
  insert into alerts (family_id, kind, severity, subject_id, chapter_id, title, details)
  select f.id, p->>'kind', coalesce(p->>'severity', 'atencao'), (p->>'subject_id')::uuid, (p->>'chapter_id')::uuid,
         p->>'title', coalesce(p->>'details', '')
    from families f order by f.created_at limit 1
  returning id
$$;

-- {kind, subject_id?, chapter_id?, quiz_id?, title, instructions, due_on?}
create or replace function public.w_add_task(p jsonb) returns uuid
language sql security definer set search_path = public as $$
  insert into tasks (family_id, kind, subject_id, chapter_id, quiz_id, title, instructions, due_on)
  select f.id, p->>'kind', (p->>'subject_id')::uuid, (p->>'chapter_id')::uuid, (p->>'quiz_id')::uuid,
         p->>'title', coalesce(p->>'instructions', ''), (p->>'due_on')::date
    from families f order by f.created_at limit 1
  returning id
$$;

-- Gera alerta (uma vez) para tarefinhas vencidas. Não precisa de IA.
create or replace function public.w_flag_overdue() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into alerts (family_id, kind, severity, subject_id, chapter_id, title, details)
  select family_id, 'revisao_atrasada', 'atencao', subject_id, chapter_id,
         'Tarefa atrasada: ' || title, 'Prazo era ' || to_char(due_on, 'DD/MM') || '.'
    from tasks where status = 'pendente' and not late_alerted and due_on < (now() at time zone 'America/Sao_Paulo')::date;
  get diagnostics n = row_count;
  update tasks set late_alerted = true
   where status = 'pendente' and not late_alerted and due_on < (now() at time zone 'America/Sao_Paulo')::date;
  return n;
end $$;

create or replace function public.w_close_task(p_task uuid, p_status text) returns void
language sql security definer set search_path = public as $$
  update tasks set status = p_status, done_at = now() where id = p_task and p_status in ('feita', 'cancelada')
$$;

-- {kind: capitulo|bloco, chapter_id (obrigatório), subject_id?, title, due_on?, ai_prompt, questions[], answer_key{}}
create or replace function public.w_create_quiz(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_attempt int;
begin
  select coalesce(max(attempt), 0) + 1 into v_attempt from quizzes
   where chapter_id = (p->>'chapter_id')::uuid;
  insert into quizzes (family_id, chapter_id, subject_id, kind, attempt, title, due_on, ai_prompt, questions)
  select f.id, (p->>'chapter_id')::uuid,
         coalesce((p->>'subject_id')::uuid, (select subject_id from chapters where id = (p->>'chapter_id')::uuid)),
         coalesce(p->>'kind', 'capitulo'), v_attempt, coalesce(p->>'title', ''), (p->>'due_on')::date,
         coalesce(p->>'ai_prompt', ''), p->'questions'
    from families f order by f.created_at limit 1
  returning id into v_id;
  insert into quiz_keys (quiz_id, answer_key) values (v_id, p->'answer_key');
  return v_id;
end $$;

create or replace function public.w_quizzes_to_grade() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('quiz_id', q.id, 'kind', q.kind, 'title', q.title, 'attempt', q.attempt,
           'chapter_id', q.chapter_id, 'questions', q.questions, 'answers', q.answers, 'answer_key', k.answer_key)), '[]')
    from quizzes q join quiz_keys k on k.quiz_id = q.id where q.status = 'respondida'
$$;

-- {quiz_id, score, feedback{}}; nota >= 7 em provinha de capítulo => capítulo dominado
create or replace function public.w_grade_quiz(p jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare q quizzes;
begin
  update quizzes set score = (p->>'score')::numeric, feedback = p->'feedback', status = 'corrigida', graded_at = now()
   where id = (p->>'quiz_id')::uuid and status = 'respondida' returning * into q;
  if q.id is null then return 'nao_encontrada'; end if;
  update tasks set status = 'feita', done_at = now() where quiz_id = q.id and status = 'pendente';
  if q.kind = 'capitulo' and q.score >= 7 then
    update chapters set status = 'dominado' where id = q.chapter_id;
    return 'dominado';
  end if;
  return case when q.score >= 7 then 'ok' else 'refazer' end;
end $$;

-- Capítulos: {chapter_id?, subject, book_id?, title, start_page?, end_page?, position?, status?, summary_sheet?, ai_prompt?}
create or replace function public.w_upsert_chapter(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fam uuid; v_subject uuid; v_id uuid := (p->>'chapter_id')::uuid;
begin
  select id into v_fam from families order by created_at limit 1;
  if v_id is null then
    insert into subjects (family_id, name) values (v_fam, p->>'subject')
      on conflict (family_id, name) do update set active = true returning id into v_subject;
    insert into chapters (family_id, subject_id, title) values (v_fam, v_subject, p->>'title')
      on conflict (subject_id, title) do update set title = excluded.title returning id into v_id;
  end if;
  update chapters set
    book_id = coalesce((p->>'book_id')::uuid, book_id),
    start_page = coalesce((p->>'start_page')::int, start_page),
    end_page = coalesce((p->>'end_page')::int, end_page),
    position = coalesce((p->>'position')::int, position),
    status = coalesce(p->>'status', status),
    finished_at = case when p->>'status' = 'finalizado' and finished_at is null then now() else finished_at end,
    summary_sheet = coalesce(p->>'summary_sheet', summary_sheet),
    ai_prompt = coalesce(p->>'ai_prompt', ai_prompt)
  where id = v_id;
  return v_id;
end $$;

-- {book_id, status, review_note, title?}
create or replace function public.w_set_book(p jsonb) returns void
language sql security definer set search_path = public as $$
  update books set status = p->>'status', review_note = coalesce(p->>'review_note', ''),
         title = coalesce(p->>'title', title) where id = (p->>'book_id')::uuid
$$;

-- {timetable_id, status: ativa|bloqueada, review_note, slots:[{weekday, position, subject}]}
create or replace function public.w_set_timetable(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare t timetables; s jsonb; v_subject uuid;
begin
  select * into t from timetables where id = (p->>'timetable_id')::uuid and status = 'aguardando_leitura';
  if t.id is null then raise exception 'grade não está aguardando leitura'; end if;
  for s in select * from jsonb_array_elements(coalesce(p->'slots', '[]'::jsonb)) loop
    insert into subjects (family_id, name) values (t.family_id, s->>'subject')
      on conflict (family_id, name) do update set active = true returning id into v_subject;
    insert into timetable_slots (family_id, timetable_id, weekday, position, subject_id)
    values (t.family_id, t.id, (s->>'weekday')::smallint, (s->>'position')::smallint, v_subject);
  end loop;
  update timetables set status = p->>'status', review_note = coalesce(p->>'review_note', '') where id = t.id;
  if p->>'status' = 'ativa' then
    update timetables set status = 'substituida' where family_id = t.family_id and status = 'ativa' and id <> t.id;
  end if;
end $$;

-- Tudo que é lido pelas fotos/descrições pendentes (para a rodada saber o que olhar)
create or replace function public.w_pending_setup() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('timetable_id', id, 'motivo', child_reason, 'desde', valid_from)), '[]')
                 from timetables where status = 'aguardando_leitura'),
    'grade_ativa', (select coalesce(jsonb_agg(jsonb_build_array(ts.weekday, ts.position, s.name) order by ts.weekday, ts.position), '[]')
                 from timetables t join timetable_slots ts on ts.timetable_id = t.id join subjects s on s.id = ts.subject_id
                where t.status = 'ativa'),
    'livros', (select coalesce(jsonb_agg(jsonb_build_object('book_id', id, 'titulo', title)), '[]')
                 from books where status = 'aguardando_leitura'),
    'trimestres', (select coalesce(jsonb_agg(jsonb_build_object('nome', name, 'inicio', starts_on, 'fim', ends_on) order by starts_on), '[]') from terms)
  )
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'w_status()', 'w_open_run()', 'w_close_run(uuid, int, int, text)', 'w_new_token()', 'w_learner_profile()',
    'w_claim_checkins()', 'w_save_review(jsonb)', 'w_finish_checkins()', 'w_add_alert(jsonb)', 'w_add_task(jsonb)',
    'w_close_task(uuid, text)', 'w_flag_overdue()', 'w_create_quiz(jsonb)', 'w_quizzes_to_grade()', 'w_grade_quiz(jsonb)',
    'w_upsert_chapter(jsonb)', 'w_set_book(jsonb)', 'w_set_timetable(jsonb)', 'w_pending_setup()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
end $$;
