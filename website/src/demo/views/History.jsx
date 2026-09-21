import React from 'react';
import { CheckCircle, Info, Sparkle, Warning, XCircle } from '@phosphor-icons/react';
import { relativeTime, useDemo } from '../useDemo.js';
import { Dot } from './Groundstation.jsx';

const TONE_ICON = { ok: [CheckCircle, '#32d583'], err: [XCircle, '#ff5f5f'], warn: [Warning, '#f5b942'], info: [Info, '#3291ff'], ai: [Sparkle, '#a5a5ff'] };
const STATE_CAPS = { running: 'RUNNING', waiting: 'NEEDS YOU', failed: 'FAILED', idle: 'IDLE', done: 'FINISHED' };
const STATE_TEXT = { running: 'Running now', waiting: 'Needs attention now', failed: 'Stopped with an error', idle: 'Not running now', done: 'Finished cleanly' };

export function HistoryView() {
  const { state, dispatch } = useDemo();
  const workers = Object.values(state.workers);
  const risks = state.history.filter(event => event.tone === 'err' || event.tone === 'warn').length;
  const decisions = state.resolved.length;
  const evidence = state.history.filter(event => event.tone === 'ok').length;
  const actors = new Set(state.history.map(event => event.workerId).filter(Boolean)).size + 1;
  const open = state.needs.length;
  const resume = [
    ...workers.filter(worker => worker.status === 'failed').map(worker => ['#ff5f5f', `Review ${worker.name}`, `${worker.name} stopped with an error; its last output is kept.`, worker.id]),
    ...workers.filter(worker => worker.status === 'waiting').map(worker => ['#f5b942', `Answer ${worker.name}`, `${worker.name} is waiting for your permission.`, worker.id]),
    ...workers.filter(worker => worker.status === 'running').map(worker => ['#3291ff', `Resume ${worker.name}`, `${worker.name} is running under engine supervision.`, worker.id]),
  ].slice(0, 4);
  return <div className="rx-scroll" data-lenis-prevent="">
    <div className="hs-head">
      <div className="hs-head__title"><span className="rx-caps mono" style={{ whiteSpace: 'nowrap' }}>Project memory</span><h3>Investigate how the work unfolded</h3></div>
      <p>A durable timeline of worker changes and verified operational facts. Structured evidence is kept without raw output.</p>
      <div className="hs-tiles">
        <div><small>RECORDED</small><b>{186 + state.history.length}</b></div>
        <div><small>EVIDENCE</small><b>{evidence}</b></div>
        <div><small>RISKS</small><b>{risks}</b></div>
        <div><small>DECISIONS</small><b>{decisions}</b></div>
        <div><small>RECIPE RUNS</small><b>{state.recipe.runs}</b></div>
        <div><small>ACTORS</small><b>{actors}</b></div>
      </div>
    </div>
    <div className="hs-body">
      <section className="rx-card hs-summary">
        <div>
          <span className="rx-caps">Since you left · Engine summary</span>
          <p>Since your last review: {state.history.length} recorded changes across {actors} actors. {open ? `${open} ${open === 1 ? 'decision remains' : 'decisions remain'} open.` : 'No run remains unresolved.'}</p>
          <ul><li>{state.history.length} changes</li><li>{risks} risks</li><li>{evidence} evidence records</li></ul>
        </div>
        <aside>
          <span className="rx-caps">Why it needs review</span>
          <p style={{ marginTop: 10 }}>{workers.some(worker => worker.status === 'failed') ? 'Queue worker exited with code 1: connect ECONNREFUSED 127.0.0.1:6379.' : 'No recorded failure reason in this review window.'}</p>
        </aside>
      </section>
      <section className="hs-resume">
        <div><span className="rx-caps">Resume work</span><b>Return with the engine's last known context</b><p>Worker state and run evidence, no generated progress.</p></div>
        {resume.map(([color, title, text, id]) => <div key={title}>
          <button type="button" onClick={() => dispatch({ type: 'FOCUS', workerId: id, show: true })}><span className="rx-dot" style={{ background: 'transparent', boxShadow: `inset 0 0 0 2px ${color}` }}/>{title}</button>
          <p>{text}</p>
          <button type="button" className="rx-caps" onClick={() => dispatch({ type: 'FOCUS', workerId: id, show: true })}>Open worker</button>
        </div>)}
      </section>
      <section className="rx-card hs-state">
        <div className="hs-state__head"><span className="rx-caps">Current engine state</span><span>Now, separate from the historical record below</span></div>
        <div className="hs-grid">
          {workers.map(worker => <button key={worker.id} type="button" className="hs-worker" onClick={() => { dispatch({ type: 'SELECT', workerId: worker.id }); dispatch({ type: 'NAV', route: 'groundstation' }); }}>
            <Dot status={worker.status}/>
            <div><b>{worker.name}</b><small>{worker.attention && worker.status === 'running' ? 'Needs attention now' : STATE_TEXT[worker.status]}</small></div>
            <em>{STATE_CAPS[worker.status]}</em>
          </button>)}
        </div>
      </section>
      <section className="rx-card hs-evidence">
        <div className="hs-state__head"><span className="rx-caps">Engine evidence</span><span style={{ fontWeight: 500, color: '#a1a1a1' }}>Verified facts from your workers</span></div>
        <ul style={{ marginTop: 8 }}>
          {state.history.slice(0, 12).map(event => {
            const [Icon, color] = TONE_ICON[event.tone] || TONE_ICON.info;
            return <li key={event.id}><Icon size={16} color={color} weight="fill"/><span>{event.text}</span><time>{relativeTime(state.tick, event.tick)}</time></li>;
          })}
        </ul>
      </section>
    </div>
  </div>;
}
