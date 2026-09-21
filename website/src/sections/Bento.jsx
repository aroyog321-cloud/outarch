import React, { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  BookOpen, ChartLineUp, Code, Command, Cpu, Lightning, LockKey, ShieldCheck, SquaresFour,
} from '@phosphor-icons/react';
import { SectionTitle, Stagger, staggerItem, useSpotlight } from '../components/ui.jsx';

// ------------------------------------------------------------------ tile visuals

function LayoutMorph() {
  const reduce = useReducedMotion();
  const layouts = [
    { cols: 1, rows: 1, count: 1, label: '1' },
    { cols: 2, rows: 1, count: 2, label: '1×2' },
    { cols: 2, rows: 2, count: 4, label: '2×2' },
    { cols: 3, rows: 2, count: 6, label: '3×2' },
  ];
  const [index, setIndex] = useState(2);
  useEffect(() => {
    if (reduce) return undefined;
    const timer = window.setInterval(() => setIndex(value => (value + 1) % layouts.length), 1800);
    return () => window.clearInterval(timer);
  }, [reduce]);
  const layout = layouts[index];
  const tones = ['#32d583', '#32d583', '#f5b942', '#32d583', '#6aa6ff', '#9b7bff'];
  return <div className="mt-6 flex items-end gap-5">
    <div className="grid h-[150px] flex-1 gap-1.5 rounded-[12px] bg-black/60 p-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" style={{ gridTemplateColumns: `repeat(${layout.cols}, 1fr)`, gridTemplateRows: `repeat(${layout.rows}, 1fr)` }}>
      {Array.from({ length: layout.count }, (_, cell) => <motion.div key={cell} layout transition={{ type: 'spring', stiffness: 260, damping: 28 }} className="flex flex-col gap-1 overflow-hidden rounded-[7px] bg-ink-700 p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]">
        <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full" style={{ background: tones[cell] }}/><span className="h-1 w-8 rounded bg-white/25"/></span>
        <span className="h-1 w-3/4 rounded bg-white/10"/><span className="h-1 w-1/2 rounded bg-white/10"/><span className="h-1 w-2/3 rounded bg-white/10"/>
      </motion.div>)}
    </div>
    <div className="flex flex-col gap-1.5">
      {layouts.map((item, at) => <span key={item.label} className={`rounded-[7px] px-2.5 py-1 text-center font-mono text-[11.5px] transition-colors ${at === index ? 'bg-white/[0.12] text-fg' : 'text-fg-dim'}`}>{item.label}</span>)}
    </div>
  </div>;
}

function Sparkline() {
  const reduce = useReducedMotion();
  const [points, setPoints] = useState(() => Array.from({ length: 28 }, (_, i) => 30 + Math.sin(i / 2.4) * 14 + (i % 5) * 2));
  useEffect(() => {
    if (reduce) return undefined;
    const timer = window.setInterval(() => setPoints(list => [...list.slice(1), Math.max(8, Math.min(58, list[list.length - 1] + (Math.random() - 0.5) * 16))]), 700);
    return () => window.clearInterval(timer);
  }, [reduce]);
  const path = points.map((value, i) => `${i === 0 ? 'M' : 'L'}${(i / (points.length - 1)) * 200} ${64 - value}`).join(' ');
  const last = Math.round(points[points.length - 1] / 3);
  return <div className="mt-5">
    <div className="flex items-baseline justify-between font-mono text-[12px] text-fg-muted"><span>API gateway</span><span className="text-brand-mint">{last}% CPU</span></div>
    <svg viewBox="0 0 200 64" className="mt-2 h-16 w-full" preserveAspectRatio="none" aria-hidden="true">
      <defs><linearGradient id="spark-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#3fd0b5" stopOpacity=".35"/><stop offset="1" stopColor="#3fd0b5" stopOpacity="0"/></linearGradient></defs>
      <path d={`${path} L200 64 L0 64 Z`} fill="url(#spark-fill)"/>
      <path d={path} fill="none" stroke="#3fd0b5" strokeWidth="1.6" vectorEffect="non-scaling-stroke"/>
    </svg>
    <div className="mt-2 flex justify-between font-mono text-[11.5px] text-fg-dim"><span>184 MB</span><span>3 child processes</span></div>
  </div>;
}

function UsageBars() {
  const rows = [['Claude Code', 'claude-opus', 72, '#9b7bff'], ['Codex', 'gpt-5-codex', 44, '#6aa6ff'], ['Mission AI', 'built-in', 18, '#3fd0b5']];
  return <div className="mt-6 flex flex-col gap-3">
    {rows.map(([name, model, width, color], index) => <div key={name}>
      <div className="flex justify-between text-[12.5px]"><span className="text-fg-soft">{name}</span><span className="font-mono text-fg-dim">{model}</span></div>
      <motion.div className="mt-1.5 h-2 rounded-full" style={{ background: color, width: `${width}%`, transformOrigin: 'left' }} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={{ once: true }} transition={{ duration: 1, delay: index * 0.12, ease: [0.16, 1, 0.3, 1] }}/>
    </div>)}
    <p className="text-[12px] text-fg-dim">Illustrative numbers</p>
  </div>;
}

function PaletteMini() {
  return <div className="mt-5 overflow-hidden rounded-[12px] bg-black/60 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.09)]">
    <div className="flex items-center gap-2 border-b border-line px-3 py-2.5 font-mono text-[12.5px] text-fg-soft"><span className="text-fg-dim">›</span>restart<span className="h-3.5 w-[7px] animate-caret bg-fg-soft"/></div>
    {['Restart Queue worker', 'Restart API gateway', 'Launch recipe: Release check'].map((item, index) => <div key={item} className={`px-3 py-2 text-[12.5px] ${index === 0 ? 'bg-[#081a36] text-fg' : 'text-fg-muted'}`}>{item}</div>)}
  </div>;
}

function UpdateMini() {
  return <div className="mt-5 flex flex-wrap items-center gap-2 font-mono text-[12px]">
    {['Download', 'Verify signature', 'Back up', 'Replace', 'Restart'].map((step, index) => <motion.span key={step} initial={{ opacity: 0.25 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.25 * index, duration: 0.4 }} className={`rounded-full px-3 py-1.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12)] ${index === 1 ? 'bg-brand-mint/15 text-brand-mint shadow-[inset_0_0_0_1px_rgba(63,208,181,0.45)]' : 'text-fg-soft'}`}>{step}</motion.span>)}
  </div>;
}

function RuleMini() {
  const rows = [['When', 'Queue worker exits with code 1', 'text-[#ff8a8a]'], ['Then', 'Restart Queue worker', 'text-brand-sky'], ['Guard', 'Approve once · 10 min cooldown', 'text-brand-amber']];
  return <div className="mt-5 flex flex-col gap-2">
    {rows.map(([label, value, tone], index) => <motion.div key={label} initial={{ opacity: 0, x: -10 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 * index, duration: 0.5, ease: [0.16, 1, 0.3, 1] }} className="flex items-center gap-3 rounded-[10px] bg-black/40 px-3 py-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
      <span className={`w-11 font-mono text-[11px] uppercase tracking-[0.08em] ${tone}`}>{label}</span>
      <span className="text-[13px] text-fg-soft">{value}</span>
    </motion.div>)}
  </div>;
}

// ------------------------------------------------------------------ tiles

const TILES = [
  { span: 'md:col-span-2', icon: SquaresFour, color: '47,123,255', title: 'Split layouts and Focus mode', body: 'One, two, four or six terminals on one canvas, a free mosaic, per-pane resize, and Focus to give one terminal the whole window. Layouts are saved per project.', extra: LayoutMorph, tint: 'from-brand-blue/15' },
  { span: '', icon: Cpu, color: '63,208,181', title: 'Worker health', body: 'CPU and memory for each worker and its child processes, sampled by the engine.', extra: Sparkline, tint: 'from-brand-mint/15' },
  { span: '', icon: BookOpen, color: '245,185,66', title: 'Project memory and recovery', body: 'Every run becomes a resumable chapter. After a crash, OUTARCH shows what was interrupted and proposes a recovery for you to approve.' },
  { span: '', icon: LockKey, color: '155,123,255', title: 'Secure MCP gateway', body: 'Let Claude Desktop and other MCP clients read your workspace over localhost only, with a token and scopes. Any change they ask for waits in Needs You.' },
  { span: '', icon: Code, color: '106,166,255', title: 'VS Code bridge', body: 'Syncs the active file, diagnostics, Git state and task results from VS Code. It never types into or reads your terminals.' },
  { span: 'md:col-span-2', icon: ChartLineUp, color: '155,123,255', title: 'Token and cost usage', body: 'See what each agent and model used, read locally from the agent CLIs\' own transcripts. Only counts are read, never prompts or code.', extra: UsageBars, tint: 'from-brand-violet/15' },
  { span: '', icon: Lightning, color: '245,185,66', title: 'Automation workflows', body: 'When a worker event happens, propose an allow-listed action. Cooldowns stop loops, dry run shows what would happen, and each run is approved once.', extra: RuleMini },
  { span: '', icon: Command, color: '47,123,255', title: 'Command palette', body: 'Ctrl K reaches every worker, view and action from the keyboard.', extra: PaletteMini },
  { span: 'md:col-span-2', icon: ShieldCheck, color: '63,208,181', title: 'Signed automatic updates', body: 'Updates install only after their signature checks out against the key built into your copy. The current version is backed up first and restored if anything fails.', extra: UpdateMini, tint: 'from-brand-mint/10' },
];

function Tile({ tile }) {
  const spotlight = useSpotlight();
  const Icon = tile.icon;
  const Extra = tile.extra;
  return <motion.article
    variants={staggerItem}
    onPointerMove={spotlight}
    whileHover={{ y: -4, transition: { type: 'spring', stiffness: 300, damping: 22 } }}
    className={`card spotlight group relative overflow-hidden p-6 sm:p-7 ${tile.span}`}
    style={{ '--spot': tile.color }}
  >
    {tile.tint ? <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${tile.tint} to-transparent opacity-80`}/> : null}
    <div className="relative">
      <span className="grid h-10 w-10 place-items-center rounded-[12px] transition-transform duration-500 group-hover:scale-110 group-hover:rotate-[-6deg]" style={{ background: `rgba(${tile.color},0.14)`, color: `rgb(${tile.color})`, boxShadow: `inset 0 0 0 1px rgba(${tile.color},0.35)` }}>
        <Icon size={20} weight="duotone"/>
      </span>
      <h3 className="mt-5 text-[18px] font-semibold tracking-[-0.01em]">{tile.title}</h3>
      <p className="mt-2 max-w-[52ch] text-[14.5px] leading-relaxed text-fg-muted">{tile.body}</p>
      {Extra ? <Extra/> : null}
    </div>
  </motion.article>;
}

export function Bento() {
  return <section className="relative z-[1] mx-auto max-w-page px-5 py-24 md:px-8">
    <SectionTitle title="Everything else in the cockpit." lede="The details that make a long session with several agents calm instead of chaotic."/>
    <Stagger className="mt-14 grid grid-cols-1 gap-4 md:grid-cols-3">
      {TILES.map(tile => <Tile key={tile.title} tile={tile}/>)}
    </Stagger>
  </section>;
}

