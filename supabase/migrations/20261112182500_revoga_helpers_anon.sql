-- Helpers de RLS só para usuários logados
revoke execute on function public.my_family_id() from public, anon;
revoke execute on function public.my_role() from public, anon;
grant execute on function public.my_family_id() to authenticated;
grant execute on function public.my_role() to authenticated;
