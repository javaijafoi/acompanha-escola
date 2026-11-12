-- Provinha pode ser respondida no app ou no papel (fotos). As duas formas podem ser misturadas.
create table if not exists public.quiz_photos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  storage_path text not null unique,
  sort int,
  created_at timestamptz not null default now()
);
create index if not exists quiz_photos_quiz on public.quiz_photos(quiz_id);
alter table public.quiz_photos enable row level security;
create policy "família lê fotos de provinha" on public.quiz_photos for select to authenticated
  using (family_id = (select public.my_family_id()));

create or replace function public.submit_quiz(p_quiz_id uuid, p_answers jsonb, p_photos text[]) returns void
language plpgsql security definer set search_path = public as $$
declare q quizzes; pth text; i int := 0;
begin
  select * into q from quizzes where id = p_quiz_id and status = 'disponivel'
     and family_id = public.my_family_id() and public.my_role() = 'child';
  if q.id is null then raise exception 'Provinha não encontrada ou já respondida'; end if;
  foreach pth in array coalesce(p_photos, '{}') loop
    if split_part(pth, '/', 1) <> q.family_id::text or split_part(pth, '/', 2) <> 'provinhas' or split_part(pth, '/', 3) <> q.id::text then
      raise exception 'caminho de foto inválido';
    end if;
    i := i + 1;
    insert into quiz_photos (family_id, quiz_id, storage_path, sort) values (q.family_id, q.id, pth, i);
  end loop;
  update quizzes set answers = p_answers, status = 'respondida', answered_at = now() where id = q.id;
end $$;
revoke all on function public.submit_quiz(uuid, jsonb, text[]) from public, anon;
grant execute on function public.submit_quiz(uuid, jsonb, text[]) to authenticated;

create or replace function public.w_quizzes_to_grade() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('quiz_id', q.id, 'kind', q.kind, 'title', q.title, 'attempt', q.attempt,
           'chapter_id', q.chapter_id, 'questions', q.questions, 'answers', q.answers, 'answer_key', k.answer_key,
           'fotos', (select count(*) from quiz_photos p where p.quiz_id = q.id))), '[]')
    from quizzes q join quiz_keys k on k.quiz_id = q.id where q.status = 'respondida'
$$;
revoke all on function public.w_quizzes_to_grade() from public, anon, authenticated;
