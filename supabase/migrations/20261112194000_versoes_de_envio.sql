-- Versões de envio: quando a correção devolve uma matéria, o aluno completa e reenvia só aquela matéria
-- (mesmo em outro dia). Cada reenvio é uma nova versão; as correções anteriores ficam no histórico.
-- Se ele não reenviar até o fim do dia, a rodada do dia seguinte avisa o responsável.

alter table public.checkin_items
  add column if not exists version int not null default 1,
  add column if not exists returned_at timestamptz,
  add column if not exists resent_at timestamptz,
  add column if not exists return_alerted boolean not null default false;

alter table public.photos
  add column if not exists version int not null default 1;

alter table public.reviews
  add column if not exists version int not null default 1,
  add column if not exists todo jsonb not null default '[]';   -- ["Mandar a foto da pág. 43", "Responder Q3 da pág. 44"]

comment on column public.reviews.todo is 'Pedido exato ao aluno quando devolvido: lista curta do que falta';

-- Correções anteriores (cada versão devolvida fica guardada aqui)
create table if not exists public.review_history (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  item_id uuid not null references public.checkin_items(id) on delete cascade,
  version int not null,
  verdict text not null,
  message_to_child text not null default '',
  todo jsonb not null default '[]',
  exercises jsonb not null default '[]',
  done_ratio numeric,
  correct_ratio numeric,
  reviewed_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists review_history_item on public.review_history(item_id);
create index if not exists review_history_family on public.review_history(family_id);
alter table public.review_history enable row level security;
create policy "família lê histórico de correções" on public.review_history for select to authenticated
  using (family_id = (select public.my_family_id()));

-- O aluno reenvia uma matéria devolvida: as fotos já foram para o storage (pasta da família);
-- aqui registramos a nova versão e devolvemos o dia para a fila de correção.
create or replace function public.resend_item(p_item uuid, p_paths text[], p_note text default '')
returns int
language plpgsql security definer set search_path = public as $$
declare it checkin_items; ck checkins; v_ver int; pth text;
begin
  select * into it from checkin_items where id = p_item;
  if it.id is null then raise exception 'matéria não encontrada'; end if;
  select * into ck from checkins where id = it.checkin_id;
  if ck.child_id is distinct from auth.uid() then raise exception 'só o aluno pode reenviar'; end if;
  if it.review_status <> 'devolvido' then raise exception 'essa matéria não está devolvida'; end if;
  if coalesce(array_length(p_paths, 1), 0) = 0 then raise exception 'mande pelo menos uma foto'; end if;
  v_ver := it.version + 1;
  foreach pth in array p_paths loop
    if split_part(pth, '/', 1) <> it.family_id::text or split_part(pth, '/', 3) <> it.id::text then
      raise exception 'caminho de foto inválido';
    end if;
    insert into photos (family_id, item_id, storage_path, version) values (it.family_id, it.id, pth, v_ver);
  end loop;
  update checkin_items set version = v_ver, review_status = 'pendente', resent_at = now(),
         pages = case when coalesce(p_note, '') = '' then pages else trim(both ' ' from pages || ' · v' || v_ver || ': ' || p_note) end
   where id = it.id;
  -- Se a correção estiver rodando agora, o w_finish_checkins devolve o dia para a fila.
  update checkins set status = 'entregue', submitted_at = now() where id = ck.id and status in ('corrigido', 'rascunho');
  return v_ver;
end $$;
revoke all on function public.resend_item(uuid, text[], text) from public, anon;
grant execute on function public.resend_item(uuid, text[], text) to authenticated;

-- A correção grava a versão atual; a anterior vai para o histórico.
-- Novos campos: todo (lista do que falta, quando devolvido).
create or replace function public.w_save_review(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare v_item uuid := (p->>'item_id')::uuid; pg jsonb; it checkin_items;
begin
  select * into it from checkin_items where id = v_item;
  if it.id is null then raise exception 'item não encontrado'; end if;

  insert into review_history (family_id, item_id, version, verdict, message_to_child, todo, exercises, done_ratio, correct_ratio, reviewed_at)
  select family_id, item_id, version, verdict, message_to_child, todo, exercises, done_ratio, correct_ratio, created_at
    from reviews where item_id = v_item and version < it.version;

  insert into reviews (family_id, item_id, version, verdict, topics, summary, message_to_child, todo, exercises,
                       done_ratio, correct_ratio, revision_sheet)
  values (it.family_id, it.id, it.version, p->>'verdict',
          coalesce(array(select jsonb_array_elements_text(p->'topics')), '{}'),
          coalesce(p->>'summary', ''), coalesce(p->>'message_to_child', ''),
          case when p->>'verdict' = 'devolvido' then coalesce(p->'todo', '[]'::jsonb) else '[]'::jsonb end,
          coalesce(p->'exercises', '[]'::jsonb), (p->>'done_ratio')::numeric, (p->>'correct_ratio')::numeric,
          coalesce(p->>'revision_sheet', ''))
  on conflict (item_id) do update set version = excluded.version, verdict = excluded.verdict, topics = excluded.topics,
    summary = excluded.summary, message_to_child = excluded.message_to_child, todo = excluded.todo,
    exercises = excluded.exercises, done_ratio = excluded.done_ratio, correct_ratio = excluded.correct_ratio,
    revision_sheet = excluded.revision_sheet, created_at = now();

  update checkin_items set review_status = p->>'verdict',
         returned_at = case when p->>'verdict' = 'devolvido' then now() else returned_at end,
         return_alerted = case when p->>'verdict' = 'devolvido' then false else return_alerted end
   where id = v_item;

  for pg in select * from jsonb_array_elements(coalesce(p->'pages', '[]'::jsonb)) loop
    update photos set page_number = (pg->>'page_number')::int, sort = (pg->>'sort')::int
     where id = (pg->>'photo_id')::uuid and item_id = v_item;
  end loop;
end $$;

-- Dia com matéria reenviada durante a rodada volta para a fila em vez de ficar "corrigido".
create or replace function public.w_finish_checkins() returns int
language sql security definer set search_path = public as $$
  with u as (
    update checkins c set
      status = case when exists (select 1 from checkin_items i where i.checkin_id = c.id and i.review_status = 'pendente')
                    then 'entregue' else 'corrigido' end,
      reviewed_at = now()
     where c.status = 'corrigindo'
    returning 1)
  select count(*)::int from u
$$;

-- Devolvida num dia e não reenviada até o fim dele: avisa o responsável (uma vez por devolução).
create or replace function public.w_flag_unreturned() returns int
language sql security definer set search_path = public as $$
  with claimed as (
    update checkin_items i set return_alerted = true
     where i.review_status = 'devolvido' and not i.return_alerted and i.returned_at is not null
       and (i.returned_at at time zone 'America/Sao_Paulo')::date < (now() at time zone 'America/Sao_Paulo')::date
    returning i.id, i.family_id, i.subject_id, i.chapter_id, i.page_from, i.page_to, i.returned_at, i.version
  ), ins as (
    insert into alerts (family_id, kind, severity, subject_id, chapter_id, title, details)
    select c.family_id, 'revisao_atrasada', 'atencao', c.subject_id, c.chapter_id,
           'Não reenviou: ' || s.name || coalesce(' págs. ' || c.page_from || '–' || c.page_to, ''),
           'Devolvida em ' || to_char(c.returned_at at time zone 'America/Sao_Paulo', 'DD/MM') ||
           ' (versão ' || c.version || '). O que falta: ' ||
           coalesce((select string_agg(t, '; ') from reviews r, jsonb_array_elements_text(r.todo) t where r.item_id = c.id), 'ver a correção') || '.'
      from claimed c join subjects s on s.id = c.subject_id
    returning 1
  )
  select count(*)::int from ins
$$;

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
        and due_on < (now() at time zone 'America/Sao_Paulo')::date),
    'devolvidas_sem_reenvio', (select count(*) from checkin_items where review_status = 'devolvido' and not return_alerted
        and returned_at is not null
        and (returned_at at time zone 'America/Sao_Paulo')::date < (now() at time zone 'America/Sao_Paulo')::date)
  )
$$;

-- A rodada passa a ver a versão, o que foi pedido antes e as fotos por versão.
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
        'status', i.review_status, 'versao', i.version,
        'pedido_anterior', (select r.todo from reviews r where r.item_id = i.id and r.version < i.version),
        'devolucoes_anteriores', (select count(*) from review_history h where h.item_id = i.id and h.verdict = 'devolvido')
                                 + (select count(*) from reviews r where r.item_id = i.id and r.version < i.version and r.verdict = 'devolvido'),
        'fotos', (select count(*) from photos p where p.item_id = i.id),
        'fotos_por_versao', (select jsonb_object_agg(v, n) from (select p.version v, count(*) n from photos p where p.item_id = i.id group by p.version) x),
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

revoke all on function public.w_save_review(jsonb) from public, anon, authenticated;
revoke all on function public.w_finish_checkins() from public, anon, authenticated;
revoke all on function public.w_flag_unreturned() from public, anon, authenticated;
revoke all on function public.w_status() from public, anon, authenticated;
revoke all on function public.w_claim_checkins() from public, anon, authenticated;
