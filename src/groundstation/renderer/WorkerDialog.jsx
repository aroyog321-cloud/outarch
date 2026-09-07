import React from "react";
import {
  buildWorkerDefinition,
  buildWorkerPatch,
  initialWorkerDraft,
  nextAvailableWorkerId
} from "./workerForm.js";
import TabSet, { tabPanelProps } from "./TabSet.jsx";

const WORKER_TEMPLATES = [
  { id: "shell", role: "terminal", badge: ">_", name: "Project shell", detail: "Interactive PowerShell rooted in this project", command: "powershell.exe", args: [], autoStart: true },
  { id: "frontend", role: "service", badge: "WEB", name: "Frontend dev", detail: "Start the package development server", command: "npm.cmd", args: ["run", "dev"], autoStart: true },
  { id: "backend", role: "agent", badge: "API", name: "Backend service", detail: "Start the package service process", command: "npm.cmd", args: ["run", "start"], autoStart: true },
  { id: "tests", role: "test", badge: "✓", name: "Test watcher", detail: "Run package tests in watch mode", command: "npm.cmd", args: ["test", "--", "--watch"], autoStart: true },
  { id: "docker", role: "container", badge: "DO", name: "Docker stack", detail: "Launch the project Compose services", command: "docker", args: ["compose", "up"], autoStart: false },
  { id: "git", role: "git", badge: "BR", name: "Git status", detail: "Inspect branch and working-tree evidence", command: "git", args: ["status", "--short", "--branch"], autoStart: false }
];

const WORKER_DIALOG_AI_PROMPT = "Explain Mission Control's Add Worker dialog to a beginner. Cover Worker ID, Display name, Command, JSON Arguments, project-relative Working directory, Environment, Start automatically, PowerShell compatibility, templates, saved presets, and what Add worker does. Explain that one EngineAPI-owned PTY is created, Full Attach never duplicates it, and no mutation occurs without the user pressing Add worker. Then help me choose settings for my current project.";

function Field({ label, detail, children, wide = false }) {
  return (
    <label className={`form-field ${wide ? "is-wide" : ""}`}>
      <span>{label}</span>
      {children}
      {detail && <small>{detail}</small>}
    </label>
  );
}

function PresetList({ commands, busy, onInstantiate }) {
  if (!commands.length) {
    return (
      <div className="dialog-empty">
        <strong>No saved presets</strong>
        <p>Add entries to the workspace&apos;s <code>commands</code> array to keep optional workers ready without launching them.</p>
      </div>
    );
  }
  return (
    <div className="preset-list">
      {commands.map(command => (
        <div className="preset-card" key={command.id}>
          <div>
            <strong>{command.name}</strong>
            <code>{command.command}{command.args?.length ? ` ${command.args.join(" ")}` : ""}</code>
            <span>{command.autoStart ? "Starts immediately" : "Creates as manual worker"} · {command.cwd}</span>
          </div>
          <button
            type="button"
            className="primary-button"
            disabled={busy || !command.available}
            onClick={() => onInstantiate(command.id)}
          >
            {command.available ? "Add worker" : "Already added"}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function WorkerDialog({ initialMode = "create", configuration, seed = null, savedCommands, existingIds = [], onClose, onSave, onInstantiate, onAskAI }) {
  const editing = Boolean(configuration);
  const [mode, setMode] = React.useState(editing ? "edit" : initialMode);
  const [draft, setDraft] = React.useState(() => {
    // T094 — a duplicate is a create, pre-filled from the worker it copies and
    // given a fresh id. It deliberately stops at the form rather than creating
    // anything: the command and directory are exactly what needs reviewing
    // before a second copy of a process starts.
    const initial = initialWorkerDraft(configuration || seed);
    if (!configuration) initial.id = nextAvailableWorkerId(initial.id, existingIds);
    return initial;
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [templateId, setTemplateId] = React.useState(configuration || seed ? "custom" : "shell");
  const titleId = React.useId();
  const dialogRef = React.useRef(null);
  const closeRef = React.useRef(onClose);
  const busyRef = React.useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;

  React.useEffect(() => {
    // T127: a complete focus trap — Tab wraps at the boundaries AND focus that
    // escapes the dialog (backdrop click, browser chrome) is pulled back in.
    // On close, focus returns to the invoking control, or #main-content if it
    // no longer exists.
    const previousFocus = document.activeElement;
    const focusablesIn = node => [...(node?.querySelectorAll('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') || [])];
    const onKeyDown = event => {
      if (event.key === "Escape" && !busyRef.current) { closeRef.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = focusablesIn(dialogRef.current);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    const onFocusIn = event => {
      if (dialogRef.current && !dialogRef.current.contains(event.target)) {
        (focusablesIn(dialogRef.current)[0] || dialogRef.current).focus({ preventScroll: true });
      }
    };
    requestAnimationFrame(() => (focusablesIn(dialogRef.current)[0] || dialogRef.current)?.focus({ preventScroll: true }));
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("focusin", onFocusIn);
      const target = previousFocus && document.contains(previousFocus) ? previousFocus : document.getElementById("main-content");
      target?.focus?.({ preventScroll: true });
    };
  }, []);

  const update = (field, value) => { setTemplateId("custom"); setDraft(current => ({ ...current, [field]: value })); };
  const applyTemplate = template => {
    setTemplateId(template.id);
    setDraft(current => ({ ...current, id: nextAvailableWorkerId(template.id === "shell" ? "terminal" : template.id, existingIds), name: template.name, command: template.command, argsText: JSON.stringify(template.args, null, 2), cwd: ".", autoStart: template.autoStart, powershellCompatibility: false }));
    setError("");
  };

  const submit = async event => {
    event.preventDefault();
    setError("");
    try {
      const value = editing ? buildWorkerPatch(draft) : buildWorkerDefinition(draft);
      setBusy(true);
      await onSave(value);
      onClose();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setBusy(false);
    }
  };

  const instantiate = async commandId => {
    setError("");
    try {
      setBusy(true);
      await onInstantiate(commandId);
      onClose();
    } catch (instantiateError) {
      setError(instantiateError instanceof Error ? instantiateError.message : String(instantiateError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="palette-backdrop" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <section ref={dialogRef} tabIndex={-1} className="worker-dialog command-palette pm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="dialog-header">
          <div>
            <span className="eyebrow">TERMINAL WORKSPACE</span>
            <h2 id={titleId}>{editing ? `Edit ${configuration.name}` : "Add a terminal worker"}</h2>
          </div>
          <div className="worker-dialog-header-actions">{!editing && <button type="button" className="worker-dialog-ai" onClick={() => onAskAI?.(WORKER_DIALOG_AI_PROMPT)} disabled={busy}><span>AI</span> Ask about this form</button>}<button type="button" className="dialog-close" onClick={onClose} disabled={busy} aria-label="Close dialog">×</button></div>
        </header>

        {!editing && (
          <TabSet
            group="worker-source"
            className="dialog-tabs"
            label="Worker source"
            value={mode}
            onChange={setMode}
            tabs={[
              { value: "create", label: "New terminal worker" },
              { value: "presets", label: "Saved presets", badge: savedCommands.length }
            ]}
          />
        )}

        {!editing && mode === "create" && <section className="worker-dialog-guide" aria-label="How adding a worker works"><div><b>1</b><span><strong>Choose a purpose</strong><small>Start from a template or enter your own command.</small></span></div><div><b>2</b><span><strong>Review the definition</strong><small>Name, command and folder stay visible before creation.</small></span></div><div><b>3</b><span><strong>Add one worker</strong><small>Mission Control registers one engine-owned terminal; auto-start is your choice.</small></span></div></section>}

        {error && <div className="dialog-error" role="alert">{error}</div>}

        {mode === "presets" && !editing ? (
          <div className="dialog-body preset-body" {...tabPanelProps("worker-source", "presets")}>
            <PresetList commands={savedCommands} busy={busy} onInstantiate={instantiate} />
          </div>
        ) : (
          <form onSubmit={submit} {...(editing ? {} : tabPanelProps("worker-source", "create"))}>
            <div className="dialog-body worker-form">
              {!editing && <section className="worker-template-section"><header><div><span className="section-kicker">QUICK START</span><strong>Choose what this terminal should do</strong></div><small>Templates only fill the form. Review every command before adding it.</small></header><div className="worker-template-grid">{WORKER_TEMPLATES.map(template => <button type="button" className={`pm-card pm-card--interactive worker-template-card role-${template.role || template.id} ${templateId === template.id ? "pm-card--selected is-selected" : ""}`} key={template.id} onClick={() => applyTemplate(template)}><span className={`worker-template-card__badge role-${template.role || template.id}`}>{template.badge}</span><span><strong>{template.name}</strong><small>{template.detail}</small></span><code>{template.command}</code></button>)}</div></section>}
              <div className="worker-form-heading"><div><span>WORKER DEFINITION</span><strong>{editing ? "Update the supervised command" : `${WORKER_TEMPLATES.find(item => item.id === templateId)?.name || "Custom worker"} configuration`}</strong></div><span>{draft.autoStart ? "Starts immediately" : "Creates idle"} · project-relative</span></div>
              <Field label="Worker ID" detail="Stable identifier; it cannot be changed later.">
                <input value={draft.id} disabled={editing || busy} onChange={event => update("id", event.target.value)} placeholder="backend" autoFocus={!editing} />
              </Field>
              <Field label="Display name">
                <input value={draft.name} disabled={busy} onChange={event => update("name", event.target.value)} placeholder="Backend server" autoFocus={editing} />
              </Field>
              <Field label="Command" detail="Defaults to an empty PowerShell terminal. Replace it with any executable you want Mission Control to supervise." wide>
                <input value={draft.command} disabled={busy} onChange={event => update("command", event.target.value)} placeholder="powershell.exe" />
              </Field>
              <Field label="Arguments" detail='JSON array, for example ["run", "dev"].' wide>
                <textarea rows="3" value={draft.argsText} disabled={busy} onChange={event => update("argsText", event.target.value)} spellCheck="false" />
              </Field>
              <Field label="Working directory" detail='Use "." for the open project folder, or a relative subfolder such as ./frontend.' wide>
                <input value={draft.cwd} disabled={busy} onChange={event => update("cwd", event.target.value)} placeholder="." />
              </Field>

              {editing && (
                <label className="terminal-toggle-card is-wide">
                  <span><strong>Replace environment overrides</strong><small>Existing values remain secret and unchanged unless you enable this.</small></span>
                  <span className="pm-toggle"><input type="checkbox" checked={draft.replaceEnvironment} disabled={busy} onChange={event => update("replaceEnvironment", event.target.checked)} /><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span>
                </label>
              )}
              <Field
                label="Environment"
                detail={editing && !draft.replaceEnvironment
                  ? `Existing keys: ${configuration.envKeys?.join(", ") || "none"}`
                  : "JSON object of string values. Values are never exposed in Groundstation state or activity."}
                wide
              >
                <textarea rows="4" value={draft.envText} disabled={busy || (editing && !draft.replaceEnvironment)} onChange={event => update("envText", event.target.value)} spellCheck="false" />
              </Field>

              <label className="terminal-toggle-card">
                <span><strong>Start automatically</strong><small>Launch now and during future workspace restores.</small></span>
                <span className="pm-toggle"><input type="checkbox" checked={draft.autoStart} disabled={busy} onChange={event => update("autoStart", event.target.checked)} /><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span>
              </label>
              <label className="terminal-toggle-card">
                <span><strong>PowerShell compatibility</strong><small>Explicit fallback that disables PSReadLine for this worker.</small></span>
                <span className="pm-toggle"><input type="checkbox" checked={draft.powershellCompatibility} disabled={busy} onChange={event => update("powershellCompatibility", event.target.checked)} /><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span>
              </label>
            </div>
            <footer className="dialog-footer">
              <span>{editing ? "The worker stays idle until you start it." : draft.autoStart ? "This creates and starts one engine-owned PTY." : "This registers an idle worker without launching a process."}</span>
              <div>
                <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? "Saving…" : editing ? "Save changes" : "Add worker"}</button>
              </div>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
