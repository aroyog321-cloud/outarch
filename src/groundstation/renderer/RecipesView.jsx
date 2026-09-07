import React from "react";
import { missionApi } from "./missionApi.js";
import { RegisterSkeleton } from "./LoadingSkeleton.jsx";

// A finished run reports what it was, not what the recipe is doing now.
function runPhaseLabel(run) {
  if (run.phase === "completed") return "Completed";
  if (run.phase === "failed") return "Failed";
  if (run.phase === "cancelled") return "Cancelled";
  return String(run.phase || "finished").replaceAll("-", " ");
}

function formatRunTime(run) {
  const at = Number(run.finishedAt || run.startedAt);
  if (!at) return "";
  const minutes = Math.max(0, Math.round((Date.now() - at) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`;
  return `${Math.floor(minutes / 1440)}d ago`;
}

function phaseLabel(recipe) {
  const phase = recipe?.run?.phase;
  if (!phase) return "Ready";
  if (phase === "failed") return "Needs recovery";
  if (phase === "paused") return "Paused";
  if (phase === "running") return "Running";
  if (phase === "cancelling") return "Cancelling";
  return phase.replaceAll("-", " ");
}

const ACTIVE_PHASES = ["running", "paused", "cancelling"];

export default function RecipesView({ sessions, onManage, onLaunch, onAskAI, onDelete, onRunAction }) {
  const [recipes, setRecipes] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const refresh = React.useCallback(async () => {
    try {
      const value = await missionApi().request("recipe.list");
      setRecipes(Array.isArray(value) ? value : []);
      setError("");
    } catch (value) {
      setError(value.message || String(value));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let unsubscribe = () => {};
    void refresh();
    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (String(notification?.type || "").startsWith("recipe:")) void refresh();
      });
    } catch { /* Explicit refresh remains available. */ }
    return () => unsubscribe?.();
  }, [refresh]);

  const sessionById = React.useMemo(() => new Map(sessions.map(session => [session.id, session])), [sessions]);
  const running = recipes.filter(recipe => ACTIVE_PHASES.includes(recipe.run?.phase)).length;
  const failed = recipes.filter(recipe => recipe.run?.phase === "failed").length;

  const runAction = (method, recipe) => (onRunAction ? onRunAction(method, recipe.id) : missionApi().request(method, { recipeId: recipe.id }).then(refresh).catch(value => setError(value.message || String(value))));

  return <div className="recipes-page">
    <header className="page-command-header pm-page-hero feat-recipe">
      <div><span className="page-eyebrow">PROJECT AUTOMATION</span><h1>Recipes</h1><p>Repeatable workspace launches: start the right terminals in the right order, restore the layout, and keep every run evidence-backed.</p></div>
      <div className="page-command-actions"><button className="btn-secondary feat-ai" onClick={onAskAI}>Design with Mission AI</button><button className="btn-primary feat-recipe" onClick={() => onManage(null, "create")}>New recipe</button></div>
    </header>
    <section className="recipes-status-strip" aria-label="Recipe status">
      <div><span>SAVED</span><strong>{recipes.length}</strong><small>project recipes</small></div>
      <div><span>RUNNING</span><strong>{running}</strong><small>active launches</small></div>
      <div className={failed ? "has-risk" : ""}><span>RECOVERY</span><strong>{failed}</strong><small>{failed ? "runs need review" : "nothing blocked"}</small></div>
      <div><span>WORKERS</span><strong>{sessions.length}</strong><small>available to recipes</small></div>
    </section>
    <div className="recipes-page-layout">
      <section className="recipes-library">
        <header><div><span className="section-kicker">SAVED RECIPES</span><h2>Launch, edit, or recover a project setup</h2></div><button onClick={refresh}>Refresh</button></header>
        {loading ? <RegisterSkeleton rows={4} label="Loading project recipes"/> : error ? <div className="page-empty-state is-error"><strong>Recipes unavailable</strong><p>{error}</p><button onClick={refresh}>Try again</button></div> : recipes.length ? <div className="recipes-page-list">{recipes.map(recipe => {
          const steps = recipe.steps || [];
          const available = (recipe.workerIds || []).filter(id => sessionById.has(id)).length;
          const phase = recipe.run?.phase;
          const active = ACTIVE_PHASES.includes(phase);
          return <article key={recipe.id} className={`recipe-row pm-card pm-card--interactive phase-${phase || "ready"}`}>
            <div className="recipe-row-main"><span className="recipe-status-dot"/><div><div className="recipe-row-title"><h3>{recipe.name}</h3><span>{phaseLabel(recipe)}</span></div><p>{available}/{recipe.workerIds?.length || 0} workers available · max {recipe.maxParallel || 1} parallel</p>{recipe.run?.rollback && <p className="recipe-rollback-status">Recovery {recipe.run.rollback.phase} · {recipe.run.rollback.stoppedCount} stop requests</p>}</div></div>
            <div className="recipe-flow" aria-label={`${recipe.name} startup order`}>{steps.slice(0,5).map((step, index) => <React.Fragment key={step.workerId}>{index > 0 && <i>→</i>}<span><b>{sessionById.get(step.workerId)?.name || step.workerId}</b><small>{step.dependsOn?.length ? `after ${step.dependsOn.length}` : "starts first"}</small></span></React.Fragment>)}{steps.length > 5 && <em>+{steps.length - 5}</em>}</div>
            {Array.isArray(recipe.runHistory) && recipe.runHistory.length > 0 && (
              <details className="recipe-run-history">
                <summary>Run history <b>{recipe.runHistory.length}</b></summary>
                <ol>
                  {recipe.runHistory.map(run => (
                    <li key={run.runId} className={`phase-${run.phase}`}>
                      <div className="recipe-run-history__head">
                        <strong>{runPhaseLabel(run)}</strong>
                        <span>{formatRunTime(run)}</span>
                      </div>
                      <small>
                        {run.completed.length} of {run.completed.length + run.failures.length} step{run.completed.length + run.failures.length === 1 ? "" : "s"} completed
                        {run.recoveryOfRunId ? " · recovery of an earlier failed run" : ""}
                        {run.durationMs ? ` · ${Math.max(1, Math.round(run.durationMs / 1000))}s` : ""}
                      </small>
                      {run.failures.length > 0 && (
                        <ul className="recipe-run-history__failures">
                          {run.failures.slice(0, 4).map((failure, index) => (
                            <li key={`${run.runId}-f${index}`}>{sessionById.get(failure.workerId)?.name || failure.workerId}: {failure.reason || "failed"}</li>
                          ))}
                        </ul>
                      )}
                      {run.rollback && (
                        <small className="recipe-run-history__rollback">
                          Rollback {run.rollback.phase}: stopped {run.rollback.stoppedCount} of {run.rollback.workerIds.length} worker{run.rollback.workerIds.length === 1 ? "" : "s"}
                          {run.rollback.failureCount ? `, ${run.rollback.failureCount} could not be stopped` : ""}
                        </small>
                      )}
                    </li>
                  ))}
                </ol>
              </details>
            )}
            <footer>
              {active && phase !== "cancelling" && <button className="btn-secondary" onClick={() => runAction(phase === "paused" ? "recipe.resume" : "recipe.pause", recipe)}>{phase === "paused" ? "Resume" : "Pause"}</button>}
              {active && phase !== "cancelling" && <button className="btn-secondary" onClick={() => runAction("recipe.cancel", recipe)}>Cancel run</button>}
              <button className="btn-ghost" onClick={() => onManage(recipe, "edit")}>Edit graph</button>
              <button className="btn-ghost" onClick={() => onManage(recipe, "duplicate")}>Duplicate</button>
              <button className="btn-danger" disabled={active} onClick={() => onDelete?.(recipe)}>Delete</button>
              <button className="btn-primary feat-recipe" disabled={!available || active} onClick={() => onLaunch(recipe, { recover: phase === "failed" })}>{active ? phaseLabel(recipe) : phase === "failed" ? "Recover failed run" : "Launch workspace"}</button>
            </footer>
          </article>;
        })}</div> : <div className="page-empty-state recipes-first-run pm-card"><span className="empty-orbit">+</span><strong>Build your first recipe</strong><p>Choose backend, frontend, agents, tests, Git, databases, or containers and decide what must become ready first.</p><div><button className="btn-secondary feat-ai" onClick={onAskAI}>Ask Mission AI</button><button className="btn-primary feat-recipe" onClick={() => onManage(null, "create")}>Create recipe</button></div></div>}
      </section>
      <aside className="recipes-guide">
        <span className="section-kicker">HOW IT RUNS</span><h2>One click. Ordered startup.</h2>
        <ol><li><b>1</b><span><strong>Start roots</strong><small>Independent workers launch in parallel.</small></span></li><li><b>2</b><span><strong>Verify readiness</strong><small>Ports, tests, builds, databases, and health gates provide evidence.</small></span></li><li><b>3</b><span><strong>Unlock dependants</strong><small>Frontend waits for backend; tests wait for both.</small></span></li><li><b>4</b><span><strong>Restore the canvas</strong><small>The saved terminal layout opens without duplicate PTYs.</small></span></li></ol>
        <button onClick={() => onManage(null, "create")}>Open the recipe builder</button>
      </aside>
    </div>
  </div>;
}
