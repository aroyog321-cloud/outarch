import React from "react";
import {
  buildSimpleWorkerDefinition,
  buildWorkerDefinition,
  buildWorkerPatch,
  initialWorkerDraft,
  nextAvailableWorkerId
} from "./workerForm.js";
import TabSet, { tabPanelProps } from "./TabSet.jsx";

const WORKER_DIALOG_AI_PROMPT = "Explain OUTARCH's Add terminal dialog. It asks for a name and an optional start command, and creates one engine-owned PTY in the open project folder; the command runs through the configured shell, which stays open afterwards so a failed command still leaves a usable prompt. Cover what happens on Start, that Full Attach never duplicates the PTY, that nothing is created until Start is pressed, and where the advanced settings (arguments, working directory, environment, PowerShell compatibility) live afterwards. Then help me choose a command for my current project.";

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

export default function WorkerDialog({ initialMode = "create", configuration, seed = null, prefill = null, savedCommands, existingIds = [], projectName = "", onClose, onSave, onInstantiate, onAskAI }) {
  const editing = Boolean(configuration);
  // A duplicate is a create, but it carries a real command that has to be
  // reviewed before a second copy of a process starts — so it gets the full
  // form, not the two-field one.
  const advanced = editing || Boolean(seed);
  const [mode, setMode] = React.useState(editing ? "edit" : initialMode);
  const [draft, setDraft] = React.useState(() => {
    // T094 — a duplicate is a create, pre-filled from the worker it copies and
    // given a fresh id. It deliberately stops at the form rather than creating
    // anything: the command and directory are exactly what needs reviewing
    // before a second copy of a process starts.
    const initial = initialWorkerDraft(configuration || seed);
    if (!configuration && seed) initial.id = nextAvailableWorkerId(initial.id, existingIds);
    // A first-run starter fills the two simple fields; the operator still presses Start.
    if (!configuration && !seed && prefill) {
      initial.name = prefill.name || "";
      initial.startCommand = prefill.startCommand || "";
    }
    return initial;
  });
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
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

  const update = (field, value) => setDraft(current => ({ ...current, [field]: value }));

  const submit = async event => {
    event.preventDefault();
    setError("");
    try {
      // Creating goes through the two-field path; editing keeps the full
      // definition so existing workers stay configurable.
      const value = editing
        ? buildWorkerPatch(draft)
        : seed
          ? buildWorkerDefinition(draft)
          : buildSimpleWorkerDefinition(draft, { platform: navigator.userAgent.includes("Windows") ? "win32" : "linux", existingIds });
      setBusy(true);
      // The two-field path's button says "Start", so it asks for a start.
      // A duplicate uses the full form, whose own restore toggle decides.
      await onSave(value, { start: !editing && !seed });
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
            <h2 id={titleId}>{editing ? `Edit ${configuration.name}` : "Add terminal"}</h2>
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


        {error && <div className="dialog-error" role="alert">{error}</div>}

        {mode === "presets" && !editing ? (
          <div className="dialog-body preset-body" {...tabPanelProps("worker-source", "presets")}>
            <PresetList commands={savedCommands} busy={busy} onInstantiate={instantiate} />
          </div>
        ) : (
          <form onSubmit={submit} {...(editing ? {} : tabPanelProps("worker-source", "create"))}>
            <div className="dialog-body worker-form">
              {advanced ? (<>
              <div className="worker-form-heading"><div><span>WORKER DEFINITION</span><strong>Update the supervised command</strong></div><span>{draft.autoStart ? "Starts immediately" : "Creates idle"} · project-relative</span></div>
              <Field label="Worker ID" detail="Stable identifier; it cannot be changed later.">
                <input value={draft.id} disabled={editing || busy} onChange={event => update("id", event.target.value)} placeholder="backend" />
              </Field>
              <Field label="Display name">
                <input value={draft.name} disabled={busy} onChange={event => update("name", event.target.value)} placeholder="Backend server" autoFocus />
              </Field>
              <Field label="Command" detail="The executable OUTARCH supervises." wide>
                <input value={draft.command} disabled={busy} onChange={event => update("command", event.target.value)} placeholder="powershell.exe" />
              </Field>
              <Field label="Arguments" detail='JSON array, for example ["run", "dev"].' wide>
                <textarea rows="3" value={draft.argsText} disabled={busy} onChange={event => update("argsText", event.target.value)} spellCheck="false" />
              </Field>
              <Field label="Working directory" detail='Use "." for the open project folder, or a relative subfolder such as ./frontend.' wide>
                <input value={draft.cwd} disabled={busy} onChange={event => update("cwd", event.target.value)} placeholder="." />
              </Field>
              </>) : (<>
              {/* Two fields, exactly as asked: what to call it, and what to run.
                  Everything else — the id, the working directory, the shell — is
                  derived, and stays editable afterwards for workers that need it. */}
              <Field label="Name" detail="What this terminal is called in the workspace." wide>
                <input value={draft.name} disabled={busy} onChange={event => update("name", event.target.value)} placeholder="Storefront" autoFocus />
              </Field>
              <Field label="Start command" detail="Optional. Runs in this project folder when the terminal opens; the shell stays open afterwards." wide>
                <input value={draft.startCommand} disabled={busy} onChange={event => update("startCommand", event.target.value)} placeholder="npm run dev" spellCheck="false" />
              </Field>
              <p className="worker-form-note">Project: <strong>{projectName || "the open project"}</strong></p>
              </>)}
              {advanced && editing && (
                <label className="terminal-toggle-card is-wide">
                  <span><strong>Replace environment overrides</strong><small>Existing values remain secret and unchanged unless you enable this.</small></span>
                  <span className="pm-toggle"><input type="checkbox" checked={draft.replaceEnvironment} disabled={busy} onChange={event => update("replaceEnvironment", event.target.checked)} /><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span>
                </label>
              )}
              {advanced && (
                <Field
                  label="Environment"
                  detail={editing && !draft.replaceEnvironment
                    ? `Existing keys: ${configuration?.envKeys?.join(", ") || "none"}`
                    : "JSON object of string values. Values are never exposed in Groundstation state or activity."}
                  wide
                >
                  <textarea rows="4" value={draft.envText} disabled={busy || (editing && !draft.replaceEnvironment)} onChange={event => update("envText", event.target.value)} spellCheck="false" />
                </Field>
              )}

              {advanced && (<>
                <label className="terminal-toggle-card">
                  <span><strong>Start automatically</strong><small>Launch now and during future workspace restores.</small></span>
                  <span className="pm-toggle"><input type="checkbox" checked={draft.autoStart} disabled={busy} onChange={event => update("autoStart", event.target.checked)} /><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span>
                </label>
                <label className="terminal-toggle-card">
                  <span><strong>PowerShell compatibility</strong><small>Explicit fallback that disables PSReadLine for this worker.</small></span>
                  <span className="pm-toggle"><input type="checkbox" checked={draft.powershellCompatibility} disabled={busy} onChange={event => update("powershellCompatibility", event.target.checked)} /><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span>
                </label>
              </>)}
            </div>
            <footer className="dialog-footer">
              <span>{editing ? "The worker stays idle until you start it." : "Opens one terminal in this project and runs the command."}</span>
              <div>
                <button type="button" className="btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={busy}>{busy ? (editing ? "Saving…" : "Starting…") : editing ? "Save changes" : "Start"}</button>
              </div>
            </footer>
          </form>
        )}
      </section>
    </div>
  );
}
