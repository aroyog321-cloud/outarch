import React from "react";
import { confirmedRequest, missionApi } from "./missionApi.js";

// Kept in sync with src/protocol/decisionBroker.cjs (that module is the engine
// side and must not be pulled into the renderer bundle). Small and stable.
const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };
const STATUS_RANK = { pending: 0, acting: 1, verifying: 2, acknowledged: 3, resolved: 4, expired: 5, dismissed: 6 };
const ACTIVE_STATUSES = new Set(["pending", "acting", "verifying", "acknowledged"]);
const CONFIRMED_SOURCES = new Set(["missionSupervisor", "mission", "mcp", "automation", "mobile", "plugin"]);

function sortDecisions(records) {
  return [...records].sort((a, b) => {
    const statusDelta = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (statusDelta) return statusDelta;
    const severityDelta = (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
    if (severityDelta) return severityDelta;
    const aExpiry = a.expiresAt == null ? Infinity : a.expiresAt;
    const bExpiry = b.expiresAt == null ? Infinity : b.expiresAt;
    if (aExpiry !== bExpiry) return aExpiry - bExpiry;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return String(a.id).localeCompare(String(b.id));
  });
}

/**
 * One read of the engine's unified decision query (`decisions.list`), merged with
 * the renderer-only terminal-transport alerts, refreshed on the engine/integration
 * events that change a decision.
 *
 * This is the single source of truth for Needs You: a source that failed to load
 * is reported here as `error`/`unavailable` and is never silently counted as zero,
 * and renderer alerts stay tagged `origin: "renderer"` so the engine/renderer
 * failure boundary is preserved.
 */

const EMPTY_QUERY = {
  records: [],
  sources: [],
  complete: true,
  counts: { pending: 0, critical: 0, byTarget: { agent: 0, worker: 0, integration: 0 } }
};

function isDecisionEvent(notification) {
  const type = notification?.type;
  if (type === "integration:event") return true;
  if (type !== "engine:event") return false;
  const eventType = String(notification?.event?.type || notification?.payload?.event?.type || "");
  return (
    eventType.startsWith("attention:") ||
    eventType.startsWith("mission:approval") ||
    eventType.startsWith("automation:approval") ||
    eventType.startsWith("session:")
  );
}

function terminalAlertRecords(terminalAlerts, sessions) {
  const nameFor = id => sessions.find(session => session.id === id)?.name || id;
  return Object.entries(terminalAlerts || {}).map(([sessionId, alert]) => ({
    id: `terminal:${sessionId}`,
    source: "terminal",
    type: "terminal.transport",
    severity: "warning",
    status: "pending",
    title: `${nameFor(sessionId)} terminal connection failed`,
    target: { kind: "worker", id: sessionId, label: nameFor(sessionId) },
    evidence: alert?.reason || "The renderer lost the terminal stream.",
    impact: "This is a renderer alert. The engine-owned worker state is unchanged.",
    actions: [
      { id: "open", label: "Open terminal", tone: "neutral", confirm: false, resolves: false },
      { id: "dismiss", label: "Dismiss", tone: "primary", confirm: false, resolves: true }
    ],
    createdAt: alert?.at || Date.now(),
    expiresAt: null,
    resolution: null,
    deepLink: { view: "workspace", params: { focus: sessionId } },
    origin: "renderer",
    audit: []
  }));
}

export function useDecisions(terminalAlerts = {}, sessions = []) {
  const [query, setQuery] = React.useState(EMPTY_QUERY);
  const [status, setStatus] = React.useState("loading"); // loading | ready | error
  const [error, setError] = React.useState(null);
  const [nonce, setNonce] = React.useState(0);
  const refresh = React.useCallback(() => setNonce(value => value + 1), []);

  React.useEffect(() => {
    let active = true;
    missionApi()
      .request("decisions.list")
      .then(result => {
        if (!active) return;
        setQuery(result && Array.isArray(result.records) ? result : EMPTY_QUERY);
        setStatus("ready");
        setError(null);
      })
      .catch(requestError => {
        if (!active) return;
        setStatus("error");
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      });
    return () => {
      active = false;
    };
  }, [nonce]);

  React.useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    let timer = null;
    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (!active || !isDecisionEvent(notification)) return;
        if (timer) return; // coalesce bursts (a recipe launch fires many events)
        timer = setTimeout(() => {
          timer = null;
          if (active) refresh();
        }, 250);
      });
    } catch {
      /* Subscription is best effort; the initial read still stands. */
    }
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      unsubscribe?.();
    };
  }, [refresh]);

  const alerts = React.useMemo(
    () => terminalAlertRecords(terminalAlerts, sessions),
    [terminalAlerts, sessions]
  );

  const records = React.useMemo(
    () => sortDecisions([...query.records, ...alerts]),
    [query.records, alerts]
  );

  const acknowledge = React.useCallback(record => {
    return missionApi().request("decisions.acknowledge", { id: record.id }).catch(() => {});
  }, []);

  const resolve = React.useCallback(async (record, actionId) => {
    const params = { id: record.id, actionId };
    if (record.source === "mission") params.missionId = record.target?.id;
    const result = CONFIRMED_SOURCES.has(record.source)
      ? await confirmedRequest("decisions.resolve", params)
      : await missionApi().request("decisions.resolve", params);
    refresh();
    return result;
  }, [refresh]);

  const activeCount = records.filter(record => ACTIVE_STATUSES.has(record.status)).length;

  return {
    records,
    sources: query.sources,
    counts: { ...query.counts, pending: activeCount },
    complete: query.complete,
    status,
    error,
    acknowledge,
    resolve,
    refresh
  };
}
