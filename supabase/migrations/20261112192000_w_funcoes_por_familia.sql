-- Funções da rodada passam a respeitar a família de cada registro (antes assumiam uma família só).
-- Também: alerta de tarefa vencida é atômico (sem duplicar em rodadas simultâneas).

create or replace function public.w_learner_profile() returns text
language sql stable security definer set search_path = public as $$
  select 'obsoleto: use w_learner_profile_for(family_id)'::text
$$;

create or replace function public.w_learner_profile_for(p_family uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select notes from learner_profile where family_id = p_family), '')
$$;

-- Família a partir do alvo: explícita, ou pelo capítulo, matéria, provinha ou livro.
create or replace function public.w_family_of(p jsonb) returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(
    (p->>'family_id')::uuid,
    (select family_id from chapters where id = (p->>'chapter_id')::uuid),
    (select family_id from subjects where id = (p->>'subject_id')::uuid),
    (select family_id from quizzes where id = (p->>'quiz_id')::uuid),
    (select family_id from books where id = (p->>'book_id')::uuid)
  )
$$;

create or replace function public.w_add_alert(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fam uuid := public.w_family_of(p); v_id uuid;
begin
  if v_fam is null then raise exception 'informe family_id ou um alvo (chapter/subject/quiz/book)'; end if;
  insert into alerts (family_id, kind, severity, subject_id, chapter_id, title, details)
  values (v_fam, p->>'kind', coalesce(p->>'severity', 'atencao'), (p->>'subject_id')::uuid, (p->>'chapter_id')::uuid,
          p->>'title', coalesce(p->>'details', ''))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.w_add_task(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fam uuid := public.w_family_of(p); v_id uuid;
begin
  if v_fam is null then raise exception 'informe family_id ou um alvo (chapter/subject/quiz/book)'; end if;
  insert into tasks (family_id, kind, subject_id, chapter_id, quiz_id, title, instructions, due_on)
  values (v_fam, p->>'kind', (p->>'subject_id')::uuid, (p->>'chapter_id')::uuid, (p->>'quiz_id')::uuid,
          p->>'title', coalesce(p->>'instructions', ''), (p->>'due_on')::date)
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.w_create_quiz(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_attempt int; ch chapters;
begin
  select * into ch from chapters where id = (p->>'chapter_id')::uuid;
  if ch.id is null then raise exception 'chapter_id obrigatório'; end if;
  select coalesce(max(attempt), 0) + 1 into v_attempt from quizzes where chapter_id = ch.id;
  insert into quizzes (family_id, chapter_id, subject_id, kind, attempt, title, due_on, ai_prompt, questions)
  values (ch.family_id, ch.id, coalesce((p->>'subject_id')::uuid, ch.subject_id), coalesce(p->>'kind', 'capitulo'),
          v_attempt, coalesce(p->>'title', ''), (p->>'due_on')::date, coalesce(p->>'ai_prompt', ''), p->'questions')
  returning id into v_id;
  insert into quiz_keys (quiz_id, answer_key) values (v_id, p->'answer_key');
  return v_id;
end $$;

-- Capítulo novo precisa de book_id ou family_id (para saber a família).
create or replace function public.w_upsert_chapter(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_fam uuid; v_subject uuid; v_id uuid := (p->>'chapter_id')::uuid;
begin
  if v_id is null then
    v_fam := public.w_family_of(p);
    if v_fam is null then raise exception 'capítulo novo precisa de book_id ou family_id'; end if;
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

create or replace function public.w_flag_overdue() returns int
language sql security definer set search_path = public as $$
  with claimed as (
    update tasks set late_alerted = true
     where status = 'pendente' and not late_alerted and due_on < (now() at time zone 'America/Sao_Paulo')::date
    returning family_id, subject_id, chapter_id, title, due_on
  ), ins as (
    insert into alerts (family_id, kind, severity, subject_id, chapter_id, title, details)
    select family_id, 'revisao_atrasada', 'atencao', subject_id, chapter_id,
           'Tarefa atrasada: ' || title, 'Prazo era ' || to_char(due_on, 'DD/MM') || '.'
      from claimed
    returning 1
  )
  select count(*)::int from ins
$$;

-- Saídas da rodada passam a trazer family_id.
create or replace function public.w_claim_checkins() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  update checkins set status = 'corrigindo'
   where status = 'entregue' or (status = 'corrigindo' and submitted_at < now() - interval '2 hours');

  select coalesce(jsonb_agg(jsonb_build_object(
    'checkin_id', c.id, 'family_id', c.family_id, 'dia', c.day,
    'itens', (select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'materia', s.name, 'subject_id', s.id,
        'capitulo', ch.title, 'chapter_id', ch.id, 'paginas_capitulo', case when ch.id is null then null else jsonb_build_array(ch.start_page, ch.end_page) end,
        'livro', b.title, 'paginas', jsonb_build_array(i.page_from, i.page_to),
        'sem_aula', i.no_class_reason, 'aprendi', i.learned, 'folhas_texto', i.pages,
        'status', i.review_status,
        'fotos', (select count(*) from photos p where p.item_id = i.id),
        'historico', (select coalesce(jsonb_agg(jsonb_build_array(c2.day, i2.page_from, i2.page_to, i2.no_class_reason) order by c2.day), '[]')
                        from checkin_items i2 join checkins c2 on c2.id = i2.checkin_id
                       where i2.subject_id = i.subject_id and c2.day < c.day and c2.day > c.day - 120)
      ) order by s.name), '[]')
      from checkin_items i join subjects s on s.id = i.subject_id
      left join chapters ch on ch.id = i.chapter_id left join books b on b.id = i.book_id
      where i.checkin_id = c.id and i.review_status = 'pendente'),
    'faltando_na_grade', (select coalesce(jsonb_agg(distinct s.name), '[]')
        from timetables t join timetable_slots ts on ts.timetable_id = t.id join subjects s on s.id = ts.subject_id
       where t.family_id = c.family_id and t.status = 'ativa' and ts.weekday = extract(isodow from c.day)
         and not exists (select 1 from checkin_items i where i.checkin_id = c.id and i.subject_id = ts.subject_id))
  ) order by c.day), '[]') into v_out
  from checkins c where c.status = 'corrigindo';
  return v_out;
end $$;

create or replace function public.w_pending_setup() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'grades', (select coalesce(jsonb_agg(jsonb_build_object('timetable_id', id, 'family_id', family_id, 'motivo', child_reason, 'desde', valid_from)), '[]')
                 from timetables where status = 'aguardando_leitura'),
    'grade_ativa', (select coalesce(jsonb_agg(jsonb_build_array(t.family_id, ts.weekday, ts.position, s.name) order by t.family_id, ts.weekday, ts.position), '[]')
                 from timetables t join timetable_slots ts on ts.timetable_id = t.id join subjects s on s.id = ts.subject_id
                where t.status = 'ativa'),
    'livros', (select coalesce(jsonb_agg(jsonb_build_object('book_id', id, 'family_id', family_id, 'titulo', title)), '[]')
                 from books where status = 'aguardando_leitura'),
    'trimestres', (select coalesce(jsonb_agg(jsonb_build_object('family_id', family_id, 'nome', name, 'inicio', starts_on, 'fim', ends_on) order by starts_on), '[]') from terms)
  )
$$;

revoke all on function public.w_learner_profile_for(uuid) from public, anon, authenticated;
revoke all on function public.w_family_of(jsonb) from public, anon, authenticated;
revoke all on function public.w_learner_profile() from public, anon, authenticated;
revoke all on function public.w_add_alert(jsonb) from public, anon, authenticated;
revoke all on function public.w_add_task(jsonb) from public, anon, authenticated;
revoke all on function public.w_create_quiz(jsonb) from public, anon, authenticated;
revoke all on function public.w_upsert_chapter(jsonb) from public, anon, authenticated;
revoke all on function public.w_flag_overdue() from public, anon, authenticated;
revoke all on function public.w_claim_checkins() from public, anon, authenticated;
revoke all on function public.w_pending_setup() from public, anon, authenticated;
