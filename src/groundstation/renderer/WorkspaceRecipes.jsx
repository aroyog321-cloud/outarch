import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Select from "@radix-ui/react-select";
import { missionApi } from "./missionApi.js";
import { TERMINAL_LAYOUTS } from "./useTerminalLayout.js";
import { RECIPE_TEMPLATES, applyRecipeTemplate, dependencyCycle, toggleStepDependency } from "./recipeBuilderModel.js";

const GATES = [
  { value: "running", label: "Process running" },
  { value: "service", label: "Service ready" },
  { value: "tests", label: "Tests passing" },
  { value: "build", label: "Build completed" },
  { value: "database", label: "Database connected" },
  { value: "container", label: "Container healthy" },
  { value: "git-clean", label: "Git working tree clean" },
  { value: "exited-zero", label: "Exited successfully" },
  { value: "healthy", label: "Engine health signal" }
];

const RECIPE_AI_PROMPT = "Explain Mission Control Workspace Recipes to a beginner. A recipe is a repeatable workspace launch that reuses existing EngineAPI-owned workers without creating duplicate PTYs. Explain one-by-one versus parallel startup, worker order, readiness gates, start-after dependencies, timeout, retries, reuse-running, failure policy, recovery/rollback, saved terminal layout, Launch, Pause, Cancel, Recover and Delete. Then help me design a practical recipe for my current project. Do not claim that any action has executed.";

const MODE_COPY = {
  create: { title: "Save a repeatable workspace launch", save: "Save recipe" },
  edit: { title: "Edit this recipe", save: "Update recipe" },
  duplicate: { title: "Duplicate this recipe", save: "Save as new recipe" }
};

function RecipeSelect({ value, onChange, options, label = "Recipe policy" }) {
  return <Select.Root value={String(value)} onValueChange={onChange}><Select.Trigger className="recipe-select" aria-label={label}><Select.Value/><Select.Icon>⌄</Select.Icon></Select.Trigger><Select.Portal><Select.Content className="recipe-select-content" position="popper" sideOffset={6}><Select.Viewport>{options.map(option => <Select.Item className="recipe-select-item" value={String(option.value)} key={option.value}><Select.ItemText>{option.label}</Select.ItemText><Select.ItemIndicator>✓</Select.ItemIndicator></Select.Item>)}</Select.Viewport></Select.Content></Select.Portal></Select.Root>;
}

function DependencyPicker({ step, steps, sessionsById, onChange }) {
  const available = steps.filter(candidate => candidate.workerId !== step.workerId);
  const label = step.dependsOn.length ? `After ${step.dependsOn.length}` : "Starts first";
  return <DropdownMenu.Root><DropdownMenu.Trigger asChild><button type="button" className="recipe-dependency-trigger"><span>{label}</span><b>⌄</b></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="recipe-dependency-menu" align="end" sideOffset={6}><DropdownMenu.Label>START ONLY AFTER</DropdownMenu.Label>{available.length ? available.map(candidate => <DropdownMenu.CheckboxItem key={candidate.workerId} checked={step.dependsOn.includes(candidate.workerId)} onCheckedChange={() => onChange(candidate.workerId)} onSelect={event => event.preventDefault()}><DropdownMenu.ItemIndicator>✓</DropdownMenu.ItemIndicator><span>{sessionsById.get(candidate.workerId)?.name || candidate.workerId}</span></DropdownMenu.CheckboxItem>) : <DropdownMenu.Item disabled>No other selected workers</DropdownMenu.Item>}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>;
}

// Persisted recipe -> builder form state. Falls back to a session-derived draft
// for the create flow so a first recipe still starts populated.
function draftFromRecipe(recipe, sessions) {
  if (recipe && Array.isArray(recipe.steps) && recipe.steps.length) {
    return {
      name: String(recipe.name || ""),
      steps: recipe.steps.map(step => ({
        workerId: step.workerId,
        dependsOn: Array.isArray(step.dependsOn) ? [...step.dependsOn] : [],
        readiness: step.readiness || "running",
        timeoutMs: Number(step.timeoutMs) || Number(recipe.readinessTimeoutMs) || 10000
      })),
      templateId: "custom",
      failurePolicy: recipe.failurePolicy || "stop",
      recoveryPolicy: recipe.recoveryPolicy || "keep-running",
      restartPolicy: recipe.restartPolicy || "reuse-running",
      maxParallel: String(recipe.maxParallel || 2),
      retryAttempts: String(recipe.retryAttempts ?? 1),
      readinessTimeoutMs: String(recipe.readinessTimeoutMs || 10000)
    };
  }
  const initial = sessions.map(session => ({ workerId: session.id, dependsOn: [], readiness: "running", timeoutMs: 10000 }));
  return {
    name: "",
    steps: applyRecipeTemplate("sequential", initial),
    templateId: "sequential",
    failurePolicy: "stop",
    recoveryPolicy: "keep-running",
    restartPolicy: "reuse-running",
    maxParallel: "2",
    retryAttempts: "1",
    readinessTimeoutMs: "10000"
  };
}

export default function WorkspaceRecipes({ open, mode = "create", editRecipe = null, projectKey, sessions, layoutId, sessionIds, onClose, onLaunch, onAskAI, onReload }) {
  const sessionIdentity = sessions.map(session => session.id).join("\u0000");
  const [name, setName] = React.useState("");
  const [steps, setSteps] = React.useState([]);
  const [templateId, setTemplateId] = React.useState("sequential");
  const [failurePolicy, setFailurePolicy] = React.useState("stop");
  const [recoveryPolicy, setRecoveryPolicy] = React.useState("keep-running");
  const [restartPolicy, setRestartPolicy] = React.useState("reuse-running");
  const [maxParallel, setMaxParallel] = React.useState("2");
  const [retryAttempts, setRetryAttempts] = React.useState("1");
  const [readinessTimeoutMs, setReadinessTimeoutMs] = React.useState("10000");
  const [advanced, setAdvanced] = React.useState(false);
  const [error, setError] = React.useState("");
  const [dirty, setDirty] = React.useState(false);
  const [conflict, setConflict] = React.useState(false);
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const dirtyGuard = React.useRef(true); // skip the first change after a (re)load

  // T075: a recipe with a live run must not be mutated in place. Editing one that
  // is running/paused/cancelling is saved as a new recipe instead, leaving the
  // active run untouched.
  const RUN_LOCKED = ["running", "paused", "cancelling"].includes(editRecipe?.run?.phase);
  const runLocked = mode === "edit" && RUN_LOCKED;
  const editingId = mode === "edit" && editRecipe && !runLocked ? editRecipe.id : null;
  const copy = runLocked
    ? { title: "Edit a running recipe", save: "Save as a new recipe" }
    : (MODE_COPY[mode] || MODE_COPY.create);

  // (Re)load the form whenever the dialog opens or its subject changes.
  React.useEffect(() => {
    if (!open) return;
    const draft = draftFromRecipe(mode === "create" ? null : editRecipe, sessions);
    dirtyGuard.current = true;
    setName(mode === "duplicate" && editRecipe ? `${editRecipe.name} copy` : draft.name);
    setSteps(draft.steps);
    setTemplateId(draft.templateId);
    setFailurePolicy(draft.failurePolicy);
    setRecoveryPolicy(draft.recoveryPolicy);
    setRestartPolicy(draft.restartPolicy);
    setMaxParallel(draft.maxParallel);
    setRetryAttempts(draft.retryAttempts);
    setReadinessTimeoutMs(draft.readinessTimeoutMs);
    setAdvanced(mode !== "create");
    setDirty(false);
    setError("");
    setDiscardOpen(false);
  }, [open, mode, editRecipe?.id, projectKey, mode === "create" ? sessionIdentity : ""]);

  // Any field change after a load marks the form dirty for the close guard.
  React.useEffect(() => {
    if (dirtyGuard.current) { dirtyGuard.current = false; return; }
    setDirty(true);
  }, [name, steps, templateId, failurePolicy, recoveryPolicy, restartPolicy, maxParallel, retryAttempts, readinessTimeoutMs]);

  const sessionById = React.useMemo(() => new Map(sessions.map(session => [session.id, session])), [sessions]);
  const workerIds = steps.map(step => step.workerId);
  // T078/T079: a plain-language read of what launching this recipe will do.
  const rootCount = steps.filter(step => !step.dependsOn.length).length;
  const chainedCount = steps.length - rootCount;
  const layoutLabel = TERMINAL_LAYOUTS.find(item => item.id === layoutId)?.label || layoutId;
  const planSummary = steps.length
    ? `Opens ${steps.length} terminal${steps.length === 1 ? "" : "s"}. ${rootCount} start${rootCount === 1 ? "s" : ""} together` +
      `${chainedCount ? `; ${chainedCount} wait${chainedCount === 1 ? "s" : ""} for a dependency to become ready` : ""}. ` +
      `Up to ${maxParallel} run at once, each gets ${retryAttempts} readiness retr${retryAttempts === "1" ? "y" : "ies"}. ` +
      `On a failed readiness check it ${failurePolicy === "stop" ? "stops starting anything new" : "keeps independent branches going"}; ` +
      `recovery ${recoveryPolicy === "rollback-started" ? "stops the workers this recipe started" : "leaves started workers running"}. ` +
      `Reuses any worker already running and restores the ${layoutLabel} terminal layout — never a duplicate PTY.`
    : "Select at least one worker to see what this recipe will do.";
  const applyTemplate = id => { setTemplateId(id); setSteps(current => applyRecipeTemplate(id, current)); setError(""); };
  const toggleWorker = id => setSteps(current => {
    if (current.some(step => step.workerId === id)) return current.filter(step => step.workerId !== id).map(step => ({ ...step, dependsOn: step.dependsOn.filter(dependency => dependency !== id) }));
    const next = [...current, { workerId: id, dependsOn: [], readiness: "running", timeoutMs: Number(readinessTimeoutMs) }];
    return applyRecipeTemplate(templateId, next);
  });
  const moveWorker = (index, direction) => setSteps(current => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= current.length) return current;
    const next = [...current];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return next;
  });
  const changeDependency = (workerId, dependencyId) => setSteps(current => {
    const next = toggleStepDependency(current, workerId, dependencyId);
    const cycle = dependencyCycle(next);
    if (cycle.length) { setError(`That relationship would create a dependency cycle: ${cycle.join(", ")}`); return current; }
    setTemplateId("custom");
    setError("");
    return next;
  });
  const changeGate = (workerId, readiness) => setSteps(current => current.map(step => step.workerId === workerId ? { ...step, readiness } : step));

  const requestClose = () => {
    if (dirty) { setDiscardOpen(true); return; }
    onClose();
  };

  // A design request, not a conversation: Mission AI is handed the real
  // workers and the current draft so the answer is about this project rather
  // than a generic recipe. It may only propose — the closing sentence keeps it
  // from reporting work it has not done.
  const askMissionAiToDesign = () => {
    const chosen = steps.map((step, index) => {
      const session = sessionById.get(step.workerId);
      return `${index + 1}. ${session?.name || step.workerId} (${session?.command || "unknown command"}, readiness gate: ${step.readiness})`;
    });
    const available = sessions.map(session => `${session.name} (${session.command})`);
    onAskAI?.([
      "Help me design a Mission Control recipe (a repeatable workspace launch) for this project.",
      `Workers available in this project: ${available.join("; ") || "none configured yet"}.`,
      chosen.length ? `Currently selected, in launch order: ${chosen.join(" ")}` : "No workers are selected yet.",
      `Startup template: ${templateId}. Terminal layout: ${layoutId}. Maximum parallel workers: ${maxParallel}. Readiness retries: ${retryAttempts}. Gate timeout: ${readinessTimeoutMs} ms.`,
      "Recommend which of these workers should open together, a safe launch order with explicit start-after dependencies, and the right readiness gate for each one. Explain your reasoning before recommending anything, and do not claim that a recipe has been created, saved, or launched."
    ].join(" "));
  };

  const save = async event => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || !steps.length) return;
    const recipe = {
      // Edit keeps the same id (recipe.save is an upsert); create and duplicate get a fresh one.
      id: editingId || globalThis.crypto?.randomUUID?.() || `recipe-${Date.now()}`,
      name: trimmed.slice(0, 60),
      workerIds,
      steps: steps.map(step => ({ ...step, timeoutMs: Number(readinessTimeoutMs) })),
      layoutId: mode === "edit" && editRecipe?.layoutId ? editRecipe.layoutId : layoutId,
      sessionIds: mode === "edit" && Array.isArray(editRecipe?.sessionIds) ? editRecipe.sessionIds : sessionIds,
      failurePolicy,
      recoveryPolicy,
      restartPolicy,
      maxParallel: Number(maxParallel),
      retryAttempts: Number(retryAttempts),
      retryDelayMs: 500,
      readinessTimeoutMs: Number(readinessTimeoutMs),
      // T076 — the revision this edit started from. The engine rejects the save
      // if the stored copy has moved on, so a second window is told rather than
      // silently overwritten. Only an edit carries one; create and duplicate are
      // new recipes and have nothing to conflict with.
      ...(mode === "edit" && Number.isInteger(editRecipe?.revision) ? { baseRevision: editRecipe.revision } : {})
    };
    try {
      await missionApi().request("recipe.save", { recipe });
      setDirty(false);
      onClose();
    } catch (value) {
      // A conflict is not a malformed edit — someone else saved first. It gets
      // its own state so the operator is offered the current copy instead of
      // being told to fix input that was never wrong.
      setConflict(value?.code === "RECIPE_CONFLICT");
      setError(value.message || String(value));
    }
  };

  return <Dialog.Root open={open} onOpenChange={value => { if (!value) requestClose(); }}><Dialog.Portal><Dialog.Overlay className="recipes-backdrop dialog-backdrop"/><Dialog.Content className="recipes-dialog recipes-dialog-v2 pm-dialog" aria-describedby="recipes-description" onEscapeKeyDown={event => { event.preventDefault(); requestClose(); }} onInteractOutside={event => { event.preventDefault(); requestClose(); }}>
      <header><div><span className="section-kicker">RECIPE BUILDER</span><Dialog.Title id="recipes-title">{copy.title}</Dialog.Title><Dialog.Description id="recipes-description">Choose existing workers, decide their order, save once, and launch without duplicating a running terminal.</Dialog.Description></div><div className="recipe-header-actions"><button className="recipe-ai-help" onClick={() => onAskAI?.(RECIPE_AI_PROMPT)}><span>AI</span> Explain recipes</button><button type="button" aria-label="Close recipe builder" onClick={requestClose}>×</button></div></header>
      <div className="recipes-content">
        <form className="recipe-builder pm-card pm-card--feat-recipe" onSubmit={save}>
          <div className="recipe-builder__intro"><div><span>{mode === "edit" ? "EDITING RECIPE" : mode === "duplicate" ? "DUPLICATING RECIPE" : "NEW RECIPE"}</span><strong>Choose what should open together</strong><small>{TERMINAL_LAYOUTS.find(item => item.id === layoutId)?.label || layoutId} layout · {workerIds.length} selected{dirty ? " · unsaved changes" : ""}</small></div><button type="button" className="recipe-ai-design" onClick={askMissionAiToDesign} title="Ask Mission AI to propose the workers, order and readiness gates for this recipe"><span aria-hidden="true">AI</span> Ask Mission AI</button></div>
          <label><span>Recipe name</span><input autoFocus maxLength="60" value={name} onChange={event => setName(event.target.value)} placeholder="Morning development stack" /></label>
          <div className="recipe-template-strip"><span>HOW SHOULD IT START?</span><div>{RECIPE_TEMPLATES.map(template => <button type="button" key={template.id} className={templateId === template.id ? "is-current" : ""} onClick={() => applyTemplate(template.id)}><strong>{template.label}</strong><small>{template.detail}</small></button>)}</div></div>
          <section className="recipe-simple-workers"><header><div><span>WORKERS IN THIS RECIPE</span><strong>Select terminals and arrange the launch order</strong></div><small>Running workers are reused by default</small></header><div>{sessions.map(session => { const selectedIndex = workerIds.indexOf(session.id); const step = steps.find(item => item.workerId === session.id); const dependencyNames = (step?.dependsOn || []).map(id => sessionById.get(id)?.name || id); return <article key={session.id} className={selectedIndex >= 0 ? "is-selected" : ""}><label><input type="checkbox" checked={selectedIndex >= 0} onChange={() => toggleWorker(session.id)}/><span><strong>{session.name}</strong><small>{session.command}</small></span></label>{selectedIndex >= 0 && <><span className="recipe-simple-order"><b>{selectedIndex + 1}</b><small>{dependencyNames.length ? `Starts after ${dependencyNames.join(", ")}` : "Starts first"}</small></span><div><button type="button" aria-label={`Move ${session.name} earlier`} disabled={selectedIndex === 0} onClick={() => moveWorker(selectedIndex, -1)}>↑</button><button type="button" aria-label={`Move ${session.name} later`} disabled={selectedIndex === workerIds.length - 1} onClick={() => moveWorker(selectedIndex, 1)}>↓</button></div></>}</article>; })}</div></section>
          <button type="button" className={`recipe-advanced-toggle ${advanced ? "is-open" : ""}`} onClick={() => setAdvanced(value => !value)}><span><strong>{advanced ? "Hide advanced controls" : "Advanced startup controls"}</strong><small>Readiness checks, dependencies, retries, failure and recovery</small></span><b>{advanced ? "−" : "+"}</b></button>
          {advanced && <><div className="recipe-policy-grid recipe-policy-grid-v2"><label><span>Parallel workers</span><RecipeSelect value={maxParallel} onChange={setMaxParallel} label="Maximum parallel workers" options={[1,2,3,4].map(value => ({ value, label: `${value} at once` }))}/></label><label><span>Readiness retries</span><RecipeSelect value={retryAttempts} onChange={setRetryAttempts} label="Readiness retries" options={[0,1,2,3].map(value => ({ value, label: value ? `${value} retr${value === 1 ? "y" : "ies"}` : "No retry" }))}/></label><label><span>Gate timeout</span><RecipeSelect value={readinessTimeoutMs} onChange={setReadinessTimeoutMs} label="Readiness timeout" options={[5000,10000,20000,30000].map(value => ({ value, label: `${value / 1000} seconds` }))}/></label><label><span>Running workers</span><RecipeSelect value={restartPolicy} onChange={setRestartPolicy} label="Running worker policy" options={[{value:"reuse-running",label:"Reuse current process"},{value:"restart-running",label:"Restart on launch"}]}/></label><label><span>On failure</span><RecipeSelect value={failurePolicy} onChange={setFailurePolicy} label="Failure policy" options={[{value:"stop",label:"Stop scheduling"},{value:"continue",label:"Continue independent branches"}]}/></label><label><span>Recovery</span><RecipeSelect value={recoveryPolicy} onChange={setRecoveryPolicy} label="Recovery policy" options={[{value:"keep-running",label:"Keep started workers"},{value:"rollback-started",label:"Stop recipe-started workers"}]}/></label></div>
          <div className="recipe-worker-list recipe-dag-editor" aria-label="Worker startup order and parallel dependency graph editor">
            {sessions.map(session => { const selectedIndex = workerIds.indexOf(session.id); const step = steps.find(item => item.workerId === session.id); return <div key={session.id} className={selectedIndex >= 0 ? "is-selected" : ""}><label><input type="checkbox" checked={selectedIndex >= 0} onChange={() => toggleWorker(session.id)}/><span><strong>{session.name}</strong><small>{session.command}</small></span></label>{selectedIndex >= 0 && <><div className="recipe-step-order"><b>{selectedIndex + 1}</b><button type="button" aria-label={`Move ${session.name} earlier`} disabled={selectedIndex === 0} onClick={() => moveWorker(selectedIndex, -1)}>↑</button><button type="button" aria-label={`Move ${session.name} later`} disabled={selectedIndex === workerIds.length - 1} onClick={() => moveWorker(selectedIndex, 1)}>↓</button></div><div className="recipe-step-policy"><RecipeSelect value={step.readiness} onChange={value => changeGate(session.id, value)} label={`${session.name} readiness gate`} options={GATES}/><DependencyPicker step={step} steps={steps} sessionsById={sessionById} onChange={dependencyId => changeDependency(session.id, dependencyId)}/></div></>}</div>; })}
          </div></>}
          <div className="recipe-dag-summary"><span><b>{rootCount}</b> parallel roots</span><span><b>{steps.reduce((total, step) => total + step.dependsOn.length, 0)}</b> dependency edges</span><span><b>{maxParallel}</b> worker limit</span><span><b>{retryAttempts}</b> retries</span></div>
          <p className="recipe-plan-summary">{planSummary}</p>
          {runLocked && <p className="recipe-run-locked" role="status">This recipe has a live run ({editRecipe.run.phase}). Changes are saved as a new recipe so the active run is not disturbed.</p>}
          {error && <div className={`recipe-error${conflict ? " is-conflict" : ""}`} role="alert"><p>{error}</p>{conflict && onReload && <button type="button" onClick={() => { setError(""); setConflict(false); onReload(); }}>Reload the saved copy</button>}</div>}
          <div className="recipe-builder__actions">
            <button type="button" className="btn-ghost" onClick={requestClose}>Cancel</button>
            <button type="submit" className="recipe-save btn-primary feat-recipe" disabled={!name.trim() || !workerIds.length}>{copy.save}</button>
          </div>
        </form>
      </div>
      {discardOpen && <div className="recipe-discard-guard" role="alertdialog" aria-label="Discard unsaved recipe changes">
        <div>
          <strong>Discard unsaved changes?</strong>
          <p>The edits to this recipe have not been saved.</p>
          <div>
            <button type="button" className="btn-ghost" onClick={() => setDiscardOpen(false)}>Keep editing</button>
            <button type="button" className="btn-danger" onClick={() => { setDiscardOpen(false); setDirty(false); onClose(); }}>Discard changes</button>
          </div>
        </div>
      </div>}
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
