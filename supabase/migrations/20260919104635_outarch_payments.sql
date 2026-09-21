-- Online payments for OUTARCH plans (Cashfree).
--
-- Prices live in the database so the website, the checkout function and the
-- desktop app all read the same numbers. A purchase is prepaid time: paying
-- for Pro or Ultimate switches that plan on for 1 or 12 months. Buying the
-- same plan again adds the time to the end; moving up from Pro to Ultimate
-- carries the Pro time that was left over, converted at the two monthly
-- prices. Only the payment Edge Functions (service role) can apply a payment.

-- 1. What each paid plan costs, per billing period and currency.
create table public.plan_prices (
  plan_id text not null references public.plans(id) on delete cascade,
  period text not null check (period in ('month','year')),
  currency text not null check (currency in ('INR','USD')),
  amount numeric(12,2) not null check (amount > 0),
  months smallint not null check (months between 1 and 36),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (plan_id, period, currency)
);
comment on table public.plan_prices is 'What a paid plan costs. month = 1 month, year = 12 months. Change amount here: the website and checkout both read it.';
create trigger plan_prices_touch before update on public.plan_prices for each row execute function public.touch_updated_at();
alter table public.plan_prices enable row level security;
create policy "Anyone can read plan prices" on public.plan_prices for select to anon, authenticated using (true);
grant select on public.plan_prices to anon, authenticated;

insert into public.plan_prices (plan_id, period, currency, amount, months) values
  ('pro', 'month', 'INR', 700, 1),
  ('pro', 'month', 'USD', 7.30, 1),
  ('pro', 'year', 'INR', 7000, 12),
  ('pro', 'year', 'USD', 73.00, 12),
  ('ultimate', 'month', 'INR', 1000, 1),
  ('ultimate', 'month', 'USD', 10.42, 1),
  ('ultimate', 'year', 'INR', 10000, 12),
  ('ultimate', 'year', 'USD', 104.20, 12);

-- The app's upgrade dialog shows this label.
update public.plans set price_label = '₹700 / month ($7.30)' where id = 'pro';
update public.plans set price_label = '₹1,000 / month ($10.42)' where id = 'ultimate';

-- 2. Every checkout. Written only by the payment functions; users read their own.
create table public.payments (
  id text primary key check (id ~ '^oa_[A-Za-z0-9_-]{8,40}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null references public.plans(id),
  period text not null check (period in ('month','year')),
  months smallint not null check (months between 1 and 36),
  currency text not null check (currency in ('INR','USD')),
  amount numeric(12,2) not null check (amount > 0),
  provider text not null default 'cashfree',
  environment text not null check (environment in ('sandbox','production')),
  status text not null default 'created' check (status in ('created','paid','failed','expired','refunded')),
  provider_order_id text,
  provider_payment_id text,
  payment_method text,
  last_event text,
  period_start timestamptz,
  period_end timestamptz,
  note text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  updated_at timestamptz not null default now()
);
comment on table public.payments is 'One row per checkout. status paid means the plan was switched on by public.apply_payment().';
create index payments_user on public.payments (user_id, created_at desc);
create trigger payments_touch before update on public.payments for each row execute function public.touch_updated_at();
alter table public.payments enable row level security;
create policy "Users read their own payments" on public.payments for select to authenticated using ((select auth.uid()) = user_id);
grant select on public.payments to authenticated;

-- 3. What buying p_months of p_plan would do to p_user's subscription.
-- One place decides it, for the checkout preview and for the real thing.
create or replace function public.purchase_outcome(p_user uuid, p_plan text, p_months integer, p_at timestamptz default now())
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
  v_new public.plans%rowtype;
  v_cur public.plans%rowtype;
  v_cur_price numeric;
  v_new_price numeric;
  v_bought interval;
  v_left interval := interval '0';
  v_credit interval := interval '0';
  v_end timestamptz;
begin
  select * into v_new from public.plans where id = p_plan;
  if v_new.id is null or not v_new.purchasable then
    return jsonb_build_object('blocked', true, 'reason', 'This plan cannot be bought.');
  end if;
  if p_months is null or p_months < 1 then
    return jsonb_build_object('blocked', true, 'reason', 'Choose a billing period.');
  end if;
  select * into v_sub from public.subscriptions where user_id = p_user;
  select * into v_cur from public.plans where id = public.effective_plan_id(p_user);
  v_bought := (p_at + make_interval(months => p_months)) - p_at;

  if v_cur.id is null or v_cur.id = 'free' then
    v_end := p_at + v_bought;
    return jsonb_build_object('blocked', false, 'planId', v_new.id, 'currentPlanId', 'free', 'currentPeriodEnd', null,
      'startsAt', p_at, 'endsAt', v_end, 'carriedOver', 0, 'kind', 'new');
  end if;

  if v_sub.current_period_end is null then
    return jsonb_build_object('blocked', true, 'currentPlanId', v_cur.id,
      'reason', format('Your %s plan has no end date, so there is nothing to buy. Write to support to change it.', v_cur.name));
  end if;

  if v_cur.id = v_new.id then
    v_end := greatest(v_sub.current_period_end, p_at) + v_bought;
    return jsonb_build_object('blocked', false, 'planId', v_new.id, 'currentPlanId', v_cur.id, 'currentPeriodEnd', v_sub.current_period_end,
      'startsAt', greatest(v_sub.current_period_end, p_at), 'endsAt', v_end, 'carriedOver', 0, 'kind', 'extend');
  end if;

  if v_new.rank < v_cur.rank then
    return jsonb_build_object('blocked', true, 'currentPlanId', v_cur.id, 'currentPeriodEnd', v_sub.current_period_end,
      'reason', format('You are on %s until %s. Buy %s to extend it, or pick %s after it ends.', v_cur.name, to_char(v_sub.current_period_end at time zone 'utc', 'FMDD Mon YYYY'), v_cur.name, v_new.name));
  end if;

  -- Moving up: the time left on the lower plan is carried over at its value.
  select amount into v_cur_price from public.plan_prices where plan_id = v_cur.id and period = 'month' and currency = 'INR';
  select amount into v_new_price from public.plan_prices where plan_id = v_new.id and period = 'month' and currency = 'INR';
  if v_sub.current_period_end > p_at then
    v_left := v_sub.current_period_end - p_at;
  end if;
  if v_cur_price is not null and v_new_price is not null and v_new_price > 0 then
    v_credit := v_left * (v_cur_price / v_new_price)::double precision;
  end if;
  v_end := p_at + v_bought + v_credit;
  return jsonb_build_object('blocked', false, 'planId', v_new.id, 'currentPlanId', v_cur.id, 'currentPeriodEnd', v_sub.current_period_end,
    'startsAt', p_at, 'endsAt', v_end, 'carriedOver', round((extract(epoch from v_credit) / 86400)::numeric, 1), 'kind', 'upgrade');
end;
$$;
revoke all on function public.purchase_outcome(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.purchase_outcome(uuid, text, integer, timestamptz) to service_role;

-- 4. The checkout page's preview for the signed-in user.
create or replace function public.checkout_quote(p_plan text, p_period text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_months integer;
  v_prices jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in to OUTARCH first' using errcode = '28000';
  end if;
  select max(months), jsonb_object_agg(currency, amount) into v_months, v_prices
    from public.plan_prices where plan_id = p_plan and period = p_period and active;
  if v_months is null then
    return jsonb_build_object('blocked', true, 'reason', 'This plan and period are not for sale.');
  end if;
  return public.purchase_outcome(v_uid, p_plan, v_months) || jsonb_build_object('months', v_months, 'prices', v_prices, 'period', p_period);
end;
$$;
revoke all on function public.checkout_quote(text, text) from public, anon;
grant execute on function public.checkout_quote(text, text) to authenticated;

-- 5. A payment the provider confirmed: switch the plan on. Idempotent, so the
-- webhook and the checkout page can both report the same order safely.
create or replace function public.apply_payment(p_order text, p_payment_id text default null, p_method text default null, p_amount numeric default null, p_currency text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pay public.payments%rowtype;
  v_sub public.subscriptions%rowtype;
  v_cur public.plans%rowtype;
  v_outcome jsonb;
  v_plan text;
  v_start timestamptz;
  v_end timestamptz;
  v_note text;
  v_cur_price numeric;
  v_new_price numeric;
begin
  select * into v_pay from public.payments where id = p_order for update;
  if v_pay.id is null then
    raise exception 'Unknown order %', p_order using errcode = 'P0002';
  end if;
  if v_pay.status = 'paid' then
    return jsonb_build_object('applied', false, 'alreadyPaid', true, 'orderId', v_pay.id, 'planId', v_pay.plan_id, 'periodEnd', v_pay.period_end);
  end if;
  if p_amount is not null and p_amount <> v_pay.amount then
    raise exception 'Paid amount % does not match the order amount %', p_amount, v_pay.amount;
  end if;
  if p_currency is not null and upper(p_currency) <> v_pay.currency then
    raise exception 'Paid currency % does not match the order currency %', p_currency, v_pay.currency;
  end if;

  insert into public.subscriptions (user_id, plan_id) values (v_pay.user_id, 'free') on conflict (user_id) do nothing;
  select * into v_sub from public.subscriptions where user_id = v_pay.user_id for update;
  v_outcome := public.purchase_outcome(v_pay.user_id, v_pay.plan_id, v_pay.months);

  if not coalesce((v_outcome->>'blocked')::boolean, false) then
    v_plan := v_outcome->>'planId';
    v_start := (v_outcome->>'startsAt')::timestamptz;
    v_end := (v_outcome->>'endsAt')::timestamptz;
  else
    -- The plan changed between checkout and payment (for example a second
    -- tab bought the higher plan). The money is never wasted: it extends the
    -- plan the person has now, converted at the two monthly prices.
    select * into v_cur from public.plans where id = public.effective_plan_id(v_pay.user_id);
    v_plan := v_cur.id;
    v_start := now();
    if v_sub.current_period_end is null then
      v_end := null;
      v_note := 'Paid while on a plan with no end date; refund or extend by hand.';
    else
      select amount into v_cur_price from public.plan_prices where plan_id = v_cur.id and period = 'month' and currency = 'INR';
      select amount into v_new_price from public.plan_prices where plan_id = v_pay.plan_id and period = 'month' and currency = 'INR';
      v_end := greatest(v_sub.current_period_end, now())
        + ((now() + make_interval(months => v_pay.months)) - now()) * (coalesce(v_new_price, 1) / coalesce(nullif(v_cur_price, 0), 1))::double precision;
      v_note := format('Bought %s while on %s; converted into %s time.', v_pay.plan_id, v_cur.id, v_cur.id);
    end if;
  end if;

  if v_end is not null or v_plan <> v_sub.plan_id then
    update public.subscriptions set
      plan_id = v_plan,
      status = 'active',
      current_period_end = v_end,
      provider = v_pay.provider,
      provider_reference = v_pay.id
    where user_id = v_pay.user_id;
  end if;

  update public.payments set
    status = 'paid',
    paid_at = now(),
    provider_payment_id = coalesce(p_payment_id, provider_payment_id),
    payment_method = coalesce(p_method, payment_method),
    period_start = v_start,
    period_end = v_end,
    note = v_note
  where id = v_pay.id;

  update public.upgrade_requests set status = 'done'
    where user_id = v_pay.user_id and status = 'open'
      and plan_id in (select id from public.plans where rank <= (select rank from public.plans where id = v_plan));

  return jsonb_build_object('applied', true, 'orderId', v_pay.id, 'planId', v_plan, 'periodEnd', v_end);
end;
$$;
revoke all on function public.apply_payment(text, text, text, numeric, text) from public, anon, authenticated;
grant execute on function public.apply_payment(text, text, text, numeric, text) to service_role;

-- 6. Every payment in one place, for the owner (SQL editor / Table editor).
create or replace view admin.payments
with (security_invoker = true)
as
select
  p.id as order_id,
  u.email,
  p.plan_id,
  p.period,
  p.currency,
  p.amount,
  p.status,
  p.environment,
  p.payment_method,
  p.provider_payment_id,
  p.period_end,
  p.note,
  p.created_at,
  p.paid_at
from public.payments p
left join auth.users u on u.id = p.user_id
order by p.created_at desc;
revoke all on admin.payments from public, anon, authenticated;
