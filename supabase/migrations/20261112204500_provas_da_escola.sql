-- Provas da escola (opcionais, 1 ou 2 por trimestre por matéria): o aluno fotografa, a rodada lê, corrige,
-- explica cada questão (por que a resposta é assim e o que uma resposta completa precisa ter) e faz uma revisão.
create table if not exists public.exams (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  subject_id uuid references public.subjects(id),
  chapter_id uuid references public.chapters(id) on delete set null,
  title text not null default '',
  taken_on date,
  note text not null default '',                 -- recado do aluno ao mandar
  status text not null default 'aguardando_leitura' check (status in ('aguardando_leitura', 'corrigida', 'com_problema')),
  grade_text text not null default '',           -- nota como veio na prova (ex.: "7,5 de 10")
  summary text not null default '',
  questions jsonb not null default '[]',         -- [{ref, status: certo|errado|parcial|em_branco, comment}]
  explanation text not null default '',          -- markdown: explicação questão a questão
  revision_sheet text not null default '',
  ai_prompt text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists exams_family on public.exams(family_id, created_at);

create table if not exists public.exam_photos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  exam_id uuid not null references public.exams(id) on delete cascade,
  storage_path text not null unique,
  sort int,
  created_at timestamptz not null default now()
);
create index if not exists exam_photos_exam on public.exam_photos(exam_id);

alter table public.exams enable row level security;
alter table public.exam_photos enable row level security;
create policy "família lê provas" on public.exams for select to authenticated
  using (family_id = (select public.my_family_id()));
create policy "família manda prova" on public.exams for insert to authenticated
  with check (family_id = (select public.my_family_id()) and status = 'aguardando_leitura');
create policy "família lê fotos de prova" on public.exam_photos for select to authenticated
  using (family_id = (select public.my_family_id()));
create policy "família manda foto de prova" on public.exam_photos for insert to authenticated
  with check (family_id = (select public.my_family_id())
    and exists (select 1 from public.exams e where e.id = exam_id and e.family_id = (select public.my_family_id()) and e.status = 'aguardando_leitura'));

create or replace function public.w_pending_exams() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'exam_id', e.id, 'family_id', e.family_id, 'materia', s.name, 'subject_id', e.subject_id,
    'capitulo', ch.title, 'chapter_id', e.chapter_id, 'titulo', e.title, 'data', e.taken_on, 'recado', e.note,
    'fotos', (select count(*) from exam_photos p where p.exam_id = e.id)) order by e.created_at), '[]')
  from exams e left join subjects s on s.id = e.subject_id left join chapters ch on ch.id = e.chapter_id
  where e.status = 'aguardando_leitura'
$$;

-- {exam_id, status: corrigida|com_problema, grade_text, summary, questions[], explanation, revision_sheet, ai_prompt, chapter_id?}
create or replace function public.w_save_exam(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  update exams set
    status = coalesce(p->>'status', 'corrigida'),
    grade_text = coalesce(p->>'grade_text', grade_text),
    summary = coalesce(p->>'summary', summary),
    questions = coalesce(p->'questions', questions),
    explanation = coalesce(p->>'explanation', explanation),
    revision_sheet = coalesce(p->>'revision_sheet', revision_sheet),
    ai_prompt = coalesce(p->>'ai_prompt', ai_prompt),
    chapter_id = coalesce((p->>'chapter_id')::uuid, chapter_id),
    read_at = now()
  where id = (p->>'exam_id')::uuid;
end $$;

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
    'provas_para_ler', (select count(*) from exams where status = 'aguardando_leitura'
        and exists (select 1 from exam_photos p where p.exam_id = exams.id)),
    'tarefas_vencidas', (select count(*) from tasks where status = 'pendente' and not late_alerted
        and due_on < (now() at time zone 'America/Sao_Paulo')::date),
    'devolvidas_sem_reenvio', (select count(*) from checkin_items where review_status = 'devolvido' and not return_alerted
        and returned_at is not null
        and (returned_at at time zone 'America/Sao_Paulo')::date < (now() at time zone 'America/Sao_Paulo')::date)
  )
$$;

revoke all on function public.w_pending_exams() from public, anon, authenticated;
revoke all on function public.w_save_exam(jsonb) from public, anon, authenticated;
revoke all on function public.w_status() from public, anon, authenticated;
