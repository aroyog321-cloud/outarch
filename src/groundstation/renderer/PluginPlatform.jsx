import React from "react";
import { confirmedRequest, missionApi } from "./missionApi.js";
import TrustBoundary from "./TrustBoundary.jsx";
import PluginContributionSlot from "./PluginContributionSlot.jsx";

const PERMISSIONS = {
  "context.read": ["Mission Context", "Bounded workers, missions, recipes, and project state"],
  "memory.read": ["Project Memory", "Resumable chapters and verified recovery relationships"],
  "attention.read": ["Needs You", "Current human-attention records"],
  "events.read": ["Activity events", "Bounded metadata without terminal output"],
  "health.read": ["Worker health", "Lifecycle, root-process resources, and dependency impact"],
  "worker.lifecycle.request": ["Request worker actions", "Creates an expiring local approval"],
  "recipe.run.request": ["Request recipe actions", "Creates an expiring local approval"],
  "automation.run.request": ["Request automation workflows", "Creates an expiring local approval to run or test an automation"]
};

function relativeTime(value) {
  if (!value) return "never";
  const minutes = Math.max(0, Math.floor((Date.now() - value) / 60000));
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m ago` : `${Math.floor(minutes / 60)}h ago`;
}

export function PluginPlatformSettings({ onConfirm }) {
  const [status, setStatus] = React.useState(null);
  const [plugins, setPlugins] = React.useState([]);
  const [audit, setAudit] = React.useState([]);
  const [expanded, setExpanded] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [resourceState, setResourceState] = React.useState({
    loading: true,
    statusError: "",
    pluginsError: "",
    auditError: "",
    statusUpdatedAt: null,
    pluginsUpdatedAt: null,
    auditUpdatedAt: null
  });
  const refresh = React.useCallback(async () => {
    setResourceState(current => ({ ...current, loading: true }));
    const [statusResult, pluginsResult, auditResult] = await Promise.allSettled([
      missionApi().request("plugin.status"),
      missionApi().request("plugin.list"),
      missionApi().request("plugin.audit.list", { limit: 8 })
    ]);
    const now = Date.now();
    if (statusResult.status === "fulfilled") setStatus(statusResult.value);
    if (pluginsResult.status === "fulfilled") setPlugins(Array.isArray(pluginsResult.value) ? pluginsResult.value : []);
    if (auditResult.status === "fulfilled") setAudit(Array.isArray(auditResult.value) ? auditResult.value : []);
    setResourceState(current => ({
      ...current,
      loading: false,
      statusError: statusResult.status === "rejected" ? (statusResult.reason?.message || String(statusResult.reason)) : "",
      pluginsError: pluginsResult.status === "rejected" ? (pluginsResult.reason?.message || String(pluginsResult.reason)) : "",
      auditError: auditResult.status === "rejected" ? (auditResult.reason?.message || String(auditResult.reason)) : "",
      statusUpdatedAt: statusResult.status === "fulfilled" ? now : current.statusUpdatedAt,
      pluginsUpdatedAt: pluginsResult.status === "fulfilled" ? now : current.pluginsUpdatedAt,
      auditUpdatedAt: auditResult.status === "fulfilled" ? now : current.auditUpdatedAt
    }));
  }, []);
  React.useEffect(() => {
    let active = true; let unsubscribe = () => {};
    void refresh();
    try { unsubscribe = missionApi().subscribe(notification => { if (active && notification?.type === "integration:event" && notification.integration === "plugins") { setStatus(notification.status); setResourceState(current => ({ ...current, statusError: "", statusUpdatedAt: Date.now() })); void missionApi().request("plugin.list").then(value => { if (!active) return; setPlugins(Array.isArray(value) ? value : []); setResourceState(current => ({ ...current, pluginsError: "", pluginsUpdatedAt: Date.now() })); }).catch(error => { if (active) setResourceState(current => ({ ...current, pluginsError: error?.message || String(error) })); }); } }, { type: "integration:event", integration: "plugins" }); } catch {}
    return () => { active = false; unsubscribe?.(); };
  }, [refresh]);
  const install = async () => {
    setBusy("install"); setMessage("");
    try { const result = await confirmedRequest("plugin.install"); if (!result?.canceled) { setExpanded(result.plugin.manifest.id); setMessage(`${result.plugin.manifest.name} manifest installed disabled with no permissions granted.`); } await refresh(); }
    catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };
  const configure = async (plugin, configuration) => {
    setBusy(plugin.manifest.id); setMessage("");
    try { await confirmedRequest("plugin.configure", { pluginId: plugin.manifest.id, configuration }); await refresh(); setMessage(`${plugin.manifest.name} permissions updated.`); }
    catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };
  const togglePermission = (plugin, permission) => {
    const grants = plugin.grantedPermissions.includes(permission) ? plugin.grantedPermissions.filter(item => item !== permission) : [...plugin.grantedPermissions, permission];
    void configure(plugin, { grantedPermissions: grants });
  };
  const uninstall = async plugin => {
    setBusy(plugin.manifest.id); setMessage("");
    try { await confirmedRequest("plugin.uninstall", { pluginId: plugin.manifest.id }); await refresh(); setMessage(`${plugin.manifest.name} was removed and pending requests were revoked.`); }
    catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };
  const statusKnown = status !== null;
  const enabledCount = statusKnown ? String(status?.enabledCount ?? 0) : "—";
  const pendingCount = statusKnown ? String(status?.pendingApprovalCount ?? 0) : "—";
  return <section className="settings-panel settings-panel-wide plugin-platform-settings pm-card pm-card--feat-plugin">
    <header><div className="plugin-title"><span className="plugin-mark">P</span><div><h3>Permission-controlled plugins</h3><p>Install declarative manifests and grant only the capabilities this project needs.</p></div></div><div className={`plugin-platform-state ${resourceState.statusError ? "is-risk" : ""}`}><i/><span><small>PLATFORM</small><strong>{resourceState.loading && !statusKnown ? "Loading status…" : `${enabledCount} enabled · ${pendingCount} waiting`}</strong></span></div></header>
    {resourceState.statusError && <div className="integration-resource-notice" role="status"><span><strong>Plugin platform status could not be refreshed.</strong> {statusKnown ? `Showing status verified ${relativeTime(resourceState.statusUpdatedAt)}.` : "Counts are unavailable until OUTARCH can verify the platform."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    <TrustBoundary tone="safe" title="OUTARCH renders every contribution" summary="Plugins provide validated text data only. The renderer owns markup, actions, accessibility, and styling." facts={[{ label: "Allowed", value: "Declared summaries, context, health, and approval requests" }, { label: "Actions", value: "Needs You approval through EngineAPI" }, { label: "Blocked", value: "Files, process, network, secrets, JSX, CSS, and handlers" }]}/>
    <PluginContributionSlot surface="settings.summary" plugins={plugins}/>
    <div className="plugin-registry-head"><div><span>LOCAL MANIFEST REGISTRY</span><strong>Inspect permissions before enabling</strong></div><button disabled={Boolean(busy)} onClick={() => void install()}>{busy === "install" ? "Opening…" : "Install manifest…"}</button></div>
    {resourceState.pluginsError && <div className="integration-resource-notice" role="status"><span><strong>Installed plugins could not be refreshed.</strong> {resourceState.pluginsUpdatedAt ? `Showing manifests verified ${relativeTime(resourceState.pluginsUpdatedAt)}.` : "No empty-state claim is shown because the registry is unavailable."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    <div className="plugin-registry">{plugins.length ? plugins.map(plugin => {
      const open = expanded === plugin.manifest.id;
      return <article key={plugin.manifest.id} className={`${plugin.enabled ? "is-enabled" : ""} ${open ? "is-open" : ""}`}><button className="plugin-summary" onClick={() => setExpanded(open ? null : plugin.manifest.id)}><span className="plugin-avatar">{plugin.manifest.name.slice(0, 2).toUpperCase()}</span><span><small>{plugin.manifest.publisher} · v{plugin.manifest.version}</small><strong>{plugin.manifest.name}</strong><p>{plugin.manifest.description}</p></span><em>{plugin.enabled ? "ENABLED" : "DISABLED"}</em><b>{open ? "−" : "+"}</b></button>{open && <div className="plugin-detail"><div className="plugin-manifest-facts"><span><small>PLUGIN ID</small><code>{plugin.manifest.id}</code></span><span><small>SURFACES</small><strong>{plugin.manifest.surfaces.length ? plugin.manifest.surfaces.join(" · ") : "None"}</strong></span><span><small>ACTIONS</small><strong>{plugin.manifest.actions.length} declared</strong></span></div>{Array.isArray(plugin.manifest.contributions) && plugin.manifest.contributions.length > 0 && <div className="plugin-permission-list"><header><span>DECLARATIVE CONTRIBUTIONS</span><small>Renderer-evaluated Safe Lane A contributions</small></header><div style={{ display: "grid", gap: "8px", marginTop: "6px" }}>{plugin.manifest.contributions.map(contrib => <div key={contrib.id} style={{ padding: "10px 12px", background: "var(--mc-surface-2)", border: "1px solid var(--mc-border)", borderRadius: "var(--mc-radius-sm)", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "8px" }}><div><span style={{ font: "650 9px/1 var(--font-mono)", color: "var(--mc-text-dim)", textTransform: "uppercase" }}>{contrib.surface} · {contrib.id}</span><strong style={{ display: "block", fontSize: "12px", color: "var(--mc-text-main)", marginTop: "2px" }}>{contrib.title}</strong>{contrib.rules && <small style={{ display: "block", fontSize: "10px", color: "var(--mc-accent)", marginTop: "2px" }}>{contrib.rules.length} dynamic rule{contrib.rules.length === 1 ? "" : "s"}</small>}</div><div style={{ textAlign: "right" }}><span className={`tone-badge tone-${contrib.tone || "neutral"}`} style={{ fontSize: "10px", padding: "2px 8px", borderRadius: "12px", background: "var(--mc-surface-3)", border: "1px solid var(--mc-border)" }}>{contrib.value}</span></div></div>)}</div></div>}<div className="plugin-permission-list"><header><span>DECLARED PERMISSIONS</span><small>Installed manifests start with every grant off</small></header>{plugin.manifest.permissions.map(permission => <label key={permission} className="terminal-toggle-card"><div><strong>{PERMISSIONS[permission]?.[0] || permission}{permission.endsWith(".request") && <em>APPROVAL GATED</em>}</strong><p style={{ margin: "2px 0 0", fontSize: "var(--mc-type-caption)", color: "var(--mc-text-muted)" }}>{PERMISSIONS[permission]?.[1]}</p></div><div className="pm-toggle"><input type="checkbox" checked={plugin.grantedPermissions.includes(permission)} disabled={Boolean(busy)} onChange={() => togglePermission(plugin, permission)}/><div className="pm-toggle-track"><div className="pm-toggle-thumb"/></div></div></label>)}</div><footer><span>Installed {relativeTime(plugin.installedAt)} · source {plugin.source}</span><div><button disabled={Boolean(busy) || !onConfirm} onClick={() => onConfirm?.({ title: `Uninstall "${plugin.manifest.name}"?`, detail: "The manifest, its grants, and its pending requests will be removed from this project.", recovery: "Import the manifest again and explicitly restore any required permissions.", confirmLabel: "Uninstall plugin", run: () => uninstall(plugin) })}>Uninstall</button><button className={plugin.enabled ? "is-stop" : "is-start"} disabled={Boolean(busy)} onClick={() => void configure(plugin, { enabled: !plugin.enabled })}>{busy === plugin.manifest.id ? "Updating…" : plugin.enabled ? "Disable plugin" : "Enable plugin"}</button></div></footer></div>}</article>;
    }) : !resourceState.loading && !resourceState.pluginsError ? <div className="plugin-empty"><span>P</span><strong>No plugin manifests installed</strong><p>Import a local `.json` manifest. OUTARCH validates it and rejects executable or privileged fields.</p></div> : null}</div>
    {message && <p className="plugin-message" role="status">{message}</p>}
    {resourceState.auditError && <div className="integration-resource-notice" role="status"><span><strong>Plugin audit history could not be refreshed.</strong> {resourceState.auditUpdatedAt ? `Showing entries verified ${relativeTime(resourceState.auditUpdatedAt)}.` : "No audit history is shown because its availability is unknown."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {audit.length > 0 && <div className="plugin-audit"><span>AUDIT · METADATA ONLY</span><div className="mcp-terminal-feed">{audit.slice(0, 5).map(item => <article key={item.id} className="mcp-terminal-row is-live"><i className="mcp-dot"/><span><strong>{item.kind} · {item.outcome}</strong><p style={{ margin: "2px 0 0", fontSize: "var(--mc-type-caption)", color: "var(--mc-text-dim)" }}>{item.pluginId || "platform"} · {item.capability || "registry"}</p></span><time style={{ fontSize: "var(--mc-type-caption)", color: "var(--mc-text-muted)" }}>{relativeTime(item.at)}</time></article>)}</div></div>}
    {resourceState.auditUpdatedAt && !resourceState.auditError && audit.length === 0 && <p className="integration-resource-empty">No plugin audit events recorded.</p>}
  </section>;
}

// Plugin permission approvals render only through the unified decision model now
// (`useDecisions` -> `DecisionList`). The old per-integration approval queue was
// unrendered dead code that replaced a failed plugin approval list with a `0`
// pending count — the exact MC-11 / T050 defect; the broker reports `error`.
