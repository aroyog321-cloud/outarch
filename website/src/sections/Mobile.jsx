import React, { useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion';
import { BellRinging, Check, ChatCircleDots, DeviceMobile, Fingerprint, House, Lock, QrCode, Sparkle, WarningDiamond, WifiHigh } from '@phosphor-icons/react';
import { EASE, Reveal } from '../components/ui.jsx';

// The phone companion, as it looks in the phone's browser once paired. The
// tabs here mirror the real companion's Overview, Needs You and Ask.

const WORKERS = [
  ['Web dev server', 'running', '#32d583', 'Running for 42m. Vite is serving on port 5173.'],
  ['API gateway', 'running', '#32d583', 'Running for 42m. Listening on port 4000.'],
  ['Claude Code', 'needs you', '#f5b942', 'Waiting for you: permission to install zod@3.'],
  ['Unit tests (watch)', '1 failed', '#ff6b6b', 'Tests: 84 passed, 1 failed in src/auth/session.test.ts.'],
];

function Phone() {
  const [tab, setTab] = useState('overview');
  const [restarted, setRestarted] = useState(false);
  const [asked, setAsked] = useState(false);
  const [open, setOpen] = useState(null);
  const tabs = [['overview', 'Overview', House], ['needs', 'Needs You', WarningDiamond], ['ask', 'Ask', ChatCircleDots]];
  return <div className="relative mx-auto w-[300px] rounded-[46px] bg-[#0b0d12] p-3 shadow-[inset_0_0_0_1.5px_rgba(255,255,255,0.14),0_50px_100px_-30px_rgba(0,0,0,0.95),0_0_90px_-20px_rgba(63,208,181,0.35)]">
    <div className="relative h-[600px] overflow-hidden rounded-[36px] bg-black">
      <div className="absolute left-1/2 top-2.5 z-10 h-6 w-24 -translate-x-1/2 rounded-full bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"/>
      <div className="flex items-center justify-between px-6 pt-3 text-[11px] font-semibold text-fg-soft"><span>9:41</span><span className="flex items-center gap-1"><WifiHigh size={13} weight="bold"/>LAN</span></div>
      <div className="px-4 pt-6">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 place-items-center rounded-[9px] bg-brand-blue text-[13px] font-bold">T</span>
          <div><p className="text-[10px] uppercase tracking-[0.1em] text-fg-dim">Paired project</p><p className="text-[14px] font-semibold">tidepool</p></div>
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-brand-green/10 px-2 py-1 text-[10.5px] font-semibold text-[#7ee2ae] shadow-[inset_0_0_0_1px_rgba(50,213,131,0.35)]"><Lock size={10} weight="bold"/>Encrypted</span>
        </div>
      </div>
      <div className="h-[460px] overflow-hidden px-4 pt-4">
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25, ease: EASE }}>
            {tab === 'overview' ? <div className="flex flex-col gap-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-[14px] bg-ink-700 p-3"><p className="text-[22px] font-bold text-brand-green">4<span className="text-[13px] text-fg-dim">/6</span></p><p className="text-[10px] uppercase tracking-[0.1em] text-fg-dim">Running</p></div>
                <div className="rounded-[14px] bg-ink-700 p-3"><p className="text-[22px] font-bold text-brand-amber">{restarted ? 1 : 2}</p><p className="text-[10px] uppercase tracking-[0.1em] text-fg-dim">Needs you</p></div>
              </div>
              {WORKERS.map(([name, state, color, summary]) => {
                const fixed = name === 'Unit tests (watch)' && restarted;
                const current = fixed ? ['running', '#32d583'] : [state, color];
                const shown = open === name;
                return <button key={name} type="button" onClick={() => setOpen(shown ? null : name)} aria-expanded={shown} className="rounded-[12px] bg-ink-800 px-3 py-2.5 text-left">
                  <span className="flex items-center gap-2.5">
                    <span className="h-2 w-2 rounded-full" style={{ background: current[1] }}/>
                    <span className="text-[13px]">{name}</span>
                    <span className="ml-auto text-[11.5px]" style={{ color: current[1] }}>{current[0]}</span>
                  </span>
                  {shown ? <span className="mt-2 block border-t border-white/[0.07] pt-2 text-[11.5px] leading-relaxed text-fg-muted">{fixed ? 'Restarted from this phone. Running for 0s.' : summary}</span> : null}
                </button>;
              })}
              <p className="text-center text-[11px] text-fg-dim">Tap a terminal for its summary.</p>
            </div> : null}
            {tab === 'needs' ? <div className="flex flex-col gap-2.5">
              {restarted
                ? <div className="grid place-items-center gap-2 rounded-[14px] bg-ink-800 px-4 py-8 text-center"><Check size={26} className="text-brand-green" weight="bold"/><p className="text-[14px] font-semibold">Unit tests restarted</p><p className="text-[12px] text-fg-muted">It ran at once. Your desktop was not asked. Stopping would have waited for you.</p></div>
                : <div className="rounded-[14px] bg-ink-800 p-3.5 shadow-[inset_0_0_0_1px_rgba(255,107,107,0.4)]">
                  <p className="flex items-center gap-1.5 text-[11px] text-[#ff8a8a]"><WarningDiamond size={13} weight="fill"/>Worker attention</p>
                  <p className="mt-1 text-[14px] font-semibold">Unit tests (watch): 1 failed, 84 passed</p>
                  <p className="mt-1 text-[12px] text-fg-muted">src/auth/session.test.ts rejects expired tokens</p>
                  <div className="mt-3 flex gap-2">
                    <button type="button" onClick={() => setRestarted(true)} className="h-9 flex-1 rounded-[10px] bg-brand-blue text-[13px] font-semibold active:scale-[0.97]">Restart</button>
                    <button type="button" className="h-9 rounded-[10px] bg-white/[0.07] px-3 text-[13px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">Acknowledge</button>
                  </div>
                </div>}
              <div className="rounded-[14px] bg-ink-800 p-3.5">
                <p className="flex items-center gap-1.5 text-[11px] text-[#fbbf24]"><BellRinging size={13} weight="fill"/>Waiting on your desktop</p>
                <p className="mt-1 text-[14px] font-semibold">Claude Code asks permission to run npm install zod@3</p>
                <p className="mt-1 text-[12px] text-fg-muted">Agent permissions are answered on the desktop.</p>
              </div>
            </div> : null}
            {tab === 'ask' ? <div className="flex flex-col gap-2.5">
              <button type="button" onClick={() => setAsked(true)} className="self-end rounded-[14px] bg-[#0b2a57] px-3 py-2 text-left text-[13px] shadow-[inset_0_0_0_1px_rgba(50,145,255,0.4)]">Is anything broken?</button>
              {asked
                ? <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-[14px] bg-ink-700 px-3 py-2.5 text-[13px] leading-relaxed"><p className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-[#c4b5fd]"><Sparkle size={12} weight="fill"/>Mission AI</p>One test fails in src/auth/session.test.ts, and Claude Code is waiting for permission to install zod. Everything else is running.</motion.div>
                : <p className="text-center text-[12px] text-fg-dim">Tap the question to ask it.</p>}
            </div> : null}
          </motion.div>
        </AnimatePresence>
      </div>
      <nav className="absolute inset-x-3 bottom-3 grid grid-cols-3 rounded-[20px] bg-ink-700/95 p-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] backdrop-blur" aria-label="Phone companion tabs">
        {tabs.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => setTab(id)} aria-pressed={tab === id} className={`relative flex flex-col items-center gap-0.5 rounded-[14px] py-1.5 text-[10.5px] transition-colors ${tab === id ? 'text-fg' : 'text-fg-dim'}`}>
          {tab === id ? <motion.span layoutId="phone-tab" className="absolute inset-0 rounded-[14px] bg-white/[0.08]" transition={{ type: 'spring', stiffness: 400, damping: 32 }}/> : null}
          <Icon size={18} weight={tab === id ? 'fill' : 'regular'} className="relative"/><span className="relative">{label}</span>
          {id === 'needs' && !restarted ? <span className="absolute right-5 top-1 h-2 w-2 rounded-full bg-[#e5484d]"/> : null}
        </button>)}
      </nav>
    </div>
  </div>;
}

const POINTS = [
  [QrCode, 'Pair in seconds', 'Scan the QR code in Settings and type the 6-digit code. The code proves the key exchange and is never sent over the network.'],
  [Lock, 'Encrypted end to end', 'X25519 key exchange, AES-256-GCM for every message, replay protection, and a separate credential per phone that you can revoke at any time.'],
  [Fingerprint, 'Start and restart, never a shell', 'Tap a terminal for a summary, then start or restart it, or run a recipe, with no prompt on the desktop. Stopping one, or cancelling a run, still waits for your approval. There is no remote shell, and terminal output stays off unless you allow it.'],
];

export function MobileSection() {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] });
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [60, -60]);
  const rotate = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [-4, 3]);
  return <section id="mobile" ref={ref} className="relative z-[1] scroll-mt-24 overflow-hidden py-28">
    <div className="pointer-events-none absolute left-1/2 top-1/2 h-[700px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(63,208,181,0.14),transparent)]" aria-hidden="true"/>
    <div className="relative mx-auto grid grid-cols-1 max-w-page items-center gap-16 px-5 md:px-8 lg:grid-cols-[1fr_auto]">
      <div>
        <Reveal><p className="kicker mb-4 flex items-center gap-2"><DeviceMobile size={15}/>Mobile companion</p></Reveal>
        <Reveal delay={0.05}><h2 className="display text-[clamp(2rem,4.4vw,3.4rem)]">Step away. Your phone still knows.</h2></Reveal>
        <Reveal delay={0.1}><p className="lede mt-5 text-[17px]">See what is running, read a summary of any terminal, and start, restart or run a recipe from your phone while you are away from the desk. It talks to OUTARCH over your own network, not through a cloud relay, and installs to the home screen from the phone's browser.</p></Reveal>
        <div className="mt-10 grid gap-6">
          {POINTS.map(([Icon, title, body], index) => <Reveal key={title} delay={0.12 + index * 0.06} className="flex gap-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[12px] bg-brand-mint/10 text-brand-mint shadow-[inset_0_0_0_1px_rgba(63,208,181,0.3)]"><Icon size={19} weight="duotone"/></span>
            <div><h3 className="text-[16.5px] font-semibold">{title}</h3><p className="mt-1 max-w-[56ch] text-[15px] leading-relaxed text-fg-muted">{body}</p></div>
          </Reveal>)}
        </div>
        <Reveal delay={0.3}><p className="mt-8 text-[13.5px] text-fg-dim">Included with Pro and Ultimate. An Android 13+ app is also included as source code for developers who want a native client.</p></Reveal>
      </div>
      <motion.div style={{ y, rotate }}><Phone/></motion.div>
    </div>
  </section>;
}
