import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bell, BellRinging, CaretUpDown, CheckCircle, ClockCounterClockwise, GearSix, Info, MagnifyingGlass, Minus,
  Pulse, Scan, ShieldCheck, Sparkle, Square, SquaresFour, TerminalWindow, Warning, WarningDiamond, X,
} from '@phosphor-icons/react';
import { BrandIcon, Wordmark } from '../components/Brand.jsx';
import { LAYOUTS, PROJECT, RECIPE } from './demoData.js';
import { projectStatus, useDemo } from './useDemo.js';

export const ROUTES = [
  { id: 'groundstation', label: 'Groundstation', icon: Pulse },
  { id: 'workspace', label: 'Workspace', icon: TerminalWindow },
  { id: 'needs', label: 'Needs You', icon: Warning },
  { id: 'recipes', label: 'Recipes', icon: SquaresFour },
  { id: 'history', label: 'History', icon: ClockCounterClockwise },
  { id: 'settings', label: 'Settings', icon: GearSix },
];

export const ROUTE_TITLE = { groundstation: 'Groundstation', workspace: 'Workspace', needs: 'Needs You', recipes: 'Recipes', history: 'History', settings: 'Settings', integrations: 'Integrations', ai: 'Mission AI' };

export function Rail() {
  const { state, dispatch } = useDemo();
  const item = ({ id, label, icon: Icon }) => <button key={id} type="button" className={`rx-nav ${state.route === id ? 'is-active' : ''}`} onClick={() => dispatch({ type: 'NAV', route: id })} aria-current={state.route === id ? 'page' : undefined}>
    <Icon size={20}/>{label}
    {id === 'needs' && state.needs.length ? <span className="rx-nav__badge">{state.needs.length}</span> : null}
  </button>;
  return <nav className="rx-rail" aria-label="Demo navigation">
    <div className="rx-brand">
      <BrandIcon size={34}/>
      <div><Wordmark/><small>Developer cockpit</small></div>
    </div>
    <div className="rx-project">
      <span className="rx-avatar">{PROJECT.initial}</span>
      <div><small>PROJECT</small><strong>{PROJECT.name}</strong></div>
      <CaretUpDown size={16}/>
    </div>
    {ROUTES.map(item)}
    <hr/>
    {item({ id: 'integrations', label: 'Integrations', icon: Scan })}
    <div className="rx-rail__spacer"/>
    <button type="button" className="rx-search" onClick={() => dispatch({ type: 'PALETTE', open: true })}><MagnifyingGlass size={17}/>Search commands<kbd>Ctrl+K</kbd></button>
    <button type="button" className={`rx-mai ${state.route === 'ai' ? 'is-active' : ''}`} onClick={() => dispatch({ type: 'NAV', route: 'ai' })}>
      <span className="rx-spark"><Sparkle size={14} weight="fill"/></span>Mission AI
    </button>
  </nav>;
}

export function Tape() {
  const { state, dispatch } = useDemo();
  const status = projectStatus(state);
  const dot = { good: '#32d583', warn: '#f5b942', bad: '#ff5f5f' }[status.tone];
  return <header className="rx-tape">
    <span className="rx-pill"><i style={{ background: dot }}/>{PROJECT.name}</span>
    <span className={`rx-pill rx-pill--${status.tone}`}><i style={{ background: dot }}/>{status.label}</span>
    <span className="rx-tape__route">{ROUTE_TITLE[state.route]}</span>
    <div className="rx-tape__right">
      <span className="rx-tape__meta">Protocol v1&nbsp;&nbsp;Last signal just now</span>
      <span className="rx-tape__sep"/>
      <span className="rx-tape__meta">Needs you {state.needs.length ? <b>{state.needs.length}</b> : '-'}</span>
      <button type="button" className="rx-bell" onClick={() => dispatch({ type: 'NAV', route: 'needs' })} aria-label={`Notifications, ${state.unread} new`}>
        {state.unread ? <BellRinging size={16}/> : <Bell size={16}/>}
        {state.unread ? <b>{state.unread}</b> : null}
      </button>
      <button type="button" className="rx-help" onClick={() => dispatch({ type: 'TOAST', toast: { tone: 'info', title: 'Keyboard guide', detail: 'Ctrl+K search · Alt 1-6 panes · Alt F focus' } })}>Help&nbsp;F1</button>
      <div className="rx-winctl" aria-hidden="true"><span><Minus size={16}/></span><span><Square size={13}/></span><span><X size={17}/></span></div>
    </div>
  </header>;
}

const TOAST_LOOK = {
  warn: [BellRinging, 'rgba(245,185,66,.14)', '#f5b942'],
  err: [WarningDiamond, 'rgba(255,95,95,.14)', '#ff6b6b'],
  ok: [CheckCircle, 'rgba(50,213,131,.14)', '#32d583'],
  info: [Info, 'rgba(47,123,255,.16)', '#6aa6ff'],
  ai: [Sparkle, 'rgba(155,123,255,.16)', '#b59dff'],
  update: [ShieldCheck, 'rgba(47,123,255,.16)', '#6aa6ff'],
};

// The same notification cards the app shows (and the website hero plays).
export function Toasts() {
  const { state, dispatch } = useDemo();
  return <div className="rx-toasts" aria-live="polite">
    <AnimatePresence initial={false}>
      {state.toasts.map(item => {
        const [Icon, bg, color] = TOAST_LOOK[item.tone] || TOAST_LOOK.info;
        const ringing = item.tone === 'warn' || item.tone === 'err';
        return <motion.div key={item.id} layout className={`rx-toast rx-toast--${item.tone}`}
          initial={{ opacity: 0, x: 40, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, x: 30, transition: { duration: 0.2 } }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}>
          <span className={`rx-toast__tile ${ringing ? 'is-ringing' : ''}`} style={{ background: bg, color }}><Icon size={19} weight="fill"/></span>
          <div style={{ minWidth: 0 }}>
            <div className="rx-toast__meta"><b>OUTARCH</b>now</div>
            <div className="rx-toast__title">{item.title}</div>
            {item.detail ? <div className="rx-toast__detail">{item.source ? `${item.source} · ` : ''}{item.detail}</div> : null}
            {item.action === 'open' ? <div className="rx-toast__actions">
              <button type="button" className="rx-pillbtn rx-pillbtn--primary" onClick={() => dispatch({ type: 'FOCUS', workerId: item.workerId, show: true })}>Open terminal</button>
              <button type="button" className="rx-pillbtn" onClick={() => dispatch({ type: 'NAV', route: 'needs' })}>Needs You</button>
            </div> : null}
            {item.action === 'ai' ? <div className="rx-toast__actions">
              <button type="button" className="rx-pillbtn" onClick={() => dispatch({ type: 'AI_ASK', topic: 'tests', text: 'Why are the tests failing?' })}>Ask Mission AI</button>
            </div> : null}
          </div>
          <button type="button" className="rx-toast__x" aria-label="Dismiss" onClick={() => dispatch({ type: 'DISMISS_TOAST', id: item.id })}><X size={13}/></button>
        </motion.div>;
      })}
    </AnimatePresence>
  </div>;
}

export function Palette() {
  const { state, dispatch } = useDemo();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef(null);

  const commands = useMemo(() => [
    ...Object.entries(ROUTE_TITLE).map(([route, title]) => ({ id: `go-${route}`, label: `Go to ${title}`, hint: 'Navigate', run: () => dispatch({ type: 'NAV', route }) })),
    { id: 'recipe', label: `Launch recipe: ${RECIPE.name}`, hint: 'Recipe', run: () => { dispatch({ type: 'NAV', route: 'recipes' }); dispatch({ type: 'LAUNCH_RECIPE' }); } },
    { id: 'start-idle', label: 'Start every idle worker', hint: 'Workers', run: () => dispatch({ type: 'START_IDLE' }) },
    ...Object.values(state.workers).filter(worker => worker.status === 'failed' || worker.status === 'done').map(worker => ({ id: `restart-${worker.id}`, label: `Restart ${worker.name}`, hint: 'Worker', run: () => dispatch({ type: 'RESTART', workerId: worker.id }) })),
    ...Object.values(state.workers).map(worker => ({ id: `open-${worker.id}`, label: `Open terminal: ${worker.name}`, hint: 'Terminal', run: () => dispatch({ type: 'FOCUS', workerId: worker.id, show: true }) })),
    ...LAYOUTS.map(layout => ({ id: `layout-${layout.id}`, label: `Layout ${layout.label}`, hint: 'Layout', run: () => { dispatch({ type: 'NAV', route: 'workspace' }); dispatch({ type: 'LAYOUT', layout: layout.id }); } })),
    { id: 'focus', label: 'Toggle Focus mode', hint: 'View', run: () => dispatch({ type: 'FOCUS_MODE' }) },
    { id: 'ai-tests', label: 'Ask Mission AI: why are the tests failing?', hint: 'AI', run: () => dispatch({ type: 'AI_ASK', topic: 'tests', text: 'Why are the tests failing?' }) },
    { id: 'reset', label: 'Reset the demo', hint: 'Demo', run: () => dispatch({ type: 'RESET' }) },
  ], [state.workers, dispatch]);

  const filtered = commands.filter(command => command.label.toLowerCase().includes(query.trim().toLowerCase()));
  useEffect(() => { if (state.palette) { setQuery(''); setActive(0); requestAnimationFrame(() => input.current?.focus({ preventScroll: true })); } }, [state.palette]);
  useEffect(() => { setActive(0); }, [query]);
  const close = () => dispatch({ type: 'PALETTE', open: false });
  const run = command => { close(); command?.run(); };

  return <AnimatePresence>
    {state.palette ? <motion.div className="rx-scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onPointerDown={event => { if (event.target === event.currentTarget) close(); }}>
      <motion.div className="rx-palette" role="dialog" aria-label="Command palette" initial={{ opacity: 0, y: -12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
        <div className="rx-palette__input">
          <MagnifyingGlass size={18}/>
          <input ref={input} value={query} onChange={event => setQuery(event.target.value)} placeholder="Search commands, workers and views" aria-label="Search commands"
            onKeyDown={event => {
              if (event.key === 'ArrowDown') { event.preventDefault(); setActive(value => Math.min(filtered.length - 1, value + 1)); }
              else if (event.key === 'ArrowUp') { event.preventDefault(); setActive(value => Math.max(0, value - 1)); }
              else if (event.key === 'Enter') { event.preventDefault(); run(filtered[active]); }
              else if (event.key === 'Escape') { event.preventDefault(); close(); }
            }}/>
        </div>
        <ul role="listbox" aria-label="Commands">
          {filtered.length ? filtered.map((command, index) => <li key={command.id} role="option" aria-selected={index === active}>
            <button type="button" data-active={index === active} onPointerEnter={() => setActive(index)} onClick={() => run(command)}>{command.label}<small>{command.hint}</small></button>
          </li>) : <li style={{ padding: 14, color: '#a1a1a1' }}>No command matches.</li>}
        </ul>
      </motion.div>
    </motion.div> : null}
  </AnimatePresence>;
}
