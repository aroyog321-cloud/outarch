-- OUTARCH accounts, plans and subscriptions.
-- Every table has row level security. Users can read only their own rows;
-- nothing a user can reach lets them change their own plan or usage.

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- 1. The plan catalogue. Admin-editable; public to read (the website's pricing page).
create table public.plans (
  id text primary key constraint plans_id_format check (id ~ '^[a-z][a-z0-9_-]{1,31}$'),
  name text not null,
  rank smallint not null unique,
  tagline text not null default '',
  price_label text not null default '',
  highlights text[] not null default '{}',
  limits jsonb not null,
  purchasable boolean not null default true,
  updated_at timestamptz not null default now()
);
comment on table public.plans is 'OUTARCH plan catalogue. limits: terminals, projects, projectSwitching, mcp (none|read|full), mobileCompanion, vscodeBridge, recipes, recipeTrialDays, byokKeys, missionAiMessages, missionAiPeriod (day|month|lifetime). A null number means unlimited.';
create trigger plans_touch before update on public.plans for each row execute function public.touch_updated_at();
alter table public.plans enable row level security;
create policy "Anyone can read the plan catalogue" on public.plans for select to anon, authenticated using (true);
grant select on public.plans to anon, authenticated;

insert into public.plans (id, name, rank, tagline, highlights, limits, purchasable) values
  ('free', 'Free', 0, 'Start supervising your terminals.',
   array['3 terminals','1 project','Recipes: 3-day trial, 1 recipe','Mission AI: 3 messages a day'],
   '{"terminals":3,"projects":1,"projectSwitching":false,"mcp":"none","mobileCompanion":false,"vscodeBridge":false,"recipes":1,"recipeTrialDays":3,"byokKeys":0,"missionAiMessages":3,"missionAiPeriod":"day"}'::jsonb,
   false),
  ('pro', 'Pro', 1, 'For developers running a real stack.',
   array['8 terminals','Unlimited projects and switching','MCP read access','Mobile companion','3 recipes','1 BYOK key','Full Mission AI'],
   '{"terminals":8,"projects":null,"projectSwitching":true,"mcp":"read","mobileCompanion":true,"vscodeBridge":false,"recipes":3,"recipeTrialDays":null,"byokKeys":1,"missionAiMessages":null,"missionAiPeriod":"day"}'::jsonb,
   true),
  ('ultimate', 'Ultimate', 2, 'Everything OUTARCH can do, without limits.',
   array['Unlimited terminals','Full MCP access','Mobile companion','VS Code bridge','Unlimited recipes','Unlimited BYOK keys','Full Mission AI'],
   '{"terminals":null,"projects":null,"projectSwitching":true,"mcp":"full","mobileCompanion":true,"vscodeBridge":true,"recipes":null,"recipeTrialDays":null,"byokKeys":null,"missionAiMessages":null,"missionAiPeriod":"day"}'::jsonb,
   true);

-- 2. Profiles, one per auth user.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
alter table public.profiles enable row level security;
create policy "Users read their own profile" on public.profiles for select to authenticated using ((select auth.uid()) = id);
create policy "Users update their own profile" on public.profiles for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
grant select on public.profiles to authenticated;
grant update (full_name, avatar_url) on public.profiles to authenticated;

-- 3. Subscriptions. Only the admin (dashboard / service role) writes these.
create table public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan_id text not null default 'free' references public.plans(id),
  status text not null default 'active' check (status in ('active','trialing','past_due','canceled','expired')),
  current_period_end timestamptz,
  provider text not null default 'manual',
  provider_reference text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.subscriptions is 'Set plan_id (free|pro|ultimate) and current_period_end (null = never expires) to change what a user can do. The app picks the change up within a few minutes.';
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();
alter table public.subscriptions enable row level security;
create policy "Users read their own subscription" on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.subscriptions to authenticated;

-- 4. Metered usage (Mission AI messages on plans that cap them).
create table public.usage_counters (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature text not null,
  period_start date not null,
  used integer not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature, period_start)
);
alter table public.usage_counters enable row level security;
create policy "Users read their own usage" on public.usage_counters for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.usage_counters to authenticated;

-- 5. One row per Mission AI message: the AI proxy only serves model calls that
-- belong to a live turn, so the message quota cannot be bypassed.
create table public.ai_turns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  surface text not null default 'mission',
  calls integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '1 hour'
);
create index ai_turns_user_created on public.ai_turns (user_id, created_at desc);
alter table public.ai_turns enable row level security;
revoke all on public.ai_turns from anon, authenticated;

-- 6. The built-in AI keys. Never readable by app users: only the ai-proxy
-- Edge Function (service role) and the dashboard can see them.
create table public.ai_provider_keys (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gemini','nvidia')),
  label text not null default '',
  api_key text not null check (length(api_key) >= 20),
  priority integer not null default 100,
  enabled boolean not null default true,
  cooldown_until timestamptz,
  last_status integer,
  last_error text,
  last_used_at timestamptz,
  success_count bigint not null default 0,
  failure_count bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.ai_provider_keys is 'Built-in Mission AI keys. Lower priority is tried first. When a provider refuses a key (quota, rate limit, revoked) the proxy puts it on cooldown and moves to the next. To replace a used-up key: insert a new row, or set enabled = false on the old one.';
create trigger ai_provider_keys_touch before update on public.ai_provider_keys for each row execute function public.touch_updated_at();
alter table public.ai_provider_keys enable row level security;
revoke all on public.ai_provider_keys from anon, authenticated;

-- 7. Public app configuration (no secrets here: anyone can read it).
create table public.app_config (
  key text primary key check (key ~ '^[a-z][a-z0-9_.-]{1,63}$'),
  value jsonb not null,
  description text not null default '',
  updated_at timestamptz not null default now()
);
create trigger app_config_touch before update on public.app_config for each row execute function public.touch_updated_at();
alter table public.app_config enable row level security;
create policy "Anyone can read public app configuration" on public.app_config for select to anon, authenticated using (true);
grant select on public.app_config to anon, authenticated;

insert into public.app_config (key, value, description) values
  ('website_url', '"http://localhost:5173"', 'Where the OUTARCH website is served. The desktop app sends people here to sign in and to manage their plan.'),
  ('support_email', '""', 'Shown on the pricing page for upgrade questions.'),
  ('update_channel', '"stable"', 'The release channel desktop apps follow.');

-- 8. Desktop releases for the auto-updater. Signed with the OUTARCH release
-- key; the app refuses any row whose signature does not verify.
create table public.app_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null check (version ~ '^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$'),
  channel text not null default 'stable',
  notes text not null default '',
  download_url text not null check (download_url ~ '^https://'),
  file_name text not null,
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  size_bytes bigint not null check (size_bytes > 0),
  signature text not null,
  published_at timestamptz not null default now(),
  mandatory boolean not null default false,
  enabled boolean not null default true,
  unique (channel, version)
);
alter table public.app_releases enable row level security;
create policy "Anyone can read published releases" on public.app_releases for select to anon, authenticated using (enabled);
grant select on public.app_releases to anon, authenticated;

-- 9. Upgrade requests from the website while payments are handled manually.
create table public.upgrade_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  message text not null default '' check (length(message) <= 1000),
  status text not null default 'open' check (status in ('open','done','declined')),
  created_at timestamptz not null default now()
);
create index upgrade_requests_user on public.upgrade_requests (user_id, created_at desc);
alter table public.upgrade_requests enable row level security;
create policy "Users read their own upgrade requests" on public.upgrade_requests for select to authenticated using ((select auth.uid()) = user_id);
create policy "Users file their own upgrade requests" on public.upgrade_requests for insert to authenticated with check ((select auth.uid()) = user_id and status = 'open');
grant select on public.upgrade_requests to authenticated;
grant insert (plan_id, message) on public.upgrade_requests to authenticated;

-- 10. Every new account gets a profile and a Free subscription.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  insert into public.subscriptions (user_id, plan_id) values (new.id, 'free') on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
