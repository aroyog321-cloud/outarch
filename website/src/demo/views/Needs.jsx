import React from 'react';
import { ArrowRight, CheckCircle, Info } from '@phosphor-icons/react';
import { NEED_COLUMNS } from '../demoData.js';
import { relativeTime, useDemo } from '../useDemo.js';

const TABS = [['all', 'All'], ['critical', 'Critical'], ['agents', 'Agents'], ['resolved', 'Resolved']];

function inTab(need, tab) {
  if (tab === 'critical') return need.kind === 'failure';
  if (tab === 'agents') return need.kind === 'permission' || need.kind === 'plan' || need.kind === 'idle';
  return true;
}

function Actions({ need }) {
  const { dispatch } = useDemo();
  const open = <button type="button" className="rx-btn rx-btn--text" style={{ boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.09)' }} onClick={() => (need.messageId ? dispatch({ type: 'NAV', route: 'ai' }) : dispatch({ type: 'FOCUS', workerId: need.workerId, show: true }))}>{need.messageId ? 'Open Mission AI' : 'Open terminal'}<ArrowRight size={14}/></button>;
  const snooze = <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'ACK', needId: need.id, outcome: 'Snoozed 15m' })}>Snooze 15m</button>;
  if (need.kind === 'permission') return <>
    <div className="nd-side__row">
      <button type="button" className="rx-btn rx-btn--primary" onClick={() => dispatch({ type: 'ANSWER_PROMPT', workerId: need.workerId, allow: true })}>Allow once</button>
      <button type="button" className="rx-btn rx-btn--danger" onClick={() => dispatch({ type: 'ANSWER_PROMPT', workerId: need.workerId, allow: false })}>Deny</button>
    </div>
    <div className="nd-side__row">{snooze}<span/></div>
    {open}
  </>;
  if (need.messageId) return <>
    <div className="nd-side__row">
      <button type="button" className="rx-btn rx-btn--primary" onClick={() => dispatch({ type: 'AI_SETTLE', messageId: need.messageId, approve: true })}>Approve once</button>
      <button type="button" className="rx-btn rx-btn--danger" onClick={() => dispatch({ type: 'AI_SETTLE', messageId: need.messageId, approve: false })}>Reject</button>
    </div>
    {open}
  </>;
  if (need.kind === 'failure') return <>
    <div className="nd-side__row">
      <button type="button" className="rx-btn" onClick={() => { dispatch({ type: 'SELECT', workerId: need.workerId }); dispatch({ type: 'NAV', route: 'groundstation' }); }}>Inspect evidence</button>
      <button type="button" className="rx-btn rx-btn--primary" onClick={() => dispatch({ type: 'RESTART', workerId: need.workerId })}>Restart</button>
    </div>
    <div className="nd-side__row">{snooze}<span/></div>
    {open}
  </>;
  return <>
    <div className="nd-side__row">
      <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'AI_ASK', topic: 'tests', text: 'Why are the tests failing?' })}>Ask Mission AI</button>
      <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'ACK', needId: need.id })}>Acknowledge</button>
    </div>
    <div className="nd-side__row">{snooze}<span/></div>
    {open}
  </>;
}

function Item({ need, resolved = false }) {
  const { state } = useDemo();
  const columns = NEED_COLUMNS[need.kind] || NEED_COLUMNS.failure;
  const labelColor = need.kind === 'permission' ? '#b3b0ff' : need.messageId ? '#a5a5ff' : '#f5b92d';
  const fresh = state.tick - need.tick < 40;
  return <article className="nd-item">
    <span className="nd-id">{need.code}</span>
    <div style={{ minWidth: 0 }}>
      <div className="nd-label"><span style={{ color: labelColor }}>{need.messageId ? 'Mission AI' : columns.label}</span>{resolved ? <em>{need.outcome.toUpperCase()}</em> : fresh ? <em>NEW</em> : null}</div>
      <h4>{need.title}</h4>
      <div className="nd-cols">
        <div><span className="rx-caps">Evidence</span><p>{columns.evidence}</p></div>
        <div><span className="rx-caps">Impact</span><p>{columns.impact}</p></div>
        <div><span className="rx-caps">Recommended</span><p>{columns.recommended}</p></div>
        <div><span className="rx-caps">Recovery</span><p>{columns.recovery}</p></div>
      </div>
    </div>
    <div className="nd-side">
      <span className="nd-side__time">{resolved ? `Resolved ${relativeTime(state.tick, need.resolvedTick)}` : `Opened ${relativeTime(state.tick, need.tick)}`}</span>
      {resolved ? null : <Actions need={need}/>}
    </div>
  </article>;
}

export function NeedsView() {
  const { state, dispatch } = useDemo();
  const tab = state.needsTab;
  const list = tab === 'resolved' ? state.resolved : state.needs.filter(need => inTab(need, tab));
  const counts = { all: state.needs.length, critical: state.needs.filter(need => inTab(need, 'critical')).length, agents: state.needs.filter(need => inTab(need, 'agents')).length, resolved: state.resolved.length };
  return <div className="rx-scroll" data-lenis-prevent="">
    <div className="rx-head">
      <span className="rx-caps mono rx-head__label">Needs you</span>
      <h3>{state.needs.length} decision{state.needs.length === 1 ? '' : 's'} waiting</h3>
      <p>Evidence and consequence come before every action.</p>
    </div>
    <div className="nd-queue">
      <div className="nd-queue__head">
        <div><span className="rx-caps">Prioritized queue</span><strong>Review impact before acting</strong></div>
        <span>Evidence → action → engine verification</span>
      </div>
      <div className="nd-tabs" role="group" aria-label="Filter decisions">
        {TABS.map(([id, label]) => <button key={id} type="button" aria-pressed={tab === id} onClick={() => dispatch({ type: 'NEEDS_TAB', tab: id })}>{label}<b>{counts[id]}</b></button>)}
        <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'SEEN' })}>Mark all seen</button>
      </div>
      <div className="nd-life"><button type="button" className="rx-btn rx-btn--sm" onClick={() => dispatch({ type: 'TOAST', toast: { tone: 'info', title: 'Queue lifecycle', detail: 'Opened, acted on, verified by the engine, resolved' } })}><Info size={14}/>Queue lifecycle</button></div>
      {list.length
        ? list.map(need => <Item key={need.id + (need.resolvedTick || '')} need={need} resolved={tab === 'resolved'}/>)
        : <div className="nd-empty"><CheckCircle size={34} color="#32d583" weight="fill"/><strong>{tab === 'resolved' ? 'Nothing resolved yet' : 'Nothing needs you'}</strong><p>OUTARCH rings and adds an item here the moment a worker fails or an agent asks.</p></div>}
    </div>
  </div>;
}
