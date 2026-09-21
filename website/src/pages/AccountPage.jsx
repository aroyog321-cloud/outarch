import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowClockwise, ArrowSquareOut, Crown, Receipt, SignOut, Sparkle } from '@phosphor-icons/react';
import { Button, EASE, Reveal } from '../components/ui.jsx';
import { formatMoney } from '../lib/currency.js';
import { useRouter } from '../lib/router.jsx';
import { website } from '../lib/supabase.js';

// Who is signed in on the website, the plan the OUTARCH app honours, how much
// of it is used, and every payment. The app reads the same record, so what
// this page says is exactly what the app allows.

function formatDate(value) {
  const at = Date.parse(value || '');
  return Number.isFinite(at) ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

function limitRows(entitlements) {
  const limits = entitlements?.limits || {};
  const unlimited = value => value === null || value === undefined;
  const trial = entitlements?.recipeTrial;
  const trialEnded = trial?.endsAt && Date.parse(trial.endsAt) < Date.now();
  return [
    ['Terminals at once', unlimited(limits.terminals) ? 'Unlimited' : String(limits.terminals)],
    ['Projects', limits.projectSwitching ? 'All projects' : 'One project'],
    ['Your own AI keys', limits.byokKeys === 0 ? 'Not included' : unlimited(limits.byokKeys) ? 'Unlimited' : `${limits.byokKeys} key${limits.byokKeys === 1 ? '' : 's'}`],
    ['Recipes', trial ? (trialEnded ? 'Trial ended' : `${limits.recipes} · trial ends ${formatDate(trial.endsAt)}`) : unlimited(limits.recipes) ? 'Unlimited' : String(limits.recipes)],
    ['Secure MCP', limits.mcp === 'full' ? 'Full access' : limits.mcp === 'read' ? 'Read-only tools' : 'Not included'],
    ['Mobile companion', limits.mobileCompanion ? 'Included' : 'Not included'],
    ['VS Code bridge', limits.vscodeBridge ? 'Included' : 'Not included'],
  ];
}

const STATUS = {
  paid: ['Paid', 'text-brand-green bg-brand-green/10 shadow-[inset_0_0_0_1px_rgba(50,213,131,0.35)]'],
  created: ['Not completed', 'text-fg-muted bg-white/[0.05] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]'],
  failed: ['Failed', 'text-[#ffb3b3] bg-brand-red/10 shadow-[inset_0_0_0_1px_rgba(255,95,95,0.35)]'],
  expired: ['Expired', 'text-fg-dim bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'],
  refunded: ['Refunded', 'text-brand-sky bg-brand-blue/10 shadow-[inset_0_0_0_1px_rgba(47,123,255,0.35)]'],
};

function Skeleton() {
  return <div className="mx-auto max-w-[980px] px-5 pb-24 pt-36 md:px-8" role="status" aria-label="Loading your account">
    <div className="card h-40 animate-pulse"/>
    <div className="card mt-5 h-72 animate-pulse"/>
  </div>;
}

export default function AccountPage() {
  const { navigate } = useRouter();
  const [entitlements, setEntitlements] = useState(null);
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setError('');
    const { data: sessionData } = await website().auth.getSession();
    if (!sessionData?.session) { navigate('/auth?next=/account', { replace: true }); return; }
    const [{ data, error: rpcError }, { data: rows }] = await Promise.all([
      website().rpc('get_entitlements'),
      website().from('payments').select('id,plan_id,period,currency,amount,status,payment_method,period_end,created_at,paid_at').order('created_at', { ascending: false }).limit(20),
    ]);
    if (rpcError) {
      // A session the server no longer accepts (revoked, or from another
      // project): end it here and sign in again rather than show a broken page.
      if (rpcError.code === 'PGRST301' || /jwt|token/i.test(rpcError.message || '')) {
        await website().auth.signOut({ scope: 'local' });
        navigate('/auth?next=/account', { replace: true });
        return;
      }
      setError('Your plan could not be loaded. Check your connection and try again.');
    } else setEntitlements(data);
    setPayments(rows || []);
    setLoading(false);
  }, [navigate]);

  useEffect(() => { void load(); }, [load]);

  const refresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };
  const signOut = async () => { await website().auth.signOut({ scope: 'local' }); navigate('/auth'); };

  if (loading && !entitlements) return <Skeleton/>;

  // Without the plan record nothing below would be true, so say so and offer a retry.
  if (!entitlements) {
    return <section className="mx-auto max-w-[640px] px-5 pb-24 pt-36 text-center md:px-8">
      <h1 className="display text-[clamp(1.8rem,3.4vw,2.4rem)]">Your account could not be loaded</h1>
      <p className="lede mx-auto mt-4 text-[16px]">{error}</p>
      <div className="mt-8 flex justify-center gap-3">
        <button type="button" onClick={refresh} className="btn btn--primary"><ArrowClockwise size={16} className={refreshing ? 'animate-spin' : ''}/>Try again</button>
        <button type="button" onClick={signOut} className="btn btn--glass"><SignOut size={16}/>Sign out</button>
      </div>
    </section>;
  }

  const user = entitlements?.user || {};
  const plan = entitlements?.plan || { id: 'free', name: 'Free' };
  const subscription = entitlements?.subscription || {};
  const usage = entitlements?.usage?.missionAiMessages || {};
  const paid = plan.id !== 'free';
  const ends = subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : '';
  const limit = entitlements?.limits?.missionAiMessages;
  const used = usage.used || 0;
  const accent = plan.id === 'ultimate' ? '155,123,255' : plan.id === 'pro' ? '47,123,255' : '63,208,181';

  return <section className="mx-auto max-w-[980px] px-5 pb-24 pt-32 md:px-8">
    <Reveal>
      <div className="flex flex-wrap items-center gap-4">
        <span className="grid h-14 w-14 place-items-center overflow-hidden rounded-full bg-brand-blue text-[22px] font-semibold">
          {user.avatarUrl ? <img src={user.avatarUrl} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer"/> : (Array.from(String(user.name || user.email || 'O'))[0] || 'O').toUpperCase()}
        </span>
        <div className="mr-auto min-w-0">
          <h1 className="display truncate text-[clamp(1.6rem,3vw,2.2rem)]">{user.name || user.email || 'Your account'}</h1>
          <p className="truncate text-[14.5px] text-fg-muted">{user.name && user.email ? `${user.email} · ` : ''}Signed in with {user.provider === 'google' ? 'Google' : 'email and password'}</p>
        </div>
        <button type="button" onClick={signOut} className="btn btn--glass btn--sm"><SignOut size={16}/>Sign out</button>
      </div>
    </Reveal>

    {error ? <p className="mt-6 rounded-field bg-brand-red/10 px-4 py-3 text-[14px] text-[#ffb3b3] shadow-[inset_0_0_0_1px_rgba(255,95,95,0.4)]" role="alert">{error}</p> : null}

    <Reveal delay={0.06}>
      <div className="card relative mt-8 overflow-hidden p-7 sm:p-9" style={{ background: `linear-gradient(135deg, rgba(${accent},0.2), rgba(255,255,255,0.02) 60%)` }}>
        <div className="flex flex-wrap items-center gap-5">
          <motion.span initial={{ rotate: -12, scale: 0.8 }} animate={{ rotate: 0, scale: 1 }} transition={{ duration: 0.8, ease: EASE }} className="grid h-14 w-14 place-items-center rounded-[16px]" style={{ background: `rgba(${accent},0.18)`, color: `rgb(${accent})`, boxShadow: `inset 0 0 0 1px rgba(${accent},0.45)` }}><Crown size={28} weight="fill"/></motion.span>
          <div className="mr-auto">
            <p className="text-[13px] text-fg-muted">Your plan</p>
            <p className="text-[28px] font-semibold tracking-[-0.02em]">{plan.name}</p>
            <p className="text-[14.5px] text-fg-soft">{paid ? (ends ? `Active until ${ends}` : 'Active, no end date') : 'Free forever. Upgrade when you need more.'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={refresh} className="btn btn--glass btn--sm" aria-label="Check your plan again"><ArrowClockwise size={15} className={refreshing ? 'animate-spin' : ''}/>Refresh</button>
            <a href="outarch://account/refresh" className="btn btn--glass btn--sm"><ArrowSquareOut size={15}/>Open OUTARCH</a>
            {plan.id !== 'ultimate'
              ? <Button to={`/checkout?plan=${plan.id === 'pro' ? 'ultimate' : 'pro'}&period=month`} size="sm" magnetic={false}><Crown size={15} weight="fill"/>Upgrade</Button>
              : ends ? <Button to="/checkout?plan=ultimate&period=month" size="sm" magnetic={false}>Extend Ultimate</Button> : null}
          </div>
        </div>
        <div className="mt-8 rounded-field bg-black/30 p-5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
          <div className="flex items-center justify-between text-[14px]"><span className="flex items-center gap-2 text-fg-soft"><Sparkle size={16} weight="fill" className="text-brand-violet"/>Mission AI today</span><span className="font-mono text-fg">{limit == null ? `${used} used · unlimited` : `${used} of ${limit}`}</span></div>
          {limit != null ? <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><motion.div className="h-full rounded-full bg-brand-violet" initial={{ width: 0 }} animate={{ width: `${Math.min(100, (used / Math.max(1, limit)) * 100)}%` }} transition={{ duration: 0.9, ease: EASE }}/></div> : null}
        </div>
        <dl className="mt-6 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
          {limitRows(entitlements).map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 border-b border-line-soft pb-3"><dt className="text-[14px] text-fg-muted">{label}</dt><dd className="text-right text-[14.5px] text-fg">{value}</dd></div>)}
        </dl>
        <p className="mt-6 text-[13px] text-fg-dim">The app checks your plan when it starts, when its window gets focus and every five minutes. Open OUTARCH makes it check now.</p>
      </div>
    </Reveal>

    <Reveal delay={0.1}>
      <div className="card mt-6 p-7 sm:p-9">
        <h2 className="flex items-center gap-2 text-[19px] font-semibold"><Receipt size={20} className="text-brand-sky"/>Billing history</h2>
        {payments.length
          ? <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[14px]">
              <thead><tr className="text-[12.5px] text-fg-dim"><th className="pb-3 font-medium">Date</th><th className="pb-3 font-medium">Plan</th><th className="pb-3 font-medium">Amount</th><th className="pb-3 font-medium">Status</th><th className="pb-3 font-medium">Order reference</th></tr></thead>
              <tbody>
                {payments.map(row => {
                  const [label, style] = STATUS[row.status] || STATUS.created;
                  return <tr key={row.id} className="border-t border-line-soft">
                    <td className="py-3 text-fg-soft">{formatDate(row.paid_at || row.created_at)}</td>
                    <td className="py-3 capitalize">{row.plan_id} · {row.period === 'year' ? '12 months' : '1 month'}</td>
                    <td className="py-3 font-mono">{formatMoney(row.amount, row.currency, { exact: true })}</td>
                    <td className="py-3"><span className={`rounded-full px-2.5 py-1 text-[12px] font-medium ${style}`}>{label}</span></td>
                    <td className="py-3 font-mono text-[12.5px] text-fg-dim">{row.id}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          : <p className="mt-4 text-[14.5px] text-fg-muted">No payments yet. When you buy a plan, the receipt and its order reference appear here.</p>}
      </div>
    </Reveal>
  </section>;
}
