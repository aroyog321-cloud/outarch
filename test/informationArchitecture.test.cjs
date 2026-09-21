"use strict";

// Phase 12 - Information architecture and product guardrails (T200, T201, T202, T220-T226).
//
// Every route in Mission Control has a single, coherent conceptual model that
// preserves operator trust, bounded resource usage, and predictable authority.
// This test suite locks those architectural contracts so future changes cannot
// scatter responsibilities, fabricate telemetry, or degrade information hierarchy.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
const read = (...parts) => fs.readFileSync(path.join(rendererRoot, ...parts), "utf8");

test("T220 - Groundstation IA: Health, Decisions, Worker register, Inspector, Activity, Run Recipe", () => {
  const app = read("App.jsx");

  // Groundstation view exists as core cockpit
  assert.match(app, /function LiveGroundstationView\(/);

  // Unified decision queue embedded on Groundstation
  assert.match(app, /<AttentionInbox[^>]*records=\{decisions\?\.records \|\| \[\]\}/);

  // Worker manifest with live status indicators
  assert.match(app, /mc-ref-groundstation/);
  assert.match(app, /mc-gs-register--operations/);

  // Inspector and activity
  assert.match(app, /<WorkerInspector session=\{selected\}/);
  assert.match(app, /<ActivityWaterline/);

  // Recipe launch entry point
  assert.match(app, /<ReferenceRecipePanel sessions=\{sessions\} onLaunch=\{onLaunchRecipe\}/);
});

test("T221 & T200 - Workspace IA: fast search, pane sets, layout/focus, bounded terminal grid, inspector", () => {
  const app = read("App.jsx");
  const layout = read("useTerminalLayout.js");

  // Fast worker search without mounting unneeded terminals (T200)
  assert.match(app, /className="workspace-worker-search"/);
  assert.match(app, /const showInPane = id => \{ terminalLayout\.setSlotSession\(focusedSlot, id\); onFocus\(id\); setQuery\(""\); \};/);

  // Off-canvas background workers strip
  assert.match(app, /<section className="workspace-background" aria-label="Workers not shown on the canvas">/);
  assert.match(app, /No terminal is mounted for these\./);

  // Stored named pane sets (bounded at 12 per project)
  assert.match(layout, /const MAX_PANE_SETS = 12;/);
  assert.match(app, /terminalLayout\.applyPaneSet\(set\.id\)/);

  // Canvas layouts (1-6 slots)
  assert.match(app, /const TERMINAL_LAYOUTS = \[|TERMINAL_LAYOUTS/);
  assert.match(layout, /slots:\s*1/);
  assert.match(layout, /slots:\s*6/);

  // Terminal inspector
  assert.match(app, /className=\{`workspace-experience \$\{inspectorOpen && !focusMode \? "has-inspector" : ""\}/);
  assert.match(app, /className=\{`context-inspector \$\{profile \? `role-\$\{profile\.key\}` : ""\}`\}/);
});

test("T222 - Needs You IA: All, Critical, Agents, Integrations, and resolved history as views of one queue", () => {
  const app = read("App.jsx");
  const decisions = read("useDecisions.js");
  const decisionList = read("DecisionList.jsx");

  // Unified broker queries all active decision categories
  assert.match(app, /value: "all", label: "All"/);
  assert.match(app, /value: "critical", label: "Critical"/);
  assert.match(app, /value: "agents", label: "Agents"/);
  assert.match(app, /value: "resolved", label: "Resolved"/);

  // Decision sources flow into one engine-owned model
  assert.match(decisions, /CONFIRMED_SOURCES = new Set\(\["missionSupervisor", "mission", "mcp", "automation", "mobile"\]\);/);
  assert.match(decisionList, /session: "Worker"/);
});

test("T223 - Agents IA: Roster, Inspector, Supervised missions, Checkpoints, Decisions", () => {
  const agents = read("AgentWorkspace.jsx");

  // Roster of supervised agents
  assert.match(agents, /className="agent-roster-list"/);
  assert.match(agents, /className="agent-roster-strip"/);

  // Selected-agent inspector
  assert.match(agents, /className="agent-operations__detail"/);

  // Observable checkpoints and verification authority
  assert.match(agents, /CHECKPOINT_CHOICES/);
  assert.match(agents, /confirmedRequest\("mission\.checkpoint\.verify"/);

  // Decisions for selected agent
  assert.match(agents, /function decisionsForAgent\(records, agent, missions\)/);

  // Direct terminal jump
  assert.match(agents, /onOpenTerminal\(selected\.id\)/);
});

test("T224 - Recipes IA: List, Create/Edit/Duplicate, Run state, Bounded run history, Recovery", () => {
  const recipesView = read("RecipesView.jsx");

  // Recipe steps and dependency flow
  assert.match(recipesView, /className="recipe-flow"/);

  // Create, Edit, Duplicate, Delete actions
  assert.match(recipesView, /Edit graph/);
  assert.match(recipesView, /Duplicate/);
  assert.match(recipesView, /Delete/);

  // Bounded run history with failure causes
  assert.match(recipesView, /details className="recipe-run-history"/);
  assert.match(recipesView, /recipe-run-history__failures/);

  // Rollback and recovery
  assert.match(recipesView, /recipe-run-history__rollback/);
  assert.match(recipesView, /Recover failed run/);
});

test("T225 - History IA: Merged timeline, Decisions, Recipe runs, Filters, Safe export", () => {
  const app = read("App.jsx");

  // Merged timeline of events, decisions and recipe runs
  assert.match(app, /missionApi\(\)\.request\("history\.model", \{ limit: 200 \}\)/);

  // Filters for kind, actor, search
  assert.match(app, /filter: \{ kind: filter, query, actor: actorFilter \}/);

  // Safe export with secret redaction
  assert.match(app, /function HistoryExport\(/);
  assert.match(app, /missionApi\(\)\.request\("history\.export",/);
});

test("T226 & T201 & T202 - Settings IA: 8 distinct groups, dedicated Diagnostics, distinct About", () => {
  const app = read("App.jsx");

  // The 8 distinct settings groups
  const groupsMatch = app.slice(app.indexOf("const SETTINGS_GROUPS = ["), app.indexOf("const SETTINGS_GROUP_KEY"));
  const expectedGroups = ["appearance", "terminal", "notifications", "project", "integrations", "security", "diagnostics", "about"];
  for (const group of expectedGroups) {
    assert.ok(groupsMatch.includes(`"${group}"`), `SETTINGS_GROUPS must include ${group}`);
  }

  // T201: Dedicated Diagnostics surface
  const diagnostics = app.slice(app.indexOf("function DiagnosticsSettings("), app.indexOf("function SecuritySettings("));
  assert.match(diagnostics, /Engine contract/);
  assert.match(diagnostics, /Workspace mode/);
  assert.match(diagnostics, /Recovery controller/);
  assert.match(diagnostics, /Recovery attempts/);

  // T202 & T197: Distinct About surface, and the auto-updater it now reports
  const about = app.slice(app.indexOf("function AboutSettings("), app.indexOf("const SETTINGS_GROUPS"));
  assert.match(about, /Application/);
  assert.match(about, /Engine contract/);
  assert.match(about, /Runtime/);
  assert.match(about, /Updates/);
  assert.match(about, /Automatic · signed releases, verified before they install/);
  assert.match(about, /<UpdatesPanel onConfirm=\{onConfirm\}\/>/);
  assert.match(about, /<ResourceLinks\/>/);
});

