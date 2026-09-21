import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft, ArrowSquareOut, CalendarCheck, Check, CircleNotch, Crown, CreditCard, Info, Lock, ShieldCheck, WarningCircle,
} from '@phosphor-icons/react';
import { Segmented } from '../components/Pricing.jsx';
import { EASE } from '../components/ui.jsx';
import { billing, loadCashfree, waitForPayment } from '../lib/billing.js';
import { priceOf, useCatalog } from '../lib/catalog.js';
import { formatMoney, useCurrency } from '../lib/currency.js';
import { Link, useRouter } from '../lib/router.jsx';
import { website } from '../lib/supabase.js';

// Buying Pro or Ultimate. The page shows what the purchase will do (from
// checkout_quote, the same rule the database applies), opens Cashfree's
// checkout in a pop-up, then asks the billing function until the order is
// settled. The plan is switched on by the server either way: by this page's
// check or by Cashfree's webhook, whichever comes first.

const PLAN_POINTS = {
  pro: ['8 terminals at once', 'Unlimited projects', 'Unlimited Mission AI*', '3 recipes', '1 key of your own', 'Mobile companion', 'MCP gateway, read-only tools'],
  ultimate: ['Unlimited terminals', 'Unlimited projects', 'Unlimited Mission AI*', 'Unlimited recipes', 'Unlimited keys of your own', 'Mobile companion', 'Full MCP gateway', 'VS Code bridge'],
};

const CODES = [
  ['+91', 'India'], ['+1', 'US and Canada'], ['+44', 'United Kingdom'], ['+971', 'UAE'], ['+65', 'Singapore'],
  ['+61', 'Australia'], ['+49', 'Germany'], ['+33', 'France'], ['+81', 'Japan'], ['other', 'Other'],
];

function formatDate(value) {
  const at = Date.parse(value || '');
  return Number.isFinite(at) ? new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
}

function phoneFor(code, number) {
  const digits = number.replace(/[^\d+]/g, '');
  if (code === 'other') return digits.startsWith('+') ? digits : `+${digits}`;
  if (code === '+91') return digits.replace(/^\+?91/, '').replace(/^0/, '');
  return `${code}${digits.replace(/^\+/, '').replace(/^0/, '')}`;
}

function validPhone(code, number) {
  const phone = phoneFor(code, number);
  return code === '+91' ? /^[6-9]\d{9}$/.test(phone) : /^\+[1-9]\d{7,14}$/.test(phone);
}

// ------------------------------------------------------------------ result screens

function Burst() {
  const reduce = useReducedMotion();
  if (reduce) return null;
  const colors = ['#2f7bff', '#3fd0b5', '#9b7bff', '#f5b942', '#6aa6ff'];
  return <div className="pointer-events-none absolute left-1/2 top-[70px]" aria-hidden="true">
    {Array.from({ length: 22 }, (_, index) => {
      const angle = (index / 22) * Math.PI * 2;
      const distance = 90 + (index % 4) * 22;
      return <motion.span key={index} className="absolute h-2 w-2 rounded-[2px]" style={{ background: colors[index % colors.length] }}
        initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
        animate={{ x: Math.cos(angle) * distance, y: Math.sin(angle) * distance, opacity: 0, rotate: 200, scale: 0.6 }}
        transition={{ duration: 1.1, ease: [0.2, 0.7, 0.3, 1], delay: 0.25 }}/>;
    })}
  </div>;
}

function Success({ planName, periodEnd }) {
  return <motion.div className="card relative mx-auto max-w-[560px] overflow-hidden p-10 text-center" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }}>
    <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_0%,rgba(63,208,181,0.2),transparent)]"/>
    <Burst/>
    <svg viewBox="0 0 80 80" className="relative mx-auto h-20 w-20" aria-hidden="true">
      <motion.circle cx="40" cy="40" r="36" fill="none" stroke="#3fd0b5" strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.6, ease: EASE }}/>
      <motion.path d="M25 41 L36 52 L56 30" fill="none" stroke="#3fd0b5" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.45, delay: 0.45, ease: EASE }}/>
    </svg>
    <h1 className="display relative mt-6 text-[32px]">{planName} is on.</h1>
    <p className="relative mt-3 text-[16px] text-fg-muted">{periodEnd ? `Your plan runs until ${formatDate(periodEnd)}.` : 'Your plan is active.'} A receipt is in your account.</p>
    <div className="relative mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
      <a href="outarch://account/refresh" className="btn btn--primary"><ArrowSquareOut size={17}/>Open OUTARCH</a>
      <Link to="/account" className="btn btn--glass">Go to your account</Link>
    </div>
    <p className="relative mt-6 text-[13px] text-fg-dim">Open OUTARCH makes the app read your new plan straight away. Otherwise it picks it up within five minutes.</p>
  </motion.div>;
}

function Waiting({ title, body, children }) {
  return <div className="card mx-auto max-w-[560px] p-10 text-center">
    <CircleNotch size={44} className="mx-auto animate-spin text-brand-sky"/>
    <h1 className="display mt-6 text-[28px]">{title}</h1>
    <p className="mt-3 text-[15.5px] text-fg-muted">{body}</p>
    {children}
  </div>;
}

// ------------------------------------------------------------------ page

export default function CheckoutPage() {
  const { path, query, navigate } = useRouter();
  const catalog = useCatalog();
  const [preferred] = useCurrency();
  const returning = path === '/checkout/return';
  const returnOrder = query.get('order_id') || '';

  const [plan, setPlan] = useState(['pro', 'ultimate'].includes(query.get('plan')) ? query.get('plan') : 'pro');
  const [period, setPeriod] = useState(query.get('period') === 'year' ? 'year' : 'month');
  const [currency, setCurrency] = useState(['INR', 'USD'].includes(query.get('currency')) ? query.get('currency') : preferred);
  const [session, setSession] = useState(null);
  const [config, setConfig] = useState(null);
  const [quote, setQuote] = useState(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState(preferred === 'INR' ? '+91' : '+1');
  const [number, setNumber] = useState('');
  const [touched, setTouched] = useState(false);
  const [phase, setPhase] = useState(returning ? 'verifying' : 'loading');
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);

  // Signed in? Otherwise sign up first and come back to exactly this checkout.
  useEffect(() => {
    let alive = true;
    website().auth.getSession().then(({ data }) => {
      if (!alive) return;
      if (!data?.session) {
        const back = `${window.location.pathname}${window.location.search}`;
        navigate(`/auth?mode=signup&next=${encodeURIComponent(back)}`, { replace: true });
        return;
      }
      setSession(data.session);
      setName(data.session.user?.user_metadata?.full_name || data.session.user?.user_metadata?.name || '');
    });
    return () => { alive = false; };
  }, [navigate]);

  useEffect(() => {
    if (!session) return;
    billing.config().then(setConfig).catch(() => setConfig({ enabled: false, mode: 'sandbox', currencies: ['INR'], unreachable: true }));
  }, [session]);

  // Loaded on the return page too, so a payment that did not go through can
  // be tried again from the same screen.
  useEffect(() => {
    if (!session) return undefined;
    let alive = true;
    setQuote(null);
    website().rpc('checkout_quote', { p_plan: plan, p_period: period }).then(async ({ data, error: quoteError }) => {
      if (!alive) return;
      // A stored session the server no longer accepts: sign in again, then come back here.
      if (quoteError && (quoteError.code === 'PGRST301' || /jwt|token/i.test(quoteError.message || ''))) {
        await website().auth.signOut({ scope: 'local' });
        navigate(`/auth?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`, { replace: true });
        return;
      }
      setQuote(quoteError ? { blocked: true, reason: 'Your plan could not be checked. Refresh to try again.' } : data);
      setPhase(value => (value === 'loading' ? 'ready' : value));
    });
    return () => { alive = false; };
  }, [session, plan, period, navigate]);

  // Keep the address in step with the choices, so a refresh keeps them.
  useEffect(() => {
    if (returning) return;
    const url = `/checkout?plan=${plan}&period=${period}&currency=${currency}`;
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, '', url);
  }, [plan, period, currency, returning]);

  const settle = useCallback(async orderId => {
    setPhase('verifying');
    setError('');
    try {
      const outcome = await waitForPayment(orderId);
      if (outcome?.status === 'paid') { setResult(outcome); setPhase('paid'); return; }
      if (outcome?.status === 'expired') { setError('This payment window expired before it was paid. Nothing was charged. Start again.'); setPhase('ready'); return; }
      if (outcome?.lastAttempt === 'FAILED') { setError('The payment did not go through. Nothing was charged. Try again or use another method.'); setPhase('ready'); return; }
      if (outcome?.lastAttempt === 'USER_DROPPED') { setError('The payment was not finished. Nothing was charged.'); setPhase('ready'); return; }
      setResult({ orderId }); setPhase('pending');
    } catch (reason) {
      setError(reason.message); setResult({ orderId }); setPhase('pending');
    }
  }, []);

  useEffect(() => {
    if (!returning || !session) return;
    if (!/^oa_[A-Za-z0-9_-]{8,40}$/.test(returnOrder)) { setPhase('ready'); setError('That payment reference is not valid.'); return; }
    void settle(returnOrder);
  }, [returning, session, returnOrder, settle]);

  const enabledCurrencies = config?.currencies || ['INR'];
  const chargeCurrency = enabledCurrencies.includes(currency) ? currency : 'INR';
  const shown = priceOf(catalog.prices, plan, period, currency);
  const charged = priceOf(catalog.prices, plan, period, chargeCurrency);
  const monthlyEquivalent = priceOf(catalog.prices, plan, 'month', currency);
  const planName = plan === 'ultimate' ? 'Ultimate' : 'Pro';
  const phoneOk = validPhone(code, number);

  const whatHappens = useMemo(() => {
    if (!quote) return null;
    if (quote.blocked) return { tone: 'warn', text: quote.reason };
    const end = formatDate(quote.endsAt);
    if (quote.kind === 'extend') return { tone: 'ok', text: `Adds ${period === 'year' ? '12 months' : 'a month'} to your current ${planName}. It will run until ${end}.` };
    if (quote.kind === 'upgrade') return { tone: 'ok', text: `${planName} starts as soon as you pay${quote.carriedOver ? `, with ${quote.carriedOver} days carried over from Pro` : ''}. It will run until ${end}.` };
    return { tone: 'ok', text: `${planName} starts as soon as you pay and runs until ${end}.` };
  }, [quote, period, planName]);

  const pay = async () => {
    setTouched(true);
    if (!phoneOk) { setError('Enter a valid mobile number. Cashfree needs it to process the payment.'); return; }
    setError('');
    setPhase('creating');
    try {
      const order = await billing.create({ plan, period, currency: chargeCurrency, phone: phoneFor(code, number), name: name.trim() });
      setPhase('paying');
      const cashfree = await loadCashfree(order.mode);
      const outcome = await cashfree.checkout({ paymentSessionId: order.paymentSessionId, redirectTarget: '_modal' });
      if (outcome?.redirect) return; // Cashfree is taking the browser to the bank or UPI app; /checkout/return picks it up.
      await settle(order.orderId);
    } catch (reason) {
      setPhase('ready');
      setError(reason?.message || 'The payment could not be started. Try again.');
    }
  };

  const [requested, setRequested] = useState(false);
  const requestByHand = async () => {
    setError('');
    const { error: insertError } = await website().from('upgrade_requests').insert({ plan_id: plan, message: `Checkout request: ${period}, ${currency}` });
    if (insertError) setError('Your request could not be sent. Try again in a moment.');
    else setRequested(true);
  };

  if (!session || phase === 'loading') {
    return <div className="grid min-h-[80dvh] place-items-center pt-24" role="status" aria-label="Preparing checkout"><CircleNotch size={36} className="animate-spin text-brand-sky"/></div>;
  }

  return <section className="mx-auto max-w-page px-5 pb-24 pt-32 md:px-8">
    <AnimatePresence mode="wait">
      {phase === 'paid' ? <motion.div key="paid"><Success planName={result?.planId === 'ultimate' ? 'Ultimate' : result?.planId === 'pro' ? 'Pro' : planName} periodEnd={result?.periodEnd}/></motion.div> : null}
      {phase === 'verifying' ? <motion.div key="verifying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Waiting title="Confirming your payment" body="Checking with Cashfree. This usually takes a few seconds; please keep this page open."/></motion.div> : null}
      {phase === 'pending' ? <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <Waiting title="Waiting for the bank" body="Cashfree has not confirmed this payment yet. You can close this page: your plan switches on by itself when the payment clears, and your account shows it.">
          <p className="mt-4 font-mono text-[12.5px] text-fg-dim">Order {result?.orderId}</p>
          <div className="mt-6 flex justify-center gap-3"><button type="button" className="btn btn--glass btn--sm" onClick={() => settle(result.orderId)}>Check again</button><Link to="/account" className="btn btn--glass btn--sm">Your account</Link></div>
        </Waiting>
      </motion.div> : null}
      {['ready', 'creating', 'paying'].includes(phase) ? <motion.div key="form" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: EASE }}>
        <Link to="/pricing" className="inline-flex items-center gap-1.5 text-[14px] text-fg-muted hover:text-fg"><ArrowLeft size={15}/>All plans</Link>
        <h1 className="display mt-4 text-[clamp(2rem,4vw,3rem)]">Checkout</h1>
        {config?.mode === 'sandbox' && config?.enabled ? <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-amber/10 px-3 py-1.5 text-[13px] text-brand-amber shadow-[inset_0_0_0_1px_rgba(245,185,66,0.35)]"><Info size={15}/>Test mode: use Cashfree's test cards or UPI; no real money moves.</p> : null}

        <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="card relative overflow-hidden p-7 sm:p-9" style={{ background: plan === 'ultimate' ? 'linear-gradient(145deg, rgba(155,123,255,0.18), rgba(255,255,255,0.02) 60%)' : 'linear-gradient(145deg, rgba(47,123,255,0.18), rgba(255,255,255,0.02) 60%)' }}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <Segmented label="Plan" value={plan} onChange={setPlan} options={[{ value: 'pro', label: 'Pro' }, { value: 'ultimate', label: 'Ultimate' }]}/>
              <Segmented label="Checkout period" value={period} onChange={setPeriod} options={[{ value: 'month', label: '1 month' }, { value: 'year', label: '12 months', note: '2 free' }]}/>
            </div>
            <div className="mt-8 flex items-center gap-3">
              <Crown size={26} weight="fill" className={plan === 'ultimate' ? 'text-brand-violet' : 'text-brand-sky'}/>
              <h2 className="text-[26px] font-semibold">{planName}</h2>
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-3">
              <motion.span key={`${plan}${period}${currency}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="text-[52px] font-semibold leading-none tracking-[-0.03em]">{shown ? formatMoney(shown.amount, currency) : '-'}</motion.span>
              <span className="pb-1.5 text-[15px] text-fg-muted">for {period === 'year' ? '12 months' : '1 month'}</span>
              <span className="ml-auto pb-1"><Segmented label="Checkout currency" value={currency} onChange={value => { setCurrency(value); if (!number) setCode(value === 'INR' ? '+91' : '+1'); }} options={[{ value: 'INR', label: '₹' }, { value: 'USD', label: '$' }]}/></span>
            </div>
            {period === 'year' && monthlyEquivalent ? <p className="mt-2 text-[14px] text-brand-mint">You save {formatMoney(monthlyEquivalent.amount * 12 - (shown?.amount || 0), currency)} compared with paying monthly.</p> : null}
            {currency !== chargeCurrency && charged ? <p className="mt-3 flex items-start gap-2 rounded-field bg-white/[0.04] p-3 text-[13.5px] text-fg-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"><Info size={16} className="mt-0.5 shrink-0"/>You will be charged in Indian rupees: {formatMoney(charged.amount, chargeCurrency)}. Your bank converts it at its own rate.</p> : null}
            <ul className="mt-7 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {PLAN_POINTS[plan].map(point => <li key={point} className="flex gap-2 text-[14.5px] text-fg-soft"><Check size={17} weight="bold" className="mt-0.5 shrink-0 text-brand-mint"/>{point}</li>)}
            </ul>
            <div className="mt-7 flex items-start gap-3 rounded-field bg-black/30 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
              {whatHappens?.tone === 'warn' ? <WarningCircle size={20} className="mt-0.5 shrink-0 text-brand-amber"/> : <CalendarCheck size={20} className="mt-0.5 shrink-0 text-brand-mint"/>}
              <p className="text-[14.5px] leading-relaxed text-fg-soft">{whatHappens ? whatHappens.text : 'Checking your current plan…'}</p>
            </div>
            <p className="mt-4 text-[12.5px] text-fg-dim">*Fair-use ceiling of 2,000 Mission AI messages a day. Prepaid: nothing renews automatically.</p>
          </div>

          <div className="card p-7 sm:p-9">
            <h2 className="flex items-center gap-2 text-[19px] font-semibold"><CreditCard size={20} className="text-brand-sky"/>Payment details</h2>
            {config && !config.enabled
              ? <div className="mt-6">
                <p className="rounded-field bg-brand-amber/10 p-4 text-[14.5px] leading-relaxed text-[#fde2a8] shadow-[inset_0_0_0_1px_rgba(245,185,66,0.35)]">{config.unreachable ? 'The payment service could not be reached.' : 'Online payment is being switched on.'} Leave a request and we will activate {planName} for you by hand once payment is arranged.</p>
                {requested
                  ? <p className="mt-5 flex items-center gap-2 text-[15px] text-brand-mint" role="status"><Check size={18} weight="bold"/>Request sent. We will contact you at {session.user?.email}.</p>
                  : <button type="button" className="btn btn--primary btn--lg mt-5 w-full" onClick={requestByHand}>Request {planName}</button>}
              </div>
              : <form className="mt-6 flex flex-col gap-5" onSubmit={event => { event.preventDefault(); void pay(); }} noValidate>
                <label className="flex flex-col gap-2"><span className="text-[14px] font-medium text-fg-soft">Account</span><input className="field opacity-80" value={session.user?.email || ''} readOnly aria-readonly="true"/></label>
                <label className="flex flex-col gap-2"><span className="text-[14px] font-medium text-fg-soft">Name on the receipt</span><input className="field" value={name} onChange={event => setName(event.target.value)} autoComplete="name" maxLength={100}/></label>
                <div className="flex flex-col gap-2">
                  <label htmlFor="checkout-phone" className="text-[14px] font-medium text-fg-soft">Mobile number</label>
                  <div className="flex gap-2">
                    <select aria-label="Country code" className="field w-[118px] shrink-0 px-3" value={code} onChange={event => setCode(event.target.value)}>
                      {CODES.map(([value, label]) => <option key={value} value={value}>{value === 'other' ? 'Other' : `${value} ${label.split(' ')[0]}`}</option>)}
                    </select>
                    <input id="checkout-phone" className="field" inputMode="tel" autoComplete="tel-national" placeholder={code === '+91' ? '98765 43210' : code === 'other' ? '+ country code and number' : 'Phone number'} value={number} onChange={event => setNumber(event.target.value)} onBlur={() => setTouched(true)} aria-invalid={touched && !phoneOk} aria-describedby="checkout-phone-help"/>
                  </div>
                  <small id="checkout-phone-help" className={`text-[13px] ${touched && !phoneOk ? 'text-[#ffb3b3]' : 'text-fg-dim'}`}>{touched && !phoneOk ? (code === '+91' ? 'Enter the 10-digit mobile number.' : 'Enter a valid number for the country chosen.') : 'Cashfree requires it for the payment. We do not store it.'}</small>
                </div>
                <AnimatePresence>{error ? <motion.p initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} role="alert" className="rounded-field bg-brand-red/10 px-4 py-3 text-[14px] text-[#ffb3b3] shadow-[inset_0_0_0_1px_rgba(255,95,95,0.4)]">{error}</motion.p> : null}</AnimatePresence>
                <button type="submit" className="btn btn--primary btn--lg w-full" disabled={!config || !quote || quote.blocked || !charged || phase !== 'ready'}>
                  {phase === 'creating' || phase === 'paying' ? <CircleNotch size={18} className="animate-spin"/> : <Lock size={17} weight="bold"/>}
                  {phase === 'creating' ? 'Starting secure checkout…' : phase === 'paying' ? 'Complete the payment in the window' : charged ? `Pay ${formatMoney(charged.amount, chargeCurrency, { exact: false })}` : 'Pay'}
                </button>
                <p className="flex items-start gap-2 text-[13px] leading-relaxed text-fg-dim"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-brand-mint"/>Payments are processed by Cashfree Payments with UPI, cards, netbanking and wallets. OUTARCH never sees your card or bank details. By paying you agree to the <Link to="/terms" className="underline hover:text-fg">terms</Link> and the <Link to="/refunds" className="underline hover:text-fg">refund policy</Link>.</p>
              </form>}
          </div>
        </div>
      </motion.div> : null}
    </AnimatePresence>
  </section>;
}
