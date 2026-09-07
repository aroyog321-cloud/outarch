"use strict";

// Phase 5 - History (T113, T114).
//
// T114 - activity events, decisions and recipe runs answered as ONE model, so
//        "what happened on this project" stops being three different screens.
// T113 - one sanitized way out of that model, built where the redactor lives.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const { buildHistoryModel, exportHistory, filterHistory } = require("../src/protocol/historyExport.cjs");
const { scanText } = require("../src/service/contextSanitizer.cjs");

const now = Date.UTC(2026, 8, 5, 12, 0, 0);

function sample() {
  return buildHistoryModel({
    activity: [
      { sequence: 4, type: "session:failed", timestamp: now - 1000, name: "Queue worker", reason: "exit 1", exitCode: 1 },
      { sequence: 5, type: "session:evidence", timestamp: now - 800, name: "Unit tests", category: "tests" }
    ],
    decisions: [
      {
        id: "session:att-1",
        source: "session",
        severity: "critical",
        status: "resolved",
        title: "Queue worker failed",
        evidence: "Redis refused the connection.",
        createdAt: now - 5000,
        resolution: { decision: "restarted", at: now - 2000, by: "user" },
        target: { kind: "worker", id: "worker", label: "Queue worker" }
      }
    ],
    recipes: [
      {
        id: "r1",
        name: "Morning stack",
        runHistory: [{ id: "run-1", phase: "completed", startedAt: now - 9000, finishedAt: now - 3000, durationMs: 6000, completedSteps: 3, failedSteps: 0 }]
      }
    ]
  });
}

test("T114 - one model merges activity, decisions and recipe runs, newest first", () => {
  const model = sample();
  assert.equal(model.rows.length, 4);
  assert.deepEqual(model.counts, { event: 2, decision: 1, "recipe-run": 1, risk: 2 });
  assert.equal(model.complete, true);

  // Ordered by when the thing happened, across all three kinds.
  const times = model.rows.map(row => row.at);
  assert.deepEqual(times, [...times].sort((a, b) => b - a));

  // A resolved decision is filed at the moment it was DECIDED, not raised:
  // using createdAt would file this minute's decision under last week.
  const decision = model.rows.find(row => row.kind === "decision");
  assert.equal(decision.at, now - 2000);
  assert.equal(decision.outcome, "restarted by user");

  // The original activity event travels with its row so the History inspector
  // keeps the fields only an activity event has.
  const event = model.rows.find(row => row.kind === "event" && row.sequence === 4);
  assert.equal(event.event.exitCode, 1);
  assert.equal(event.event.type, "session:failed");
});

test("T114 - one filter and one search cover every kind", () => {
  const model = sample();
  assert.equal(filterHistory(model.rows, { kind: "decision" }).length, 1);
  assert.equal(filterHistory(model.rows, { kind: "recipe-run" }).length, 1);
  assert.equal(filterHistory(model.rows, { kind: "event" }).length, 2);
  assert.equal(filterHistory(model.rows, { kind: "risk" }).length, 2);
  assert.equal(filterHistory(model.rows, { kind: "all" }).length, 4);

  // Search reaches across kinds, not just event types.
  assert.equal(filterHistory(model.rows, { query: "redis" }).length, 1);
  assert.equal(filterHistory(model.rows, { query: "morning" }).length, 1);
  assert.equal(filterHistory(model.rows, { actor: "Queue worker" }).length, 2);
});

test("T114 - a source that could not be read is reported, never counted as zero", () => {
  const model = buildHistoryModel({ activity: [], decisions: null, recipes: [] });
  assert.equal(model.complete, false);
  const decisions = model.sources.find(source => source.id === "decisions");
  assert.equal(decisions.availability, "error");
  assert.equal(decisions.count, 0);
  assert.match(decisions.error, /could not be read/);

  // The distinction has to survive into the export, or a file that is missing
  // every decision reads exactly like a project that never had one.
  const out = exportHistory({ model, format: "markdown" });
  assert.equal(out.complete, false);
  assert.deepEqual(out.blindSources, ["decisions"]);
  assert.match(out.content, /Incomplete: decisions did not report/);
});

test("T113 - the export redacts secrets and says what it found", () => {
  const model = buildHistoryModel({
    activity: [{
      sequence: 1,
      type: "session:failed",
      timestamp: now,
      name: "API gateway",
      reason: "auth failed for token=ghp_abcdefghijklmnopqrstuvwx1234 and Authorization: Bearer abcdefghijklmnop"
    }],
    decisions: [],
    recipes: []
  });

  for (const format of ["json", "markdown"]) {
    const out = exportHistory({ model, format, project: "Acme Console" });
    assert.ok(out.redactions >= 2, `expected redactions, got ${out.redactions}`);
    assert.doesNotMatch(out.content, /ghp_abcdefghijklmnopqrstuvwx1234/);
    assert.doesNotMatch(out.content, /Bearer abcdefghijklmnop/);
    assert.match(out.content, /REDACTED/);
    // The scan names what it found, so the operator decides knowing what was in it.
    assert.ok(Object.keys(out.found).length > 0);
    assert.match(out.filename, /^acme-console-history-.*\.(json|md)$/);
  }

  const json = JSON.parse(exportHistory({ model, format: "json" }).content);
  assert.equal(json.schema, "mission-control.history.v1");
  assert.match(json.note, /Terminal output is never exported/);
  // The raw event rides along in the model for the inspector; it must not ride
  // out in the file.
  assert.equal(json.rows[0].event, undefined);
});

test("T113 - the scan uses the same rule table as the redactor", () => {
  const found = scanText("token=ghp_abcdefghijklmnopqrstuvwx1234");
  assert.ok(found.length > 0);
  assert.ok(found.every(item => typeof item.label === "string" && item.count > 0));
  // Scanning must not consume the regex state and report clean on a second pass.
  assert.deepEqual(scanText("token=ghp_abcdefghijklmnopqrstuvwx1234"), found);
  assert.deepEqual(scanText("nothing secret here"), []);
});

test("T113 - an unknown format is rejected rather than silently guessed", () => {
  assert.throws(() => exportHistory({ model: sample(), format: "csv" }), /format must be one of/);
  assert.throws(() => exportHistory({ format: "json" }), /model\.rows is required/);
});

test("T113/T114 - the protocol exposes both, and the renderer reads the model rather than rebuilding it", () => {
  const protocol = fs.readFileSync(path.join(__dirname, "..", "src", "protocol", "index.cjs"), "utf8");
  assert.match(protocol, /"history\.model",/);
  assert.match(protocol, /"history\.export",/);
  assert.match(protocol, /case "history\.model":/);
  assert.match(protocol, /case "history\.export":/);
  // Neither is a confirmed method: reading and exporting history changes nothing.
  const confirmed = protocol.slice(protocol.indexOf("const CONFIRMED"), protocol.indexOf("const METHODS"));
  assert.doesNotMatch(confirmed, /history\./);

  const app = fs.readFileSync(path.join(__dirname, "..", "src", "groundstation", "renderer", "App.jsx"), "utf8");
  assert.match(app, /missionApi\(\)\.request\("history\.model", \{ limit: 200 \}\)/);
  assert.match(app, /missionApi\(\)\.request\("history\.export", \{/);
  // The renderer never assembles export content itself.
  assert.doesNotMatch(app, /function exportHistory|redactText\(/);
  // A failed model read leaves the worker events it already has, and says so.
  assert.match(app, /const ordered = historyModel \? historyModel\.rows\.map\(historyRow\) : \[\.\.\.events\]\.reverse\(\);/);
  assert.match(app, /The merged history could not be loaded/);
});

test("T203 - safe operational history export with user-visible redaction results", () => {
  const app = fs.readFileSync(path.join(__dirname, "..", "src", "groundstation", "renderer", "App.jsx"), "utf8");
  const exportBlock = app.slice(
    app.indexOf("function HistoryExport("),
    app.indexOf("function HistoryView(")
  );

  // Exposes bounded export options for JSON and Markdown
  assert.match(exportBlock, /button type="button"[^>]*onClick=\{\(\) => void run\("json"\)\}>\{busy === "json" \? "Preparing…" : "Copy JSON"\}<\/button>/);
  assert.match(exportBlock, /button type="button"[^>]*onClick=\{\(\) => void run\("markdown"\)\}>\{busy === "markdown" \? "Preparing…" : "Copy Markdown"\}<\/button>/);
  assert.match(exportBlock, /limit: 200/);

  // States user-visible redaction count and categorized types
  assert.match(exportBlock, /result\.redactions \? `\$\{result\.redactions\} secret-shaped value\$\{result\.redactions === 1 \? "" : "s"\} redacted \(\$\{Object\.keys\(result\.found\)\.join\(", "\)\}\)` : "no secret-shaped values found"/);

  // Surfaces incomplete blind sources rather than silently emitting partial records
  assert.match(exportBlock, /result\.complete \? "" : ` · incomplete: \$\{result\.blindSources\.join\(", "\)\} did not report`/);

  // Provides accessible textarea inspection and selection fallback
  assert.match(exportBlock, /<details className="history-export__content"/);
  assert.match(exportBlock, /<textarea readOnly value=\{result\.content\} aria-label=\{`Exported history, \$\{result\.filename\}`\}/);
});

