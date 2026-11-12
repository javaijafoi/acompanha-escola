-- Fim de 2026: só Matemática, Ciências e História são obrigatórias; o resto é opcional ("café com leite").
-- Matéria nova nasce opcional; o responsável marca como obrigatória em Matérias.
-- w_claim_checkins passa a trazer 'obrigatoria' por item e só cobra matérias obrigatórias em faltando_na_grade
-- (mesma função da migração 20261112194000, com essas duas mudanças; aplicada no banco em 12/11/2026).
alter table public.subjects add column if not exists required boolean not null default false;
update public.subjects set required = true where name in ('Matemática', 'Ciências', 'História');

create or replace function public.w_claim_checkins() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_out jsonb;
begin
  update checkins set status = 'corrigindo'
   where status = 'entregue' or (status = 'corrigindo' and submitted_at < now() - interval '2 hours');

  select coalesce(jsonb_agg(jsonb_build_object(
    'checkin_id', c.id, 'family_id', c.family_id, 'dia', c.day,
    'itens', (select coalesce(jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'materia', s.name, 'subject_id', s.id, 'obrigatoria', s.required,
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
       where t.family_id = c.family_id and t.status = 'ativa' and ts.weekday = extract(isodow from c.day) and s.required
         and not exists (select 1 from checkin_items i where i.checkin_id = c.id and i.subject_id = ts.subject_id))
  ) order by c.day), '[]') into v_out
  from checkins c where c.status = 'corrigindo';
  return v_out;
end $$;

revoke all on function public.w_claim_checkins() from public, anon, authenticated;
