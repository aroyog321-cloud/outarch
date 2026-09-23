import React from "react";
import { confirmedRequest, missionApi } from "./missionApi.js";
import { copyText } from "./clipboard.js";

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
  const [clientStatuses, setClientStatuses] = React.useState({});
  const [copyFeedback, setCopyFeedback] = React.useState("");
  const [resourceState, setResourceState] = React.useState({
    loading: true,
    statusError: "",
    auditError: "",
    statusUpdatedAt: null,
    auditUpdatedAt: null
  });

  const workspacePath = workspace?.directory || workspace?.path || "";

  const refresh = React.useCallback(async () => {
    setResourceState(current => ({ ...current, loading: true }));
    const [statusResult, auditResult, tokenResult, clientsResult] = await Promise.allSettled([
      missionApi().request("mcp.status"),
      missionApi().request("mcp.audit.list", { limit: 6 }),
      missionApi().request("mcp.getToken"),
      missionApi().request("mcp.clientStatus", { workspacePath })
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
    if (clientsResult.status === "fulfilled" && clientsResult.value) {
      setClientStatuses(clientsResult.value);
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
  }, [workspacePath]);

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
        void missionApi().request("mcp.clientStatus", { workspacePath }).then(res => {
          if (active && res) setClientStatuses(res);
        }).catch(() => {});
      }, { type: "integration:event", integration: "mcp" });
    } catch { /* Status request remains authoritative. */ }
    return () => { active = false; unsubscribe?.(); };
  }, [refresh, workspacePath]);

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
      setMessage("New MCP access token generated. Use Connect below to update your AI clients.");
      await refresh();
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
  };

  const copyTimerRef = React.useRef(null);
  React.useEffect(() => () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
  }, []);

  // Named apart from the imported helper it calls: sharing the name made it call itself.
  const copyWithFeedback = async (text, label) => {
    try {
      await copyText(text);
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
        workspacePath
      });
      setInstallerStatus(prev => ({ ...prev, [target]: "connected" }));
      setMessage(result.message || `Successfully configured ${target}!`);
      await refresh();
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

  const removeClient = target => {
    const client = localClients.find(c => c.id === target);
    const targetLabel = client?.name || target;

    const performRemoval = async () => {
      setBusy(`remove-${target}`);
      setMessage("");
      try {
        const result = await missionApi().request("mcp.removeClient", {
          target,
          workspacePath
        });
        setInstallerStatus(prev => ({ ...prev, [target]: "removed" }));
        setMessage(result.message || `Successfully removed OUTARCH from ${targetLabel}!`);
        await refresh();
        setTimeout(() => {
          setInstallerStatus(prev => ({ ...prev, [target]: "" }));
        }, 4000);
      } catch (error) {
        setInstallerStatus(prev => ({ ...prev, [target]: "failed" }));
        setMessage(error?.message || `Failed to remove ${targetLabel}`);
      } finally {
        setBusy("");
      }
    };

    if (onConfirm) {
      onConfirm({
        title: `Remove OUTARCH from ${targetLabel}?`,
        detail: `OUTARCH's server entry is removed from ${client?.where || "the client configuration file"}. Every other setting in that file stays as it is.`,
        recovery: "You can click Connect at any time to re-enable OUTARCH in this tool.",
        confirmLabel: "Remove integration",
        run: performRemoval
      });
    } else {
      void performRemoval();
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

  const claudeCliCommand = `claude mcp add outarch -- npx -y mcp-remote ${endpointUrl} --header "Authorization: Bearer ${activeToken}"`;

  const claudeConfigSnippet = JSON.stringify({
    mcpServers: {
      "outarch": {
        command: "npx",
        args: ["-y", "mcp-remote", endpointUrl, "--header", `Authorization: Bearer ${activeToken}`]
      }
    }
  }, null, 2);

  const cursorConfigSnippet = JSON.stringify({
    name: "outarch",
    type: "http",
    url: endpointUrl,
    headers: {
      Authorization: `Bearer ${activeToken}`
    }
  }, null, 2);

  const codexConfigSnippet = [
    "[mcp_servers.outarch]",
    'command = "npx"',
    `args = ["-y", "mcp-remote", "${endpointUrl}", "--header", "Authorization: Bearer ${activeToken}"]`
  ].join("\n");

  const geminiConfigSnippet = JSON.stringify({
    mcpServers: {
      "outarch": {
        httpUrl: endpointUrl,
        headers: { Authorization: `Bearer ${activeToken}` }
      }
    }
  }, null, 2);

  const localClients = [
    { id: "claude-code", name: "Claude Code", where: "~/.claude.json", copy: claudeCliCommand, copyLabel: "Copy command" },
    { id: "codex", name: "Codex CLI", where: "~/.codex/config.toml", copy: codexConfigSnippet, copyLabel: "Copy TOML" },
    { id: "gemini-cli", name: "Gemini CLI", where: "~/.gemini/settings.json", copy: geminiConfigSnippet, copyLabel: "Copy JSON" },
    { id: "cursor", name: "Cursor", where: ".cursor/mcp.json in this project", copy: cursorConfigSnippet, copyLabel: "Copy JSON" },
    { id: "claude-desktop", name: "Claude Desktop", where: "claude_desktop_config.json", copy: claudeConfigSnippet, copyLabel: "Copy JSON" }
  ];

  return <section className={`settings-panel settings-panel-wide mcp-gateway-settings pm-card pm-card--feat-mcp ${running ? "is-running" : ""}`}>
    <header>
      <div className="settings-panel__head">
        <span className="mcp-mark">M</span>
        <div>
          <h3>Secure MCP Gateway</h3>
          <p>Lets AI tools running on this computer — Claude Code, Codex CLI, Gemini CLI, Cursor, Claude Desktop — see this project and ask OUTARCH to act. It listens on 127.0.0.1 only, so nothing off this machine can reach it.</p>
        </div>
      </div>
      <div className={`mcp-state ${running ? "is-live" : status?.lastError || resourceState.statusError ? "is-risk" : ""}`}>
        <i/>
        <span><small>LOCAL GATEWAY</small><strong>{gatewayLabel}</strong></span>
      </div>
    </header>

    {resourceState.statusError && <div className="integration-resource-notice" role="status"><span><strong>Gateway status could not be refreshed.</strong> {statusKnown ? `Showing status verified ${relativeTime(resourceState.statusUpdatedAt)}.` : "Controls remain unavailable until OUTARCH can verify the gateway."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}

    <div className="mcp-summary">
      <div><span>ENDPOINT</span><strong title={status?.endpoint}>{status?.endpoint || (resourceState.loading ? "Loading…" : "Unavailable")}</strong><small>127.0.0.1 only · strict Origin checks</small></div>
      <div><span>PROTECTION</span><strong>{statusKnown ? (protectedStore ? "OS-encrypted token" : "Unavailable") : "—"}</strong><small>{status?.backend || (resourceState.loading ? "Checking secure storage" : "Status unavailable")}</small></div>
      <div><span>CLIENTS</span><strong>{knownCount(status?.clientCount)} recently active</strong><small>Authenticated in the last 5 minutes</small></div>
      <div className={status?.pendingApprovalCount ? "has-attention" : ""}><span>APPROVALS</span><strong>{knownCount(status?.pendingApprovalCount)} waiting</strong><small>Mutations execute only from Needs You</small></div>
    </div>

    {/* Connect / Remove Local AI Tools */}
    <section className="mcp-clients" aria-label="Connect or remove local AI tools">
      <header>
        <div>
          <h4>Local AI tool connections</h4>
          <p>One click adds or removes the gateway address and authentication token in each tool's configuration file.</p>
        </div>
      </header>
      <ul>
        {localClients.map(client => {
          const isInstalled = Boolean(clientStatuses[client.id]?.installed);
          const currentStatus = installerStatus[client.id];

          return <li key={client.id} className={currentStatus ? `is-${currentStatus}` : isInstalled ? "is-connected" : ""}>
            <div className="mcp-clients__copy">
              <strong>{client.name}</strong>
              <code>{client.where}</code>
              <span className={`mcp-clients__badge ${isInstalled ? "is-connected" : "is-idle"}`}>
                {isInstalled ? "Connected" : "Not connected"}
              </span>
              {currentStatus && <span className="mcp-clients__done" role="status">
                {currentStatus === "connected"
                  ? "Connected — restart tool to apply changes"
                  : currentStatus === "removed"
                    ? "Removed from configuration"
                    : "Operation failed"}
              </span>}
            </div>
            <div className="mcp-clients__actions">
              <button type="button" className="mcp-clients__copy-button" onClick={() => void copyWithFeedback(client.copy, `${client.name} setup copied`)}>
                {copyFeedback === `${client.name} setup copied` ? "Copied" : client.copyLabel}
              </button>
              <button type="button" className="mcp-clients__install" onClick={() => void autoInstall(client.id)} disabled={Boolean(busy) || !token} title={isInstalled ? "Update client configuration with current token" : "Configure client"}>
                {busy === `install-${client.id}` ? "Saving…" : isInstalled ? "Update" : "Connect"}
              </button>
              {isInstalled && <button type="button" className="mcp-clients__remove" onClick={() => removeClient(client.id)} disabled={Boolean(busy)} title={`Remove OUTARCH from ${client.name}`}>
                {busy === `remove-${client.id}` ? "Removing…" : "Remove"}
              </button>}
            </div>
          </li>;
        })}
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
          <button type="button" onClick={() => void copyWithFeedback(token, "Token copied!")}>
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
        <button disabled={Boolean(busy) || !protectedStore || (status?.configured && !onConfirm)} onClick={() => status?.configured ? onConfirm?.({ title: "Rotate the MCP access token?", detail: "Every client using the current token will lose access immediately. You can re-click Connect or Update after rotation.", recovery: "Use 1-Click Connect to instantly update each client with the new token.", confirmLabel: "Rotate token", run: rotate }) : void rotate()}>
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
    {audit.length > 0 && <div className="mcp-audit"><span>AUDIT TRAIL · NO PROMPTS, TOKENS, OR TERMINAL OUTPUT</span><div className="mcp-terminal-feed">{audit.slice(0, 4).map(record => <article key={record.id} className={`mcp-terminal-row ${record.outcome === "denied" || record.outcome === "error" ? "is-failed" : "is-live"}`}><i className="mcp-dot"/><span><strong>{record.kind} · {record.outcome}</strong><p style={{ margin: "2px 0 0", fontSize: "var(--mc-type-caption)", color: "var(--mc-text-dim)" }}>{record.client} · {record.capability || "gateway"}</p></span><time style={{ fontSize: "var(--mc-type-caption)", color: "var(--mc-text-muted)" }}>{relativeTime(record.at)}</time></article>)}</div></div>}
    {resourceState.auditUpdatedAt && !resourceState.auditError && audit.length === 0 && <p className="integration-resource-empty">No MCP audit events recorded.</p>}
  </section>;
}
