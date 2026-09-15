"use strict";

// Four defects found on an annotated screenshot of the running app. Each was
// measured in the rendered renderer before it was fixed; these checks pin the
// cause, not just the symptom, so the same defect cannot quietly return.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const RENDERER = path.resolve(__dirname, "../src/groundstation/renderer");
const read = file => fs.readFileSync(path.join(RENDERER, file), "utf8");

test("the sidebar project switcher stacks its label above the project name", () => {
  const base = read("redesign/base.css");
  // A blanket display reset on every child outranked the rules that lay the
  // switcher out, so the label and name ran together on one line.
  assert.doesNotMatch(base, /\.top-project > \* \{ display:/, "a blanket display reset on the switcher's children has returned");
  // The unconditional icon-rail sizing pinned the switcher at a 40px square.
  assert.doesNotMatch(base, /\.top-project \{[^}]*height: 40px !important/, "the icon-rail height lock has returned");
  assert.match(base, /\.app-sidebar > \.top-project > div \{[^}]*display: flex;[^}]*flex-direction: column;/);
  // Stacked above its value, the label needs no colon.
  assert.match(read("App.jsx"), /<small>Project<\/small><strong>\{workspace\?\.name \|\| "Choose project"\}<\/strong>/);
});

test("Groundstation readings each carry their own edge and the health light keeps its core", () => {
  const screens = read("redesign/screens.css");
  const counts = screens.slice(
    screens.indexOf("#root#root .shell .mc-gs-counts {"),
    screens.indexOf("#root#root .shell .mc-gs-statusbar-actions")
  );
  const button = counts.match(/\.mc-gs-counts button \{([^}]*)\}/)[1];
  assert.match(button, /background: var\(--mc-surface-3\);/, "a reading has no surface of its own at rest");
  assert.match(button, /border: 1px solid var\(--mc-border\);/, "a reading has no border of its own at rest");
  assert.doesNotMatch(counts, /button \+ button::before/, "drawn separators have returned in place of real edges");
  assert.match(counts, /\.mc-gs-counts button\.is-active \{[^}]*border-color: var\(--mc-accent-line\);/);

  assert.match(screens, /\.mc-gs-statusbar \{[\s\S]{0,400}min-height: 78px;/);
  // The status-line rule must not reach the health light, which is also a span.
  assert.doesNotMatch(screens, /\.mc-gs-identity span \{/, "the status-line rule catches the health light again");
  assert.match(screens, /\.mc-gs-identity > div > span \{/);
});

// Pull the renderer's own dedupe out of DecisionList.jsx and run it, so this
// checks behaviour rather than wording.
function loadDedupe() {
  const list = read("DecisionList.jsx");
  const mapStart = list.indexOf("const DEEP_LINK_LABEL = {");
  const map = list.slice(mapStart, list.indexOf("};", mapStart) + 2);
  const fnStart = list.indexOf("function duplicatesAnAction(record) {");
  assert.notEqual(fnStart, -1, "duplicatesAnAction is missing from DecisionList.jsx");
  const fn = list.slice(fnStart, list.indexOf("\n}\n", fnStart) + 2);
  return new Function(`${map}\n${fn}\nreturn duplicatesAnAction;`)();
}

test("a decision never offers two controls that go to the same place", () => {
  const duplicatesAnAction = loadDedupe();
  const workspace = { view: "workspace", params: { focus: "api" } };

  // A terminal alert names "Open terminal" as its own action and again as its
  // deep link. The link must yield.
  const hook = read("useDecisions.js");
  assert.match(hook, /\{ id: "open", label: "Open terminal"/);
  assert.equal(duplicatesAnAction({ deepLink: workspace, actions: [{ label: "Open terminal" }, { label: "Dismiss" }] }), true);

  // A worker decision's actions are different words, so its link stays.
  assert.equal(duplicatesAnAction({ deepLink: workspace, actions: [{ label: "Inspect evidence" }, { label: "Acknowledge" }] }), false);
  assert.equal(duplicatesAnAction({ deepLink: { view: "needs" }, actions: [{ label: "Approve" }, { label: "Deny" }] }), false);

  const list = read("DecisionList.jsx");
  assert.match(list, /onOpenSource && record\.deepLink\?\.view && !repeatsAnAction/);
});

test("Open terminal opens a terminal instead of repeating Inspect evidence", () => {
  const app = read("App.jsx");
  // Inspect evidence still opens the worker's evidence dialog...
  assert.match(app, /if \(actionId === "inspect"\) \{ markSeen\(record\.id\); onFocus\(record\.target\?\.id\); return; \}/);
  // ...while the workspace deep link now reaches the terminal itself.
  assert.match(app, /if \(link\.view === "workspace" && link\.params\?\.focus\) \{ focusWorker\(link\.params\.focus\); return; \}/);
  assert.doesNotMatch(app, /if \(link\.view === "workspace" && link\.params\?\.focus\) \{ inspectWorker/);
  // A terminal alert's own "Open terminal" action does the same.
  assert.match(app, /else onOpenTerminal\?\.\(record\.target\?\.id\);/);
  assert.match(app, /<NeedsView [^>]*onOpenTerminal=\{focusWorker\}/);

  // The way back is navigation: full width, quieter than the decisions.
  const surfaces = read("redesign/surfaces.css");
  assert.match(surfaces, /\.decision-item__actions \.decision-deep-link \{[^}]*grid-column: 1 \/ -1;/);
});

test("a recipe with run history lays out exactly like one without", () => {
  const cockpit = read("redesign/cockpit.css");
  // Placement is stated per child, so a fourth child cannot displace the actions.
  assert.match(cockpit, /\.recipe-row > \.recipe-row-main \{ grid-area: 1 \/ 1; \}/);
  assert.match(cockpit, /\.recipe-row > \.recipe-flow \{ grid-area: 1 \/ 2; \}/);
  assert.match(cockpit, /\.recipe-row > footer \{ grid-area: 1 \/ 3; \}/);
  assert.match(cockpit, /\.recipe-row > \.recipe-run-history \{ grid-area: 2 \/ 1 \/ auto \/ -1; \}/);
  // Actions never wrap, and the launch verb cannot move the cluster.
  assert.match(cockpit, /\.recipe-row > footer button \{[^}]*white-space: nowrap;/);
  assert.match(cockpit, /\.recipe-row > footer \.btn-primary \{[^}]*min-width: 140px;/);
  // The single-column fallback releases the stated cells.
  assert.match(cockpit, /@media \(max-width: 900px\) \{[\s\S]*\.recipe-row > :is\(\.recipe-row-main, \.recipe-flow, footer, \.recipe-run-history\) \{ grid-area: auto; \}/);
  // The worker count and parallelism are never cut to an ellipsis.
  assert.doesNotMatch(cockpit, /\.recipe-row-main p \{[^}]*text-overflow: ellipsis/);
});
