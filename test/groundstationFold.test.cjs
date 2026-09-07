"use strict";

// Phase 5 - Groundstation fold budget and decision lead (T101-T104).
//
// These lock the shape that the measurement harness proved, so the defects it
// found cannot come back silently:
//
//   T101/T102 - the long collections (activity, recipe catalog, mission graph)
//               live below the register in DOM order, evidence lives in the
//               contextual inspector, and the inspector is bounded by the
//               VIEWPORT rather than by an ancestor. Measured at 1440x900
//               before the fix the panel computed to 1305px tall in an 816px
//               window and its footer actions sat at y=1405; after it is 659px
//               with the footer at 776.
//   T103      - the globally most urgent record is shown, not just counted.
//   T104      - a clear queue still reports a fact and offers a next action.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
const read = (...parts) => fs.readFileSync(path.join(rendererRoot, ...parts), "utf8");

function groundstationView(app) {
  const start = app.indexOf("function LiveGroundstationView(");
  assert.ok(start > 0, "LiveGroundstationView is missing");
  const end = app.indexOf("\nfunction ", start + 1);
  return app.slice(start, end);
}

test("T102 - the above-fold order is health, decisions, register, then the contextual inspector", () => {
  const view = groundstationView(read("App.jsx"));
  const order = ["<GroundstationStatusBar", "<AttentionInbox", "mc-gs-register--operations", "<ManifestList", "<WorkerInspector"];
  let cursor = -1;
  for (const marker of order) {
    const at = view.indexOf(marker);
    assert.ok(at > cursor, `${marker} must follow ${order[order.indexOf(marker) - 1] || "the start of the view"} in DOM order`);
    cursor = at;
  }
});

test("T101 - the long collections render after the worker register, never above it", () => {
  const view = groundstationView(read("App.jsx"));
  const register = view.indexOf("mc-gs-register--operations");
  const lowerGrid = view.indexOf("mc-ref-lower-grid");
  assert.ok(register > 0 && lowerGrid > register, "activity, recipes and the mission graph must sit below the register");

  // Each of the collections T101 names is inside that lower grid, not above it.
  const lower = view.slice(lowerGrid);
  for (const marker of ["<ActivityWaterline", "<ReferenceRecipePanel", "mc-ref-graph"]) {
    assert.ok(lower.includes(marker), `${marker} must live in the lower grid`);
  }

  // Evidence is the contextual-inspector half of T101: it is reached by
  // selecting a worker, not by scrolling past it on the way to the register.
  const inspector = read("App.jsx");
  const inspectorStart = inspector.indexOf("function WorkerInspector(");
  const inspectorBody = inspector.slice(inspectorStart, inspector.indexOf("\nfunction ", inspectorStart + 1));
  assert.match(inspectorBody, /RECENT EVIDENCE/);
  assert.match(inspectorBody, /mc-gs-inspector-evidence/);
});

test("T101 - the worker inspector is bounded by the viewport, not by a containing ancestor", () => {
  const screens = read("redesign", "screens.css");
  const rule = screens.slice(screens.indexOf("it is `sticky`, not `fixed`"));
  assert.ok(rule.length > 0, "the inspector rule must record why it is sticky");

  const blockStart = rule.indexOf(".mc-gs-inspector {");
  const block = rule.slice(blockStart, rule.indexOf("}", blockStart));
  assert.match(block, /position: sticky;/);
  assert.match(block, /max-height: calc\(100dvh/, "the height ceiling must be measured against the viewport");
  assert.match(block, /overflow-y: auto;/, "a bounded panel must be able to scroll itself");
  assert.doesNotMatch(block, /position: fixed/, "two ancestors establish a containing block, so `fixed` is not viewport-relative here");

  // The overlay keeps the manifest width: both children share one grid cell.
  assert.match(screens, /\.has-inspector \.mc-gs-main,\s*\n\s*#root#root \.shell \.mc-ref-groundstation\.has-inspector \.mc-gs-inspector \{\s*\n\s*grid-area: 1 \/ 1;/);
});

test("T103 - the globally most urgent decision is shown, and it comes from the unified list", () => {
  const app = read("App.jsx");
  assert.match(app, /function MostUrgentDecision\(/);
  assert.match(app, /MOST URGENT/);

  const inbox = app.slice(app.indexOf("function AttentionInbox("), app.indexOf("function ManifestToolbar("));
  // The lead is the first ACTIVE record of the already-sorted unified query.
  // Re-sorting here would let Groundstation disagree with Needs You.
  assert.match(inbox, /records\.find\(record => ACTIVE_DECISION_STATUSES\.has\(record\.status\)\)/);
  assert.doesNotMatch(inbox, /records\.sort|\[\.\.\.records\]\.sort/, "the inbox must not re-rank the engine's order");

  // A worker lead is already previewed as a row; an integration lead was the
  // case the worker-only preview could count but never show.
  assert.match(inbox, /lead && lead\.source !== "session" && <MostUrgentDecision/);

  // Source completeness travels with it, through the same component Needs You uses.
  assert.match(inbox, /<DecisionSourceStrip status=\{decisionsStatus\} sources=\{sources\} onRetry=\{onRefresh\}\/>/);
  assert.match(app, /records=\{decisions\?\.records \|\| \[\]\}/);
  assert.match(app, /sources=\{decisions\?\.sources \|\| \[\]\}/);
});

test("T103 - Groundstation and Needs You name a decision source the same way", () => {
  const list = read("DecisionList.jsx");
  assert.match(list, /export function decisionSourceLabel\(record\)/);
  assert.match(list, /export function decisionDeepLinkLabel\(record\)/);

  const app = read("App.jsx");
  assert.match(app, /import \{ DecisionList, decisionDeepLinkLabel, decisionSourceLabel \} from "\.\/DecisionList\.jsx";/);
  // No second copy of the maps in App.jsx.
  assert.doesNotMatch(app, /const SOURCE_LABEL = \{/);
  assert.doesNotMatch(app, /const DEEP_LINK_LABEL = \{/);
});

test("T104 - a clear queue reports a fact and offers a next action without inventing urgency", () => {
  const app = read("App.jsx");
  assert.match(app, /function AttentionClear\(/);
  assert.match(app, /NOTHING WAITING/);

  const step = app.slice(app.indexOf("function nextStep("), app.indexOf("function AttentionClear("));
  // Every branch is read off engine-reported state: configured workers, alive
  // workers, recorded activity. Nothing estimates progress or time.
  assert.match(step, /workers\.filter\(session => !session\.isAlive\)/);
  assert.match(step, /No workers are configured in this project\./);
  assert.match(step, /Every decision source reported and nothing is waiting\./);
  assert.doesNotMatch(step, /%|urgent|soon|overdue|estimated/i, "the clear state must not invent urgency or telemetry");

  // It renders only when there is genuinely nothing waiting.
  assert.match(app, /\{!attention\.length && !needsCount && <AttentionClear/);
});
