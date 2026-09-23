import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { missionApi } from "./missionApi.js";
import { ModelSwitcher, useAssistantStatus } from "./aiCatalog.jsx";
import AssistantKeys from "./AssistantKeys.jsx";

// Project memory: arch_memory.md in the project folder, kept by the people
// and AI agents who work on the project. The service in the main process
// (src/service/projectMemoryFile.cjs) owns the file; this module is how the
// operator meets it:
// - an introduction the first time a saved project is open without one, which
//   asks before anything is written and can be told not to ask again;
// - a question on the way out when something changed since the last update,
//   so Mission AI can record work done by hand;
// - a panel in Settings, Project defaults, that reaches all of it any time.

const introListeners = new Set();
export function openProjectMemoryIntro() {
  for (const listener of introListeners) listener();
}

export function useProjectMemory(workspaceKey) {
  const [status, setStatus] = React.useState(null);
  const [error, setError] = React.useState("");
  const refresh = React.useCallback(async () => {
    try {
      const value = await missionApi().request("projectMemory.status");
      setStatus(value);
      setError("");
      return value;
    } catch (value) {
      setError(value?.message || String(value));
      return null;
    }
  }, []);
  React.useEffect(() => {
    let active = true;
    void refresh();
    let unsubscribe = () => {};
    try {
      unsubscribe = missionApi().subscribe(message => {
        if (!active) return;
        // A new key, plan or model choice changes which model writes the memory.
        if (message?.type === "projectMemory:changed" || message?.type === "ai:changed" || (message?.type === "services:changed" && message.detail === "project:switched")) void refresh();
      });
    } catch { /* the next action refreshes it */ }
    return () => { active = false; unsubscribe?.(); };
  }, [refresh, workspaceKey]);
  return { status, error, refresh, setStatus };
}

function ago(timestamp) {
  if (!timestamp) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ------------------------------------------------------------------ glyphs

export function MemoryGlyph({ size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 3.5h6.8l4.7 4.7V19.5a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1Z"/><path d="M13.5 3.7V8.5h4.8"/><path d="M9 12.5h6"/><path d="M9 16h4"/></svg>;
}

function Glyph({ name }) {
  const paths = {
    agents: <><rect x="5" y="8" width="14" height="11" rx="3"/><path d="M12 4.5V8"/><circle cx="12" cy="4" r="1"/><path d="M9.5 13h.01M14.5 13h.01"/><path d="M9.5 16.2h5"/></>,
    spark: <path d="M12 3.5c.5 4.3 3.9 7.7 8.2 8.2-4.3.5-7.7 3.9-8.2 8.2-.5-4.3-3.9-7.7-8.2-8.2 4.3-.5 7.7-3.9 8.2-8.2Z"/>,
    layers: <><path d="m12 4 8 4-8 4-8-4Z"/><path d="m4 12 8 4 8-4"/><path d="m4 16 8 4 8-4"/></>,
    check: <path d="m5 12.5 4.5 4.5L19 7.5"/>,
    x: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>,
    folder: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>
  };
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Spinner() {
  return <span className="pmem-spinner" aria-hidden="true"/>;
}

// ------------------------------------------------------------------ preview

// A picture of the file this project would get, with the facts OUTARCH found in
// it. The two example entries are labelled as examples.
function MemoryPreview({ preview, projectName }) {
  const languages = preview?.languages?.length ? preview.languages.slice(0, 3).map(item => `${item.name} ${item.share}%`).join(", ") : "worked out from your files";
  const terminals = preview?.terminals?.length ? preview.terminals.slice(0, 3).map(item => item.name).join(", ") : "the terminals you run in OUTARCH";
  return <aside className="pmem-preview" aria-label="What arch_memory.md looks like">
    <div className="pmem-preview__bar"><i/><i/><i/><span>arch_memory.md</span></div>
    <div className="pmem-preview__body">
      <p className="is-h1"># Project memory: {projectName || "your project"}</p>
      <p className="is-h2">## Rules for AI agents</p>
      <p>1. <b>Read this file first.</b></p>
      <p>2. <b>Add an entry when you finish.</b></p>
      <p>3. <b>Only add, never remove.</b></p>
      <p className="is-h2">## Project facts</p>
      <p>- <b>Languages:</b> {languages}</p>
      <p>- <b>Terminals:</b> {terminals}</p>
      <p className="is-h2">## Change log</p>
      <div className="pmem-preview__entry">
        <p className="is-h3">### 16:40 · Claude Code (claude-sonnet-4-5) · fix</p>
        <p>- <b>Changed:</b> Session tokens now expire after 24 hours.</p>
        <p>- <b>Why:</b> Expired tokens were still accepted.</p>
      </div>
      <div className="pmem-preview__entry is-ai">
        <p className="is-h3">### 18:05 · OUTARCH Mission AI (gemini-2.5-flash) · session</p>
        <p>- <b>Changed:</b> Moved the API address into .env.example.</p>
        <p>- <b>Why:</b> The build broke on a fresh clone.</p>
      </div>
    </div>
    <small className="pmem-preview__note">Example entries. Yours start empty.</small>
  </aside>;
}

// ------------------------------------------------------------------ introduction

const STEP_WORDS = {
  file: ["Creating arch_memory.md", "Created arch_memory.md", "Could not create arch_memory.md"],
  pointers: ["Pointing AI agents to it", "Pointed Claude Code, Codex and other agents to it", "Could not add the note for agents"],
  summary: ["Mission AI is writing the project summary", "Mission AI wrote the project summary", "The project summary was not written"]
};

export function ProjectMemoryIntro({ open, manual = false, status, onClose, onDone }) {
  const [pointers, setPointers] = React.useState(true);
  const [never, setNever] = React.useState(false);
  const [preview, setPreview] = React.useState(null);
  const [steps, setSteps] = React.useState(null);
  const [problem, setProblem] = React.useState("");
  const running = Boolean(steps && Object.values(steps).some(step => step.state === "running"));

  React.useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setSteps(null);
    setProblem("");
    setNever(false);
    setPointers(true);
    missionApi().request("projectMemory.preview").then(value => { if (active) setPreview(value); }).catch(() => { if (active) setPreview(null); });
    return () => { active = false; };
  }, [open]);

  const projectName = status?.project?.name || preview?.project?.name || "this project";
  const modelLabel = status?.model ? `${status.model.label}${status.model.source === "byok" ? ` (${status.model.keyLabel})` : ""}` : null;

  const create = async () => {
    setProblem("");
    const next = { file: { state: "running" }, pointers: { state: pointers ? "waiting" : "skipped" }, summary: { state: "waiting" } };
    setSteps({ ...next });
    try {
      const result = await missionApi().request("projectMemory.enable", { pointers });
      next.file = { state: "done", detail: result?.adopted ? "Your existing file was kept; OUTARCH's sections were added after it." : result?.path || "" };
      if (pointers) {
        const failed = (result?.pointers || []).filter(item => item.action === "failed");
        next.pointers = failed.length ? { state: "failed", detail: failed.map(item => `${item.file}: ${item.error}`).join(" ") } : { state: "done", detail: (result?.pointers || []).map(item => item.file).join(" and ") };
      }
      next.summary = { state: "running" };
      setSteps({ ...next });
    } catch (error) {
      next.file = { state: "failed", detail: error?.message || String(error) };
      next.summary = { state: "skipped" };
      if (pointers) next.pointers = { state: "skipped" };
      setSteps({ ...next });
      return;
    }
    try {
      await missionApi().request("projectMemory.summarize");
      next.summary = { state: "done" };
    } catch (error) {
      next.summary = { state: "failed", detail: `${error?.message || String(error)} The file is ready; write the summary later from Settings.` };
    }
    setSteps({ ...next });
    onDone?.();
  };

  // Once the file exists, the summary can finish without the dialog.
  const fileReady = steps?.file?.state === "done";
  const dismiss = async ({ declined }) => {
    if (running && !fileReady) return;
    if (declined && !steps) {
      try { await missionApi().request("projectMemory.decline", { never: !manual && never }); } catch (error) { setProblem(error?.message || String(error)); return; }
    }
    onClose?.();
  };

  const openFile = async () => {
    try { await missionApi().request("projectMemory.open"); } catch (error) { setProblem(error?.message || String(error)); }
  };

  const finished = steps && !running;
  return <Dialog.Root open={open} onOpenChange={value => { if (!value) void dismiss({ declined: true }); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="pmem-backdrop"/>
      <Dialog.Content className="pmem-dialog pmem-intro" aria-describedby="pmem-intro-lede" onPointerDownOutside={event => event.preventDefault()}>
        <div className="pmem-intro__grid">
          <div className="pmem-intro__main">
            <span className="pmem-kicker"><MemoryGlyph size={15}/>Project memory</span>
            <Dialog.Title className="pmem-title">{steps ? (finished ? `${projectName} has a memory` : "Setting it up…") : `Give ${projectName} a memory`}</Dialog.Title>
            <Dialog.Description id="pmem-intro-lede" className="pmem-lede">
              OUTARCH can keep an <code>arch_memory.md</code> in this project: what it is for, how it runs, and every change, error and fix, with who made it and why.
            </Dialog.Description>

            {!steps ? <>
              <ul className="pmem-points">
                <li><span className="pmem-points__icon"><Glyph name="agents"/></span><div><strong>Every AI agent starts informed</strong><p>Claude Code, Codex, Gemini CLI and others read it before they work. When they finish, they add a short entry: what changed, why, and which model did it.</p></div></li>
                <li><span className="pmem-points__icon is-ai"><Glyph name="spark"/></span><div><strong>You never write it by hand</strong><p>When you close OUTARCH after working yourself, Mission AI records what changed and why. You can also update it any time from Settings.</p></div></li>
                <li><span className="pmem-points__icon"><Glyph name="layers"/></span><div><strong>Nothing is lost between sessions</strong><p>Entries are only ever added, so the history of errors and fixes stays with the code. Commit it and your team shares it.</p></div></li>
              </ul>
              <div className="pmem-plan" role="group" aria-label="What OUTARCH will do">
                <div className="pmem-plan__row"><span className="pmem-plan__tick"><Glyph name="check"/></span><span>Create <code>arch_memory.md</code> in <b title={status?.project?.directory || ""}>{status?.project?.directory || "the project folder"}</b></span></div>
                <label className="pmem-plan__row is-choice"><input type="checkbox" checked={pointers} onChange={event => setPointers(event.target.checked)}/><span>Point AI agents to it<small>Adds a short note to CLAUDE.md and AGENTS.md, the files agents read on their own. Nothing in them is changed.</small></span></label>
                <div className="pmem-plan__row"><span className="pmem-plan__tick is-ai"><Glyph name="spark"/></span><span>Mission AI writes its entries{modelLabel ? <> with <b>{modelLabel}</b></> : null}. It reads terminal output and your git changes to do it, with secrets removed first. It uses an AI key kept apart from your chats, or one of your own. Each entry counts as one Mission AI message.</span></div>
              </div>
            </> : <ol className="pmem-steps" aria-live="polite">
              {["file", "pointers", "summary"].map(id => {
                const step = steps[id];
                if (step.state === "skipped" && id === "pointers") return null;
                const words = STEP_WORDS[id];
                const label = step.state === "done" ? words[1] : step.state === "failed" ? words[2] : step.state === "skipped" ? `${words[0]} (skipped)` : `${words[0]}…`;
                return <li key={id} className={`is-${step.state}`}>
                  <span className="pmem-steps__mark">{step.state === "running" ? <Spinner/> : step.state === "done" ? <Glyph name="check"/> : step.state === "failed" ? <Glyph name="x"/> : <i/>}</span>
                  <span><strong>{label}</strong>{step.detail ? <small>{step.detail}</small> : null}</span>
                </li>;
              })}
            </ol>}
            {problem && <p className="pmem-error" role="alert">{problem}</p>}
          </div>
          <MemoryPreview preview={preview} projectName={projectName}/>
        </div>
        <footer className="pmem-footer">
          {!steps && !manual ? <label className="pmem-check"><input type="checkbox" checked={never} onChange={event => setNever(event.target.checked)}/>Don't ask me again</label> : <span className="pmem-footer__hint">{finished ? "You can change this any time in Settings, Project defaults." : !steps ? "Settings, Project defaults, has this any time." : fileReady ? "The file is ready. The summary can finish without this window." : "This takes a moment."}</span>}
          <div className="pmem-footer__actions">
            {running && fileReady && <button type="button" className="pmem-btn" onClick={() => void dismiss({ declined: false })}>Close</button>}
            {!steps && <>
              <button type="button" className="pmem-btn" onClick={() => void dismiss({ declined: true })}>{never ? "Don't ask again" : "Not now"}</button>
              <button type="button" className="pmem-btn is-primary" onClick={() => void create()} disabled={!status?.available}>Create project memory</button>
            </>}
            {finished && <>
              {steps.file.state === "done" && <button type="button" className="pmem-btn" onClick={() => void openFile()}>Open file</button>}
              <button type="button" className="pmem-btn is-primary" onClick={() => void dismiss({ declined: false })}>Done</button>
            </>}
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

// ------------------------------------------------------------------ closing

export function ProjectMemoryCloseDialog({ request, status, onCancel }) {
  const [note, setNote] = React.useState("");
  const [dontAsk, setDontAsk] = React.useState(false);
  const [phase, setPhase] = React.useState("ask");
  const [problem, setProblem] = React.useState("");
  const create = request?.mode === "create";

  React.useEffect(() => {
    if (!request) return;
    setNote("");
    setDontAsk(false);
    setPhase("ask");
    setProblem("");
  }, [request]);

  const saveChoice = async () => {
    if (!dontAsk) return;
    try { await missionApi().request("projectMemory.configure", { configuration: create ? { askOnOpen: false } : { askOnClose: false } }); } catch { /* the close still happens */ }
  };

  const closeApp = async () => {
    setPhase("closing");
    await saveChoice();
    try { await missionApi().request("projectMemory.closePrompt", { state: "close" }); } catch { /* shutting down anyway */ }
    try { await missionApi().request("system.shutdown"); }
    catch (error) {
      setPhase("ask");
      setProblem(`OUTARCH could not close: ${error?.message || String(error)}`);
    }
  };

  const writeAndClose = async () => {
    setProblem("");
    setPhase("writing");
    try {
      if (create) {
        await missionApi().request("projectMemory.enable", { pointers: true });
        try { await missionApi().request("projectMemory.summarize"); } catch { /* the file is made; the summary can wait */ }
      } else {
        await missionApi().request("projectMemory.update", { reason: "close", note });
      }
    } catch (error) {
      setPhase("failed");
      setProblem(error?.message || String(error));
      return;
    }
    setPhase("saved");
    await new Promise(resolve => { setTimeout(resolve, 650); });
    await closeApp();
  };

  const cancel = async () => {
    if (phase === "writing" || phase === "closing") return;
    try { await missionApi().request("projectMemory.closePrompt", { state: "cancel" }); } catch { /* staying open is the default */ }
    onCancel?.();
  };

  const busy = phase === "writing" || phase === "closing" || phase === "saved";
  const modelLabel = status?.model?.label || null;
  // Known to have no model only once the status has arrived.
  const noModel = Boolean(status) && !status.model && !create;
  return <Dialog.Root open={Boolean(request)} onOpenChange={value => { if (!value) void cancel(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="pmem-backdrop"/>
      <Dialog.Content className="pmem-dialog pmem-close" aria-describedby="pmem-close-lede" onPointerDownOutside={event => event.preventDefault()}>
        <header className="pmem-close__head">
          <span className="pmem-close__mark"><MemoryGlyph size={20}/></span>
          <div>
            <Dialog.Title className="pmem-title is-small">{create ? "Give this project a memory before you close?" : "Update project memory before you close?"}</Dialog.Title>
            <Dialog.Description id="pmem-close-lede" className="pmem-lede">
              {create
                ? "OUTARCH creates arch_memory.md with the rules AI agents follow and the facts about this project, and Mission AI writes a short summary."
                : <>{request?.summary ? <b>Since the last update: {request.summary}.</b> : null} Mission AI adds an entry to arch_memory.md saying what changed and why, so the next person or agent knows.</>}
            </Dialog.Description>
          </div>
        </header>

        {!create && <label className="pmem-field">
          <span>What did you work on?<small>Optional. Mission AI writes the entry; this tells it why.</small></span>
          <textarea rows={3} maxLength={600} value={note} disabled={busy || noModel} onChange={event => setNote(event.target.value)} placeholder="For example: fixed the login redirect and moved the API address into .env"/>
        </label>}

        <div className="pmem-close__status" aria-live="polite">
          {phase === "writing" && <p><Spinner/>{create ? "Creating the memory…" : `Mission AI is writing the entry${modelLabel ? ` with ${modelLabel}` : ""}…`}</p>}
          {phase === "saved" && <p className="is-done"><Glyph name="check"/>Saved to arch_memory.md. Closing…</p>}
          {phase === "closing" && <p><Spinner/>Closing OUTARCH…</p>}
          {phase === "ask" && modelLabel && !create && <p className="is-quiet"><Glyph name="spark"/>Writes with {modelLabel}. Change it in Settings, Project defaults.</p>}
          {phase === "ask" && noModel && <p className="is-quiet"><Glyph name="spark"/>No model can write the entry yet: project memory's AI key is not available. Pick one of your own keys in Settings, Project defaults, or close without updating.</p>}
          {problem && <p className="pmem-error" role="alert">{problem}</p>}
        </div>

        <footer className="pmem-footer">
          <label className="pmem-check"><input type="checkbox" checked={dontAsk} disabled={busy} onChange={event => setDontAsk(event.target.checked)}/>{create ? "Don't ask about this again" : "Don't ask when I close"}</label>
          <div className="pmem-footer__actions">
            <button type="button" className="pmem-btn is-quiet" onClick={() => void cancel()} disabled={busy}>Cancel</button>
            <button type="button" className="pmem-btn" onClick={() => void closeApp()} disabled={phase === "closing" || phase === "saved"}>{phase === "writing" ? "Close now" : create ? "Close without it" : "Close without updating"}</button>
            <button type="button" className="pmem-btn is-primary" onClick={() => void writeAndClose()} disabled={busy || noModel}>{phase === "failed" ? "Try again" : create ? "Create and close" : "Update and close"}</button>
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

// ------------------------------------------------------------------ host

// Mounted once in the app. Shows the introduction when a saved project opens
// without a memory (once per project per launch, and never over another
// dialog), and the question on the way out when the main process asks.
export function ProjectMemoryHost({ workspace }) {
  const workspaceKey = workspace?.persistent ? (workspace.path || workspace.directory || workspace.name || null) : null;
  const { status, refresh } = useProjectMemory(workspaceKey);
  const [intro, setIntro] = React.useState(null);
  const [closeRequest, setCloseRequest] = React.useState(null);
  const offered = React.useRef(new Set());

  // Tells the main process this window can show the question on the way out.
  React.useEffect(() => {
    missionApi().request("projectMemory.closePrompt", { state: "ready" }).catch(() => {});
    let unsubscribe = () => {};
    try {
      unsubscribe = missionApi().subscribe(message => {
        if (message?.type !== "projectMemory:close-requested") return;
        setIntro(null);
        setCloseRequest({ mode: message.mode === "create" ? "create" : "update", summary: typeof message.summary === "string" ? message.summary : "", at: Date.now() });
        missionApi().request("projectMemory.closePrompt", { state: "shown" }).catch(() => {});
        void refresh();
      });
    } catch { /* without the channel, closing never waits */ }
    return () => unsubscribe?.();
  }, [refresh]);

  React.useEffect(() => {
    const listener = () => setIntro({ manual: true });
    introListeners.add(listener);
    return () => { introListeners.delete(listener); };
  }, []);

  // Offered a moment after the project opens, and only when nothing else is
  // asking for attention: the recovery review, a confirmation or the palette
  // come first, and the introduction waits its turn.
  React.useEffect(() => {
    if (!workspaceKey || status?.prompt !== "open" || intro || closeRequest || offered.current.has(workspaceKey)) return undefined;
    let tries = 0;
    let timer = null;
    const attempt = () => {
      tries += 1;
      const busy = document.querySelector("[role='dialog'], [role='alertdialog'], [cmdk-root]");
      if (!busy) {
        offered.current.add(workspaceKey);
        setIntro({ manual: false });
        return;
      }
      if (tries < 30) timer = setTimeout(attempt, 2000);
    };
    timer = setTimeout(attempt, 1800);
    return () => clearTimeout(timer);
  }, [workspaceKey, status?.prompt, intro, closeRequest]);

  return <>
    <ProjectMemoryIntro open={Boolean(intro)} manual={Boolean(intro?.manual)} status={status} onClose={() => { setIntro(null); void refresh(); }} onDone={() => void refresh()}/>
    <ProjectMemoryCloseDialog request={closeRequest} status={status} onCancel={() => setCloseRequest(null)}/>
  </>;
}

// ------------------------------------------------------------------ settings

function Toggle({ label, detail, checked, disabled, onChange }) {
  return <label className="pmem-row">
    <span><strong>{label}</strong><small>{detail}</small></span>
    <span className="pm-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)}/>
      <i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i>
    </span>
  </label>;
}

export function ProjectMemorySettings({ workspace, onConfirm }) {
  const workspaceKey = workspace?.persistent ? (workspace.path || workspace.directory || workspace.name || null) : null;
  const { status, error, refresh } = useProjectMemory(workspaceKey);
  const { status: aiStatus, refresh: refreshAi, setStatus: setAiStatus } = useAssistantStatus();
  const [keysOpen, setKeysOpen] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState(null);
  const [note, setNote] = React.useState("");

  const run = async (id, method, params, done) => {
    setBusy(id);
    setMessage(null);
    try {
      const result = await missionApi().request(method, params);
      const text = typeof done === "function" ? done(result) : done;
      if (text) setMessage({ tone: "ok", text });
      await refresh();
      return result;
    } catch (value) {
      setMessage({ tone: "error", text: value?.message || String(value) });
      return null;
    } finally {
      setBusy("");
    }
  };

  const serviceBusy = Boolean(status?.busy);
  const disabled = Boolean(busy) || serviceBusy;
  const noModel = Boolean(status?.enabled) && !status.model;
  const pointerNames = status?.pointers ? Object.entries(status.pointers).filter(([, value]) => value !== null) : [];
  const pointersMissing = pointerNames.filter(([, value]) => value === false).map(([name]) => name);

  return <section className="settings-panel settings-panel-wide pm-card pmem-settings" aria-label="Project memory">
    <div className="settings-panel__head">
      <MemoryGlyph/>
      <div><h3>Project memory</h3><p>An arch_memory.md that you and every AI agent keep up to date: what the project is for, how it runs, and every change with who made it and why.</p></div>
    </div>

    {!status && !error && <p className="settings-note">Checking project memory…</p>}
    {error && !status && <div className="integration-resource-notice" role="status"><span><strong>Project memory could not be checked.</strong> {error}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

    {status && !status.available && <p className="settings-note">Open a saved project to give it a memory. The file lives in the project's folder.</p>}

    {status?.available && !status.enabled && <div className="pmem-off">
      <div>
        <strong>{status.decision === "never" ? "Turned off for this project" : status.exists ? "This project has an arch_memory.md that OUTARCH did not write" : "This project has no memory yet"}</strong>
        <p>{status.decision === "never" ? "OUTARCH does not ask or write here. The file, if there is one, is untouched." : "Set it up and AI agents read it before they work and add to it when they finish. Mission AI records what you do by hand."}</p>
      </div>
      <button type="button" className="pmem-btn is-primary" onClick={() => openProjectMemoryIntro()}>Set up project memory</button>
    </div>}

    {status?.available && status.enabled && <>
      <div className="pmem-file">
        <span className="pmem-file__icon"><MemoryGlyph size={17}/></span>
        <div><strong>{status.fileName}</strong><small title={status.path}>{status.path}</small></div>
        <button type="button" className="pmem-btn is-small" onClick={() => void run("open", "projectMemory.open", {}, null)} disabled={busy === "open"}>Open file</button>
      </div>

      <dl className="pmem-facts">
        <div><dt>Entries</dt><dd>{status.entries?.count ?? 0}</dd></div>
        <div><dt>Last update by OUTARCH</dt><dd>{status.lastUpdate ? ago(status.lastUpdate.at) : "not yet"}</dd></div>
        <div><dt>Agents pointed to it</dt><dd>{pointerNames.length ? pointerNames.map(([name, value]) => <span key={name} className={value ? "is-on" : "is-off"}>{value ? "✓" : "–"} {name}</span>) : "—"}</dd></div>
      </dl>

      {status.entries?.latest?.length > 0 && <div className="pmem-latest" aria-label="Latest entries">
        <span className="pmem-latest__title">Latest entries</span>
        <ul>{status.entries.latest.map(entry => <li key={`${entry.stamp}-${entry.tool}-${entry.changed.slice(0, 20)}`}>
          <span className={`pmem-kind kind-${entry.kind}`}>{entry.kind}</span>
          <div><strong>{entry.changed || "No summary line"}</strong><small>{entry.stamp} · {entry.tool}{entry.model ? ` (${entry.model})` : ""}</small></div>
        </li>)}</ul>
      </div>}

      <div className="pmem-update">
        <label className="pmem-field">
          <span>Record what you did<small>Optional note. Mission AI reads your git changes and terminal output and writes the entry.</small></span>
          <textarea rows={2} maxLength={600} value={note} disabled={disabled} onChange={event => setNote(event.target.value)} placeholder="For example: switched the database to Postgres and added a migration"/>
        </label>
        <div className="pmem-update__actions">
          <button type="button" className="pmem-btn is-primary" disabled={disabled || noModel} onClick={() => void run("update", "projectMemory.update", { reason: "manual", note }, result => { if (result?.written) setNote(""); return result?.written ? "Mission AI added an entry to arch_memory.md." : result?.message || "Nothing was written."; })}>
            {busy === "update" || status.busy === "update" ? <><Spinner/>Writing…</> : "Update memory now"}
          </button>
          <button type="button" className="pmem-btn" disabled={disabled || noModel} onClick={() => void run("summary", "projectMemory.summarize", {}, "Mission AI wrote the project summary.")}>
            {busy === "summary" || status.busy === "summary" ? <><Spinner/>Writing…</> : status.summaryWritten ? "Rewrite summary" : "Write summary"}
          </button>
          <button type="button" className="pmem-btn is-quiet" disabled={disabled} onClick={() => void run("facts", "projectMemory.refreshFacts", {}, result => result?.changed ? "Updated the project facts in arch_memory.md." : "The project facts were already up to date.")}>Refresh facts</button>
        </div>
      </div>

      <div className="pmem-model">
        <span><strong>Writes with</strong><small>{noModel ? "No model can write yet: project memory's AI key is not available. Add one of your own with Manage keys; agents can still add their own entries." : "Mission AI writes the entries and the summary with an AI key kept apart from your chats. You can pick one of your own keys here instead."}</small></span>
        {noModel
          ? <button type="button" className="pmem-btn is-small" onClick={() => setKeysOpen(true)}>Manage keys</button>
          : <ModelSwitcher status={aiStatus} surface="memory" align="end" onManageKeys={() => setKeysOpen(true)} onChanged={next => { if (next) setAiStatus(next); void refresh(); }}/>}
      </div>

      {pointersMissing.length > 0 && <div className="pmem-off is-inline">
        <div><strong>Some agents are not pointed to it</strong><p>{pointersMissing.join(" and ")} {pointersMissing.length === 1 ? "has" : "have"} no note about project memory, so agents that read {pointersMissing.length === 1 ? "it" : "them"} may not know it exists.</p></div>
        <button type="button" className="pmem-btn" disabled={disabled} onClick={() => void run("pointers", "projectMemory.pointers", {}, "Added the note for AI agents.")}>Add the note</button>
      </div>}
    </>}

    {status?.available && <div className="pmem-rows">
      <Toggle label="Ask to update when I close OUTARCH" detail="Only when something changed since the last update." checked={status.askOnClose !== false} disabled={disabled} onChange={value => void run("askOnClose", "projectMemory.configure", { configuration: { askOnClose: value } }, null)}/>
      <Toggle label="Offer project memory when I open a project without one" detail="Turn off to never be asked; you can still set it up here." checked={status.askOnOpen !== false} disabled={disabled} onChange={value => void run("askOnOpen", "projectMemory.configure", { configuration: { askOnOpen: value } }, null)}/>
    </div>}

    {status?.available && status.enabled && <p className="settings-note pmem-foot">
      OUTARCH only adds to the file and keeps its two blocks, About and Project facts, current. <button type="button" className="settings-inline-link" disabled={disabled} onClick={() => onConfirm ? onConfirm({ title: "Turn off project memory for this project?", detail: "OUTARCH stops asking and stops writing to arch_memory.md here. The file and everything in it stay, and agents can keep using it.", recovery: "Turn it on again any time from this panel.", confirmLabel: "Turn off", run: () => run("disable", "projectMemory.disable", {}, "Project memory is off for this project. The file is untouched.") }) : void run("disable", "projectMemory.disable", {}, "Project memory is off for this project.")}>Turn it off for this project</button>.
    </p>}

    {status?.lastError && !message && <p className="pmem-message is-error" role="status">{status.lastError}</p>}
    {message && <p className={`pmem-message ${message.tone === "error" ? "is-error" : ""}`} role="status">{message.text}</p>}

    <AssistantKeys open={keysOpen} onOpenChange={value => { setKeysOpen(value); if (!value) { void refreshAi(); void refresh(); } }} status={aiStatus} onStatus={next => { if (next) setAiStatus(next); void refresh(); }} onConfirm={onConfirm}/>
  </section>;
}
