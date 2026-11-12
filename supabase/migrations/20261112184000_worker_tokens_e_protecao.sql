-- Tokens curtos que a rodada de correção gera via SQL para baixar as fotos pela edge function.
create table public.worker_tokens (
  token text primary key default encode(gen_random_bytes(24), 'hex'),
  expires_at timestamptz not null default now() + interval '1 hour',
  created_at timestamptz not null default now()
);
alter table public.worker_tokens enable row level security;

-- A filha só pode voltar um item para 'pendente'; aceitar/devolver é só da correção.
create or replace function public.guard_review_status() returns trigger
language plpgsql set search_path = public as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and new.review_status is distinct from old.review_status
     and new.review_status <> 'pendente' then
    raise exception 'Só a correção pode aceitar ou devolver uma matéria';
  end if;
  return new;
end $$;
create trigger checkin_items_guard_review
  before update on public.checkin_items
  for each row execute function public.guard_review_status();
revoke execute on function public.guard_review_status() from public, anon, authenticated;
