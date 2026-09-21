import React, { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowClockwise, Check, SpeakerHigh, SpeakerSlash } from '@phosphor-icons/react';
import { GOALS } from './demoData.js';
import { DemoContext, TICK_MS, initialState, reducer, useDemo } from './useDemo.js';
import { Palette, Rail, Tape, Toasts } from './chrome.jsx';
import { GroundstationView } from './views/Groundstation.jsx';
import { WorkspaceView } from './views/Workspace.jsx';
import { NeedsView } from './views/Needs.jsx';
import { RecipesView } from './views/Recipes.jsx';
import { HistoryView } from './views/History.jsx';
import { MissionAiView } from './views/MissionAI.jsx';
import { IntegrationsView, SettingsView } from './views/Settings.jsx';
import './demo.css';

// The replica is laid out as the app is at a 1440 x 880 window, then scaled
// to the width the page gives it, so it looks exactly like the app, only
// smaller. On a phone it stops shrinking at half size and pans sideways.
const WIDTH = 1440;
const HEIGHT = 880;
const MIN_SCALE = 0.5;

// A soft two-note chime, like the app's permission notice. Only after the
// visitor has clicked inside the demo (browsers require it), and mutable.
function useChime(enabled) {
  const context = useRef(null);
  const unlock = () => {
    if (context.current || typeof window === 'undefined') return;
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (Audio) context.current = new Audio();
  };
  const play = () => {
    const audio = context.current;
    if (!enabled || !audio) return;
    const now = audio.currentTime;
    [[880, 0], [1318.5, 0.13]].forEach(([frequency, offset]) => {
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.06, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.5);
      oscillator.connect(gain).connect(audio.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.55);
    });
  };
  return { unlock, play };
}

function Guide({ sound, setSound }) {
  const { state, dispatch } = useDemo();
  const done = GOALS.filter(goal => state.goals[goal.id]).length;
  return <div className="oa-guide">
    <span className="mr-1 font-mono text-[12px] uppercase tracking-[0.14em] text-fg-muted">Try it · {done}/{GOALS.length}</span>
    {GOALS.map((goal, index) => <span key={goal.id} className={`oa-goal ${state.goals[goal.id] ? 'is-done' : ''}`}>
      <i>{state.goals[goal.id] ? <Check size={11} weight="bold"/> : index + 1}</i>{goal.label}
    </span>)}
    <span className="ml-auto flex items-center gap-1">
      <button type="button" onClick={() => setSound(value => !value)} aria-pressed={sound} className="inline-flex h-[34px] items-center gap-1.5 rounded-full px-3 text-[13px] text-fg-muted hover:bg-white/[0.06] hover:text-fg">{sound ? <SpeakerHigh size={15}/> : <SpeakerSlash size={15}/>}{sound ? 'Sound on' : 'Sound off'}</button>
      <button type="button" onClick={() => dispatch({ type: 'RESET' })} className="inline-flex h-[34px] items-center gap-1.5 rounded-full px-3 text-[13px] text-fg-muted hover:bg-white/[0.06] hover:text-fg"><ArrowClockwise size={14}/>Reset demo</button>
    </span>
  </div>;
}

function useFit(ref) {
  const [scale, setScale] = useState(0.86);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => setScale(Math.min(1, Math.max(MIN_SCALE, element.clientWidth / WIDTH)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return scale;
}

const VIEWS = { groundstation: GroundstationView, workspace: WorkspaceView, needs: NeedsView, recipes: RecipesView, history: HistoryView, ai: MissionAiView, settings: SettingsView, integrations: IntegrationsView };

export default function DemoApp() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [sound, setSound] = useState(true);
  const [visible, setVisible] = useState(false);
  const root = useRef(null);
  const pan = useRef(null);
  const hovering = useRef(false);
  const chime = useChime(sound);
  const lastChime = useRef(0);
  const scale = useFit(pan);

  useEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.12 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = window.setInterval(() => { if (!document.hidden) dispatch({ type: 'TICK' }); }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [visible]);

  useEffect(() => {
    if (state.chime > lastChime.current) chime.play();
    lastChime.current = state.chime;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.chime]);

  // Ctrl+K opens the palette while the pointer or keyboard focus is in the demo.
  useEffect(() => {
    const onKey = event => {
      const inside = hovering.current || root.current?.contains(document.activeElement);
      if (!inside) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        dispatch({ type: 'PALETTE', open: !state.palette });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.palette]);

  const View = VIEWS[state.route] || WorkspaceView;

  return <DemoContext.Provider value={{ state, dispatch }}>
    <div ref={root} className="oa-demo" onPointerEnter={() => { hovering.current = true; }} onPointerLeave={() => { hovering.current = false; }} onPointerDown={chime.unlock}>
      <Guide sound={sound} setSound={setSound}/>
      <div className="rx-stage">
        <div ref={pan} className="rx-pan" data-lenis-prevent="">
          <div className="rx-fit" style={{ width: WIDTH * scale, height: HEIGHT * scale }}>
            <div className="rx-window" style={{ transform: `scale(${scale})` }} role="region" aria-label="Interactive OUTARCH demo. Everything here is simulated in your browser.">
              <Rail/>
              <Tape/>
              <main className="rx-main">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.div key={state.route} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}>
                    <View/>
                  </motion.div>
                </AnimatePresence>
              </main>
              <Toasts/>
              <Palette/>
            </div>
          </div>
        </div>
      </div>
      <p className="oa-pan-hint">Swipe sideways to see the whole window. It is easiest to explore on a larger screen.</p>
    </div>
  </DemoContext.Provider>;
}
