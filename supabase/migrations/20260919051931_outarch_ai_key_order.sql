-- A key on cooldown is tried last rather than never: when every key is cooling
-- down, the operator still gets an answer if any key recovers first.
create or replace function public.next_ai_keys(p_provider text)
returns table (id uuid, api_key text)
language sql
security definer
set search_path = ''
as $$
  select k.id, k.api_key
  from public.ai_provider_keys k
  where k.provider = p_provider
    and k.enabled
  order by (k.cooldown_until is not null and k.cooldown_until > now()) asc,
           k.priority asc,
           k.last_used_at asc nulls first
  limit 6;
$$;
revoke execute on function public.next_ai_keys(text) from public, anon, authenticated;
grant execute on function public.next_ai_keys(text) to service_role;