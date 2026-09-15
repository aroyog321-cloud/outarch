const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..", "src", "groundstation", "renderer");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("2.19 surfaces layer establishes a readable integration type floor and loads last", () => {
  const main = read("main.jsx");
  const surfaces = read(path.join("redesign", "surfaces.css"));
  assert.ok(main.indexOf('import "./redesign/surfaces.css"') > main.indexOf('import "./redesign/cockpit.css"'));
  assert.match(surfaces, /--mc-type-caption:\s*\.75rem/);
  assert.match(surfaces, /--mc-type-control:\s*\.8125rem/);
  assert.match(surfaces, /\.vscode-bridge-settings/);
  assert.match(surfaces, /\.mobile-companion-settings/);
  assert.match(surfaces, /\.mission-ai-screen/);
});

test("Groundstation readings use semantic surfaces and text in every theme", () => {
  const screens = read(path.join("redesign", "screens.css"));
  const readings = screens.slice(
    screens.indexOf("#root#root .shell .mc-gs-counts {"),
    screens.indexOf("#root#root .shell .mc-gs-statusbar-actions")
  );

  assert.match(readings, /background: color-mix\(in srgb, var\(--mc-surface\) 88%, transparent\) !important/);
  assert.match(readings, /color: var\(--mc-text\) !important/);
  assert.doesNotMatch(readings, /#fff|rgba\(14, 17, 23|rgba\(255, 255, 255/);
});

test("trust boundaries use native disclosure and replace repeated authority prose", () => {
  const trust = read("TrustBoundary.jsx");
  assert.match(trust, /<section/);
  assert.match(trust, /<details>/);
  assert.match(trust, /<summary>View access and authority<\/summary>/);
  // Mission AI states its authority where it acts — the approval card and the
  // composer — rather than in a boundary card above an empty conversation.
  assert.doesNotMatch(read("MissionAIScreen.jsx"), /<TrustBoundary/);
  assert.match(read("AssistantChat.jsx"), /aria-label="Approve what the assistant wants to do"/);
  assert.match(read("IntegrationsView.jsx"), /<TrustBoundary/);
  assert.match(read("PluginPlatform.jsx"), /Mission Control renders every contribution/);
});

test("Needs You sources share one normalized decision item grammar", () => {
  const decision = read("DecisionItem.jsx");
  for (const field of ["severity", "source", "evidence", "impact", "recommendedAction", "expiry", "lifecycle", "recovery"]) assert.match(decision, new RegExp(field));
  // Exactly one component renders decisions now — the unified DecisionList. Every
  // source is normalized upstream by the broker, not by a per-integration queue.
  assert.match(read("DecisionList.jsx"), /<DecisionItem/);
  for (const file of ["AgentWorkspace.jsx", "MissionAI.jsx", "McpGateway.jsx", "AutomationWorkflows.jsx", "MobileCompanion.jsx", "PluginPlatform.jsx"]) {
    assert.doesNotMatch(read(file), /<DecisionItem/, `${file} must not render its own decision queue`);
  }
  const broker = fs.readFileSync(path.resolve(__dirname, "..", "src", "protocol", "decisionBroker.cjs"), "utf8");
  for (const source of ["missionSupervisor", "mission", "mcp", "automation", "mobile", "plugin"]) assert.match(broker, new RegExp(`"${source}"`));
  assert.doesNotMatch(decision, /bulk|select all|approve all/i);
});

test("Needs You shows a completeness signal so an empty queue is never mistaken for a dead source", () => {
  const app = read("App.jsx");
  const strip = read("DecisionSourceStrip.jsx");
  const hook = read("useDecisions.js");
  // The unified query is read and threaded into Needs You.
  assert.match(app, /useDecisions\(terminalAlerts, sessions\)/);
  assert.match(app, /<DecisionSourceStrip status=\{decisionsStatus\}/);
  assert.match(app, /<DecisionList records=\{visible\}/);
  assert.match(hook, /request\("decisions\.list"\)/);
  // A failed/absent source is surfaced, not silently zeroed.
  assert.match(strip, /failed to load/);
  assert.match(strip, /unavailable/);
  assert.match(strip, /Showing decisions from/);
  // The header hedges the count when the query is incomplete.
  assert.match(app, /At least /);
  assert.match(app, /queue below may be incomplete/);
});

test("plugin contribution slots render only normalized data with renderer-owned markup", () => {
  const component = read("PluginContributionSlot.jsx");
  const platform = fs.readFileSync(path.resolve(__dirname, "..", "src", "service", "pluginPlatformStore.cjs"), "utf8");
  assert.match(component, /enabledContributions/);
  assert.match(component, /plugin\.manifest\.contributions/);
  assert.match(component, /plugin\.grantedPermissions/);
  assert.doesNotMatch(component, /dangerouslySetInnerHTML/);
  assert.match(platform, /PLUGIN_CONTRIBUTION_SURFACES/);
  assert.match(platform, /Unsupported plugin contribution field/);
  assert.match(read("App.jsx"), /surface="health\.status"/);
  assert.match(read("App.jsx"), /surface="context\.resource"/);
  assert.match(read("PluginPlatform.jsx"), /surface="settings\.summary"/);
});

test("premium foundations ship fonts, real density geometry, shaped loading, and stacked notices", () => {
  const main = read("main.jsx");
  const base = read(path.join("redesign", "base.css"));
  const surfaces = read(path.join("redesign", "surfaces.css"));
  const toast = read("ToastSystem.jsx");
  assert.match(main, /@fontsource-variable\/inter\/wght\.css/);
  assert.match(main, /@fontsource-variable\/jetbrains-mono\/wght\.css/);
  assert.match(base, /--mc-manifest-row-height: 40px/);
  assert.match(base, /--mc-manifest-row-height: 54px/);
  assert.match(surfaces, /mc-skeleton-row/);
  assert.match(toast, /createdAt: Date\.now\(\)/);
  assert.match(toast, /prev\.slice\(-4\)/);
  assert.doesNotMatch(read("App.jsx"), /className="toast"/);
});

test("previously unused protocol surfaces are reachable without widening renderer authority", () => {
  const app = read("App.jsx");
  const context = read("ContextSnapshotButton.jsx");
  const audit = read("IntegrationAuditLog.jsx");
  assert.match(app, /request\("preset\.list"\)/);
  assert.match(context, /request\("context\.snapshot", \{ includeOutput: false \}\)/);
  assert.match(audit, /mobile\.audit\.list/);
  assert.match(audit, /mcp\.audit\.list/);
  assert.match(audit, /plugin\.audit\.list/);
});

test("desktop chrome and pending badge stay behind a bounded preload method", () => {
  const electronMain = fs.readFileSync(path.resolve(__dirname, "..", "src", "groundstation", "main", "index.cjs"), "utf8");
  const preload = fs.readFileSync(path.resolve(__dirname, "..", "src", "groundstation", "preload", "index.cjs"), "utf8");
  assert.match(electronMain, /titleBarStyle: "hidden"/);
  assert.match(electronMain, /titleBarOverlay/);
  assert.match(electronMain, /setOverlayIcon/);
  assert.match(electronMain, /count > 999/);
  assert.match(preload, /setPendingBadge/);
  assert.match(read("App.jsx"), /setPendingBadge\?\.\(pendingCount\)/);
});

test("visual acceptance harness covers every route, theme, and target width", () => {
  const packageJson = fs.readFileSync(path.resolve(__dirname, "..", "package.json"), "utf8");
  const capture = fs.readFileSync(path.resolve(__dirname, "..", "scripts", "visual", "capture-groundstation-matrix.cjs"), "utf8");
  const electronMain = fs.readFileSync(path.resolve(__dirname, "..", "src", "groundstation", "main", "index.cjs"), "utf8");
  assert.match(packageJson, /"groundstation:capture"/);
  // Agents was removed as a destination, so the capture matrix no longer walks it.
  for (const route of ["groundstation", "workspace", "needs", "recipes", "history", "integrations", "settings"]) {
    assert.match(electronMain, new RegExp(`"${route}"`));
  }
  for (const theme of ["orbital", "solar", "contrast"]) assert.match(electronMain, new RegExp(`"${theme}"`));
  for (const width of [720, 800, 960, 1280, 1600]) assert.match(electronMain, new RegExp(`\\b${width}\\b`));
  assert.match(electronMain, /\{ width: 800, height: 680, label: "800x680" \}/);
  assert.match(electronMain, /\{ width: 960, height: 680, label: "960x680" \}/);
  assert.match(capture, /MISSION_CONTROL_VISUAL_CAPTURE_DIR/);
  assert.match(capture, /mkdtempSync/);
  assert.match(capture, /autoStart: false/);
  assert.match(capture, /\[main, "--config", fixturePath\]/);
  assert.match(electronMain, /MISSION_CONTROL_VISUAL_CAPTURE_DIR/);
  assert.match(electronMain, /disableHardwareAcceleration/);
});

// T123 — Restore defaults previews its exact scope, is inert when there is
// nothing to restore, and confirms only when the reset destroys something the
// user cannot get back.
test("Restore defaults previews its scope and confirms only real data loss", () => {
  const app = read("App.jsx");
  const hook = read("useInterfacePreferences.js");
  const screens = read(path.join("redesign", "screens.css"));

  // The scope comes from the defaults module that owns it, not a hand-kept list.
  assert.match(hook, /export function describePreferenceReset\(preferences\)/);
  assert.match(hook, /\.filter\(field => preferences\?\.\[field\] !== DEFAULT_INTERFACE_PREFERENCES\[field\]\)/);
  assert.match(hook, /discardsScrollback = Number\(preferences\?\.terminalScrollback\) > DEFAULT_INTERFACE_PREFERENCES\.terminalScrollback/);

  // The footer names the affected settings and what stays untouched.
  assert.match(app, /Restoring defaults will change \{changed\.length\} setting/);
  assert.match(app, /\{changed\.join\(", "\)\}/);
  assert.match(app, /Engine configuration, credentials, project state and running PTYs are not affected\./);
  assert.match(app, /Every setting is already at its default\./);

  // Nothing to restore means the control is inert, not a no-op that looks live.
  assert.match(app, /const pristine = changed\.length === 0;/);
  assert.match(app, /onClick=\{onReset\} disabled=\{pristine\}/);
  assert.match(app, /aria-describedby="settings-reset-preview"/);
  assert.match(app, /<small id="settings-reset-preview"/);

  // A restyle applies directly; discarding scrollback takes the shared ceremony.
  assert.match(app, /if \(!changed\.length\) return;/);
  assert.match(app, /if \(!discardsScrollback\) \{ resetPreferences\(\); return; \}/);
  assert.match(app, /setConfirmation\(\{\s*title: "Restore default settings\?"/);
  assert.match(app, /discards buffered output already held by mounted terminal panes/);
  assert.match(app, /Discarded terminal scrollback cannot be recovered\./);
  assert.match(app, /onReset=\{requestPreferenceReset\}/);

  // The preview is legible: the base footer's 9px caption size does not apply.
  assert.match(screens, /#root#root \.shell \.settings-reset-preview \{[^}]*font-size: 12px;/);
  assert.match(screens, /#root#root \.shell \.settings-footer button:disabled \{[^}]*cursor: not-allowed;/);
});

// T068 — a decision is never a dead end, and what was decided is kept.
test("Needs You keeps a resolved history and can open every decision's source", () => {
  const app = read("App.jsx");
  const list = read("DecisionList.jsx");

  // Resolved records are their own bounded, newest-first view.
  assert.match(app, /const resolvedRecords = decisionRecords/);
  assert.match(app, /\.filter\(record => !ACTIVE_DECISION_STATUSES\.has\(record\.status\)\)/);
  assert.match(app, /\.slice\(0, 25\);/, "resolved history must stay bounded");
  // T151 - the queue filters are one `FilterGroup`; "resolved" is an option
  // value passed to `setFilter` rather than four hand-written buttons.
  assert.match(app, /\{ value: "resolved", label: "Resolved", count: resolvedRecords\.length \}/);
  assert.match(app, /<FilterGroup label="Filter decisions" value=\{filter\} onChange=\{setFilter\}/);
  assert.match(app, /const showingResolved = filter === "resolved";/);

  // A resolved row is read-only: it reports its outcome and offers no action
  // that would resolve it again.
  assert.match(list, /\{!resolved && record\.actions\.map/);
  assert.match(list, /resolved \? resolutionLabel\(record\) : expiryLabel\(record\)/);
  assert.match(list, /function resolutionLabel\(record\)/);
  assert.match(app, /onSnooze=\{showingResolved \? undefined : snooze\}/);
  // Its own empty state, not a borrowed one.
  assert.match(app, /Nothing has been resolved yet/);

  // Deep links come from the engine's record, so a new source needs no renderer change.
  assert.match(list, /onOpenSource && record\.deepLink\?\.view/);
  assert.match(app, /const openDecisionSource = React\.useCallback\(record => \{/);
  assert.match(app, /if \(link\.view === "workspace" && link\.params\?\.focus\)/);
  assert.match(app, /if \(link\.view === "integrations"\)/);
  assert.match(app, /onOpenSource=\{openDecisionSource\}/);
});

// T070 — "Healthy" is a claim about the whole project and may not be made on
// partial evidence.
test("project health is derived from decision-source completeness, not just sessions", () => {
  const app = read("App.jsx");
  const health = app.slice(app.indexOf("function healthFor("), app.indexOf("function needsAttention("));

  assert.match(health, /function healthFor\(sessions, workspace, decisions\)/);
  // A source that errored or is unavailable makes the view incomplete.
  assert.match(health, /source\.availability === "error" \|\| source\.availability === "unavailable"/);
  assert.match(health, /decisions\.complete !== false && blindSources\.length === 0/);
  // Known failure outranks unknown; unknown outranks green.
  const degradedAt = health.indexOf('label: "Degraded"');
  const partialAt = health.indexOf('label: "Partial view"');
  const healthyAt = health.indexOf('label: "Healthy"');
  assert.ok(degradedAt > -1 && partialAt > -1 && healthyAt > -1);
  assert.ok(degradedAt < partialAt, "a known failure must be reported before an unknown");
  assert.ok(partialAt < healthyAt, "Healthy must never be reachable while a source is blind");
  assert.match(health, /Every decision source reported and nothing is waiting/);
  // Both call sites pass the decision query.
  assert.match(app, /healthFor\(sessions, workspace, decisions\)/);
  assert.match(app, /healthFor\(supervisedSessions, workspace, decisions\)/);
});
