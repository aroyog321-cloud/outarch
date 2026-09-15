import React from "react";
import { missionApi } from "./missionApi.js";
import TrustBoundary from "./TrustBoundary.jsx";
import IntegrationAuditLog from "./IntegrationAuditLog.jsx";
import { RegisterSkeleton } from "./LoadingSkeleton.jsx";
import StatusChip from "./StatusChip.jsx";
import IntegrationDiagnostics from "./IntegrationDiagnostics.jsx";

// Automation was removed from this directory on 2026-09-12 at the operator's
// request. The engine still runs the workflows that exist and their approvals
// still reach the operator, because every one of them is a decision and
// Needs You is where decisions are answered — see CONFIRMED_SOURCES in
// useDecisions.js, which still names `automation`. What is gone is a whole
// tab for configuring something most projects never configure.
const INTEGRATIONS = [
  { id: "intelligence", mark: "AI", role: "ENGINE", name: "Mission AI", detail: "Reads terminals and acts with your approval", request: "missionAi.status" },
  { id: "vscode", mark: "VS", role: "EDITOR", name: "VS Code Bridge", detail: "Editor context and managed terminals", request: "vscode.status" },
  { id: "mcp", mark: "MC", role: "GATEWAY", name: "Secure MCP", detail: "Claude Code, Codex and other AI tools on this computer", request: "mcp.status" },
  { id: "companion", mark: "MB", role: "CLIENT", name: "Mobile Companion", detail: "Encrypted Android supervision", request: "mobile.status" },
  { id: "extensions", mark: "PL", role: "PLATFORM", name: "Plugins", detail: "Declarative, permission-controlled manifests — not executable code", request: "plugin.status" }
];

// The tab strip. "overview" always leads; the rest mirror INTEGRATIONS so a
// new bridge only needs one entry, not a second list to keep in sync.
const TABS = [["overview", "Overview"], ...INTEGRATIONS.map(item => [item.id, item.name])];

function connectionState(id, value, failed) {
  if (failed) return { tone: "error", label: value ? "Stale" : "Unavailable", detail: value ? `Refresh failed · ${failed}` : failed };
  if (id === "intelligence") return value?.available === false ? { tone: "error", label: "Unavailable", detail: value.error || "Protected credential storage is unavailable" } : value?.lastError ? { tone: "error", label: "Needs review", detail: value.lastError } : value?.configured ? { tone: "ready", label: "Ready", detail: "Built-in keys · reads terminals, acts with your approval" } : { tone: "idle", label: "Needs a model", detail: "Add a key under Keys & models" };
  if (id === "vscode") return value?.connected ? { tone: "ready", label: "Connected", detail: value.editor?.relativePath || "Project linked" } : value?.awaitingHandshake ? { tone: "waiting", label: "Waiting", detail: "Complete the extension handshake" } : value?.lastError ? { tone: "error", label: "Needs review", detail: value.lastError } : { tone: "idle", label: "Not connected", detail: "Connect the included extension" };
  if (id === "mcp") return value?.available === false ? { tone: "error", label: "Unavailable", detail: value.lastError || "Protected credential storage is unavailable" } : value?.running ? { tone: "ready", label: "Listening", detail: value.endpoint || "Authenticated local gateway" } : value?.enabled ? { tone: value?.lastError ? "error" : "waiting", label: "Needs attention", detail: value.lastError || "Gateway is enabled but offline" } : { tone: "idle", label: "Disabled", detail: "Configure a client credential" };
  if (id === "companion") return value?.available === false ? { tone: "error", label: "Unavailable", detail: value.lastError || "Protected device storage is unavailable" } : value?.running ? { tone: "ready", label: "Available", detail: `${value.deviceCount ?? value.devices?.length ?? 0} paired devices` } : value?.enabled ? { tone: value?.lastError ? "error" : "waiting", label: "Needs attention", detail: value.lastError || "Desktop gateway is offline" } : { tone: "idle", label: "Disabled", detail: "Pair a mobile companion" };
  if (id === "extensions") return value?.available === false ? { tone: "error", label: "Unavailable", detail: "Plugin registry is unavailable" } : { tone: value?.enabledCount ? "ready" : "idle", label: value?.enabledCount ? `${value.enabledCount} enabled` : "No active plugins", detail: `${value?.pluginCount ?? 0} installed · ${value?.pendingApprovalCount ?? 0} approvals` };
  return { tone: "idle", label: "Not configured", detail: "Open setup" };
}

// Live status for every integration, read from the same protected service calls
// the detail panels use — nothing is asserted without a request behind it. The
// rail and the overview both read it, so the status beside a name in the rail
// is always the one the overview shows for it.
function useIntegrationStatuses(workspace) {
  const [statuses, setStatuses] = React.useState({});
  const [loading, setLoading] = React.useState(true);

  const refreshTargeted = React.useCallback(async (targetIds = null) => {
    const targets = targetIds && targetIds.length > 0
      ? INTEGRATIONS.filter(item => targetIds.includes(item.id))
      : INTEGRATIONS;
    if (targets.length === 0) return;

    const results = await Promise.all(targets.map(async integration => {
      try { return [integration.id, { value: await missionApi().request(integration.request) }]; }
      catch (error) { return [integration.id, { error: error.message || String(error) }]; }
    }));
    setStatuses(current => {
      const next = { ...current };
      for (const [id, result] of results) {
        next[id] = result.error
          ? { value: current[id]?.value, error: result.error, updatedAt: current[id]?.updatedAt || null }
          : { ...result, error: "", updatedAt: Date.now() };
      }
      return next;
    });
    setLoading(false);
  }, []);

  const refresh = React.useCallback(() => refreshTargeted(null), [refreshTargeted]);

  React.useEffect(() => {
    let unsubscribe = () => {};
    void refresh();
    let debounceTimer = null;
    let pendingTargets = new Set();
    let refreshAll = false;

    const scheduleRefresh = (targetId) => {
      if (!targetId || targetId === "all" || targetId === "*") {
        refreshAll = true;
      } else {
        pendingTargets.add(targetId);
      }
      if (debounceTimer) return;
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        const targets = refreshAll ? null : Array.from(pendingTargets);
        refreshAll = false;
        pendingTargets.clear();
        void refreshTargeted(targets);
      }, 100);
    };

    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (notification?.type === "integration:event") {
          scheduleRefresh(notification.integration || notification.integrationId || null);
        }
      });
    } catch { /* Manual refresh remains available. */ }

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe?.();
    };
  }, [refresh, refreshTargeted, workspace?.path]);

  return { statuses, loading, refresh };
}

function stateFor(item, statuses, capabilityHandshake) {
  const capability = capabilityHandshake?.capabilities?.[item.id];
  const status = capability?.support === "unavailable"
    ? { tone: "error", label: "Unavailable", detail: capability.reason || "This capability is not provided by the current engine connection" }
    : connectionState(item.id, statuses[item.id]?.value, statuses[item.id]?.error);
  return { item, status, capability };
}

function HubIcon({ id }) {
  const paths = {
    overview: <><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></>,
    intelligence: <path d="M12 3.5c.4 4.4 4.1 8.1 8.5 8.5-4.4.4-8.1 4.1-8.5 8.5-.4-4.4-4.1-8.1-8.5-8.5 4.4-.4 8.1-4.1 8.5-8.5Z"/>,
    vscode: <><path d="m8.5 8-4 4 4 4"/><path d="m15.5 8 4 4-4 4"/><path d="m13.5 5.5-3 13"/></>,
    mcp: <><path d="M9 3.5v4.5M15 3.5v4.5"/><path d="M6.5 8h11v3.5a5.5 5.5 0 0 1-11 0Z"/><path d="M12 17v3.5"/></>,
    companion: <><rect x="7" y="3" width="10" height="18" rx="2.4"/><path d="M11 17.5h2"/></>,
    extensions: <path d="M9.5 4h5v3.2a1.8 1.8 0 1 0 3.3 1H20v5h-2.2a1.8 1.8 0 1 0 0 3.3H20V20h-5v-2.2a1.8 1.8 0 1 0-3.3 0V20H4v-5h2.2a1.8 1.8 0 1 0 0-3.3H4V4h5.5Z"/>
  };
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[id] || paths.overview}</svg>;
}

// The overview: what is connected, what needs a look, and the one control
// that goes to each — then the audit trail every bridge writes to.
function IntegrationOverview({ onOpen, onAskAI, capabilityHandshake, statuses, loading, refresh }) {
  const withState = INTEGRATIONS.map(item => stateFor(item, statuses, capabilityHandshake));
  const readyCount = withState.filter(({ status }) => status.tone === "ready").length;
  const attentionCount = withState.filter(({ status }) => status.tone === "waiting" || status.tone === "error").length;
  const idleCount = withState.filter(({ status }) => status.tone === "idle").length;

  return <>
    <section className="hub-callout">
      <span className="hub-callout__mark" aria-hidden="true"><HubIcon id="intelligence"/></span>
      <div><strong>Ask Mission AI</strong><p>Questions about the project are answered from what its terminals printed, and next steps run once you approve them.</p></div>
      <button className="btn-primary feat-ai" disabled={capabilityHandshake?.capabilities?.intelligence?.support === "unavailable" || capabilityHandshake?.status !== "ready"} title={capabilityHandshake?.capabilities?.intelligence?.reason || undefined} onClick={onAskAI}>Open Mission AI</button>
    </section>
    <section className="hub-directory" aria-label="Connections and extensions">
      <header>
        <div className="hub-counts">
          <span className="hub-counts__item tone-ready"><strong>{loading ? "—" : readyCount}</strong> ready</span>
          <span className={`hub-counts__item ${attentionCount ? "tone-waiting" : ""}`}><strong>{loading ? "—" : attentionCount}</strong> need attention</span>
          <span className="hub-counts__item"><strong>{loading ? "—" : idleCount}</strong> not set up</span>
        </div>
        <button type="button" onClick={refresh}>Refresh</button>
      </header>
      {loading ? <RegisterSkeleton rows={5} label="Checking integration status"/> : <div className="hub-directory__list">{withState.map(({ item, status, capability }) => <article key={item.id} className={`hub-directory__row tone-${status.tone}`}>
        <span className="hub-directory__icon" aria-hidden="true"><HubIcon id={item.id}/></span>
        <div className="hub-directory__copy"><strong>{item.name}</strong><small>{status.detail || item.detail}</small></div>
        <StatusChip className="hub-directory__status" tone={status.tone === "error" ? "critical" : status.tone === "waiting" ? "warning" : status.tone === "ready" ? "ready" : "idle"} label={status.label}/>
        <button type="button" className="hub-directory__open" onClick={() => onOpen(item.id)}>{capability?.support === "unavailable" ? "Why unavailable" : "Open"}</button>
      </article>)}</div>}
    </section>
    <IntegrationAuditLog/>
  </>;
}

export default function IntegrationHubView({ workspace, section = "overview", onSection, onAskAI, capabilityHandshake, children }) {
  const { statuses, loading, refresh } = useIntegrationStatuses(workspace);
  const currentCapability = section === "overview" ? null : capabilityHandshake?.capabilities?.[section];
  const capabilityUnavailable = currentCapability?.support === "unavailable";
  const detailContent = capabilityHandshake?.status === "loading"
    ? <RegisterSkeleton rows={4} label="Verifying integration capability"/>
    : capabilityHandshake?.status === "error"
      ? <div className="integration-resource-notice" role="status"><span><strong>Capability verification failed.</strong> {capabilityHandshake.error}. Integration controls remain unavailable until the engine contract is verified.</span><button type="button" onClick={() => void capabilityHandshake.refresh()}>Retry</button></div>
      : capabilityUnavailable
        ? <section className="capability-unavailable-panel" role="status"><span className="section-kicker">CAPABILITY UNAVAILABLE</span><h2>This engine connection does not provide {TABS.find(([id]) => id === section)?.[1] || "this integration"}.</h2><p>{currentCapability.reason || "The required protocol service is not available. No action has been attempted."}</p><button type="button" onClick={() => void capabilityHandshake.refresh()}>Check again</button></section>
        : <>
            <IntegrationDiagnostics integrationId={section} capability={currentCapability}/>
            {children}
          </>;

  const rail = TABS.map(([id, label]) => {
    if (id === "overview") {
      const all = INTEGRATIONS.map(item => stateFor(item, statuses, capabilityHandshake));
      const attention = all.filter(({ status }) => status.tone === "waiting" || status.tone === "error").length;
      return { id, label, tone: attention ? "waiting" : "idle", line: loading ? "Checking…" : attention ? `${attention} need attention` : `${all.filter(({ status }) => status.tone === "ready").length} connected` };
    }
    const item = INTEGRATIONS.find(entry => entry.id === id);
    const { status } = stateFor(item, statuses, capabilityHandshake);
    return { id, label, tone: status.tone, line: loading && !statuses[id] ? "Checking…" : status.label };
  });

  // One page header, a rail of every integration with its live state, and the
  // chosen integration beside it. The header, a boundary card and a tab row
  // used to stack above the content and cost 40% of the window before any of
  // it began; the boundary is a disclosure in the header now.
  return <div className="integrations-page integration-hub-v2 hub">
    <header className="hub__head">
      <div className="hub__title">
        <h1>Integrations</h1>
        <p>Tools connected to this project. Each one states what it can see and do before it touches anything.</p>
      </div>
      <TrustBoundary compact className="hub__trust" eyebrow="Access" title="Scoped by design" facts={[{ label: "Observe", value: "Bounded project and integration state" }, { label: "Request", value: "Explicit capability-specific actions" }, { label: "Execute", value: "EngineAPI after a local decision" }]}/>
    </header>
    <div className="hub__body">
      <nav className="hub__rail" aria-label="Integration sections">{rail.map(({ id, label, tone, line }) => { const unavailable = capabilityHandshake?.capabilities?.[id]?.support === "unavailable"; return <button key={id} type="button" className={`hub__rail-item ${section === id ? "is-current" : ""} ${unavailable ? "is-unavailable" : ""}`} aria-current={section === id ? "page" : undefined} aria-label={unavailable ? `${label} (unavailable)` : undefined} title={unavailable ? capabilityHandshake.capabilities[id].reason : undefined} onClick={() => onSection(id)}>
        <span className="hub__rail-icon"><HubIcon id={id}/></span>
        <span className="hub__rail-copy"><strong>{label}</strong><small className={`tone-${tone}`}>{line}</small></span>
      </button>; })}</nav>
      <div className="hub__panel">
        {section === "overview" ? <IntegrationOverview onOpen={onSection} onAskAI={onAskAI} capabilityHandshake={capabilityHandshake} statuses={statuses} loading={loading} refresh={refresh}/> : detailContent}
      </div>
    </div>
  </div>;
}
