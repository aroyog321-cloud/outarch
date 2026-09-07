import React from "react";
import { confirmedRequest, missionApi } from "./missionApi.js";

const SCOPE_CHOICES = [
  { id: "context.read", label: "Mission Context", detail: "Workers, health, dependencies, missions, recipes, and bounded editor state." },
  { id: "memory.read", label: "Project Memory", detail: "Resumable chapters, evidence-backed recovery, and causal relationships." },
  { id: "attention.read", label: "Needs You", detail: "Current attention records and human-decision lifecycle." },
  { id: "terminal.read", label: "Terminal evidence", detail: "Sanitized bounded lines only. Off by default and never includes terminal input access.", sensitive: true },
  { id: "worker.lifecycle.request", label: "Request worker actions", detail: "May request start, restart, stop, or acknowledge. Every request waits in Needs You.", approval: true },
  { id: "supervisor.plan.request", label: "Request Gemini plans", detail: "External AI may ask Gemini for a validated workspace plan. It never executes directly.", approval: true },
  { id: "worker.create.request", label: "Request worker creation", detail: "Exact project-scoped worker definitions wait for local approval.", approval: true },
  { id: "terminal.input.request", label: "Request terminal input", detail: "Exact bounded input only; secret-bearing requests are rejected and approval is mandatory.", sensitive: true, approval: true },
  { id: "recipe.run.request", label: "Request recipe actions", detail: "May request run, recovery, or cancel. Every request waits in Needs You.", approval: true }
];

function relativeTime(value) {
  if (!value) return "never";
  const seconds = Math.max(0, Math.floor((Date.now() - value) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}


export function McpGatewaySettings({ workspace, onConfirm }) {
  const [status, setStatus] = React.useState(null);
  const [scopes, setScopes] = React.useState([]);
  const [audit, setAudit] = React.useState([]);
  const [token, setToken] = React.useState("");
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [testTool, setTestTool] = React.useState("mission_control_supervision");
  const [testResult, setTestResult] = React.useState(null);
  const [testBusy, setTestBusy] = React.useState(false);
  const [copyFeedback, setCopyFeedback] = React.useState("");
  const [resourceState, setResourceState] = React.useState({
    loading: true,
    statusError: "",
    auditError: "",
    statusUpdatedAt: null,
    auditUpdatedAt: null
  });

  const refresh = React.useCallback(async () => {
    setResourceState(current => ({ ...current, loading: true }));
    const [statusResult, auditResult] = await Promise.allSettled([
      missionApi().request("mcp.status"),
      missionApi().request("mcp.audit.list", { limit: 6 })
    ]);
    const now = Date.now();
    if (statusResult.status === "fulfilled") {
      const next = statusResult.value;
      setStatus(next);
      setScopes(next?.scopes || []);
    }
    if (auditResult.status === "fulfilled") {
      setAudit(Array.isArray(auditResult.value) ? auditResult.value : []);
    }
    setResourceState(current => ({
      ...current,
      loading: false,
      statusError: statusResult.status === "rejected" ? (statusResult.reason?.message || String(statusResult.reason)) : "",
      auditError: auditResult.status === "rejected" ? (auditResult.reason?.message || String(auditResult.reason)) : "",
      statusUpdatedAt: statusResult.status === "fulfilled" ? now : current.statusUpdatedAt,
      auditUpdatedAt: auditResult.status === "fulfilled" ? now : current.auditUpdatedAt
    }));
    return statusResult.status === "fulfilled" ? statusResult.value : null;
  }, []);

  React.useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    void refresh();
    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (notification?.type !== "integration:event" || notification.integration !== "mcp" || !active) return;
        setStatus(notification.status);
        setScopes(notification.status?.scopes || []);
        setResourceState(current => ({ ...current, statusError: "", statusUpdatedAt: Date.now() }));
      }, { type: "integration:event", integration: "mcp" });
    } catch { /* Status request remains authoritative. */ }
    return () => { active = false; unsubscribe?.(); };
  }, [refresh, workspace?.path]);

  const configure = async (operation, configuration) => {
    setBusy(operation);
    setMessage("");
    setToken("");
    try {
      const next = await missionApi().request("mcp.configure", { configuration });
      setStatus(next);
      setScopes(next.scopes || []);
      setMessage(next.running ? "Secure MCP Gateway is listening on authenticated localhost." : "Secure MCP Gateway is stopped.");
      await refresh();
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };

  const rotate = async () => {
    setBusy("token");
    setMessage("");
    try {
      const result = await confirmedRequest("mcp.rotateToken");
      setToken(result.token);
      setStatus(result.status);
      setMessage("Previous MCP credentials were revoked. Copy this token now; it will not be shown again.");
      await refresh();
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      setTimeout(() => setCopyFeedback(""), 2500);
    } catch {
      setMessage("Clipboard copy failed. Please select text manually.");
    }
  };

  const copyConfiguration = async () => {
    if (!token) return;
    const value = JSON.stringify({ url: status?.endpoint, headers: { Authorization: `Bearer ${token}` } }, null, 2);
    await copyText(value, "Client config copied!");
  };

  const runToolTest = async () => {
    setTestBusy(true);
    setTestResult(null);
    const start = Date.now();
    try {
      const result = await missionApi().request("mcp.tool.call", {
        name: testTool,
        arguments: {}
      });
      const elapsed = Date.now() - start;
      setTestResult({
        ok: true,
        elapsed,
        data: result
      });
    } catch (error) {
      const elapsed = Date.now() - start;
      setTestResult({
        ok: false,
        elapsed,
        error: error?.message || String(error)
      });
    } finally {
      setTestBusy(false);
    }
  };

  const toggleScope = id => setScopes(current => current.includes(id) ? current.filter(scope => scope !== id) : [...current, id]);
  const running = status?.running === true;
  const protectedStore = status?.available === true;
  const statusKnown = status !== null;
  const gatewayLabel = !statusKnown && resourceState.loading
    ? "Loading status…"
    : !statusKnown && resourceState.statusError
      ? "Status unavailable"
      : running
        ? "Authenticated & listening"
        : status?.lastError
          ? "Needs review"
          : "Stopped";
  const knownCount = value => statusKnown ? String(value ?? 0) : "—";

  const claudeConfigSnippet = JSON.stringify({
    mcpServers: {
      "mission-control": {
        command: "npx",
        args: ["-y", "mcp-remote", status?.endpoint || "http://127.0.0.1:48000/mcp", "--header", `Authorization: Bearer ${token || "<TOKEN>"}`]
      }
    }
  }, null, 2);

  const cursorConfigSnippet = JSON.stringify({
    name: "mission-control",
    type: "http",
    url: status?.endpoint || "http://127.0.0.1:48000/mcp",
    headers: {
      Authorization: `Bearer ${token || "<TOKEN>"}`
    }
  }, null, 2);

  const samplePrompt = "Use Mission Control MCP tools to inspect running workers, detect any failures or warnings, and summarize current project health.";

  return <section className={`settings-panel settings-panel-wide mcp-gateway-settings pm-card pm-card--feat-mcp ${running ? "is-running" : ""}`}>
    <header><div className="settings-panel__head"><span className="mcp-mark">M</span><div><h3>Secure MCP Gateway</h3><p>Connect external AI clients (Claude Desktop, Cursor, Custom Agents) to bounded project intelligence without giving them shell or process ownership.</p></div></div><div className={`mcp-state ${running ? "is-live" : status?.lastError || resourceState.statusError ? "is-risk" : ""}`}><i/><span><small>LOCAL GATEWAY</small><strong>{gatewayLabel}</strong></span></div></header>
    {resourceState.statusError && <div className="integration-resource-notice" role="status"><span><strong>Gateway status could not be refreshed.</strong> {statusKnown ? `Showing status verified ${relativeTime(resourceState.statusUpdatedAt)}.` : "Controls remain unavailable until Mission Control can verify the gateway."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    <div className="mcp-summary"><div><span>ENDPOINT</span><strong title={status?.endpoint}>{status?.endpoint || (resourceState.loading ? "Loading…" : "Unavailable")}</strong><small>127.0.0.1 only · strict Origin checks</small></div><div><span>PROTECTION</span><strong>{statusKnown ? (protectedStore ? "OS-encrypted token" : "Unavailable") : "—"}</strong><small>{status?.backend || (resourceState.loading ? "Checking secure storage" : "Status unavailable")}</small></div><div><span>CLIENTS</span><strong>{knownCount(status?.clientCount)} recently active</strong><small>Authenticated in the last 5 minutes</small></div><div className={status?.pendingApprovalCount ? "has-attention" : ""}><span>APPROVALS</span><strong>{knownCount(status?.pendingApprovalCount)} waiting</strong><small>Mutations execute only from Needs You</small></div></div>
    
    <div className="mcp-permissions pm-stagger"><div className="mcp-permission-head"><div><span>EXPLICIT CAPABILITIES</span><strong>Grant only what this project needs</strong></div><small>Read permissions are independent. Mutation requests require human approval in Needs You.</small></div><div className="mcp-terminal-feed">{SCOPE_CHOICES.map(scope => <label key={scope.id} className={`terminal-toggle-card ${scope.sensitive ? "is-sensitive" : ""} ${scope.approval ? "is-approval" : ""}`}><div><strong>{scope.label}{scope.approval && <em>APPROVAL GATED</em>}</strong><p style={{ margin: "2px 0 0", fontSize: "var(--mc-type-caption)", color: "var(--mc-text-muted)" }}>{scope.detail}</p></div><div className="pm-toggle"><input type="checkbox" checked={scopes.includes(scope.id)} disabled={!protectedStore || Boolean(busy)} onChange={() => toggleScope(scope.id)}/><div className="pm-toggle-track"><div className="pm-toggle-thumb"/></div></div></label>)}</div></div>
    
    {token && <div className="mcp-token-reveal" role="status"><span>ONE-TIME ACCESS TOKEN</span><div><code>{token}</code><button onClick={() => void copyConfiguration()}>{copyFeedback || "Copy client config"}</button></div><small>Store it in the MCP client’s secret configuration. Mission Control keeps only the OS-encrypted copy.</small></div>}
    {message && <p className={status?.lastError ? "is-error" : ""} role="status">{message}</p>}
    
    {/* Interactive MCP Testing Playground */}
    <div style={{ marginTop: "16px", padding: "14px", background: "var(--mc-surface-2, #101612)", border: "1px solid var(--mc-line, #223227)", borderRadius: "var(--mc-radius-sm, 6px)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", flexWrap: "wrap", gap: "8px" }}>
        <div>
          <span style={{ color: "var(--mc-ok, #4ade80)", fontSize: "9px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase" }}>INTERACTIVE MCP TESTER</span>
          <h4 style={{ margin: "2px 0 0", fontSize: "12px", fontWeight: 600 }}>Test MCP Tools Live in Workspace</h4>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <select value={testTool} onChange={event => setTestTool(event.target.value)} disabled={testBusy} style={{ background: "var(--mc-surface, #090d0b)", color: "var(--mc-text, #e1ede4)", border: "1px solid var(--mc-line, #223227)", borderRadius: "4px", padding: "4px 8px", fontSize: "11px", fontFamily: "var(--mc-font-mono, monospace)" }}>
            <option value="mission_control_supervision">mission_control_supervision</option>
            <option value="mission_control_context">mission_control_context</option>
            <option value="mission_control_worker">mission_control_worker</option>
            <option value="mission_control_memory">mission_control_memory</option>
            <option value="mission_control_attention">mission_control_attention</option>
          </select>
          <button type="button" onClick={() => void runToolTest()} disabled={testBusy} style={{ background: "var(--mc-ok, #4ade80)", color: "#09130c", border: "none", borderRadius: "4px", padding: "5px 12px", fontSize: "11px", fontWeight: 700, cursor: "pointer" }}>
            {testBusy ? "Running Test…" : "Execute Tool Test"}
          </button>
        </div>
      </div>
      {testResult && <div style={{ marginTop: "10px", padding: "10px", background: "var(--mc-surface, #090d0b)", border: "1px solid var(--mc-line, #223227)", borderRadius: "4px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
          <span style={{ fontSize: "10px", color: testResult.ok ? "var(--mc-ok, #4ade80)" : "var(--mc-danger, #ef4444)", fontWeight: 700 }}>
            {testResult.ok ? `✓ Tool executed successfully (${testResult.elapsed}ms)` : `✗ Tool test failed (${testResult.elapsed}ms)`}
          </span>
          <button type="button" onClick={() => void copyText(JSON.stringify(testResult.data || testResult.error, null, 2), "Result copied!")} style={{ fontSize: "10px", padding: "2px 8px", cursor: "pointer" }}>
            {copyFeedback === "Result copied!" ? "Copied!" : "Copy Response JSON"}
          </button>
        </div>
        <pre style={{ margin: 0, maxHeight: "160px", overflowY: "auto", fontSize: "10px", color: "var(--mc-text-dim, #7f9986)", fontFamily: "var(--mc-font-mono, monospace)", lineHeight: "1.4" }}>
          <code>{JSON.stringify(testResult.data || testResult.error, null, 2)}</code>
        </pre>
      </div>}
    </div>

    {/* Production Connection Guides */}
    <div style={{ marginTop: "16px", padding: "14px", background: "var(--mc-surface-2, #101612)", border: "1px solid var(--mc-line, #223227)", borderRadius: "var(--mc-radius-sm, 6px)" }}>
      <span style={{ color: "var(--mc-ok, #4ade80)", fontSize: "9px", fontWeight: 700, letterSpacing: ".09em", textTransform: "uppercase" }}>CLIENT QUICK CONNECT</span>
      <h4 style={{ margin: "2px 0 8px", fontSize: "12px", fontWeight: 600 }}>One-Click Copyable Configurations</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "10px" }}>
        <div style={{ background: "var(--mc-surface, #090d0b)", padding: "10px", borderRadius: "4px", border: "1px solid var(--mc-line, #223227)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <strong style={{ fontSize: "11px" }}>Claude Desktop</strong>
            <button type="button" onClick={() => void copyText(claudeConfigSnippet, "Claude snippet copied!")} style={{ fontSize: "10px", padding: "2px 6px" }}>
              {copyFeedback === "Claude snippet copied!" ? "Copied!" : "Copy Config"}
            </button>
          </div>
          <small style={{ color: "var(--mc-text-muted, #7f9986)", fontSize: "10px" }}>Add to <code>claude_desktop_config.json</code> via <code>mcp-remote</code>.</small>
        </div>
        <div style={{ background: "var(--mc-surface, #090d0b)", padding: "10px", borderRadius: "4px", border: "1px solid var(--mc-line, #223227)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <strong style={{ fontSize: "11px" }}>Cursor / Cline</strong>
            <button type="button" onClick={() => void copyText(cursorConfigSnippet, "Cursor snippet copied!")} style={{ fontSize: "10px", padding: "2px 6px" }}>
              {copyFeedback === "Cursor snippet copied!" ? "Copied!" : "Copy Config"}
            </button>
          </div>
          <small style={{ color: "var(--mc-text-muted, #7f9986)", fontSize: "10px" }}>Add to <code>.cursor/mcp.json</code> as HTTP MCP Server.</small>
        </div>
        <div style={{ background: "var(--mc-surface, #090d0b)", padding: "10px", borderRadius: "4px", border: "1px solid var(--mc-line, #223227)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
            <strong style={{ fontSize: "11px" }}>Sample LLM Prompt</strong>
            <button type="button" onClick={() => void copyText(samplePrompt, "Prompt copied!")} style={{ fontSize: "10px", padding: "2px 6px" }}>
              {copyFeedback === "Prompt copied!" ? "Copied!" : "Copy Prompt"}
            </button>
          </div>
          <small style={{ color: "var(--mc-text-muted, #7f9986)", fontSize: "10px" }}>Prompt external AI models to inspect current workspace state.</small>
        </div>
      </div>
    </div>

    <footer><div><strong>{status?.protocolVersions?.[0] || "MCP"}</strong><span>Current protocol · compatible legacy handshake · strict Origin checks</span></div><div><button disabled={Boolean(busy) || !protectedStore} onClick={() => void configure("permissions", { scopes })}>{busy === "permissions" ? "Saving…" : "Save permissions"}</button><button disabled={Boolean(busy) || !protectedStore || (status?.configured && !onConfirm)} onClick={() => status?.configured ? onConfirm?.({ title: "Rotate the MCP access token?", detail: "Every client using the current token will lose access immediately.", recovery: "Copy the new one-time token into each trusted MCP client after rotation.", confirmLabel: "Rotate token", run: rotate }) : void rotate()}>{busy === "token" ? "Rotating…" : status?.configured ? "Rotate token" : "Create access token"}</button>{running ? <button className="mcp-stop" disabled={Boolean(busy)} onClick={() => void configure("stop", { enabled: false, scopes })}>{busy === "stop" ? "Stopping…" : "Stop gateway"}</button> : <button className="mcp-start" disabled={Boolean(busy) || !protectedStore || !status?.configured || !workspace?.persistent} title={!status?.configured ? "Create and copy an access token first" : undefined} onClick={() => void configure("start", { enabled: true, scopes })}>{busy === "start" ? "Starting…" : "Enable gateway"}</button>}</div></footer>
    {resourceState.auditError && <div className="integration-resource-notice" role="status"><span><strong>MCP audit history could not be refreshed.</strong> {resourceState.auditUpdatedAt ? `Showing entries verified ${relativeTime(resourceState.auditUpdatedAt)}.` : "No audit history is shown because its availability is unknown."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {audit.length > 0 && <div className="mcp-audit"><span>AUDIT TRAIL · NO PROMPTS, TOKENS, OR TERMINAL OUTPUT</span><div className="mcp-terminal-feed">{audit.slice(0,4).map(record => <article key={record.id} className={`mcp-terminal-row ${record.outcome === "denied" || record.outcome === "error" ? "is-failed" : "is-live"}`}><i className="mcp-dot"/><span><strong>{record.kind} · {record.outcome}</strong><p style={{ margin: "2px 0 0", fontSize: "var(--mc-type-caption)", color: "var(--mc-text-dim)" }}>{record.client} · {record.capability || "gateway"}</p></span><time style={{ fontSize: "var(--mc-type-caption)", color: "var(--mc-text-muted)" }}>{relativeTime(record.at)}</time></article>)}</div></div>}
    {resourceState.auditUpdatedAt && !resourceState.auditError && audit.length === 0 && <p className="integration-resource-empty">No MCP audit events recorded.</p>}
  </section>;
}

// MCP approvals render only through the unified decision model now
// (`useDecisions` -> `DecisionList`). The old per-integration approval queue was
// unrendered dead code that reported a false `0` pending on a failed list call.
