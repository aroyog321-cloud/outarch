import React from "react";
import { missionApi } from "./missionApi.js";
import TrustBoundary from "./TrustBoundary.jsx";
import IntegrationAuditLog from "./IntegrationAuditLog.jsx";
import { RegisterSkeleton } from "./LoadingSkeleton.jsx";
import StatusChip from "./StatusChip.jsx";
import IntegrationDiagnostics from "./IntegrationDiagnostics.jsx";

const INTEGRATIONS = [
  { id: "intelligence", mark: "AI", role: "ENGINE", name: "Mission AI", detail: "Gemini project supervisor", request: "missionAi.status" },
  { id: "vscode", mark: "VS", role: "EDITOR", name: "VS Code Bridge", detail: "Editor context and managed terminals", request: "vscode.status" },
  { id: "mcp", mark: "MC", role: "GATEWAY", name: "Secure MCP", detail: "Claude, ChatGPT, and external AI gateway", request: "mcp.status" },
  { id: "automation", mark: "AU", role: "WORKFLOW", name: "Automation", detail: "Approval-gated operational workflows", request: "automation.list" },
  { id: "companion", mark: "MB", role: "CLIENT", name: "Mobile Companion", detail: "Encrypted Android supervision", request: "mobile.status" },
  { id: "extensions", mark: "PL", role: "PLATFORM", name: "Plugins", detail: "Declarative, permission-controlled manifests — not executable code", request: "plugin.status" }
];

// The tab strip. "overview" always leads; the rest mirror INTEGRATIONS so a
// new bridge only needs one entry, not a second list to keep in sync.
const TABS = [["overview", "Overview"], ...INTEGRATIONS.map(item => [item.id, item.name])];

function connectionState(id, value, failed) {
  if (failed) return { tone: "error", label: value ? "Stale" : "Unavailable", detail: value ? `Refresh failed · ${failed}` : failed };
  if (id === "intelligence") return value?.available === false ? { tone: "error", label: "Unavailable", detail: value.error || "Protected credential storage is unavailable" } : value?.lastError ? { tone: "error", label: "Needs review", detail: value.lastError } : value?.configured ? { tone: "ready", label: "Ready", detail: `${value.provider || "Gemini"} · ${value.authority || "observe"}` } : { tone: "idle", label: "Set up", detail: "Add a Gemini API key" };
  if (id === "vscode") return value?.connected ? { tone: "ready", label: "Connected", detail: value.editor?.relativePath || "Project linked" } : value?.awaitingHandshake ? { tone: "waiting", label: "Waiting", detail: "Complete the extension handshake" } : value?.lastError ? { tone: "error", label: "Needs review", detail: value.lastError } : { tone: "idle", label: "Not connected", detail: "Connect the included extension" };
  if (id === "mcp") return value?.available === false ? { tone: "error", label: "Unavailable", detail: value.lastError || "Protected credential storage is unavailable" } : value?.running ? { tone: "ready", label: "Listening", detail: value.endpoint || "Authenticated local gateway" } : value?.enabled ? { tone: value?.lastError ? "error" : "waiting", label: "Needs attention", detail: value.lastError || "Gateway is enabled but offline" } : { tone: "idle", label: "Disabled", detail: "Configure a client credential" };
  if (id === "companion") return value?.available === false ? { tone: "error", label: "Unavailable", detail: value.lastError || "Protected device storage is unavailable" } : value?.running ? { tone: "ready", label: "Available", detail: `${value.deviceCount ?? value.devices?.length ?? 0} paired devices` } : value?.enabled ? { tone: value?.lastError ? "error" : "waiting", label: "Needs attention", detail: value.lastError || "Desktop gateway is offline" } : { tone: "idle", label: "Disabled", detail: "Pair a mobile companion" };
  if (id === "extensions") return value?.available === false ? { tone: "error", label: "Unavailable", detail: "Plugin registry is unavailable" } : { tone: value?.enabledCount ? "ready" : "idle", label: value?.enabledCount ? `${value.enabledCount} enabled` : "No active plugins", detail: `${value?.pluginCount ?? 0} installed · ${value?.pendingApprovalCount ?? 0} approvals` };
  if (id === "automation") return { tone: value?.definitions?.some(item => item.enabled) ? "ready" : "idle", label: value?.definitions?.some(item => item.enabled) ? "Active" : "No active workflows", detail: `${value?.definitions?.length || 0} configured · ${value?.approvals?.filter(item => item.state === "pending").length || 0} approvals` };
  return { tone: "idle", label: "Not configured", detail: "Open setup" };
}

// The overview tab: a live directory, not a static list. Every count and
// status label below is read from the same protected service calls the
// detail panels use — nothing here is asserted without a request behind it.
function IntegrationOverview({ workspace, onOpen, onAskAI, capabilityHandshake }) {
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

  const withState = INTEGRATIONS.map(item => {
    const capability = capabilityHandshake?.capabilities?.[item.id];
    const status = capability?.support === "unavailable"
      ? { tone: "error", label: "Unavailable", detail: capability.reason || "This capability is not provided by the current engine connection" }
      : connectionState(item.id, statuses[item.id]?.value, statuses[item.id]?.error);
    return { item, status, capability };
  });
  const readyCount = withState.filter(({ status }) => status.tone === "ready").length;
  const attentionCount = withState.filter(({ status }) => status.tone === "waiting" || status.tone === "error").length;
  const idleCount = withState.filter(({ status }) => status.tone === "idle").length;

  return <>
    <section className="integration-feature-callout pm-card pm-card--feat-ai"><div className="integration-feature-mark">AI</div><div><span className="section-kicker">MISSION AI SUPERVISOR</span><h2>Ask about the project. Plan the next move.</h2><p>Summarize terminals, explain blockers, estimate remaining work from recorded evidence, or propose a safe multi-worker workspace.</p></div><button className="btn-primary feat-ai" disabled={capabilityHandshake?.capabilities?.intelligence?.support === "unavailable" || capabilityHandshake?.status !== "ready"} title={capabilityHandshake?.capabilities?.intelligence?.reason || undefined} onClick={onAskAI}>Ask Mission AI</button></section>
    <div className="integration-stat-row">
      <div className="integration-stat"><small>READY</small><strong className="tone-ready">{loading ? "—" : readyCount}</strong></div>
      <div className="integration-stat"><small>NEEDS ATTENTION</small><strong className={attentionCount ? "tone-waiting" : ""}>{loading ? "—" : attentionCount}</strong></div>
      <div className="integration-stat"><small>NOT CONFIGURED</small><strong>{loading ? "—" : idleCount}</strong></div>
    </div>
    <section className="integration-directory"><header><div><span className="section-kicker">CAPABILITY DIRECTORY</span><strong>Connections and extensions</strong></div><button type="button" onClick={refresh}>Refresh status</button></header>
      {loading ? <RegisterSkeleton rows={6} label="Checking integration status"/> : <div className="integration-list">{withState.map(({ item, status, capability }) => <article key={item.id} className={`integration-list-row tone-${status.tone}`}>
        <div className="integration-list-copy"><strong>{item.name}</strong><small>{item.detail}</small></div>
        <span className="integration-role-tag">{item.role}</span>
        <StatusChip className="integration-status" tone={status.tone === "error" ? "critical" : status.tone === "waiting" ? "warning" : status.tone === "ready" ? "ready" : "idle"} label={status.label}/>
        <button type="button" className="integration-inspect" onClick={() => onOpen(item.id)}>{capability?.support === "unavailable" ? "Why unavailable" : "Inspect"}</button>
      </article>)}</div>}
    </section>
    <IntegrationAuditLog/>
  </>;
}

export default function IntegrationHubView({ workspace, section = "overview", onSection, onAskAI, capabilityHandshake, children }) {
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
  return <div className="integrations-page integration-hub-v2">
    <header className="page-command-header pm-page-hero"><div><span className="page-eyebrow">INTEGRATION HUB</span><h1>Integrations</h1><p>Connect tools without surrendering control. Every bridge declares its capability and permission boundary before it can touch the active project.</p></div></header>
    <TrustBoundary compact title="Capabilities stay scoped" summary="Each connection declares what it can observe, request, and execute before it becomes active." facts={[{ label: "Observe", value: "Bounded project and integration state" }, { label: "Request", value: "Explicit capability-specific actions" }, { label: "Execute", value: "EngineAPI after a local decision" }]}/>
    <nav className="integration-hub-tabs" aria-label="Integration sections">{TABS.map(([id, label]) => { const unavailable = capabilityHandshake?.capabilities?.[id]?.support === "unavailable"; return <button key={id} type="button" className={`${section === id ? "is-current" : ""} ${unavailable ? "is-unavailable" : ""}`} aria-current={section === id ? "page" : undefined} aria-label={unavailable ? `${label} (unavailable)` : undefined} title={unavailable ? capabilityHandshake.capabilities[id].reason : undefined} onClick={() => onSection(id)}>{label}</button>; })}</nav>
    <div className="integration-hub-body">
      {section === "overview" ? <IntegrationOverview workspace={workspace} onOpen={onSection} onAskAI={onAskAI} capabilityHandshake={capabilityHandshake}/> : detailContent}
    </div>
  </div>;
}
