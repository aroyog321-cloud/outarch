import React from "react";
import { confirmedRequest, missionApi } from "./missionApi.js";
import { RegisterSkeleton } from "./LoadingSkeleton.jsx";

const TRIGGERS = [
  ["worker-failed", "Worker fails"],
  ["worker-needs-you", "Worker needs you"],
  ["worker-exited", "Worker exits"]
];
const ACTIONS = [
  ["restart-worker", "Restart worker"],
  ["start-worker", "Start worker"],
  ["acknowledge-worker", "Acknowledge worker"]
];

function ago(timestamp) {
  if (!timestamp) return "never";
  const minutes = Math.floor((Date.now() - timestamp) / 60000);
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

export function AutomationSettings({ workspace, sessions, onConfirm }) {
  const [data, setData] = React.useState({ definitions: [], approvals: [], audit: [] });
  const [draft, setDraft] = React.useState(null);
  const [message, setMessage] = React.useState("");
  const [loadError, setLoadError] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  const [resourceState, setResourceState] = React.useState({ loading: true, updatedAt: null });
  // A failed automation.list must never render as "No workflows saved" — the last
  // known list is kept and an explicit error row with Retry is shown instead.
  const refresh = React.useCallback(() => {
    setResourceState(current => ({ ...current, loading: current.updatedAt == null }));
    return missionApi().request("automation.list").then(value => {
      setData(value);
      setLoadError(null);
      setResourceState({ loading: false, updatedAt: Date.now() });
    }).catch(error => {
      setLoadError(error instanceof Error ? error : new Error(String(error)));
      setResourceState(current => ({ ...current, loading: false }));
    });
  }, []);
  React.useEffect(() => { void refresh(); }, [refresh, workspace?.path]);
  React.useEffect(() => {
    if (!draft && sessions[0]) setDraft({ name: "Recover failed worker", enabled: false, trigger: { type: "worker-failed", targetId: sessions[0].id }, action: { type: "restart-worker", targetId: sessions[0].id }, cooldownMs: 300000 });
  }, [draft, sessions]);
  const run = async (label, operation) => {
    setBusy(label); setMessage("");
    try { await operation(); await refresh(); setMessage(label === "save" ? "Workflow saved. Enable it when the trigger and action are correct." : label === "test" ? "Dry run recorded. No action executed." : "Workflow removed."); }
    catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };
  const save = automation => run("save", () => missionApi().request("automation.save", { automation }));
  const loaded = resourceState.updatedAt != null;
  const controlsAvailable = loaded && !loadError;
  const pending = loaded ? data.approvals.filter(item => item.state === "pending").length : null;

  return <section className="settings-panel settings-panel-wide automation-settings">
    <header>
      <div><span className="automation-mark">↻</span><span><h3>Automation workflows</h3><p>Event-driven recovery with cooldowns, dry runs, and a local approval before every action.</p></span></div>
      <span className={pending ? "has-attention" : ""}><small>WAITING</small><strong>{pending ?? "—"}</strong></span>
    </header>
    {loadError && <div className="automation-load-error" role="status"><span><strong>Saved workflows could not be refreshed.</strong> {loaded ? "Showing the last verified definitions; editing is unavailable until the list is current." : "Availability is unknown, so OUTARCH will not claim there are no workflows."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {resourceState.loading && !loaded ? <RegisterSkeleton rows={3} label="Loading automation workflows"/> : <>
      {draft && <div className="automation-builder"><label><span>NAME</span><input value={draft.name} maxLength="80" disabled={!controlsAvailable} onChange={event => setDraft({ ...draft, name: event.target.value })}/></label><label><span>WHEN</span><select value={draft.trigger.type} disabled={!controlsAvailable} onChange={event => setDraft({ ...draft, trigger: { ...draft.trigger, type: event.target.value } })}>{TRIGGERS.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><label><span>WATCH</span><select value={draft.trigger.targetId} disabled={!controlsAvailable} onChange={event => setDraft({ ...draft, trigger: { ...draft.trigger, targetId: event.target.value } })}>{sessions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label><span>PROPOSE</span><select value={draft.action.type} disabled={!controlsAvailable} onChange={event => setDraft({ ...draft, action: { ...draft.action, type: event.target.value } })}>{ACTIONS.map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label><label><span>TARGET</span><select value={draft.action.targetId} disabled={!controlsAvailable} onChange={event => setDraft({ ...draft, action: { ...draft.action, targetId: event.target.value } })}>{sessions.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button disabled={!controlsAvailable || !workspace?.persistent || !sessions.length || busy === "save"} onClick={() => save(draft)}>{busy === "save" ? "Saving…" : "Save disabled workflow"}</button></div>}
      <div className="automation-list">{data.definitions.length ? data.definitions.map(item => <article key={item.id}><i className={item.enabled ? "is-live" : ""}/><div><strong>{item.name}</strong><small>{item.trigger.type.replaceAll("-", " ")} → {item.action.type.replaceAll("-", " ")} · last matched {ago(item.lastMatchedAt)}</small></div><button disabled={!controlsAvailable} onClick={() => save({ ...item, enabled: !item.enabled })}>{item.enabled ? "Disable" : "Enable"}</button><button disabled={!controlsAvailable} onClick={() => run("test", () => missionApi().request("automation.test", { automationId: item.id }))}>Dry run</button><button className="is-danger" disabled={!controlsAvailable || !onConfirm} onClick={() => { if (!onConfirm) return; const apply = () => run("delete", () => confirmedRequest("automation.delete", { automationId: item.id })); onConfirm({ title: `Remove "${item.name}"?`, detail: "The workflow definition is deleted from this project. Any approvals it already raised stay in Needs You.", recovery: "Rebuild the workflow from the builder above to restore it.", confirmLabel: "Remove workflow", run: apply }); }}>Remove</button></article>) : loaded && !loadError ? <p>No workflows saved. Build one above; new workflows remain disabled until you explicitly enable them.</p> : null}</div>
    </>}
    {message && <p role="status">{message}</p>}
    <footer><span>Every match enters Needs You. Approval is one-time and expires after 30 minutes.</span><small>{loaded ? data.audit[0] ? `Last audit: ${data.audit[0].kind.replaceAll("-", " ")} · ${ago(data.audit[0].at)}` : "No automation activity recorded" : "Automation activity has not been verified"}</small></footer>
  </section>;
}

// Automation approvals render only through the unified decision model now
// (`useDecisions` -> `DecisionList`). The old per-integration approval queue was
// unrendered dead code that reported a false `0` pending on load failure.
