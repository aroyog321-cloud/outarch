import React from 'react';
import { ArrowClockwise, Play, Star, TerminalWindow, X } from '@phosphor-icons/react';
import { PROJECT } from '../demoData.js';
import { health, projectStatus, relativeTime, runtime, useDemo } from '../useDemo.js';

export const STATE_LABEL = { running: 'Running', waiting: 'Needs you', failed: 'Failed', idle: 'Idle', done: 'Finished' };

export function Dot({ status }) {
  return <span className={`rx-dot rx-dot--${status}`} aria-hidden="true"/>;
}

function lastLine(worker) {
  return [...worker.lines].reverse().find(item => item.text.trim() && item.tone !== 'claude')?.text.trim() || '';
}

function activity(worker) {
  if (worker.status === 'idle') return 'Start when ready';
  if (worker.status === 'failed') return 'Process exited with code 1';
  if (worker.status === 'waiting') return 'Waiting for your permission';
  if (worker.status === 'done') return 'Finished cleanly';
  return lastLine(worker) || 'Running';
}

function kindLabel(worker) {
  return { agent: 'Agent', service: 'Service', test: 'Test watcher', shell: 'Terminal' }[worker.kind] || 'Terminal';
}

function currently(worker) {
  if (worker.status === 'idle') return `${worker.name} is ready. Starting it opens ${worker.kind === 'shell' ? 'an interactive PowerShell' : `\`${worker.cmd}\``} in an engine-owned PTY.`;
  if (worker.status === 'failed') return 'The process exited with code 1. Its last output is kept for review.';
  if (worker.status === 'waiting') return 'The agent stopped at a permission prompt and is waiting for your answer.';
  if (worker.status === 'done') return 'The run finished and its evidence is recorded.';
  if (worker.attention) return `${worker.attention}. The worker is still running.`;
  return 'Output is flowing and the engine reports it running.';
}

function Inspector({ worker }) {
  const { state, dispatch } = useDemo();
  const live = worker.status === 'running' || worker.status === 'waiting';
  const evidence = state.history.filter(event => event.workerId === worker.id).slice(0, 4);
  return <aside className="rx-card gs-inspector" aria-label={`${worker.name} details`}>
    <div className="gs-inspector__head">
      <div style={{ minWidth: 0 }}>
        <strong>{kindLabel(worker)} · inferred</strong>
        <b>{worker.name}</b>
        <code>{worker.cmd}</code>
      </div>
      <button type="button" className="gs-close" aria-label="Close details" onClick={() => dispatch({ type: 'INSPECTOR', open: false })}><X size={16}/></button>
    </div>
    <div className="gs-currently">
      <span className="rx-caps">Currently</span>
      <p>{currently(worker)}</p>
    </div>
    <div className="gs-grid">
      <div><small>STATE</small><span>{worker.status}</span></div>
      <div><small>RUNTIME</small><span>{live ? runtime(state, worker) : 'Idle'}</span></div>
      <div><small>LAST OUTPUT</small><span>{worker.lines.length ? (live ? 'now' : 'kept') : 'Not reported'}</span></div>
      <div><small>OWNERSHIP</small><span>{live ? 'Engine PTY' : 'No engine PTY'}</span></div>
      <div><small>DIRECTORY</small><span>{PROJECT.path}</span></div>
      <div><small>RESTORE</small><span>{worker.start === 'running' ? 'Auto-start' : 'Manual'}<button type="button" className="rx-toggle" role="switch" aria-checked={worker.start === 'running'} aria-label="Restore on open" onClick={() => dispatch({ type: 'TOAST', toast: { tone: 'info', title: 'Restore policy', detail: 'Changing it never starts or stops the process' } })}/></span></div>
    </div>
    <div className="gs-evidence">
      <span className="rx-caps">Recent evidence</span>
      <ul style={{ marginTop: 8 }}>
        {evidence.length ? evidence.map(event => <li key={event.id}><time>{relativeTime(state.tick, event.tick, { short: true })}</time><span>{event.text}</span></li>) : <li><time>1d</time><span>session · created</span></li>}
      </ul>
    </div>
    <div className="gs-inspector__actions">
      {live
        ? <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'STOP', workerId: worker.id })}>Stop</button>
        : <button type="button" className="rx-btn" onClick={() => dispatch({ type: worker.status === 'idle' ? 'START' : 'RESTART', workerId: worker.id })}>{worker.status === 'idle' ? 'Start' : 'Restart'}</button>}
      <button type="button" className="rx-btn rx-btn--primary" onClick={() => dispatch({ type: 'FOCUS', workerId: worker.id, show: true })}><TerminalWindow size={16}/>Open terminal</button>
      <button type="button" className="rx-btn" aria-label="Star" onClick={() => dispatch({ type: 'STAR', workerId: worker.id })}><Star size={16} weight={state.stars[worker.id] ? 'fill' : 'regular'} color={state.stars[worker.id] ? '#f5b942' : undefined}/></button>
    </div>
    <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'AI_ASK', topic: worker.status === 'failed' ? 'failed' : worker.id === 'tests' ? 'tests' : 'running', text: `Tell me about ${worker.name}` })}><span className="rx-ai-chip">AI</span>Ask Mission AI</button>
  </aside>;
}

const FILTERS = [['all', 'All'], ['live', 'Live'], ['idle', 'Idle'], ['review', 'Review'], ['failed', 'Failed']];

function matches(worker, filter) {
  if (filter === 'live') return worker.status === 'running' || worker.status === 'waiting';
  if (filter === 'idle') return worker.status === 'idle' || worker.status === 'done';
  if (filter === 'review') return worker.status === 'waiting' || Boolean(worker.attention);
  if (filter === 'failed') return worker.status === 'failed';
  return true;
}

export function GroundstationView() {
  const { state, dispatch } = useDemo();
  const workers = Object.values(state.workers);
  const live = workers.filter(worker => worker.status === 'running' || worker.status === 'waiting');
  const agents = workers.filter(worker => worker.kind === 'agent');
  const status = projectStatus(state);
  const query = state.gsQuery.trim().toLowerCase();
  const rows = workers
    .filter(worker => matches(worker, state.gsFilter))
    .filter(worker => !query || worker.name.toLowerCase().includes(query) || worker.cmd.toLowerCase().includes(query))
    .sort((a, b) => Number(Boolean(state.stars[b.id])) - Number(Boolean(state.stars[a.id])));
  const selected = state.workers[state.selected];
  const subtitle = status.tone === 'good' ? 'Healthy · Every decision source reported and nothing is waiting' : status.tone === 'bad' ? 'Degraded · 1 failure detected' : `Waiting on you · ${state.needs.length} decision${state.needs.length === 1 ? '' : 's'}`;

  return <>
    <div className="gs-band">
      <span className={`gs-orb ${status.tone === 'warn' ? 'is-warn' : status.tone === 'bad' ? 'is-bad' : ''}`}><i/></span>
      <div className="gs-title"><strong>{PROJECT.name}</strong><span>{subtitle}</span></div>
      <div className="gs-stats">
        <div className="gs-stat"><strong style={{ color: '#32d583' }}>{live.length}<small>/{workers.length}</small></strong><span>RUNNING</span></div>
        <div className="gs-stat"><strong>{workers.filter(worker => worker.status === 'idle' || worker.status === 'done').length}</strong><span>IDLE</span></div>
        <div className="gs-stat"><strong style={{ color: '#3291ff' }}>{agents.filter(worker => worker.status === 'running' || worker.status === 'waiting').length}<small>/{agents.length}</small></strong><span>AI CREW</span></div>
        <div className="gs-stat"><strong style={{ color: state.needs.length ? '#f5b942' : '#fff' }}>{state.needs.length}</strong><span>NEEDS YOU</span></div>
      </div>
      <button type="button" className="rx-btn rx-btn--primary" onClick={() => dispatch({ type: 'NAV', route: 'recipes' })}><Play size={15} weight="fill"/>Run recipe</button>
      <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'NAV', route: 'workspace' })}><TerminalWindow size={16}/>Workspace</button>
      <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'TOAST', toast: { tone: 'ok', title: 'Workspace context copied', detail: 'Workers, errors and Needs You, secrets left out' } })}>Copy context</button>
    </div>
    <div className={`gs-body ${state.inspector && selected ? '' : 'is-wide'}`}>
      <section className="rx-card gs-ops">
        <div className="gs-ops__head"><strong>Project operations</strong><span>{rows.length} of {workers.length} shown · {live.length} live</span></div>
        <div className="gs-filter">
          <div className="gs-tabs" role="group" aria-label="Filter workers">
            {FILTERS.map(([id, label]) => <button key={id} type="button" aria-pressed={state.gsFilter === id} onClick={() => dispatch({ type: 'GS_FILTER', filter: id })}>{label}<b>{workers.filter(worker => matches(worker, id)).length}</b></button>)}
          </div>
          <label className="rx-field"><input value={state.gsQuery} onChange={event => dispatch({ type: 'GS_QUERY', query: event.target.value })} placeholder="Search name or command..." aria-label="Search workers"/><kbd>Ctrl F</kbd></label>
        </div>
        <div className="gs-table">
          <table>
            <thead><tr><th style={{ width: 36 }}/><th>WORKER</th><th>ROLE</th><th>STATE</th><th>CURRENT ACTIVITY</th><th className="gs-col-res">RESOURCES</th><th>ACTION</th></tr></thead>
            <tbody>
              {rows.map(worker => {
                const metrics = health(state, worker);
                const live = worker.status === 'running' || worker.status === 'waiting';
                return <tr key={worker.id} className={state.selected === worker.id && state.inspector ? 'is-selected' : ''} onClick={() => dispatch({ type: 'SELECT', workerId: worker.id })}>
                  <td><button type="button" className={`gs-star ${state.stars[worker.id] ? 'is-on' : ''}`} aria-label={`Star ${worker.name}`} onClick={event => { event.stopPropagation(); dispatch({ type: 'STAR', workerId: worker.id }); }}><Star size={16} weight={state.stars[worker.id] ? 'fill' : 'regular'}/></button></td>
                  <td><strong>{worker.name}</strong><code>{worker.cmd.length > 22 ? `${worker.cmd.slice(0, 21)}…` : worker.cmd}</code></td>
                  <td><span className="gs-link">{worker.link}</span></td>
                  <td><span className="gs-state" style={{ color: worker.status === 'failed' ? '#ff7b7b' : worker.status === 'waiting' ? '#f5b942' : undefined }}><Dot status={worker.status}/>{STATE_LABEL[worker.status]}</span></td>
                  <td><div className="gs-activity">{activity(worker)}</div></td>
                  <td className="mono gs-col-res" style={{ fontSize: 12.5, color: '#a1a1a1', whiteSpace: 'nowrap' }}>{metrics ? `${metrics.cpu}% · ${metrics.mem} MB` : '—'}</td>
                  <td onClick={event => event.stopPropagation()}>
                    {worker.status === 'failed'
                      ? <button type="button" className="rx-btn rx-btn--sm rx-btn--danger" onClick={() => dispatch({ type: 'RESTART', workerId: worker.id })}><ArrowClockwise size={13}/>Restart</button>
                      : worker.status === 'waiting'
                        ? <button type="button" className="rx-btn rx-btn--sm" style={{ color: '#f5b942' }} onClick={() => dispatch({ type: 'NAV', route: 'needs' })}>Review</button>
                        : live
                          ? <button type="button" className="rx-btn rx-btn--sm" onClick={() => dispatch({ type: 'FOCUS', workerId: worker.id, show: true })}>Open</button>
                          : <button type="button" className="rx-btn rx-btn--sm" onClick={() => dispatch({ type: 'START', workerId: worker.id })}>Start</button>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
          {!rows.length ? <p style={{ padding: 24, color: '#a1a1a1' }}>No worker matches this filter.</p> : null}
        </div>
      </section>
      {state.inspector && selected ? <Inspector worker={selected}/> : null}
    </div>
  </>;
}
