-- Admin conveniences for the OUTARCH owner. The admin schema is not exposed
-- through the Data API, so nothing here is reachable by app or website users.
create schema if not exists admin;
revoke all on schema admin from public, anon, authenticated;

-- Every account with its plan, in one place (read it in the Table Editor or SQL editor).
create or replace view admin.user_plans
with (security_invoker = true)
as
select
  u.id as user_id,
  u.email,
  coalesce(p.full_name, u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name') as name,
  coalesce(u.raw_app_meta_data->>'provider', 'email') as signed_in_with,
  s.plan_id as subscribed_plan,
  public.effective_plan_id(u.id) as effective_plan,
  s.status,
  s.current_period_end,
  s.provider as payment_provider,
  s.admin_note,
  u.created_at as joined_at,
  u.last_sign_in_at
from auth.users u
left join public.profiles p on p.id = u.id
left join public.subscriptions s on s.user_id = u.id;
revoke all on admin.user_plans from public, anon, authenticated;

-- select admin.set_plan('someone@example.com', 'pro', 30);   -- Pro for 30 days
-- select admin.set_plan('someone@example.com', 'ultimate');   -- Ultimate, no expiry
-- select admin.set_plan('someone@example.com', 'free');       -- back to Free
create or replace function admin.set_plan(p_email text, p_plan text, p_days integer default null, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  select id into v_uid from auth.users where lower(email) = lower(trim(p_email));
  if v_uid is null then
    raise exception 'No OUTARCH account uses %', p_email;
  end if;
  if not exists (select 1 from public.plans where id = p_plan) then
    raise exception 'Unknown plan %. Use free, pro or ultimate.', p_plan;
  end if;
  insert into public.subscriptions (user_id, plan_id, status, current_period_end, provider, admin_note)
  values (v_uid, p_plan, 'active', case when p_days is null then null else now() + make_interval(days => p_days) end, 'manual', p_note)
  on conflict (user_id) do update set
    plan_id = excluded.plan_id,
    status = 'active',
    current_period_end = excluded.current_period_end,
    provider = 'manual',
    admin_note = coalesce(excluded.admin_note, public.subscriptions.admin_note);
  update public.upgrade_requests set status = 'done' where user_id = v_uid and plan_id = p_plan and status = 'open';
  return format('%s is now on %s%s', p_email, p_plan, case when p_days is null then ' (no expiry)' else format(' until %s', to_char(now() + make_interval(days => p_days), 'YYYY-MM-DD')) end);
end;
$$;
revoke all on function admin.set_plan(text, text, integer, text) from public, anon, authenticated;

-- select admin.add_ai_key('gemini', 'AIza...', 'Gemini key 3');   -- add a built-in key
create or replace function admin.add_ai_key(p_provider text, p_key text, p_label text default '', p_priority integer default 100)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into public.ai_provider_keys (provider, api_key, label, priority)
  values (p_provider, trim(p_key), coalesce(p_label, ''), coalesce(p_priority, 100))
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function admin.add_ai_key(text, text, text, integer) from public, anon, authenticated;

-- The health of every built-in key, without printing the key itself.
create or replace view admin.ai_key_health
with (security_invoker = true)
as
select
  id, provider, label, priority, enabled,
  left(api_key, 6) || '…' || right(api_key, 4) as key_hint,
  case
    when not enabled then 'disabled'
    when cooldown_until > now() then 'cooling down'
    else 'ready'
  end as state,
  cooldown_until, last_status, last_error, last_used_at, success_count, failure_count
from public.ai_provider_keys
order by provider, priority;
revoke all on admin.ai_key_health from public, anon, authenticated;
