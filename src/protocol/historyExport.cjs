"use strict";

// T114 - one history model. T113 - one sanitized way out of it.
//
// Three engine-owned records used to be reachable only on three different
// screens: activity events (History), decisions (Needs You) and recipe runs
// (Recipes). "What happened on this project" was therefore a question no single
// screen could answer. They are merged here into one row shape so one filter
// and one search cover all three, and so an export of "the history" is actually
// the history rather than a third of it.
//
// The export is built HERE rather than in the renderer for one reason: the
// redactor lives here. A renderer-side export would be a second, unaudited copy
// of the redaction rules, and the first field someone forgot to run through it
// would leave the machine inside a file.

const { redactText, scanText } = require("../service/contextSanitizer.cjs");

const KINDS = Object.freeze(["event", "decision", "recipe-run"]);
const FORMATS = Object.freeze(["json", "markdown"]);
const MAX_ROWS = 2000;

const RISK = /failed|error|attention|cancelled|denied/i;

function text(value, fallback = "") {
  const out = String(value ?? "").trim();
  return out || fallback;
}

function num(value, fallback = 0) {
  const out = Number(value);
  return Number.isFinite(out) ? out : fallback;
}

/* ------------------------------------------------------------- the one row */

// `at` is the only ordering key. `sequence` is kept when the source has one so
// the renderer can still address an activity event by the id it already uses.
function row(values) {
  return {
    id: text(values.id),
    kind: values.kind,
    at: num(values.at),
    sequence: Number.isInteger(values.sequence) ? values.sequence : null,
    actor: text(values.actor, "Workspace"),
    title: text(values.title, "Recorded change"),
    detail: text(values.detail),
    outcome: text(values.outcome),
    severity: values.severity === "critical" || values.severity === "warning" || values.severity === "info"
      ? values.severity
      : RISK.test(`${values.title} ${values.detail} ${values.outcome}`) ? "warning" : "info",
    correlationId: text(values.correlationId) || null,
    source: text(values.source, values.kind)
  };
}

function eventRows(activity) {
  // The original event travels with its row so the History inspector keeps the
  // fields only an activity event has (operation, exitCode, category,
  // evidence). The export never reads it: `redactRow` builds an explicit
  // object, so nothing can ride out of the machine on this field.
  return (Array.isArray(activity) ? activity : []).map(event => Object.assign(row({
    id: `event:${event.sequence ?? `${event.type}-${event.timestamp}`}`,
    kind: "event",
    at: num(event.timestamp),
    sequence: Number.isInteger(event.sequence) ? event.sequence : null,
    actor: event.name || event.id || event.sessionId || event.operation || "Workspace",
    title: text(event.type, "workspace event").replaceAll(":", " · ").replaceAll("-", " "),
    detail: text(event.reason),
    outcome: Number.isInteger(event.exitCode) ? `exit ${event.exitCode}` : text(event.status),
    correlationId: event.correlationId,
    source: "activity"
  }), { event }));
}

function decisionRows(records) {
  return (Array.isArray(records) ? records : []).map(record => row({
    id: `decision:${record.id}`,
    kind: "decision",
    // A resolved decision belongs in history at the moment it was decided; an
    // open one at the moment it was raised. Using createdAt for both would file
    // a decision made this minute under whenever it first appeared.
    at: num(record.resolution?.at, num(record.createdAt)),
    actor: text(record.target?.label, text(record.source, "decision")),
    title: text(record.title, "Decision"),
    detail: text(record.evidence),
    outcome: record.resolution?.decision
      ? `${record.resolution.decision}${record.resolution.by ? ` by ${record.resolution.by}` : ""}`
      : text(record.status, "pending"),
    severity: record.severity,
    source: text(record.source, "decision")
  }));
}

function recipeRunRows(recipes) {
  const rows = [];
  for (const recipe of Array.isArray(recipes) ? recipes : []) {
    const history = Array.isArray(recipe.runHistory) ? recipe.runHistory : [];
    for (const run of history) {
      const completedCount = Array.isArray(run.completed)
        ? run.completed.length
        : (Number.isInteger(run.completedSteps) ? run.completedSteps : 0);
      const failures = Array.isArray(run.failures) ? run.failures : [];
      const failedCount = failures.length || (Number.isInteger(run.failedSteps) ? run.failedSteps : 0);
      const rollbackPhase = typeof run.rollback === "object" && run.rollback?.phase
        ? run.rollback.phase
        : (typeof run.rollback === "string" ? run.rollback : null);
      const isRecovery = Boolean(run.recoveryOfRunId || run.recovery);

      rows.push(row({
        id: `recipe-run:${recipe.id}:${run.runId || run.id || run.startedAt}`,
        kind: "recipe-run",
        at: num(run.finishedAt, num(run.startedAt)),
        actor: text(recipe.name, text(recipe.id, "recipe")),
        title: `Recipe run · ${text(run.phase, "finished")}`,
        detail: [
          Number.isFinite(run.durationMs) ? `${Math.round(run.durationMs / 1000)}s` : "",
          `${completedCount} completed`,
          failedCount > 0 ? `${failedCount} failed` : "",
          isRecovery ? "recovery run" : "",
          rollbackPhase ? `rollback ${rollbackPhase}` : ""
        ].filter(Boolean).join(" · "),
        outcome: rollbackPhase ? `rollback ${rollbackPhase}` : text(run.phase),
        severity: failedCount > 0 ? "warning" : "info",
        source: "recipe"
      }));
    }
  }
  return rows;
}

/**
 * The unified model, newest first.
 *
 * A source that is absent contributes nothing and is reported as such, exactly
 * like the decision broker: an empty history from a source that failed to load
 * must never be indistinguishable from a source that had nothing to say.
 */
function buildHistoryModel({ activity, decisions, recipes } = {}) {
  const sources = [];
  const rows = [];

  const add = (id, produce) => {
    try {
      const produced = produce();
      rows.push(...produced);
      sources.push({ id, availability: "ready", count: produced.length });
    } catch (error) {
      sources.push({ id, availability: "error", count: 0, error: error?.message || String(error) });
    }
  };

  // `null` means the caller's read of that source FAILED. It is not the same
  // claim as an empty array and must never collapse into one: an export that
  // silently omits every decision is worse than one that says it could not
  // read them (the T047 rule, applied to history).
  add("activity", () => {
    if (activity === null) throw new Error("activity could not be read");
    return eventRows(activity);
  });
  add("decisions", () => {
    if (decisions === null) throw new Error("decisions could not be read");
    return decisionRows(decisions);
  });
  add("recipes", () => {
    if (recipes === null) throw new Error("recipes could not be read");
    return recipeRunRows(recipes);
  });

  rows.sort((a, b) => b.at - a.at || String(b.id).localeCompare(String(a.id)));
  const bounded = rows.slice(0, MAX_ROWS);

  return {
    rows: bounded,
    truncated: rows.length > bounded.length,
    total: rows.length,
    sources,
    complete: sources.every(source => source.availability === "ready"),
    counts: {
      event: bounded.filter(item => item.kind === "event").length,
      decision: bounded.filter(item => item.kind === "decision").length,
      "recipe-run": bounded.filter(item => item.kind === "recipe-run").length,
      risk: bounded.filter(item => item.severity !== "info").length
    }
  };
}

/* --------------------------------------------------------------- filtering */

function filterHistory(rows, { kind = "all", query = "", actor = "all" } = {}) {
  const term = String(query || "").trim().toLowerCase();
  return rows.filter(item => {
    if (kind === "risk" ? item.severity === "info" : kind !== "all" && item.kind !== kind) return false;
    if (actor !== "all" && item.actor !== actor) return false;
    if (!term) return true;
    return `${item.actor} ${item.title} ${item.detail} ${item.outcome} ${item.source}`.toLowerCase().includes(term);
  });
}

/* --------------------------------------------------------------- the export */

function redactRow(item, stats) {
  const clean = field => {
    const result = redactText(item[field] || "");
    stats.redactions += result.redactions;
    stats.truncations += result.truncations;
    return result.value;
  };
  for (const found of scanText(`${item.actor} ${item.title} ${item.detail} ${item.outcome}`)) {
    stats.found[found.label] = (stats.found[found.label] || 0) + found.count;
  }
  return {
    at: new Date(item.at).toISOString(),
    kind: item.kind,
    source: item.source,
    severity: item.severity,
    actor: clean("actor"),
    title: clean("title"),
    detail: clean("detail"),
    outcome: clean("outcome"),
    correlationId: item.correlationId
  };
}

function markdown(rows, meta) {
  const lines = [
    `# ${meta.project} — project history`,
    "",
    `Exported ${meta.exportedAt}. ${rows.length} record${rows.length === 1 ? "" : "s"}${meta.filterLabel ? ` (${meta.filterLabel})` : ""}.`,
    "",
    meta.complete
      ? "Every history source reported."
      : `Incomplete: ${meta.blindSources.join(", ")} did not report, so records from ${meta.blindSources.length === 1 ? "it" : "them"} are missing.`,
    "",
    meta.redactions > 0
      ? `${meta.redactions} value${meta.redactions === 1 ? " was" : "s were"} redacted before writing (${Object.keys(meta.found).join(", ") || "secret-shaped text"}).`
      : "No secret-shaped values were found in the exported fields.",
    "",
    "| When | Kind | Actor | What | Detail | Outcome |",
    "| --- | --- | --- | --- | --- | --- |"
  ];
  const cell = value => String(value || "").replaceAll("|", "\\|").replaceAll("\n", " ");
  for (const item of rows) {
    lines.push(`| ${item.at} | ${item.kind} | ${cell(item.actor)} | ${cell(item.title)} | ${cell(item.detail)} | ${cell(item.outcome)} |`);
  }
  lines.push("", "Terminal output is never exported. Every field above is an engine-recorded fact.");
  return `${lines.join("\n")}\n`;
}

/**
 * Render the filtered model as sanitized JSON or Markdown.
 *
 * The return value reports what was redacted and what was found, so the
 * operator decides whether to share the file knowing what was in it. Raw
 * terminal output is not part of the model and so cannot be exported at all.
 */
function exportHistory({ model, format = "json", filter = {}, project = "Project" } = {}) {
  if (!FORMATS.includes(format)) {
    throw new TypeError(`format must be one of ${FORMATS.join(", ")}`);
  }
  if (!model || !Array.isArray(model.rows)) throw new TypeError("model.rows is required");

  const selected = filterHistory(model.rows, filter);
  const stats = { redactions: 0, truncations: 0, found: {} };
  const rows = selected.map(item => redactRow(item, stats));
  const blindSources = (model.sources || []).filter(source => source.availability !== "ready").map(source => source.id);
  const exportedAt = new Date().toISOString();
  const filterLabel = [
    filter.kind && filter.kind !== "all" ? `kind: ${filter.kind}` : "",
    filter.actor && filter.actor !== "all" ? `actor: ${filter.actor}` : "",
    filter.query ? `search: ${filter.query}` : ""
  ].filter(Boolean).join(", ");

  const meta = {
    project,
    exportedAt,
    complete: blindSources.length === 0,
    blindSources,
    redactions: stats.redactions,
    truncations: stats.truncations,
    found: stats.found,
    filterLabel
  };

  const stamp = exportedAt.replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
  const slug = String(project).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

  const content = format === "markdown"
    ? markdown(rows, meta)
    : `${JSON.stringify({
        schema: "mission-control.history.v1",
        project,
        exportedAt,
        complete: meta.complete,
        blindSources,
        filter: { kind: filter.kind || "all", actor: filter.actor || "all", query: filter.query || "" },
        redaction: { values: stats.redactions, truncations: stats.truncations, found: stats.found },
        note: "Terminal output is never exported. Every field is an engine-recorded fact.",
        rows
      }, null, 2)}\n`;

  return {
    filename: `${slug}-history-${stamp}.${format === "markdown" ? "md" : "json"}`,
    mimeType: format === "markdown" ? "text/markdown" : "application/json",
    content,
    rowCount: rows.length,
    redactions: stats.redactions,
    truncations: stats.truncations,
    found: stats.found,
    complete: meta.complete,
    blindSources
  };
}

module.exports = { FORMATS, KINDS, MAX_ROWS, buildHistoryModel, exportHistory, filterHistory };
