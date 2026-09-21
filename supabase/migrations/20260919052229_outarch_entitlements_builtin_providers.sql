-- get_entitlements also says which providers have a built-in key, so the app
-- learns everything in one read and builtin_ai_providers() need not be public.
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
    'builtinAiProviders', to_jsonb(public.builtin_ai_providers()),
    'serverTime', now()
  );
end;
$$;
revoke execute on function public.get_entitlements() from public, anon;
grant execute on function public.get_entitlements() to authenticated;
revoke execute on function public.builtin_ai_providers() from public, anon, authenticated;