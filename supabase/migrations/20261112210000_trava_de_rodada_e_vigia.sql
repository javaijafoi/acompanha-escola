-- Esquema misto: o PC do Peter corrige na hora (sessão do Claude Code com vigia) e as rotinas
-- agendadas pegam o que sobrou. Para nunca corrigirem a mesma coisa duas vezes, só uma rodada
-- pode estar aberta por vez (trava com prazo de 40 min; se a rodada cair, a trava expira sozinha).

alter table public.correction_runs
  add column if not exists owner text not null default 'rotina',
  add column if not exists lease_until timestamptz;

-- Abre uma rodada se não houver outra viva. Devolve o id, ou null se outra rodada está corrigindo.
create or replace function public.w_try_open_run(p_owner text) returns uuid
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('acompanha-escola:rodada'));
  if exists (select 1 from correction_runs where finished_at is null
               and coalesce(lease_until, started_at + interval '40 minutes') > now()) then
    return null;
  end if;
  insert into correction_runs (owner, lease_until)
  values (coalesce(nullif(p_owner, ''), 'rotina'), now() + interval '40 minutes')
  returning id into v_id;
  return v_id;
end $$;

-- Compatibilidade: a forma antiga agora também respeita a trava.
create or replace function public.w_open_run() returns uuid
language sql security definer set search_path = public as $$
  select public.w_try_open_run('rotina')
$$;

-- Rodada longa: renove a trava a cada etapa grande (devolve false se a rodada já foi encerrada).
create or replace function public.w_renew_run(p_run uuid) returns boolean
language sql security definer set search_path = public as $$
  with u as (update correction_runs set lease_until = now() + interval '40 minutes'
              where id = p_run and finished_at is null returning 1)
  select exists (select 1 from u)
$$;

create or replace function public.w_close_run(p_run uuid, p_checkins int, p_quizzes int, p_notes text) returns void
language sql security definer set search_path = public as $$
  update correction_runs set finished_at = now(), lease_until = now(), checkins_processed = p_checkins,
         quizzes_graded = p_quizzes, notes = p_notes where id = p_run;
$$;

-- Quem está corrigindo agora.
create or replace function public.w_run_in_progress() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_build_object('run_id', id, 'owner', owner, 'started_at', started_at,
                            'lease_until', coalesce(lease_until, started_at + interval '40 minutes'))
                     from correction_runs where finished_at is null
                      and coalesce(lease_until, started_at + interval '40 minutes') > now()
                    order by started_at desc limit 1), 'null'::jsonb)
$$;

-- Chave do vigia do PC: só permite ler contagens da fila (edge function `fila`). Guardamos só o hash.
create table if not exists public.watch_keys (
  key_hash text primary key,
  label text not null default 'pc',
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
alter table public.watch_keys enable row level security;

create or replace function public.w_new_watch_key(p_label text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare v_key text := encode(gen_random_bytes(24), 'hex');
begin
  insert into watch_keys (key_hash, label) values (encode(digest(v_key, 'sha256'), 'hex'), coalesce(p_label, 'pc'));
  return v_key;
end $$;

-- Usada pela edge function `fila`: confere a chave e devolve só contagens.
create or replace function public.w_watch(p_key text) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare s jsonb;
begin
  update watch_keys set last_seen_at = now() where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex');
  if not found then return null; end if;
  s := w_status();
  return jsonb_build_object(
    'para_corrigir', (s->>'dias_entregues')::int + (s->>'provinhas_respondidas')::int + (s->>'capitulos_sem_provinha')::int
                     + (s->>'grades_para_ler')::int + (s->>'livros_para_ler')::int + (s->>'provas_para_ler')::int,
    'status', s,
    'rodada_aberta', w_run_in_progress() <> 'null'::jsonb);
end $$;

revoke all on function public.w_try_open_run(text) from public, anon, authenticated;
revoke all on function public.w_open_run() from public, anon, authenticated;
revoke all on function public.w_renew_run(uuid) from public, anon, authenticated;
revoke all on function public.w_close_run(uuid, int, int, text) from public, anon, authenticated;
revoke all on function public.w_run_in_progress() from public, anon, authenticated;
revoke all on function public.w_new_watch_key(text) from public, anon, authenticated;
revoke all on function public.w_watch(text) from public, anon, authenticated;
