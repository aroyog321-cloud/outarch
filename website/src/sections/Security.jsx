import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Code, DeviceMobile, Desktop, Plugs, ShieldCheck, Sparkle, TerminalWindow } from '@phosphor-icons/react';
import { Reveal, SectionTitle } from '../components/ui.jsx';

// Who can reach the engine, and what every one of them has to go through.
// Positions are percentages of the diagram box (aspect 5:4); the SVG uses a
// 100 x 80 view box so the same numbers place the lines (y scaled by 0.8).
const CENTER = { x: 50, y: 46 };
const CLIENTS = [
  { icon: Desktop, label: 'Desktop app', x: 17, y: 16 },
  { icon: TerminalWindow, label: 'Terminal UI', x: 83, y: 16 },
  { icon: Sparkle, label: 'Mission AI', x: 13, y: 50 },
  { icon: Plugs, label: 'MCP clients', x: 87, y: 50 },
  { icon: DeviceMobile, label: 'Phone', x: 28, y: 82 },
  { icon: Code, label: 'VS Code', x: 72, y: 82 },
];

const FACTS = [
  ['Your code stays on your computer', 'Terminals, files and the engine run locally. Nothing is uploaded for OUTARCH to work.'],
  ['Keys sealed by Windows', 'API keys and tokens are encrypted with the operating system and never reach the app\'s window process.'],
  ['Localhost only', 'The MCP gateway listens on 127.0.0.1 with a bearer token and per-capability grants. Terminal evidence is off by default.'],
  ['Redacted by default', 'Context shared with Mission AI, MCP or your phone leaves out environment values and secrets, and terminal output unless you allow it.'],
  ['Approve once', 'Requests from agents, the AI, MCP and automations wait in Needs You, expire, and run a single time. A paired phone starts and restarts directly, and its stop requests wait there too.'],
  ['A sandboxed window', 'The interface runs with context isolation and no Node access; every request to the engine is validated.'],
];

export function Security() {
  const reduce = useReducedMotion();
  return <section className="relative z-[1] mx-auto max-w-page px-5 py-24 md:px-8">
    <SectionTitle kicker="Privacy and control" title="Local first. Nothing runs without you." lede="One engine owns every terminal on your machine. Everything else, including the AI, reaches it through a checked, narrow door."/>
    <div className="mt-14 grid grid-cols-1 items-center gap-12 lg:grid-cols-[1fr_1fr]">
      <Reveal className="card relative aspect-[5/4] overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_50%,rgba(47,123,255,0.18),transparent)]"/>
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 80" aria-hidden="true">
          <defs><linearGradient id="sec-line" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="100" y2="0"><stop offset="0" stopColor="#3fd0b5"/><stop offset="1" stopColor="#2f7bff"/></linearGradient></defs>
          {CLIENTS.map((client, index) => <motion.line key={client.label} x1={CENTER.x} y1={CENTER.y * 0.8} x2={client.x} y2={client.y * 0.8} stroke="url(#sec-line)" strokeOpacity="0.55" strokeWidth="0.3" initial={{ pathLength: reduce ? 1 : 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.9, delay: 0.2 + index * 0.08 }}/>)}
          {/* Requests travelling in: every one of them arrives at the same gate. */}
          {reduce ? null : CLIENTS.map((client, index) => <motion.circle key={`p-${client.label}`} r="0.7" fill="#6aa6ff"
            initial={{ cx: client.x, cy: client.y * 0.8, opacity: 0 }}
            animate={{ cx: [client.x, CENTER.x], cy: [client.y * 0.8, CENTER.y * 0.8], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 2.2, delay: 1.2 + index * 0.55, repeat: Infinity, repeatDelay: 2.4, ease: 'easeInOut' }}/>)}
        </svg>
        <div className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-[38%] text-center">
          <div className="relative mx-auto grid h-24 w-24 place-items-center rounded-[26px] bg-ink-700 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14),0_0_60px_-10px_rgba(47,123,255,0.8)]">
            <span className="absolute inset-0 animate-pulse-ring rounded-[26px] shadow-[0_0_0_1px_rgba(106,166,255,0.6)]"/>
            <ShieldCheck size={38} weight="duotone" className="text-brand-sky"/>
          </div>
          <p className="mt-3 text-[13px] font-semibold">Engine</p>
          <p className="text-[11.5px] text-fg-muted">owns every terminal</p>
          <p className="mt-2 inline-flex rounded-full bg-brand-amber/10 px-2.5 py-1 text-[11px] font-semibold text-brand-amber shadow-[inset_0_0_0_1px_rgba(245,185,66,0.35)]">Needs You gate</p>
        </div>
        {CLIENTS.map((client, index) => {
          const Icon = client.icon;
          // The outer element places the icon's centre on the line's end; the
          // inner one animates (a motion transform would replace the translate).
          return <div key={client.label} className="absolute -translate-x-1/2 -translate-y-[22px]" style={{ left: `${client.x}%`, top: `${client.y}%` }}>
            <motion.div className="flex flex-col items-center gap-1.5" initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 + index * 0.08, type: 'spring', stiffness: 260, damping: 20 }}>
              <span className="grid h-11 w-11 place-items-center rounded-[13px] bg-ink-800 text-fg-soft shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] transition-colors hover:text-brand-mint"><Icon size={20} weight="duotone"/></span>
              <span className="whitespace-nowrap text-[11.5px] text-fg-muted">{client.label}</span>
            </motion.div>
          </div>;
        })}
      </Reveal>
      <div className="grid grid-cols-1 gap-x-8 gap-y-8 sm:grid-cols-2">
        {FACTS.map(([title, body], index) => <Reveal key={title} delay={index * 0.05}>
          <h3 className="flex items-center gap-2 text-[16px] font-semibold"><span className="h-4 w-[3px] rounded-full bg-gradient-to-b from-brand-blue to-brand-mint"/>{title}</h3>
          <p className="mt-2 text-[14.5px] leading-relaxed text-fg-muted">{body}</p>
        </Reveal>)}
      </div>
    </div>
  </section>;
}
