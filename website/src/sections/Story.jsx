import React, { useRef, useState } from 'react';
import { AnimatePresence, motion, useInView, useReducedMotion, useScroll, useSpring } from 'framer-motion';
import {
  BellRinging, Check, FolderOpen, HandPalm, Plus, Robot, Sparkle, TreeStructure, WarningDiamond, Eye,
} from '@phosphor-icons/react';
import { EASE, Reveal, SectionTitle, useSpotlight } from '../components/ui.jsx';

// ------------------------------------------------------------------ tools marquee

const TOOLS = [
  ['claude', true], ['npm run dev', false], ['codex', true], ['pytest -f', false], ['gemini', true], ['docker compose up', false],
  ['opencode', true], ['cargo watch -x test', false], ['copilot', true], ['python manage.py runserver', false], ['cursor-agent', true],
  ['go run ./cmd/api', false], ['goose', true], ['dotnet watch', false], ['aider', true], ['powershell.exe', false],
];

export function ToolsMarquee() {
  const row = [...TOOLS, ...TOOLS];
  return <section className="relative z-[1] border-y border-line-soft bg-ink-900/40 py-8" aria-label="Commands OUTARCH can run">
    <p className="mx-auto mb-5 max-w-page px-5 text-center text-[14px] text-fg-muted md:px-8">If it runs in a terminal, OUTARCH can run it. The agents in violet also raise permission alerts.</p>
    <div className="mask-fade-x overflow-hidden">
      <div className="flex w-max animate-marquee gap-3 hover:[animation-play-state:paused]">
        {row.map(([name, agent], index) => <span key={index} className={`inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-4 font-term text-[13.5px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)] ${agent ? 'bg-brand-violet/10 text-[#d6ccff] shadow-[inset_0_0_0_1px_rgba(155,123,255,0.3)]' : 'bg-white/[0.03] text-fg-soft'}`}>
          <span className="text-fg-dim">$</span>{name}
        </span>)}
      </div>
    </div>
  </section>;
}

// ------------------------------------------------------------------ how it works

const STEPS = [
  { icon: FolderOpen, color: '#6aa6ff', title: 'Open your project', body: 'Point OUTARCH at a folder. It brings back the terminals you saved for it, or starts with a single shell.' },
  { icon: Plus, color: '#3fd0b5', title: 'Run your stack', body: 'Add dev servers, test watchers, shells and AI agents. Each one runs in its own real terminal.' },
  { icon: Eye, color: '#f5b942', title: 'OUTARCH watches it', body: 'It reads every line of output and catches crashes, failing tests and agents waiting on a question.' },
  { icon: HandPalm, color: '#9b7bff', title: 'Step in when needed', body: 'A sound and a notice tell you what needs a decision. You answer in one place; everything else keeps running.' },
];

export function HowItWorks() {
  const reduce = useReducedMotion();
  const track = useRef(null);
  const { scrollYProgress } = useScroll({ target: track, offset: ['start 0.8', 'end 0.55'] });
  const progress = useSpring(scrollYProgress, { stiffness: 90, damping: 26 });
  return <section id="how" className="relative z-[1] mx-auto max-w-page scroll-mt-24 px-5 py-28 md:px-8">
    <SectionTitle kicker="How it works" title="Set it up once. Step in only when it matters." />
    <div ref={track} className="relative mt-16">
      <div className="absolute left-[22px] top-2 h-[calc(100%-16px)] w-px bg-white/10 md:left-0 md:top-[22px] md:h-px md:w-full" aria-hidden="true"/>
      <motion.div
        className="absolute left-[22px] top-2 h-[calc(100%-16px)] w-px origin-top bg-[linear-gradient(180deg,#2f7bff,#3fd0b5,#f5b942,#9b7bff)] md:hidden"
        style={{ scaleY: reduce ? 1 : progress }}
        aria-hidden="true"
      />
      <motion.div
        className="absolute left-0 top-[22px] hidden h-px w-full origin-left bg-[linear-gradient(90deg,#2f7bff,#3fd0b5,#f5b942,#9b7bff)] md:block"
        style={{ scaleX: reduce ? 1 : progress }}
        aria-hidden="true"
      />
      <ol className="relative grid grid-cols-1 gap-10 md:grid-cols-4 md:gap-8">
        {STEPS.map((step, index) => {
          const Icon = step.icon;
          return <Reveal as="li" key={step.title} delay={index * 0.08} className="relative pl-16 md:pl-0">
            <span className="absolute left-0 top-0 grid h-11 w-11 place-items-center rounded-full bg-ink-800 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.14)] md:relative" style={{ color: step.color }}>
              <Icon size={20} weight="duotone"/>
            </span>
            <h3 className="text-[19px] font-semibold tracking-[-0.01em] md:mt-6">{step.title}</h3>
            <p className="mt-2 text-[15px] leading-relaxed text-fg-muted">{step.body}</p>
          </Reveal>;
        })}
      </ol>
    </div>
  </section>;
}

// ------------------------------------------------------------------ highlights (sticky)

function PermissionVisual() {
  return <div className="flex h-full flex-col justify-center gap-3 p-6 sm:p-8">
    <div className="rounded-[14px] bg-black/70 p-4 font-term text-[12.5px] leading-relaxed text-[#d9d9d9] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
      <p className="text-[#c4b5fd]">● Bash  npm install zod@3</p>
      <div className="mt-2 rounded-[8px] border border-[#f5b942]/60 bg-[#f5b942]/[0.06] p-3">
        <p className="font-bold text-[#fbbf24]">Bash command</p>
        <p className="text-white">  npm install zod@3</p>
        <p>Do you want to proceed?</p>
        <p className="mt-1"><span className="rounded bg-[#f5b942]/20 px-1.5 text-[#fde68a]">❯ 1. Yes</span>  2. No</p>
      </div>
    </div>
    <motion.div initial={{ opacity: 0, x: 40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: false, amount: 0.6 }} transition={{ type: 'spring', stiffness: 220, damping: 22, delay: 0.3 }} className="ml-auto flex w-[88%] items-start gap-3 rounded-[14px] bg-ink-600 p-4 shadow-[0_0_0_1px_rgba(245,185,66,0.5),0_24px_50px_-20px_rgba(0,0,0,0.9)]">
      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-[#f5b942]/15 text-[#fbbf24]"><BellRinging size={18} weight="fill"/><span className="absolute inset-0 animate-pulse-ring rounded-[10px] shadow-[0_0_0_2px_#f5b942]"/></span>
      <div>
        <p className="text-[14px] font-medium">Claude Code is asking for permission</p>
        <p className="font-term text-[12px] text-fg-muted">Web app · npm install zod@3</p>
        <span className="mt-2 inline-flex h-7 items-center rounded-full bg-brand-blue px-3 text-[12px] font-medium">Open terminal</span>
      </div>
    </motion.div>
  </div>;
}

function NeedsVisual() {
  const items = [
    [BellRinging, '#fbbf24', 'Agent permission', 'Codex wants to run git push'],
    [WarningDiamond, '#ff8a8a', 'Worker failure', 'Queue worker exited with code 1'],
    [Sparkle, '#c4b5fd', 'Mission AI plan', 'Restart API gateway, then re-run tests'],
    [Robot, '#6aa6ff', 'MCP request', 'Claude Desktop asks to start E2E tests'],
  ];
  return <div className="flex h-full flex-col justify-center gap-2.5 p-6 sm:p-8">
    {items.map(([Icon, color, label, title], index) => <motion.div key={title} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: false, amount: 0.5 }} transition={{ duration: 0.5, delay: index * 0.08, ease: EASE }} className="flex items-center gap-3 rounded-[12px] bg-ink-700 px-4 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
      <Icon size={18} weight="fill" color={color}/>
      <div className="min-w-0 flex-1"><p className="text-[11.5px] text-fg-dim">{label}</p><p className="truncate text-[13.5px] font-medium">{title}</p></div>
      <span className="rounded-[7px] bg-brand-blue px-2.5 py-1 text-[12px] font-semibold">{index === 1 ? 'Restart' : 'Approve'}</span>
    </motion.div>)}
  </div>;
}

function RecipeVisual() {
  const reduce = useReducedMotion();
  const ref = useRef(null);
  const inView = useInView(ref, { amount: 0.5 });
  const nodes = [['Postgres tunnel', 'port 5432 open', 0], ['Codex review', 'review finished', 1.1], ['E2E tests', '18 passed', 1.4]];
  return <div ref={ref} className="grid h-full grid-cols-[1fr_60px_1fr] items-center p-6 sm:p-8">
    <Node label={nodes[0]} on={inView} reduce={reduce}/>
    <svg viewBox="0 0 60 140" className="h-[140px] w-full overflow-visible" aria-hidden="true">
      {[[0, 30], [0, 110]].map(([x, y], index) => <motion.path key={y} d={`M${x} 70 C 30 70, 30 ${y}, 60 ${y}`} fill="none" stroke="#3fd0b5" strokeWidth="1.6" initial={{ pathLength: reduce ? 1 : 0 }} animate={{ pathLength: inView || reduce ? 1 : 0 }} transition={{ duration: 0.6, delay: 0.7 + index * 0.1 }}/>)}
    </svg>
    <div className="flex flex-col gap-4"><Node label={nodes[1]} on={inView} reduce={reduce}/><Node label={nodes[2]} on={inView} reduce={reduce}/></div>
  </div>;
}

function Node({ label: [name, gate, delay], on, reduce }) {
  return <div className="relative overflow-hidden rounded-[12px] bg-ink-700 px-3.5 py-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
    <motion.span className="absolute inset-0 rounded-[12px] shadow-[inset_0_0_0_1px_rgba(50,213,131,0.8)]" initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: on || reduce ? 1 : 0 }} transition={{ duration: 0.4, delay: delay + 0.4 }}/>
    <p className="text-[13.5px] font-semibold">{name}</p>
    <p className="mt-0.5 text-[12px] text-fg-muted">gate: {gate}</p>
    <motion.p className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.08em] text-brand-green" initial={{ opacity: reduce ? 1 : 0 }} animate={{ opacity: on || reduce ? 1 : 0 }} transition={{ duration: 0.4, delay: delay + 0.4 }}><Check size={11} weight="bold"/>Ready</motion.p>
  </div>;
}

function AiVisual() {
  return <div className="flex h-full flex-col justify-center gap-3 p-6 sm:p-8">
    <div className="ml-auto max-w-[80%] rounded-[14px] bg-[#0b2a57] px-4 py-2.5 text-[14px] shadow-[inset_0_0_0_1px_rgba(50,145,255,0.4)]">Why did the API gateway stop?</div>
    <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: false, amount: 0.5 }} transition={{ duration: 0.6, ease: EASE }} className="max-w-[92%] rounded-[14px] bg-ink-700 px-4 py-3 text-[14px] leading-relaxed shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]">
      <p className="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-[#c4b5fd]"><Sparkle size={13} weight="fill"/>Mission AI</p>
      Port 4000 was already taken by a node process OUTARCH didn't start, so the gateway exited with EADDRINUSE. I can stop the stray process and restart the gateway.
      <div className="mt-3 flex gap-2"><span className="rounded-[7px] bg-white/[0.07] px-2.5 py-1 text-[12px] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)]">Proposed: 2 steps</span><span className="rounded-[7px] bg-brand-blue px-2.5 py-1 text-[12px] font-semibold">Send to Needs You</span></div>
    </motion.div>
  </div>;
}

const HIGHLIGHTS = [
  {
    id: 'ask', color: '47,123,255', label: 'Permission alerts', icon: BellRinging, visual: PermissionVisual,
    title: 'Know the moment an agent needs you.',
    body: 'When a coding agent stops to ask for permission, OUTARCH plays a sound and shows a notice, with a Windows notification if the app is in the background. One click opens that exact terminal, and the notice clears once you answer. Works with Claude Code, Codex, Gemini CLI, Copilot, Cursor, OpenCode, Goose and Aider.',
  },
  {
    id: 'needs', color: '245,185,66', label: 'Needs You', icon: WarningDiamond, visual: NeedsVisual,
    title: 'One queue for every decision.',
    body: 'Crashed workers, failing tests, waiting agents, Mission AI plans, and requests from automations, MCP clients or your phone all land in Needs You. Each item shows what happened and what acting on it will change. Approvals run once and expire if they wait too long.',
  },
  {
    id: 'recipes', color: '63,208,181', label: 'Workspace Recipes', icon: TreeStructure, visual: RecipeVisual,
    title: 'Start your whole stack with one click.',
    body: 'A recipe starts your workers in dependency order and waits for real signals before moving on: an open port, passing tests, a finished build, a healthy container, a clean Git tree. Retries and timeouts are built in, and a rollback stops only what that recipe started.',
  },
  {
    id: 'ai', color: '155,123,255', label: 'Mission AI', icon: Sparkle, visual: AiVisual,
    title: 'Ask what is going on, and get a real answer.',
    body: 'Mission AI answers from your live workers, errors and history. It can read project files and run checks in a private terminal of its own, and it asks before running any command. Use the built-in models or your own key from 18 providers, including OpenAI, Anthropic, Gemini and OpenRouter, or any OpenAI-compatible endpoint.',
  },
];

export function Highlights() {
  const [active, setActive] = useState(0);
  const spotlight = useSpotlight();
  const current = HIGHLIGHTS[active];
  const Visual = current.visual;
  return <section id="features" className="relative z-[1] mx-auto max-w-page scroll-mt-24 px-5 py-24 md:px-8">
    <SectionTitle title="Stop watching every terminal." lede="Agents stop to ask. Services crash while you look elsewhere. Five terminals are too many to watch. OUTARCH does the watching, so you only handle the decisions."/>
    <div className="mt-16 grid grid-cols-[minmax(0,1fr)] gap-10 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
      <div className="hidden lg:block">
        <div className="sticky top-28">
          <div onPointerMove={spotlight} className="card spotlight relative h-[460px] overflow-hidden" style={{ '--spot': current.color }}>
            <div className="absolute inset-0 transition-[background] duration-700" style={{ background: `radial-gradient(90% 70% at 30% 0%, rgba(${current.color},0.2), transparent 60%)` }}/>
            <AnimatePresence mode="wait">
              <motion.div key={current.id} className="relative h-full" initial={{ opacity: 0, y: 18, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -12, filter: 'blur(6px)' }} transition={{ duration: 0.45, ease: EASE }}>
                <Visual/>
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="mt-5 flex gap-2" aria-hidden="true">
            {HIGHLIGHTS.map((item, index) => <span key={item.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full transition-all duration-500" style={{ width: index <= active ? '100%' : '0%', background: `rgb(${item.color})` }}/>
            </span>)}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-10 lg:gap-0">
        {HIGHLIGHTS.map((item, index) => <HighlightText key={item.id} item={item} index={index} onActive={setActive}/>)}
      </div>
    </div>
  </section>;
}

function HighlightText({ item, index, onActive }) {
  const ref = useRef(null);
  const inView = useInView(ref, { margin: '-45% 0px -45% 0px' });
  React.useEffect(() => { if (inView) onActive(index); }, [inView, index, onActive]);
  const Icon = item.icon;
  const Visual = item.visual;
  return <div ref={ref} className="lg:flex lg:min-h-[78vh] lg:items-center">
    <div>
      <Reveal><span className="inline-flex items-center gap-2 text-[14px] font-medium" style={{ color: `rgb(${item.color})` }}><Icon size={18} weight="duotone"/>{item.label}</span></Reveal>
      <Reveal delay={0.05}><h3 className="display mt-4 text-[clamp(1.7rem,3vw,2.5rem)]">{item.title}</h3></Reveal>
      <Reveal delay={0.1}><p className="lede mt-4 text-[16.5px]">{item.body}</p></Reveal>
      <div className="card mt-8 h-[360px] overflow-hidden lg:hidden"><Visual/></div>
    </div>
  </div>;
}

