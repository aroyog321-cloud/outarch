import React, { useRef } from 'react';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { FileText, GitDiff, ListChecks, Robot, ShieldCheck, Sparkle } from '@phosphor-icons/react';
import { EASE, Reveal } from '../components/ui.jsx';

// Project memory: the arch_memory.md OUTARCH keeps in a project. The file on
// the right is drawn from what the app writes: the rules agents follow, the
// facts OUTARCH works out itself, and entries from agents and Mission AI.

const POINTS = [
  [Robot, 'Every agent reads it first', 'Claude Code, Codex, Gemini CLI, Cursor and others find it through CLAUDE.md and AGENTS.md. They read what the project is for and what was already tried, and when they finish they add a short entry: what changed, why, and which model did it.'],
  [Sparkle, 'Your own work, recorded for you', 'Close OUTARCH after working by hand and Mission AI writes the entry from your git changes and terminal output. It can run on a different model or key from your chats.'],
  [ListChecks, 'Facts that stay true', 'Languages, frameworks, terminals, servers and scripts are worked out from the project itself and kept current, not guessed.'],
  [ShieldCheck, 'Asks first, only ever adds', 'Nothing is written until you say yes. Entries are added, never deleted, and secrets are removed before anything reaches the file.'],
];

const ENTRIES = [
  { stamp: '2026-09-22 11:12', who: 'Codex CLI', model: 'gpt-5-codex', kind: 'feature', changed: 'Added CSV export to the reports page.', why: 'Requested in issue #214.' },
  { stamp: '2026-09-22 16:40', who: 'Claude Code', model: 'claude-sonnet-4-5', kind: 'fix', changed: 'Session tokens now expire after 24 hours.', why: 'Expired tokens were still accepted.', errors: 'Login looped until the cookie was set before the redirect.' },
  { stamp: '2026-09-22 18:05', who: 'OUTARCH Mission AI', model: 'gemini-2.5-flash', kind: 'session', ai: true, changed: 'Moved the API address into .env.example.', why: 'The build broke on a fresh clone.' },
];

function MemoryFile() {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const seen = useInView(ref, { once: true, margin: '-80px 0px' });
  const show = reduce || seen;
  const step = index => ({
    initial: reduce ? false : { opacity: 0, y: 10 },
    animate: show ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 },
    transition: { duration: 0.5, ease: EASE, delay: reduce ? 0 : 0.35 + index * 0.55 },
  });
  return <div ref={ref} className="relative">
    <div className="card overflow-hidden p-0">
      <div className="flex h-11 items-center gap-2 border-b border-line px-4">
        <span className="h-2.5 w-2.5 rounded-full bg-white/[0.12]"/><span className="h-2.5 w-2.5 rounded-full bg-white/[0.12]"/><span className="h-2.5 w-2.5 rounded-full bg-white/[0.12]"/>
        <span className="ml-3 flex items-center gap-1.5 font-mono text-[12px] text-fg-muted"><FileText size={14}/>arch_memory.md</span>
        <span className="ml-auto rounded-full bg-brand-green/10 px-2 py-0.5 text-[10.5px] font-semibold text-[#7ee2ae] shadow-[inset_0_0_0_1px_rgba(50,213,131,0.3)]">in your repo</span>
      </div>
      <div className="px-5 pb-5 pt-4 font-term text-[12.5px] leading-[1.75] text-fg-muted sm:pb-28">
        <p className="font-semibold text-fg"># Project memory: acme-console</p>
        <p className="mt-3 font-semibold text-brand-sky">## Rules for AI agents</p>
        <p><span className="text-fg-dim">1.</span> <b className="text-fg">Read this file first.</b></p>
        <p><span className="text-fg-dim">2.</span> <b className="text-fg">Add an entry when you finish:</b> what, why, tool and model.</p>
        <p><span className="text-fg-dim">3.</span> <b className="text-fg">Only add, never remove.</b> Never write secrets.</p>
        <p className="mt-3 font-semibold text-brand-sky">## Project facts</p>
        <p>- <b className="text-fg">Languages:</b> TypeScript 64%, CSS 9%</p>
        <p>- <b className="text-fg">Terminals:</b> Web dev server (:5173), API gateway (:4000)</p>
        <p className="mt-3 font-semibold text-brand-sky">## Change log</p>
        <div className="mt-1 flex flex-col gap-3">
          {ENTRIES.map((entry, index) => <motion.div key={entry.stamp} {...step(index)} className={`border-l-2 pl-3 ${entry.ai ? 'border-brand-violet' : 'border-white/20'}`}>
            <p className="truncate font-semibold text-fg-soft">### {entry.stamp} · {entry.who} <span className={entry.ai ? 'text-brand-violet' : 'text-fg-muted'}>({entry.model})</span> · {entry.kind}</p>
            <p className="truncate">- <b className="text-fg">Changed:</b> {entry.changed}</p>
            <p className="truncate">- <b className="text-fg">Why:</b> {entry.why}</p>
            {entry.errors ? <p className="truncate">- <b className="text-fg">Errors and fixes:</b> {entry.errors}</p> : null}
          </motion.div>)}
        </div>
      </div>
    </div>
    {/* What asks for the last entry: the question on the way out of the app. */}
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.97 }}
      animate={show ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 16, scale: 0.97 }}
      transition={{ duration: 0.55, ease: EASE, delay: reduce ? 0 : 1.2 }}
      className="relative mx-4 -mt-6 rounded-[16px] bg-ink-700/95 p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_30px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur sm:absolute sm:-bottom-10 sm:-left-8 sm:mx-0 sm:mt-0 sm:w-[330px]"
      aria-hidden="true"
    >
      <p className="flex items-center gap-2 text-[13.5px] font-semibold"><span className="grid h-7 w-7 place-items-center rounded-[9px] bg-brand-blue/15 text-brand-sky"><FileText size={15}/></span>Update project memory before you close?</p>
      <p className="mt-2 text-[12px] leading-relaxed text-fg-muted">Since the last update: 7 files changed · 2 commits. Mission AI writes the entry.</p>
      <div className="mt-3 flex justify-end gap-2">
        <span className="rounded-[9px] px-2.5 py-1.5 text-[12px] text-fg-muted shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">Close without updating</span>
        <span className="rounded-[9px] bg-brand-blue px-2.5 py-1.5 text-[12px] font-semibold text-white">Update and close</span>
      </div>
    </motion.div>
  </div>;
}

export function MemorySection() {
  return <section id="memory" className="relative z-[1] mx-auto max-w-page scroll-mt-24 px-5 py-24 md:px-8">
    <div className="grid grid-cols-1 items-center gap-14 lg:grid-cols-[1fr_1.05fr]">
      <div>
        <Reveal><p className="kicker mb-4 flex items-center gap-2"><GitDiff size={15}/>Project memory</p></Reveal>
        <Reveal delay={0.05}><h2 className="display text-[clamp(2rem,4.4vw,3.4rem)]">Every agent starts where the last one stopped.</h2></Reveal>
        <Reveal delay={0.1}><p className="lede mt-5 text-[17px]">OUTARCH keeps an arch_memory.md in your project: what it is for, how it runs, and every change, error and fix, with who made it and why. People and AI agents keep it together, and you never have to write it yourself.</p></Reveal>
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {POINTS.map(([Icon, title, body], index) => <Reveal key={title} delay={0.12 + index * 0.05}>
            <span className="grid h-10 w-10 place-items-center rounded-[12px] bg-brand-blue/10 text-brand-sky shadow-[inset_0_0_0_1px_rgba(47,123,255,0.3)]"><Icon size={19} weight="duotone"/></span>
            <h3 className="mt-3 text-[16px] font-semibold">{title}</h3>
            <p className="mt-1.5 text-[14.5px] leading-relaxed text-fg-muted">{body}</p>
          </Reveal>)}
        </div>
      </div>
      <Reveal className="lg:pl-6"><MemoryFile/></Reveal>
    </div>
  </section>;
}
