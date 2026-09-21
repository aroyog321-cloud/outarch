import React from 'react';
import { Play } from '@phosphor-icons/react';
import { RECIPE } from '../demoData.js';
import { useDemo } from '../useDemo.js';

const STATUS = { ready: ['READY', ''], running: ['RUNNING', 'rc-status--running'], done: ['COMPLETED', 'rc-status--done'] };

export function RecipesView() {
  const { state, dispatch } = useDemo();
  const recipe = state.recipe;
  const workers = Object.values(state.workers);
  const [label, statusClass] = STATUS[recipe.status];
  const stepLabel = (step, index) => step.state === 'ready' ? 'ready' : step.state === 'starting' ? 'starting…' : index === 0 ? 'starts first' : 'after 1';
  const toast = (title, detail) => dispatch({ type: 'TOAST', toast: { tone: 'info', title, detail } });
  return <div className="rx-scroll" data-lenis-prevent="">
    <div className="rc-head">
      <span className="rx-caps rx-head__label" style={{ paddingRight: 14, borderRight: '1px solid rgba(255,255,255,.14)' }}>Project automation</span>
      <h3 style={{ fontSize: 20, fontWeight: 700 }}>Recipes</h3>
      <p>Repeatable workspace launches: start the right terminals in the right order, restore the layout, and keep every run evidence-backed.</p>
      <button type="button" className="rx-btn" onClick={() => dispatch({ type: 'AI_ASK', topic: 'other', text: 'Design a recipe that starts Postgres, then the API, then the web app' })}>Design with Mission AI</button>
      <button type="button" className="rx-btn rx-btn--primary" onClick={() => toast('New recipe', 'Pick workers, set dependencies and readiness gates')}>New recipe</button>
    </div>
    <div className="rc-stats">
      <div><span className="rx-caps mono">Saved</span><b>1</b>project recipe</div>
      <div><span className="rx-caps mono">Running</span><b>{recipe.status === 'running' ? 1 : 0}</b>active launches</div>
      <div><span className="rx-caps mono">Recovery</span><b>0</b>nothing blocked</div>
      <div><span className="rx-caps mono">Workers</span><b>{workers.length}</b>available to recipes</div>
    </div>
    <div className="rc-body">
      <div>
        <div className="rc-list__head">
          <span className="rx-caps">Saved recipes</span><strong>Launch, edit, or recover a project setup</strong>
          <button type="button" className="rx-btn rx-btn--sm" onClick={() => toast('Recipes refreshed', 'Read from the project file')}>Refresh</button>
        </div>
        <article className="rx-card rc-card">
          <div className="rc-card__top">
            <div>
              <div className="rc-card__name"><span className={`rx-dot ${recipe.status === 'running' ? 'rx-dot--waiting' : recipe.status === 'done' ? 'rx-dot--running' : ''}`} style={recipe.status === 'ready' ? { background: '#a1a1a1' } : undefined}/>{RECIPE.name}<span className={`rc-status ${statusClass}`}>{label}</span></div>
              <p className="rc-card__meta">{RECIPE.steps.length}/{RECIPE.steps.length} workers available · max {RECIPE.parallel} parallel</p>
              <p className="rc-card__meta" style={{ fontSize: 13.5, marginTop: 4 }}>{RECIPE.description}</p>
            </div>
            <div className="rc-chain">
              {recipe.steps.map((step, index) => <React.Fragment key={step.workerId}>
                {index ? <span className="rc-arrow">→</span> : null}
                <div className="rc-chip" data-state={step.state}><strong>{state.workers[step.workerId].name}</strong><span>{stepLabel(step, index)} · {step.gate}</span></div>
              </React.Fragment>)}
            </div>
          </div>
          <div className="rc-card__actions">
            <button type="button" className="rx-btn rx-btn--text" onClick={() => toast('Recipe graph', 'Drag to change what waits for what')}>Edit graph</button>
            <button type="button" className="rx-btn rx-btn--text" onClick={() => toast('Recipe duplicated', `${RECIPE.name} (copy)`)}>Duplicate</button>
            <button type="button" className="rx-btn rx-btn--danger" onClick={() => toast('Delete needs confirming', 'Deleting a recipe never stops its workers')}>Delete</button>
            <button type="button" className="rx-btn rx-btn--primary" disabled={recipe.status === 'running'} onClick={() => dispatch({ type: 'LAUNCH_RECIPE' })}><Play size={14} weight="fill"/>{recipe.status === 'running' ? 'Launching…' : recipe.status === 'done' ? 'Launch again' : 'Launch workspace'}</button>
          </div>
          {recipe.runs ? <p className="rc-history">Run history · {recipe.runs} run{recipe.runs === 1 ? '' : 's'}{recipe.status === 'done' ? ', last one passed every gate' : ''}</p> : null}
        </article>
      </div>
      <aside className="rx-card rc-how">
        <span className="rx-caps">How it runs</span>
        <strong>One click. Ordered startup.</strong>
        <ol>
          <li><span>1</span><div><b>Start roots</b><p>Independent workers launch in parallel.</p></div></li>
          <li><span>2</span><div><b>Verify readiness</b><p>Ports, tests, builds, databases, and health gates provide evidence.</p></div></li>
          <li><span>3</span><div><b>Unlock dependants</b><p>The review and the E2E suite wait for Postgres, then run side by side.</p></div></li>
          <li><span>4</span><div><b>Restore the canvas</b><p>The saved terminal layout opens without duplicate PTYs.</p></div></li>
        </ol>
        <button type="button" className="rx-btn" onClick={() => toast('Recipe builder', 'Templates: Ordered stack, Parallel services, Start then verify')}>Open the recipe builder</button>
      </aside>
    </div>
  </div>;
}
