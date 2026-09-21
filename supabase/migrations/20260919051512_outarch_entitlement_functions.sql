-- The plan a user actually has right now: their subscription while it is
-- active and unexpired, Free otherwise.
create or replace function public.effective_plan_id(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case
      when s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end > now())
        then s.plan_id
      else 'free'
    end
    from public.subscriptions s
    where s.user_id = p_user
  ), 'free');
$$;
revoke execute on function public.effective_plan_id(uuid) from public, anon, authenticated;

-- The start of the current metering period and when it resets.
create or replace function public.usage_period(p_period text, out period_start date, out resets_at timestamptz)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'utc')::date;
begin
  if p_period = 'month' then
    period_start := date_trunc('month', v_today)::date;
    resets_at := (period_start + interval '1 month')::timestamp at time zone 'utc';
  elsif p_period = 'lifetime' then
    period_start := date '1970-01-01';
    resets_at := null;
  else
    period_start := v_today;
    resets_at := (v_today + 1)::timestamp at time zone 'utc';
  end if;
end;
$$;
revoke execute on function public.usage_period(text) from public, anon, authenticated;

-- Everything the desktop app and the website need to know about the signed-in
-- user in one read: who they are, their plan, its limits, and metered usage.
create or replace function public.get_entitlements()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_user auth.users%rowtype;
  v_profile public.profiles%rowtype;
  v_sub public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_limits jsonb;
  v_period text;
  v_start date;
  v_resets timestamptz;
  v_used integer := 0;
  v_trial_days integer;
begin
  if v_uid is null then
    raise exception 'Sign in to OUTARCH first' using errcode = '28000';
  end if;
  select * into v_user from auth.users where id = v_uid;
  -- Accounts created before the signup trigger existed get their rows here.
  insert into public.profiles (id, email) values (v_uid, v_user.email) on conflict (id) do nothing;
  insert into public.subscriptions (user_id, plan_id) values (v_uid, 'free') on conflict (user_id) do nothing;
  select * into v_profile from public.profiles where id = v_uid;
  select * into v_sub from public.subscriptions where user_id = v_uid;
  select * into v_plan from public.plans where id = public.effective_plan_id(v_uid);
  if v_plan.id is null then
    select * into v_plan from public.plans where id = 'free';
  end if;
  v_limits := v_plan.limits;
  v_period := coalesce(v_limits->>'missionAiPeriod', 'day');
  select p.period_start, p.resets_at into v_start, v_resets from public.usage_period(v_period) p;
  select coalesce(u.used, 0) into v_used from public.usage_counters u
    where u.user_id = v_uid and u.feature = 'mission_ai_message' and u.period_start = v_start;
  v_trial_days := nullif(v_limits->>'recipeTrialDays', '')::integer;

  return jsonb_build_object(
    'user', jsonb_build_object(
      'id', v_uid,
      'email', v_user.email,
      'name', coalesce(v_profile.full_name, v_user.raw_user_meta_data->>'full_name', v_user.raw_user_meta_data->>'name'),
      'avatarUrl', coalesce(v_profile.avatar_url, v_user.raw_user_meta_data->>'avatar_url'),
      'provider', coalesce(v_user.raw_app_meta_data->>'provider', 'email'),
      'createdAt', v_user.created_at
    ),
    'plan', jsonb_build_object('id', v_plan.id, 'name', v_plan.name, 'rank', v_plan.rank),
    'subscription', jsonb_build_object(
      'planId', v_sub.plan_id,
      'status', v_sub.status,
      'currentPeriodEnd', v_sub.current_period_end,
      'provider', v_sub.provider
    ),
    'limits', v_limits,
    'usage', jsonb_build_object(
      'missionAiMessages', jsonb_build_object(
        'used', coalesce(v_used, 0),
        'limit', v_limits->'missionAiMessages',
        'period', v_period,
        'resetsAt', v_resets
      )
    ),
    'recipeTrial', case when v_trial_days is null then null else jsonb_build_object(
      'days', v_trial_days,
      'startedAt', v_user.created_at,
      'endsAt', v_user.created_at + make_interval(days => v_trial_days)
    ) end,
    'serverTime', now()
  );
end;
$$;
revoke execute on function public.get_entitlements() from public, anon;
grant execute on function public.get_entitlements() to authenticated;

-- One Mission AI message. Counts it against the plan's quota atomically (two
-- windows sending at once cannot both take the last message) and opens the
-- turn the ai-proxy will serve model calls for.
create or replace function public.begin_ai_turn(p_surface text default 'mission')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_limits jsonb;
  v_limit integer;
  v_period text;
  v_start date;
  v_resets timestamptz;
  v_used integer;
  v_recent integer;
  v_turn uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to OUTARCH first' using errcode = '28000';
  end if;
  select p.limits into v_limits from public.plans p where p.id = public.effective_plan_id(v_uid);
  v_limit := nullif(v_limits->>'missionAiMessages', '')::integer;
  v_period := coalesce(v_limits->>'missionAiPeriod', 'day');
  select p.period_start, p.resets_at into v_start, v_resets from public.usage_period(v_period) p;

  if v_limit is not null and v_limit <= 0 then
    return jsonb_build_object('allowed', false, 'used', 0, 'limit', v_limit, 'period', v_period, 'resetsAt', v_resets);
  end if;

  -- A ceiling no honest operator reaches, so a leaked session cannot drain the keys.
  select count(*) into v_recent from public.ai_turns t where t.user_id = v_uid and t.created_at > now() - interval '1 day';
  if v_recent >= 2000 then
    return jsonb_build_object('allowed', false, 'reason', 'daily-ceiling', 'used', v_recent, 'limit', 2000, 'period', 'day', 'resetsAt', null);
  end if;

  if v_limit is null then
    insert into public.usage_counters as u (user_id, feature, period_start, used)
    values (v_uid, 'mission_ai_message', v_start, 1)
    on conflict (user_id, feature, period_start) do update set used = u.used + 1, updated_at = now()
    returning u.used into v_used;
  else
    insert into public.usage_counters as u (user_id, feature, period_start, used)
    values (v_uid, 'mission_ai_message', v_start, 1)
    on conflict (user_id, feature, period_start) do update set used = u.used + 1, updated_at = now()
      where u.used < v_limit
    returning u.used into v_used;
    if v_used is null then
      return jsonb_build_object('allowed', false, 'used', v_limit, 'limit', v_limit, 'period', v_period, 'resetsAt', v_resets);
    end if;
  end if;

  insert into public.ai_turns (user_id, surface) values (v_uid, left(coalesce(p_surface, 'mission'), 32)) returning id into v_turn;
  delete from public.ai_turns t where t.user_id = v_uid and t.created_at < now() - interval '2 days';

  return jsonb_build_object(
    'allowed', true,
    'turnId', v_turn,
    'used', v_used,
    'limit', v_limit,
    'remaining', case when v_limit is null then null else greatest(v_limit - v_used, 0) end,
    'period', v_period,
    'resetsAt', v_resets
  );
end;
$$;
revoke execute on function public.begin_ai_turn(text) from public, anon;
grant execute on function public.begin_ai_turn(text) to authenticated;

-- Used by the ai-proxy (service role only): one model call inside a turn.
create or replace function public.claim_ai_turn_call(p_turn uuid, p_user uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.ai_turns set calls = calls + 1
    where id = p_turn and user_id = p_user and expires_at > now() and calls < 60
    returning id into v_id;
  return v_id is not null;
end;
$$;
revoke execute on function public.claim_ai_turn_call(uuid, uuid) from public, anon, authenticated;
grant execute on function public.claim_ai_turn_call(uuid, uuid) to service_role;

-- Used by the ai-proxy (service role only): the keys to try, best first.
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
    and (k.cooldown_until is null or k.cooldown_until <= now())
  order by k.priority asc, k.last_used_at asc nulls first
  limit 6;
$$;
revoke execute on function public.next_ai_keys(text) from public, anon, authenticated;
grant execute on function public.next_ai_keys(text) to service_role;

-- Used by the ai-proxy (service role only): what happened when a key was used.
create or replace function public.report_ai_key_result(p_key uuid, p_ok boolean, p_status integer, p_error text, p_cooldown_seconds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_ok then
    update public.ai_provider_keys
      set success_count = success_count + 1, last_used_at = now(), last_status = coalesce(p_status, 200), cooldown_until = null
      where id = p_key;
  else
    update public.ai_provider_keys
      set failure_count = failure_count + 1,
          last_used_at = now(),
          last_status = p_status,
          last_error = left(coalesce(p_error, ''), 500),
          cooldown_until = case when coalesce(p_cooldown_seconds, 0) > 0 then now() + make_interval(secs => p_cooldown_seconds) else cooldown_until end
      where id = p_key;
  end if;
end;
$$;
revoke execute on function public.report_ai_key_result(uuid, boolean, integer, text, integer) from public, anon, authenticated;
grant execute on function public.report_ai_key_result(uuid, boolean, integer, text, integer) to service_role;

-- Whether the server has at least one usable built-in key per provider. The
-- app shows Mission AI's built-in models only for providers that do.
create or replace function public.builtin_ai_providers()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct k.provider order by k.provider), '{}')
  from public.ai_provider_keys k
  where k.enabled;
$$;
revoke execute on function public.builtin_ai_providers() from public, anon;
grant execute on function public.builtin_ai_providers() to authenticated;
