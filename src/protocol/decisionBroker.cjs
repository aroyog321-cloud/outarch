"use strict";

/**
 * Decision broker — one normalised, failure-isolated view of every source that
 * can put a decision in front of the operator.
 *
 * Sources today:
 *   session            engineApi.listAttention()          (engine-owned, has a lifecycle)
 *   missionSupervisor  missionSupervisor.listApprovals()
 *   mission            engineApi.listMissionApprovals()
 *   mcp                mcpGateway.listApprovals()
 *   automation         engineApi.listAutomations().approvals
 *   mobile             mobileCompanion.listApprovals()
 *
 * Renderer terminal-transport alerts are NOT brokered here — they never reach the
 * engine and are injected client-side by the renderer with origin "renderer".
 *
 * Every adapter is wrapped so one slow or broken source can never blank the
 * others or collapse the count to zero: a failed source is reported with
 * `availability: "error"` and contributes no records, and `complete` becomes
 * false so the UI can say "N waiting · source unavailable" instead of a clean N.
 */

const SEVERITY_RANK = Object.freeze({ critical: 0, warning: 1, info: 2 });
const STATUS_RANK = Object.freeze({
  pending: 0, acting: 1, verifying: 2, acknowledged: 3,
  resolved: 4, expired: 5, dismissed: 6
});

const ACTIVE_STATUSES = new Set(["pending", "acting", "verifying", "acknowledged"]);

// Sources whose resolve is a consequential approval and must carry a confirmation
// ceremony. "session" and "terminal" are lifecycle/visibility only.
const CONFIRMED_SOURCES = new Set(["missionSupervisor", "mission", "mcp", "automation", "mobile"]);

/** Split a namespaced decision id ("mcp:approval-7") into { source, nativeId }. */
function parseDecisionId(id) {
  const raw = String(id || "");
  const separator = raw.indexOf(":");
  if (separator <= 0) return { source: "", nativeId: raw };
  return { source: raw.slice(0, separator), nativeId: raw.slice(separator + 1) };
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = "") {
  const string = typeof value === "string" ? value.trim() : "";
  return string || fallback;
}

/**
 * Deterministic global order: active before resolved, then severity, then the
 * soonest expiry, then the oldest, then a stable id tiebreak.
 */
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

/* ------------------------------------------------------------------ mappers */

function mapSessionState(state) {
  switch (state) {
    case "acting": return "acting";
    case "verifying": return "verifying";
    case "seen": return "acknowledged";
    case "recovered": return "resolved";
    default: return "pending";
  }
}

function mapSessionRecord(record) {
  const critical = record.severity === "critical";
  const isAgent = String(record.sessionId || "").startsWith("agent-");
  const created = num(record.createdAt, num(record.updatedAt, Date.now()));
  return {
    id: `session:${record.id}`,
    source: "session",
    type: critical ? "worker.failed" : "worker.attention",
    severity: SEVERITY_RANK[record.severity] != null ? record.severity : "warning",
    status: mapSessionState(record.state),
    title: `${text(record.sessionName, text(record.sessionId, "Worker"))} ${critical ? "failed" : "needs a decision"}`,
    target: {
      kind: isAgent ? "agent" : "worker",
      id: record.sessionId || null,
      label: text(record.sessionName, text(record.sessionId, "worker"))
    },
    evidence: text(record.reason, `Engine reports ${text(record.state, "attention")}.`),
    impact: "This is an engine-owned worker; acting changes its lifecycle.",
    actions: [
      { id: "inspect", label: "Inspect evidence", tone: "neutral", confirm: false, resolves: false },
      ...(critical ? [{ id: "restart", label: "Restart worker", tone: "primary", confirm: false, resolves: false }] : []),
      { id: "acknowledge", label: "Acknowledge", tone: "neutral", confirm: false, resolves: false }
    ],
    createdAt: created,
    expiresAt: null,
    resolution: record.state === "recovered"
      ? { decision: "recovered", at: num(record.recoveredAt, num(record.updatedAt, Date.now())), by: "engine" }
      : null,
    deepLink: { view: "workspace", params: { focus: record.sessionId || null } },
    origin: "engine",
    audit: Array.isArray(record.history)
      ? record.history.map(entry => ({ at: num(entry.at), event: text(entry.state, "state") }))
      : [],
    groupKey: record.groupKey || null,
    snoozedUntil: num(record.snoozedUntil, 0) || null,
    steps: []
  };
}

const APPROVAL_DEFAULTS = Object.freeze({
  severity: () => "warning",
  type: () => "approval",
  title: item => text(
    item.title,
    [item.action || item.operation, item.targetName || item.target].filter(Boolean).join(" · ")
  ) || "Approval requested",
  target: item => ({
    kind: "integration",
    id: item.targetId || null,
    label: text(item.targetName || item.client || item.deviceName || item.missionTitle, "integration")
  }),
  evidence: item => text(item.reason || item.actionLabel, "Authenticated request awaiting a local decision."),
  impact: item => text(item.impact, "Approving performs the request through EngineAPI. Denying performs no action."),
  deepLink: () => ({ view: "needs", params: {} })
});

// A "terminal-input" -> "Terminal input" style label for a plan action.
function planActionLabel(action) {
  const type = String((action && action.type) || "action").replace(/[-_]+/g, " ");
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function mapApprovalRecord(source, item, overrides = {}) {
  const opts = { ...APPROVAL_DEFAULTS, ...overrides };
  const active = item.state === "pending";
  const planActions = item.plan && Array.isArray(item.plan.actions) ? item.plan.actions : [];
  const steps = planActions.map(action => ({
    label: planActionLabel(action),
    reason: text(action.reason, ""),
    code: text(action.input || action.command, "")
  }));
  return {
    id: `${source}:${text(item.id, "unknown")}`,
    source,
    type: opts.type(item),
    severity: opts.severity(item),
    status: active ? "pending" : "resolved",
    title: opts.title(item),
    target: opts.target(item),
    evidence: opts.evidence(item),
    impact: opts.impact(item),
    actions: [
      { id: "approve", label: "Approve", tone: "primary", confirm: true, resolves: true },
      { id: "deny", label: "Deny", tone: "neutral", confirm: false, resolves: true }
    ],
    createdAt: num(item.createdAt, num(item.requestedAt, Date.now())),
    expiresAt: item.expiresAt == null ? null : num(item.expiresAt, null),
    resolution: active
      ? null
      : { decision: text(item.state, "resolved"), at: num(item.resolvedAt, num(item.updatedAt, Date.now())), by: "user" },
    deepLink: opts.deepLink(item),
    origin: "engine",
    audit: [],
    steps
  };
}

const SOURCE_OVERRIDES = Object.freeze({
  missionSupervisor: {
    type: () => "approval.plan",
    title: item => `Approve ${((item.plan && item.plan.actions) || []).length} supervisor action${((item.plan && item.plan.actions) || []).length === 1 ? "" : "s"}`,
    evidence: item => text(item.plan && item.plan.summary, "A validated multi-step plan is waiting for approval."),
    target: item => ({ kind: "integration", id: null, label: "Mission Supervisor" })
  },
  mission: {
    type: () => "approval.scopes",
    title: item => `Grant scopes to ${text(item.missionTitle, "an agent mission")}`,
    evidence: item => `Requested scopes: ${(item.requestedScopes || []).join(", ") || "unspecified"}.`,
    target: item => ({ kind: "mission", id: item.missionId || null, label: text(item.missionTitle, "mission") })
  },
  mcp: {
    type: () => "approval.mcp",
    title: item => `${text(item.action, "Action")} · ${text(item.targetName, "target")}`,
    target: item => ({ kind: "integration", id: null, label: text(item.client, "MCP client") }),
    deepLink: () => ({ view: "integrations", params: { section: "mcp" } })
  },
  automation: {
    type: () => "approval.automation",
    title: item => `${text(item.action && item.action.type, "Automation action")}`,
    target: item => ({ kind: "integration", id: item.automationId || null, label: text(item.automationName, "Automation") }),
    deepLink: () => ({ view: "integrations", params: { section: "automation" } })
  },
  mobile: {
    type: () => "approval.mobile",
    title: item => `${text(item.action, "Request")} · ${text(item.targetName, "target")}`,
    target: item => ({ kind: "integration", id: null, label: text(item.deviceName, "paired device") }),
    deepLink: () => ({ view: "integrations", params: { section: "mobile" } })
  }
});

/* ----------------------------------------------------------------- adapters */

async function runAdapter(id, load, map) {
  try {
    const raw = await load();
    const list = Array.isArray(raw)
      ? raw
      : Array.isArray(raw && raw.records) ? raw.records
      : Array.isArray(raw && raw.approvals) ? raw.approvals
      : [];
    const records = list.filter(Boolean).map(map).filter(Boolean);
    return { id, availability: "ready", records, error: null, lastSuccessAt: Date.now() };
  } catch (error) {
    return {
      id,
      availability: "error",
      records: [],
      error: error instanceof Error ? error.message : String(error),
      lastSuccessAt: null
    };
  }
}

function unavailable(id) {
  return { id, availability: "unavailable", records: [], error: null, lastSuccessAt: null };
}

function sessionAdapter(engineApi) {
  if (!engineApi || typeof engineApi.listAttention !== "function") return Promise.resolve(unavailable("session"));
  return runAdapter(
    "session",
    () => engineApi.listAttention(),
    record => (record && record.state !== "recovered" ? mapSessionRecord(record) : null)
  );
}

function approvalAdapterFrom(id, handle, method) {
  if (!handle || typeof handle[method] !== "function") return Promise.resolve(unavailable(id));
  const overrides = SOURCE_OVERRIDES[id] || {};
  return runAdapter(
    id,
    () => handle[method](),
    item => (item && item.state === "pending" ? mapApprovalRecord(id, item, overrides) : null)
  );
}

/**
 * @param {object} sources { engineApi, missionSupervisor, mcpGateway, mobileCompanion }
 * @returns {Promise<{records, sources, complete, counts}>}
 */
async function buildDecisionQuery(sources = {}) {
  const { engineApi, missionSupervisor, mcpGateway, mobileCompanion } = sources;
  const results = await Promise.all([
    sessionAdapter(engineApi),
    approvalAdapterFrom("missionSupervisor", missionSupervisor, "listApprovals"),
    approvalAdapterFrom("mission", engineApi, "listMissionApprovals"),
    approvalAdapterFrom("mcp", mcpGateway, "listApprovals"),
    approvalAdapterFrom("automation", engineApi, "listAutomations"),
    approvalAdapterFrom("mobile", mobileCompanion, "listApprovals")
  ]);

  const records = sortDecisions(results.flatMap(result => result.records));
  const bySource = results.map(result => ({
    id: result.id,
    availability: result.availability,
    lastSuccessAt: result.lastSuccessAt,
    error: result.error,
    pending: result.records.filter(record => ACTIVE_STATUSES.has(record.status)).length
  }));
  const active = records.filter(record => ACTIVE_STATUSES.has(record.status));
  const complete = bySource.every(source => source.availability === "ready" || source.availability === "unconfigured");

  return {
    records,
    sources: bySource,
    complete,
    counts: {
      pending: active.length,
      critical: active.filter(record => record.severity === "critical").length,
      byTarget: {
        agent: active.filter(record => record.target.kind === "agent").length,
        worker: active.filter(record => record.target.kind === "worker").length,
        integration: active.filter(record => record.target.kind === "integration" || record.target.kind === "mission").length
      }
    }
  };
}

module.exports = {
  SEVERITY_RANK,
  STATUS_RANK,
  ACTIVE_STATUSES,
  CONFIRMED_SOURCES,
  parseDecisionId,
  sortDecisions,
  mapSessionRecord,
  mapApprovalRecord,
  buildDecisionQuery
};
