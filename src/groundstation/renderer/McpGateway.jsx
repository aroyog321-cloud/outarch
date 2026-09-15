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
  const [showToken, setShowToken] = React.useState(false);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [installerStatus, setInstallerStatus] = React.useState({});
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
    const [statusResult, auditResult, tokenResult] = await Promise.allSettled([
      missionApi().request("mcp.status"),
      missionApi().request("mcp.audit.list", { limit: 6 }),
      missionApi().request("mcp.getToken")
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
    if (tokenResult.status === "fulfilled" && tokenResult.value?.token) {
      setToken(tokenResult.value.token);
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
      setShowToken(true);
      setStatus(result.status);
      setMessage("New MCP access token generated. Use 1-Click Auto-Install below to update your AI clients instantly.");
      await refresh();
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };

  const copyTimerRef = React.useRef(null);
  React.useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  const copyText = async (text, label) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(label);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyFeedback(""), 2500);
    } catch {
      setMessage("Clipboard copy failed. Please select text manually.");
    }
  };

  const autoInstall = async target => {
    setBusy(`install-${target}`);
    setMessage("");
    try {
      const result = await missionApi().request("mcp.installClient", {
        target,
        workspacePath: workspace?.directory || workspace?.path || ""
      });
      setInstallerStatus(prev => ({ ...prev, [target]: "connected" }));
      setMessage(result.message || `Successfully configured ${target}!`);
      setTimeout(() => {
        setInstallerStatus(prev => ({ ...prev, [target]: "" }));
      }, 4000);
    } catch (error) {
      setInstallerStatus(prev => ({ ...prev, [target]: "failed" }));
      setMessage(error?.message || `Failed to configure ${target}`);
    } finally {
      setBusy("");
    }
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

  const endpointUrl = status?.endpoint || "http://127.0.0.1:37421/mcp";
  const activeToken = token || "<TOKEN>";

  const claudeCliCommand = `claude mcp add mission-control -- npx -y mcp-remote ${endpointUrl} --header "Authorization: Bearer ${activeToken}"`;

  const claudeConfigSnippet = JSON.stringify({
    mcpServers: {
      "mission-control": {
        command: "npx",
        args: ["-y", "mcp-remote", endpointUrl, "--header", `Authorization: Bearer ${activeToken}`]
      }
    }
  }, null, 2);

  const cursorConfigSnippet = JSON.stringify({
    name: "mission-control",
    type: "http",
    url: endpointUrl,
    headers: {
      Authorization: `Bearer ${activeToken}`
    }
  }, null, 2);

  const codexConfigSnippet = [
    "[mcp_servers.mission-control]",
    'command = "npx"',
    `args = ["-y", "mcp-remote", "${endpointUrl}", "--header", "Authorization: Bearer ${activeToken}"]`
  ].join("\n");

  const geminiConfigSnippet = JSON.stringify({
    mcpServers: {
      "mission-control": {
        httpUrl: endpointUrl,
        headers: { Authorization: `Bearer ${activeToken}` }
      }
    }
  }, null, 2);

  // One row per local client: where its configuration lives, the one-click
  // install, and the snippet for anyone who prefers to paste it themselves.
  const localClients = [
    { id: "claude-code", name: "Claude Code", where: "~/.claude.json", copy: claudeCliCommand, copyLabel: "Copy command" },
    { id: "codex", name: "Codex CLI", where: "~/.codex/config.toml", copy: codexConfigSnippet, copyLabel: "Copy TOML" },
    { id: "gemini-cli", name: "Gemini CLI", where: "~/.gemini/settings.json", copy: geminiConfigSnippet, copyLabel: "Copy JSON" },
    { id: "cursor", name: "Cursor", where: ".cursor/mcp.json in this project", copy: cursorConfigSnippet, copyLabel: "Copy JSON" },
    { id: "claude-desktop", name: "Claude Desktop", where: "claude_desktop_config.json", copy: claudeConfigSnippet, copyLabel: "Copy JSON" }
  ];

  const samplePrompt = "Use Mission Control MCP tools to inspect running workers, detect any failures or warnings, and summarize current project health.";

  return <section className={`settings-panel settings-panel-wide mcp-gateway-settings pm-card pm-card--feat-mcp ${running ? "is-running" : ""}`}>
    <header>
      <div className="settings-panel__head">
        <span className="mcp-mark">M</span>
        <div>
          <h3>Secure MCP Gateway</h3>
          <p>Lets AI tools running on this computer — Claude Code, Codex CLI, Gemini CLI, Cursor, Claude Desktop — see this project and ask Mission Control to act. It listens on 127.0.0.1 only, so nothing off this machine can reach it.</p>
        </div>
      </div>
      <div className={`mcp-state ${running ? "is-live" : status?.lastError || resourceState.statusError ? "is-risk" : ""}`}>
        <i/>
        <span><small>LOCAL GATEWAY</small><strong>{gatewayLabel}</strong></span>
      </div>
    </header>

    {resourceState.statusError && <div className="integration-resource-notice" role="status"><span><strong>Gateway status could not be refreshed.</strong> {statusKnown ? `Showing status verified ${relativeTime(resourceState.statusUpdatedAt)}.` : "Controls remain unavailable until Mission Control can verify the gateway."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

    <div className="mcp-summary">
      <div><span>ENDPOINT</span><strong title={status?.endpoint}>{status?.endpoint || (resourceState.loading ? "Loading…" : "Unavailable")}</strong><small>127.0.0.1 only · strict Origin checks</small></div>
      <div><span>PROTECTION</span><strong>{statusKnown ? (protectedStore ? "OS-encrypted token" : "Unavailable") : "—"}</strong><small>{status?.backend || (resourceState.loading ? "Checking secure storage" : "Status unavailable")}</small></div>
      <div><span>CLIENTS</span><strong>{knownCount(status?.clientCount)} recently active</strong><small>Authenticated in the last 5 minutes</small></div>
      <div className={status?.pendingApprovalCount ? "has-attention" : ""}><span>APPROVALS</span><strong>{knownCount(status?.pendingApprovalCount)} waiting</strong><small>Mutations execute only from Needs You</small></div>
    </div>

    {/* Connect a local AI tool. Each install writes only the mission-control
        entry into that tool's own configuration file and leaves the rest of the
        file as the operator had it. */}
    <section className="mcp-clients" aria-label="Connect a local AI tool">
      <header>
        <div>
          <h4>Connect a local AI tool</h4>
          <p>One click writes the gateway address and token into the tool's configuration. Restart the tool afterwards.</p>
        </div>
      </header>
      <ul>
        {localClients.map(client => <li key={client.id} className={installerStatus[client.id] ? `is-${installerStatus[client.id]}` : ""}>
          <div className="mcp-clients__copy">
            <strong>{client.name}</strong>
            <code>{client.where}</code>
            {installerStatus[client.id] && <span className="mcp-clients__done" role="status">{installerStatus[client.id] === "connected" ? "Connected — restart it to pick up the change" : "Could not write its configuration"}</span>}
          </div>
          <div className="mcp-clients__actions">
            <button type="button" className="mcp-clients__copy-button" onClick={() => void copyText(client.copy, `${client.name} setup copied`)}>
              {copyFeedback === `${client.name} setup copied` ? "Copied" : client.copyLabel}
            </button>
            <button type="button" className="mcp-clients__install" onClick={() => void autoInstall(client.id)} disabled={Boolean(busy) || !token}>
              {busy === `install-${client.id}` ? "Connecting…" : "Connect"}
            </button>
          </div>
        </li>)}
      </ul>
      {!token && <p className="mcp-clients__hint">Turn the gateway on to issue a token, then connect a tool.</p>}
    </section>

    {/* Token Management Card */}
    {token && <div className="mcp-token-reveal" role="status" style={{ marginTop: "14px" }}>
      <span>ACTIVE ACCESS TOKEN</span>
      <div>
        <code style={{ letterSpacing: showToken ? "0" : "2px" }}>
          {showToken ? token : "•••••••••••••••••••••••••••••••••••••••••••"}
        </code>
        <div style={{ display: "flex", gap: "6px" }}>
          <button type="button" onClick={() => setShowToken(!showToken)}>
            {showToken ? "Hide" : "Show"}
          </button>
          <button type="button" onClick={() => void copyText(token, "Token copied!")}>
            {copyFeedback === "Token copied!" ? "Copied Token!" : "Copy Plain Token"}
          </button>
        </div>
      </div>
      <small>Stored securely in OS keychain. Ready for 1-click install or manual client configuration.</small>
    </div>}

    {message && <p className={status?.lastError ? "is-error" : ""} role="status" style={{ marginTop: "10px", fontWeight: 600 }}>{message}</p>}

    {/* Scope Permissions */}
    <div className="mcp-permissions pm-stagger" style={{ marginTop: "14px" }}>
      <div className="mcp-permission-head">
        <div><span>EXPLICIT CAPABILITIES</span><strong>Grant only what this project needs</strong></div>
        <small>Read permissions are independent. Mutation requests require human approval in Needs You.</small>
      </div>
      <div className="mcp-terminal-feed">
        {SCOPE_CHOICES.map(scope => <label key={scope.id} className={`terminal-toggle-card ${scope.sensitive ? "is-sensitive" : ""} ${scope.approval ? "is-approval" : ""}`}>
          <div>
            <strong>{scope.label}{scope.approval && <em>APPROVAL GATED</em>}</strong>
            <p style={{ margin: "2px 0 0", fontSize: "var(--mc-type-caption)", color: "var(--mc-text-muted)" }}>{scope.detail}</p>
          </div>
          <div className="pm-toggle">
            <input type="checkbox" checked={scopes.includes(scope.id)} disabled={!protectedStore || Boolean(busy)} onChange={() => toggleScope(scope.id)}/>
            <div className="pm-toggle-track"><div className="pm-toggle-thumb"/></div>
          </div>
        </label>)}
      </div>
    </div>

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

    {/* Footer Controls */}
    <footer>
      <div>
        <strong>{status?.protocolVersions?.[0] || "MCP"}</strong>
        <span>Current protocol · 1-click setup · strict Origin checks</span>
      </div>
      <div>
        <button disabled={Boolean(busy) || !protectedStore} onClick={() => void configure("permissions", { scopes })}>
          {busy === "permissions" ? "Saving…" : "Save permissions"}
        </button>
        <button disabled={Boolean(busy) || !protectedStore || (status?.configured && !onConfirm)} onClick={() => status?.configured ? onConfirm?.({ title: "Rotate the MCP access token?", detail: "Every client using the current token will lose access immediately. You can re-click Auto-Add after rotation.", recovery: "Use 1-Click Auto-Add to instantly update each client with the new token.", confirmLabel: "Rotate token", run: rotate }) : void rotate()}>
          {busy === "token" ? "Rotating…" : status?.configured ? "Rotate token" : "Create access token"}
        </button>
        {running ? (
          <button className="mcp-stop" disabled={Boolean(busy)} onClick={() => void configure("stop", { enabled: false, scopes })}>
            {busy === "stop" ? "Stopping…" : "Stop gateway"}
          </button>
        ) : (
          <button className="mcp-start" disabled={Boolean(busy) || !protectedStore || !status?.configured || !workspace?.persistent} title={!status?.configured ? "Create and copy an access token first" : undefined} onClick={() => void configure("start", { enabled: true, scopes })}>
            {busy === "start" ? "Starting…" : "Enable gateway"}
          </button>
        )}
      </div>
    </footer>

    {resourceState.auditError && <div className="integration-resource-notice" role="status"><span><strong>MCP audit history could not be refreshed.</strong> {resourceState.auditUpdatedAt ? `Showing entries verified ${relativeTime(resourceState.auditUpdatedAt)}.` : "No audit history is shown because its availability is unknown."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {audit.length > 0 && <div className="mcp-audit"><span>AUDIT TRAIL · NO PROMPTS, TOKENS, OR TERMINAL OUTPUT</span><div className="mcp-terminal-feed">{audit.slice(0,4).map(record => <article key={record.id} className={`mcp-terminal-row ${record.outcome === "denied" || record.outcome === "error" ? "is-failed" : "is-live"}`}><i className="mcp-dot"/><span><strong>{record.kind} · {record.outcome}</strong><p style={{ margin: "2px 0 0", fontSize: "var(--mc-type-caption)", color: "var(--mc-text-dim)" }}>{record.client} · {record.capability || "gateway"}</p></span><time style={{ fontSize: "var(--mc-type-caption)", color: "var(--mc-text-muted)" }}>{relativeTime(record.at)}</time></article>)}</div></div>}
    {resourceState.auditUpdatedAt && !resourceState.auditError && audit.length === 0 && <p className="integration-resource-empty">No MCP audit events recorded.</p>}
  </section>;
}
