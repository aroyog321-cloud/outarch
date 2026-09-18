import React from "react";
import { missionApi } from "./missionApi.js";

/**
 * T116 - a bounded, on-demand self-test for every integration.
 *
 * "Self-test" here means exactly one thing: ask the service for its own status,
 * with a deadline, and report what came back. It performs no action, changes no
 * configuration, connects to nothing new, and needs no approval - which is why
 * it is safe to offer on every integration including the ones that hold
 * credentials. A test that could change state would need a confirmation
 * ceremony, and an operator would stop running it.
 *
 * The five facts T116 asks for come from the service's own status payload.
 * Where a service does not report one, the row says so rather than inventing a
 * plausible value: "not reported" is a finding, not a blank.
 */

const TIMEOUT_MS = 6000;

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean).map(String) : [];
}

function when(value) {
  if (!Number.isFinite(Number(value)) || !Number(value)) return null;
  const minutes = Math.max(0, Math.round((Date.now() - Number(value)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

// One descriptor per integration: which read-only method IS the self-test, and
// how to read the five facts out of its answer.
const PROBES = {
  intelligence: {
    label: "Mission AI",
    method: "missionAi.status",
    permissions: status => [`authority: ${status.authority || "observe"}`, "no execute", status.includeTerminalEvidence ? "terminal evidence included" : "terminal evidence omitted"],
    endpoint: status => status.endpoint || null,
    lastSuccess: status => status.lastCompletedAt,
    lastError: status => status.lastError || (status.available === false ? status.error : null),
    recovery: status => status.available === false
      ? "Protected credential storage is unavailable on this machine. Mission AI cannot hold a key until the OS keychain works; nothing else is affected."
      : !status.configured
        ? "Add a Gemini API key in this panel. Mission AI stays observe-only and cannot act on the project."
        : status.lastError
          ? "The last request failed. Ask again to retry; if it keeps failing, check the key and this machine's network access to the provider."
          : null
  },
  vscode: {
    label: "VS Code Bridge",
    method: "vscode.status",
    permissions: status => list(status.connection?.capabilities).length ? list(status.connection.capabilities) : list(status.permissions),
    endpoint: status => status.endpoint || null,
    lastSuccess: status => status.lastSyncAt,
    lastError: status => status.lastError,
    recovery: status => status.connected
      ? null
      : status.awaitingHandshake
        ? "A handshake is open and waiting. Run the OUTARCH command inside VS Code to complete it."
        : "Install or open the included extension in this project, then start the handshake from this panel."
  },
  mcp: {
    label: "Secure MCP",
    method: "mcp.status",
    permissions: status => list(status.scopes),
    endpoint: status => status.endpoint || null,
    lastSuccess: status => status.lastRequestAt || status.startedAt,
    lastError: status => status.lastError || (status.available === false ? "Protected credential storage is unavailable" : null),
    recovery: status => status.available === false
      ? "Protected credential storage is unavailable, so the gateway cannot hold a client credential."
      : status.running
        ? null
        : status.enabled
          ? "The gateway is enabled but not listening. Check that the port is free, then re-enable it."
          : "Enable the gateway and issue a client credential to accept external AI requests."
  },
  companion: {
    label: "Mobile Companion",
    method: "mobile.status",
    permissions: status => list(status.scopes).length ? list(status.scopes) : ["approval-gated", "paired devices only"],
    endpoint: status => status.endpoint || null,
    lastSuccess: status => status.lastRequestAt || status.startedAt,
    lastError: status => status.lastError || (status.available === false ? "Protected device storage is unavailable" : null),
    recovery: status => status.available === false
      ? "Protected device storage is unavailable, so pairings cannot be held."
      : status.running
        ? null
        : status.enabled
          ? "The desktop gateway is offline. Check the port, then re-enable it."
          : "Enable the gateway and pair a device to supervise this project from a phone."
  },
  extensions: {
    label: "Plugins",
    method: "plugin.status",
    permissions: () => ["declarative manifests", "permission-controlled", "no arbitrary code"],
    endpoint: () => "local registry",
    lastSuccess: status => status.lastLoadedAt,
    lastError: status => status.lastError || (status.available === false ? "Plugin registry is unavailable" : null),
    recovery: status => status.available === false
      ? "The plugin registry could not be read. No plugin is active while this is true."
      : Number(status.pendingApprovalCount) > 0
        ? "A plugin is waiting on a permission decision in Needs You."
        : null
  }
};

function Fact({ label, value, missing = "Not reported" }) {
  const empty = value === null || value === undefined || value === "";
  return <div className={`integration-diagnostic__fact ${empty ? "is-missing" : ""}`}>
    <dt>{label}</dt>
    <dd>{empty ? missing : value}</dd>
  </div>;
}

export default function IntegrationDiagnostics({ integrationId, capability }) {
  const probe = PROBES[integrationId];
  const [result, setResult] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  if (!probe) return null;

  const unavailable = capability?.support === "unavailable";

  const run = async () => {
    setBusy(true);
    const startedAt = Date.now();
    try {
      // The deadline is the point: a self-test that can hang is a self-test
      // nobody runs twice, and "still checking" is not an answer.
      const status = await Promise.race([
        missionApi().request(probe.method),
        new Promise((_resolve, reject) => setTimeout(() => reject(new Error(`No answer within ${Math.round(TIMEOUT_MS / 1000)}s`)), TIMEOUT_MS))
      ]);
      setResult({ ok: true, status, durationMs: Date.now() - startedAt, at: Date.now() });
    } catch (error) {
      setResult({ ok: false, error: error?.message || String(error), durationMs: Date.now() - startedAt, at: Date.now() });
    } finally {
      setBusy(false);
    }
  };

  const status = result?.ok ? result.status : null;
  const recovery = status ? probe.recovery(status) : null;

  return <section className="integration-diagnostic" aria-label={`${probe.label} self-test`}>
    <header>
      <div>
        <span className="section-kicker">SELF-TEST</span>
        <strong>Check {probe.label} without changing anything</strong>
      </div>
      <button type="button" disabled={busy || unavailable} onClick={() => void run()} title={unavailable ? capability?.reason : undefined}>
        {busy ? "Checking…" : result ? "Run again" : "Run self-test"}
      </button>
    </header>
    <p className="integration-diagnostic__scope">
      Reads <code>{probe.method}</code> with a {Math.round(TIMEOUT_MS / 1000)}-second deadline. It performs no action and needs no approval.
    </p>
    {unavailable && <p className="integration-diagnostic__scope" role="status">
      This engine connection does not provide {probe.label}, so there is nothing to test. {capability?.reason || ""}
    </p>}
    {result && (result.ok
      ? <>
        <dl className="integration-diagnostic__facts">
          <Fact label="Permissions" value={probe.permissions(status).join(" · ")} missing="No scope reported"/>
          <Fact label="Endpoint" value={probe.endpoint(status)} missing="No endpoint reported"/>
          <Fact label="Last success" value={when(probe.lastSuccess(status))} missing="No successful use recorded"/>
          <Fact label="Last error" value={probe.lastError(status)} missing="None recorded"/>
        </dl>
        <p className="integration-diagnostic__outcome" role="status">
          Answered in {result.durationMs}ms. {recovery || "No recovery step is needed."}
        </p>
      </>
      : <p className="integration-diagnostic__outcome is-error" role="status">
        The self-test failed after {result.durationMs}ms: {result.error}. The integration may still be working; this reports only that its status could not be read.
      </p>)}
  </section>;
}
