const assert = require("node:assert/strict");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { test } = require("node:test");

const moduleUrl = pathToFileURL(
  path.resolve(__dirname, "../src/groundstation/renderer/missionApi.js")
).href;
const workerFormUrl = pathToFileURL(
  path.resolve(__dirname, "../src/groundstation/renderer/workerForm.js")
).href;
const terminalLayoutUrl = pathToFileURL(
  path.resolve(__dirname, "../src/groundstation/renderer/useTerminalLayout.js")
).href;


// T154 — reduced motion is owned by one layer, not repeated per stylesheet.
// Any component test that used to assert its own copy now asserts the owner.
function assertReducedMotionIsCentral() {
  const owner = fs.readFileSync(path.resolve(__dirname, "..", "src", "groundstation", "renderer", "redesign", "surfaces.css"), "utf8");
  assert.match(owner, /@media \(prefers-reduced-motion: reduce\)/, "the redesign surface layer owns the OS preference");
  assert.match(owner, /\.shell\.motion-reduced,/, "and the in-app Motion setting resolves to the same rule");
  assert.match(owner, /--mc-duration-fast: 0ms;/, "stilling the duration tokens is what stops token-driven motion");
}

test("Groundstation product experience keeps the intentional navigation and Mission Command", () => {
  const appSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../src/groundstation/renderer/App.jsx"),
    "utf8"
  );
  const workerDialogSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../src/groundstation/renderer/WorkerDialog.jsx"),
    "utf8"
  );

  for (const section of ["Groundstation", "Workspace", "Needs You", "Recipes", "History", "Settings"]) {
    assert.match(appSource, new RegExp(`\\[\\\"[^\\\"]+\\\", \\\"${section}\\\"`));
  }
  for (const destination of ["Switch project"]) {
    assert.match(appSource, new RegExp(`\\[\\\"[^\\\"]+\\\", \\\"${destination}\\\"`));
  }
  for (const removedPrimaryPage of ["Overview", "Terminals", "Activity", "Logs"] ) {
    assert.doesNotMatch(appSource, new RegExp(`\\[\\\"[^\\\"]+\\\", \\\"${removedPrimaryPage}\\\"`));
  }
  for (const contextualOnlyPage of ["Tasks", "Git", "Tests", "Builds", "Docker", "Database", "Workers"]) {
    assert.doesNotMatch(appSource, new RegExp(`\\[\\s*\\\"[^\\\"]+\\\",\\s*\\\"${contextualOnlyPage}\\\"`));
  }
  assert.match(appSource, /Notification policy is managed in Settings/);
  assert.match(appSource, /function NotificationSettings/);
  assert.match(appSource, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(appSource, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(appSource, /event\.key\.toLowerCase\(\) === "n"/);
  assert.match(appSource, /Alt G/);
  // The create path is two fields — a name and a start command. The Frontend /
  // Backend / Git / Docker templates were removed on purpose, so their absence
  // is the assertion now.
  assert.match(workerDialogSource, /label="Start command"/);
  assert.doesNotMatch(workerDialogSource, /QUICK START/);
  assert.doesNotMatch(workerDialogSource, /Frontend dev/);
  assert.doesNotMatch(workerDialogSource, /Docker stack/);
  assert.match(appSource, /mc-ref-groundstation/);
  assert.match(appSource, /AttentionInbox/);
  assert.match(appSource, /decisionFor/);
  assert.match(appSource, /Evidence/);
  assert.match(
    fs.readFileSync(path.resolve(__dirname, "../src/protocol/decisionBroker.cjs"), "utf8"),
    /Restart worker/
  );
  assert.match(appSource, /function GroundstationOnboarding/);
  assert.match(appSource, /Open your first terminal/);
  assert.match(appSource, /ReferenceRecipePanel/);
  assert.match(appSource, /Command\.Group/);
  assert.match(appSource, /WORKER INTELLIGENCE/);
  assert.match(appSource, /SOURCE CONTROL/);
  assert.match(appSource, /working tree clean/);
  assert.match(appSource, /gitChanges/);
  assert.match(appSource, /AI crew/);
  assert.match(appSource, /WORKER FOCUS/);
  assert.match(appSource, /QUICK LOOK · HOLD SPACE/);
  assert.match(appSource, /event\.code !== "Space"/);
  assert.match(appSource, /Release Space to close/);
  assert.match(appSource, /TERMINAL WORKSPACE/);
  assert.match(appSource, /CANVAS LAYOUT/);
  assert.match(appSource, /Add terminal worker/);
  assert.match(appSource, /Create worker/);
  assert.match(appSource, /pendingWorkspaceWorker/);
  assert.match(appSource, /added to the terminal workspace/);
  assert.match(appSource, /Start all idle workers/);
  assert.match(appSource, /Stop all running workers/);
  assert.match(appSource, /Stop workspace/);
  assert.match(appSource, /executeBulk/);
  assert.match(appSource, /Selected worker/);
  assert.match(appSource, /Choose existing/);
  assert.match(appSource, /Restart worker/);
  assert.doesNotMatch(appSource, /<select/);
  assert.match(appSource, /What is happening/);
  assert.match(appSource, /function sessionSummary/);
  assert.match(appSource, /ActivityWaterline/);
  assert.match(appSource, /Terminal history/);
  assert.match(appSource, /Review agent/);
  assert.match(workerDialogSource, /Add worker/);
  assert.match(appSource, /onNavigate\("agents"\)/);
  // The Agents route renders AgentWorkspace; the old inline AgentsView is deleted (T180).
  assert.match(appSource, /<AgentWorkspace sessions=/);
  assert.doesNotMatch(appSource, /function AgentsView\(/);
  assert.doesNotMatch(appSource, /function IntegrationsView\(\)/);
  assert.match(appSource, /Risks & attention/);
  assert.match(appSource, /function needsAttention\(session\)/);
  assert.match(appSource, /No matching history/);
  assert.match(appSource, /ENGINE EVIDENCE/);
  assert.match(appSource, /RUN CHAPTERS/);
  assert.match(appSource, /Correlation-backed/);
  assert.match(appSource, /Structured evidence is stored without raw terminal output/);
  assert.match(appSource, /Search event, actor, reason/);
  assert.match(appSource, /RECORDED EVIDENCE/);
  assert.match(appSource, /durable timeline of worker changes and verified operational facts/);
  // T049 — a failed project-memory load must render a distinct notice, not read as "no memory yet".
  assert.match(appSource, /setMemoryError/);
  assert.match(appSource, /history-memory-error/);
  assert.match(appSource, /Project memory could not be loaded/);
  assert.doesNotMatch(
    appSource,
    /request\("memory\.summary"[^;]*\.catch\(\(\) => \{\}\)/,
    "memory.summary load failure must not be swallowed"
  );
  assert.match(appSource, /SINCE YOU LAST CHECKED/);
  assert.match(appSource, /mission-control\.history-cursor\.v1/);
  assert.match(appSource, /Mark reviewed/);
  // Agent creation flow (the inline AgentsView is gone — T180 — but App still owns createAgent).
  assert.match(appSource, /request\("agent\.create", \{ adapterId \}\)/);
  assert.match(appSource, /sessionId: createdSessionId, action: \{ type: "start" \}/);
  // Agents say only what their CLI reported, never an invented progress figure.
  // This once matched agentPhase(), which nothing rendered after T180 and was
  // removed as dead code; the live wording is AGENT_STATE_COPY.
  assert.match(appSource, /idle: \{ label: "Idle", full: "Idle — nothing reported since its last turn"/);
  assert.doesNotMatch(appSource, /68%|Mark resolved|window\.confirm/);
  assert.match(appSource, /ConfirmationDialog/);
  assert.match(appSource, /from "cmdk"/);
  assert.match(appSource, /<Command\.Item/);
  assert.doesNotMatch(appSource, /fuzzyCommandScore/);
  assert.match(appSource, /mission-control\.command-recents\.v1/);
  assert.match(appSource, /Fuzzy search · Engine-safe actions only/);
  assert.match(appSource, /@radix-ui\/react-alert-dialog/);
  assert.match(appSource, /@radix-ui\/react-dropdown-menu/);
  assert.match(appSource, /function ResourceLinks/);
  assert.match(appSource, /terminalPreferences=\{preferences\}/);
  assert.match(appSource, /terminalFontSize=\{terminalPreferences\.terminalFontSize\}/);
  assert.match(appSource, /terminalTheme=\{terminalPreferences\.terminalTheme\}/);
  assert.match(appSource, /terminalCursor=\{terminalPreferences\.terminalCursor\}/);
  assert.match(appSource, /terminalScrollback=\{terminalPreferences\.terminalScrollback\}/);
  assert.match(appSource, /project\.status === "uninitialized"/);
  assert.match(appSource, /project\.initialize/);
  assert.match(appSource, /terminals and agents now use this folder/);
  assert.match(appSource, /Choose a project folder/);
  assert.match(appSource, /Open workspace recipes/);
  assert.match(appSource, /Launching \$\{recipe\.name\}/);
  assert.match(appSource, /terminalLayout\.applyLayout/);
  assert.match(appSource, /Editor ownership stays explicit/);
  assert.match(appSource, /OUTARCH-managed terminals only/);
  assert.match(appSource, /Approve & create/);
  assert.match(appSource, /Approve & send/);
  assert.match(appSource, /vscode\.terminal\.write/);
  assert.match(appSource, /confirmedRequest\(method, params\)/);
  assert.match(appSource, /title: `Send command to/);
  assert.match(appSource, /raw output never crosses the bridge/);
  assert.doesNotMatch(appSource, /function SupervisionBriefing/);
  assert.doesNotMatch(appSource, /function LegacyGroundstationView/);
  assert.doesNotMatch(appSource, /function GroundstationView/);
  assert.match(appSource, /Observed facts, not inferred failures/);
  assert.doesNotMatch(appSource, /PluginContributionSlot|surface="health\.status"/);

  const recipesSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../src/groundstation/renderer/WorkspaceRecipes.jsx"),
    "utf8"
  );
  const recipeBuilderSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../src/groundstation/renderer/recipeBuilderModel.js"),
    "utf8"
  );
  const recipesPageSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../src/groundstation/renderer/RecipesView.jsx"),
    "utf8"
  );
  // WorkspaceRecipes.jsx is builder-only now (Audit B §F): create/edit/duplicate one recipe.
  assert.match(recipesSource, /RECIPE BUILDER/);
  assert.match(recipesSource, /Select terminals and arrange the launch order/);
  assert.match(recipesSource, /recipe\.save/);
  assert.match(recipesSource, /mode === "edit"/);
  assert.match(recipesSource, /Discard unsaved changes/);
  assert.match(recipesSource, /dependency graph/);
  assert.match(recipesSource, /Advanced startup controls/);
  assert.match(recipesSource, /Explain recipes/);
  assert.match(recipeBuilderSource, /Parallel services/);
  assert.match(recipesSource, /parallel dependency graph editor/i);
  assert.match(recipesSource, /rollback-started/);
  assert.match(recipesSource, /git-clean/);
  // The saved-recipe library — launch, pause, cancel, recover, delete — lives on the Recipes page.
  assert.match(recipesPageSource, /SAVED RECIPES/);
  assert.match(recipesPageSource, /Launch workspace/);
  assert.match(recipesPageSource, /recipe\.pause/);
  assert.match(recipesPageSource, /recipe\.cancel/);
  assert.match(recipesPageSource, /Recover failed run/);
  assert.match(recipesPageSource, /onManage\(recipe, "edit"\)/);
  assert.match(recipesPageSource, /onManage\(recipe, "duplicate"\)/);
  assert.match(recipesPageSource, /onDelete\?\.\(recipe\)/);

  const agentSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../src/groundstation/renderer/AgentWorkspace.jsx"),
    "utf8"
  );
  assert.match(agentSource, /AI WORKFORCE/);
  assert.match(agentSource, /AGENT DEPLOYMENT/);
  assert.match(agentSource, /Expand your AI crew/);
  assert.match(agentSource, /agent-picker-summary/);
  assert.match(agentSource, /Add another/);
  assert.match(agentSource, /MULTI-AGENT READY/);
  assert.match(agentSource, /AGENT OPERATIONS/);
  assert.match(agentSource, /WHAT THEY ARE DOING/);
  assert.match(agentSource, /Add more agents/);
  assert.match(agentSource, /CURRENT STATE/);
  assert.match(agentSource, /MISSION LIFECYCLE/);
  assert.match(agentSource, /DURABLE EVIDENCE/);
  assert.match(agentSource, /ASSIGNED MISSION/);
  assert.match(agentSource, /Official command/);
  assert.match(agentSource, /Open terminal/);
  assert.match(agentSource, /mission\.list/);
  assert.doesNotMatch(agentSource, /terminal\.open/);
  assert.doesNotMatch(agentSource, /terminal\.write/);
  assert.doesNotMatch(agentSource, /agent-chat|agent-composer|agent-message/);
  assert.doesNotMatch(agentSource, /<textarea|Send an instruction|PERMISSION PREVIEW/);
  assert.doesNotMatch(agentSource, /api key|GEMINI_API_KEY/i);

  const styleSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../src/groundstation/renderer/styles.css"),
    "utf8"
  );
  assert.match(styleSource, /scrollbar-width: thin/);
  assert.match(styleSource, /::-webkit-scrollbar-thumb/);
  assert.match(styleSource, /@container groundstation/);
  const foundationSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../src/groundstation/renderer/uiFoundation.css"),
    "utf8"
  );
  assert.match(foundationSource, /--ui-body: 14px/);
  assert.match(foundationSource, /\.agent-operations/);
  assert.match(foundationSource, /\.reference-pulse__ring \.sweep/);
  assert.match(foundationSource, /animation: none !important/);
  assert.match(appSource, /worker-folder-delete/);
  assert.doesNotMatch(appSource, /<i\s+onClick=/);

  const terminalSource = require("node:fs").readFileSync(
    path.resolve(__dirname, "../src/groundstation/renderer/TerminalPane.jsx"),
    "utf8"
  );
  assert.doesNotMatch(terminalSource, /className="terminal-session-select"/);
  assert.match(terminalSource, /className="terminal-session-menu"/);
  // The connection chip (offline / Live) and its sparkline left the pane header
  // on 2026-09-15 at the operator's request; the activity line keeps the state.
  assert.doesNotMatch(terminalSource, /terminal-pane__telemetry/);
  assert.match(terminalSource, /session\.cwd \|\| "\."/);
  assert.match(terminalSource, /terminal-action-menu/);
  assert.match(terminalSource, /@radix-ui\/react-dropdown-menu/);
  assert.match(terminalSource, /<DropdownMenu\.Portal>/);
  assert.doesNotMatch(terminalSource, /className="terminal-delete-button"/);
  assert.match(terminalSource, /requestAction\("remove"\)/);
});

test("Groundstation 2.19 uses the live supervision composition and consolidated UX layer", () => {
  const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
  const app = fs.readFileSync(path.join(rendererRoot, "App.jsx"), "utf8");
  const main = fs.readFileSync(path.join(rendererRoot, "main.jsx"), "utf8");
  const tokens = fs.readFileSync(path.join(rendererRoot, "tokens.css"), "utf8");
  const premium = fs.readFileSync(path.join(rendererRoot, "premiumDesign.css"), "utf8");
  const bridge = fs.readFileSync(path.join(rendererRoot, "redesign", "tokens-bridge.css"), "utf8");
  const base = fs.readFileSync(path.join(rendererRoot, "redesign", "base.css"), "utf8");
  const workspace = fs.readFileSync(path.join(rendererRoot, "redesign", "workspace.css"), "utf8");
  const screens = fs.readFileSync(path.join(rendererRoot, "redesign", "screens.css"), "utf8");

  assert.match(app, /view === "groundstation"\) return <LiveGroundstationView/);
  assert.match(app, /<StatusBar/);
  assert.match(app, /<HelpOverlay/);
  assert.match(main, /import "\.\/tokens\.css";[\s\S]*import "\.\/styles\.css";[\s\S]*import "\.\/redesign\/tokens-bridge\.css";[\s\S]*import "\.\/redesign\/base\.css";[\s\S]*import "\.\/redesign\/workspace\.css";[\s\S]*import "\.\/redesign\/screens\.css";/);
  assert.doesNotMatch(main, /import "\.\/(?:experience2[7-9]|experience30|redesign-v4|reference-v5|reference-final|prototype2026|theme-concept)\.css"/);
  assert.match(tokens, /--orbital-canvas/);
  assert.match(tokens, /--green-100/);
  assert.match(tokens, /\.theme-solar/);
  assert.match(premium, /--surface-canvas:\s*var\(--theme-canvas\)/);
  assert.match(premium, /--status-needs-you:\s*var\(--accent-attention\)/);
  assert.match(bridge, /--font-family-ui/);
  // The dim text role must exist in the bridge; its value belongs to the
  // palette, and accessibilityMeasured.test.cjs is what holds it to contrast.
  assert.match(bridge, /--mc-text-dim:\s*#[0-9a-f]{3,8};/i);
  assert.match(base, /OUTARCH .* base layer/);
  assert.match(base, /grid-template-columns: var\(--mc-rail-w, 64px\) minmax\(0, 1fr\)/);
  assert.match(base, /\.mission-status-bar/);
  assertReducedMotionIsCentral();
  assert.match(workspace, /container: workspace-stage \/ inline-size/);
  assert.match(workspace, /@container workspace-stage/);
  assert.match(screens, /2\.19 Groundstation contract/);
  // T101 — the inspector is a sticky overlay, not a fixed drawer; `fixed` was
  // never viewport-relative here (two ancestors establish a containing block).
  assert.match(screens, /position: sticky;[\s\S]*width: min\(360px/);
});

test("Groundstation premium shell uses one responsive sidebar with intentional primary tabs", () => {
  const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
  const app = fs.readFileSync(path.join(rendererRoot, "App.jsx"), "utf8");
  const main = fs.readFileSync(path.join(rendererRoot, "main.jsx"), "utf8");
  const base = fs.readFileSync(path.join(rendererRoot, "redesign", "base.css"), "utf8");
  const workspaceCss = fs.readFileSync(path.join(rendererRoot, "redesign", "workspace.css"), "utf8");
  const recipes = fs.readFileSync(path.join(rendererRoot, "RecipesView.jsx"), "utf8");
  const integrations = fs.readFileSync(path.join(rendererRoot, "IntegrationsView.jsx"), "utf8");

  assert.match(app, /function AppSidebar/);
  assert.match(app, /<aside className="app-sidebar"/);
  assert.doesNotMatch(app, /<aside className="power-rail"/);
  assert.doesNotMatch(app, /<aside className="rail"/);
  assert.match(app, /\["recipes", "Recipes", "grid"\]/);
  assert.match(app, /\["settings", "Settings", "settings"\]/);
  const primaryNavigation = app.slice(app.indexOf("const NAVIGATION"), app.indexOf("const SECONDARY_DESTINATIONS"));
  const coreDestinations = ["groundstation", "workspace", "needs", "recipes", "history", "settings"];
  let previousIndex = -1;
  for (const id of coreDestinations) {
    const index = primaryNavigation.indexOf(`["${id}",`);
    assert.ok(index > previousIndex, `${id} must retain its position in the six-route core order`);
    previousIndex = index;
  }
  assert.match(primaryNavigation, /const PRIMARY_NAV_COUNT = 6/);
  assert.match(app, /NAVIGATION\.slice\(0, PRIMARY_NAV_COUNT\)\.map/);
  // Integrations is reachable but visually contextual: Settings keeps local
  // preferences while connected bridges live after the six core routes.
  assert.match(primaryNavigation, /\["integrations", "Integrations", "expand"\]/);
  assert.match(app, /className="top-navigation__contextual"[\s\S]{0,160}NAVIGATION\.slice\(PRIMARY_NAV_COUNT\)\.map/);
  // The sidebar still has to stay a short, intentional list rather than a
  // dumping ground for every surface.
  assert.ok(
    primaryNavigation.match(/\["[a-z-]+", "/g).length <= 8,
    "primary sidebar navigation must stay a short, intentional list"
  );
  assert.match(app, /<RecipesView/);
  assert.match(app, /<IntegrationHubView/);
  assert.match(app, /top-navigation/);
  assert.match(app, /const totalWaiting = available\.length/);
  assert.match(main, /import "\.\/premiumDesign\.css";[\s\S]*import "\.\/redesign\/base\.css";/);
  assert.match(base, /grid-template-columns: var\(--mc-rail-w, 212px\) minmax\(0, 1fr\)/);
  assert.match(base, /\.app-sidebar[\s\S]*overflow: hidden auto/);
  assert.match(base, /\.top-navigation button > span[\s\S]*display: block !important/);
  assert.match(app, /> Run recipe<\/button>/);
  assert.match(workspaceCss, /\.terminal-grid\.layout-grid-3x2/);
  assert.match(recipes, /request\("recipe\.list"\)/);
  assert.match(recipes, /Launch workspace/);
  assert.match(integrations, /request\(integration\.request\)/);
  for (const label of ["Mission AI", "VS Code Bridge", "Secure MCP", "Mobile Companion"]) assert.match(integrations, new RegExp(label));
  assert.doesNotMatch(integrations, /name: "Plugins"|plugin\.status/);
});

test("Mission Graph stays contextual and renders only configured recipe relationships", () => {
  const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
  const app = fs.readFileSync(path.join(rendererRoot, "App.jsx"), "utf8");
  const main = fs.readFileSync(path.join(rendererRoot, "main.jsx"), "utf8");
  const graph = fs.readFileSync(path.join(rendererRoot, "MissionGraph.jsx"), "utf8");
  const graphStyle = fs.readFileSync(path.join(rendererRoot, "missionGraph.css"), "utf8");

  assert.match(app, /import MissionGraph from "\.\/MissionGraph\.jsx"/);
  assert.match(app, /missionGraphOpen/);
  assert.match(app, /onMissionGraph/);
  assert.match(app, /Open Mission Graph/);
  assert.doesNotMatch(app, /\["mission-graph",\s*"Mission Graph"/);
  assert.match(main, /import "\.\/styles\.css";[\s\S]*import "\.\/uiFoundation\.css";[\s\S]*import "\.\/groundstation21\.css";[\s\S]*import "\.\/missionGraph\.css";/);
  assert.match(graph, /request\("recipe\.list"\)/);
  assert.match(graph, /buildMissionGraph/);
  assert.match(graph, /function Cable/);
  assert.match(graph, /node\.dependsOn\.forEach/);
  assert.match(graph, /engineEventFrom/);
  assert.match(graph, /startsWith\("recipe:"\)/);
  assert.doesNotMatch(graph, /setInterval|setTimeout/);
  assert.match(graphStyle, /\.mission-graph-dialog/);
  assert.match(graphStyle, /@media \(max-width: 980px\)/);
  assertReducedMotionIsCentral();
});

test("Worker Intelligence renders engine-owned resources, health, and configured dependency impact", () => {
  const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
  const app = fs.readFileSync(path.join(rendererRoot, "App.jsx"), "utf8");
  const graph = fs.readFileSync(path.join(rendererRoot, "MissionGraph.jsx"), "utf8");
  const main = fs.readFileSync(path.join(rendererRoot, "main.jsx"), "utf8");
  const intelligenceStyle = fs.readFileSync(path.join(rendererRoot, "redesign", "surfaces.css"), "utf8");

  assert.match(app, /function WorkerResourceIntelligence/);
  assert.match(app, /ENGINE HEALTH ANALYSIS/);
  assert.match(app, /DEPENDENCY IMPACT/);
  assert.match(app, /session\.resources/);
  assert.match(app, /session\.health/);
  assert.match(app, /session\.dependencyImpact/);
  assert.match(app, /Observed facts, not inferred failures/);
  assert.match(app, /High usage remains an observation/);
  assert.match(graph, /node\.downstream/);
  assert.match(graph, /Resources/);
  assert.doesNotMatch(main, /import "\.\/workerIntelligence\.css";/);
  assert.match(main, /import "\.\/redesign\/surfaces\.css";/);
  assert.match(intelligenceStyle, /\.worker-resource-intelligence/);
  assert.match(intelligenceStyle, /\.worker-health\.tone-pressure/);
  assert.match(intelligenceStyle, /@media \(max-width: 760px\)/);
  assertReducedMotionIsCentral();
});

test("Project Memory 2 renders resumable engine chapters without inventing causality", () => {
  const root = path.join(__dirname, "..");
  const rendererRoot = path.join(root, "src", "groundstation", "renderer");
  const app = fs.readFileSync(path.join(rendererRoot, "App.jsx"), "utf8");
  const main = fs.readFileSync(path.join(rendererRoot, "main.jsx"), "utf8");
  const memoryStyle = fs.readFileSync(path.join(rendererRoot, "projectMemory.css"), "utf8");
  const engine = fs.readFileSync(path.join(root, "src", "engine", "index.cjs"), "utf8");
  const model = fs.readFileSync(path.join(root, "src", "engine", "projectMemory.cjs"), "utf8");

  assert.match(engine, /buildProjectMemory\(this\.#activityEvents, this\.list\(\)/);
  assert.match(model, /same worker plus later verified evidence/);
  assert.match(model, /MAX_MEMORY_CHAPTERS/);
  assert.match(model, /MAX_CHAPTER_EVENTS/);
  assert.match(app, /RESUME WORK/);
  assert.match(app, /memory\.resumePoints/);
  assert.match(app, /memory\?\.causalLinks/);
  assert.match(app, /RUN CHAPTERS · RESUMABLE MEMORY/);
  assert.match(app, /success requires verification/);
  assert.match(app, /<HistoryView events=\{activity\} onFocus=\{inspectWorker\}/);
  assert.doesNotMatch(app, /const chapters = \[\.\.\.ordered\.reduce/);
  assert.match(main, /import "\.\/projectMemory\.css";[\s\S]*import "\.\/redesign\/surfaces\.css";/);
  assert.match(memoryStyle, /\.memory-resume/);
  assert.match(memoryStyle, /@media \(max-width: 760px\)/);
  assertReducedMotionIsCentral();
});

test("VS Code Bridge stays contextual in Settings and uses Protocol-owned synchronization", () => {
  const root = path.join(__dirname, "..");
  const rendererRoot = path.join(root, "src", "groundstation", "renderer");
  const app = fs.readFileSync(path.join(rendererRoot, "App.jsx"), "utf8");
  const main = fs.readFileSync(path.join(rendererRoot, "main.jsx"), "utf8");
  const style = fs.readFileSync(path.join(rendererRoot, "vscodeBridge.css"), "utf8");
  const protocol = fs.readFileSync(path.join(root, "src", "protocol", "index.cjs"), "utf8");
  const electronMain = fs.readFileSync(path.join(root, "src", "groundstation", "main", "index.cjs"), "utf8");

  assert.match(app, /function VSCodeBridgeSettings/);
  assert.match(app, /<VSCodeBridgeSettings workspace=\{workspace\}/);
  assert.match(app, /request\("vscode\.status"\)/);
  assert.match(app, /"vscode\.launch"/);
  assert.match(app, /"vscode\.openFile"/);
  assert.match(app, /notification\?\.type === "integration:event"/);
  assert.match(app, /Editor ownership stays explicit/);
  assert.match(app, /OUTARCH-managed terminals only/);
  assert.match(app, /raw output never crosses the bridge/);
  assert.match(app, /"vscode\.terminal\.create"/);
  assert.match(app, /"vscode\.terminal\.write"/);
  const primaryNavigation = app.slice(app.indexOf("const NAVIGATION"), app.indexOf("const ICON_PATHS"));
  assert.doesNotMatch(primaryNavigation, /\["vscode",\s*"VS Code"/);
  assert.match(protocol, /"vscode\.launch"/);
  assert.match(protocol, /"vscode\.terminal\.close"/);
  assert.match(protocol, /integration:event/);
  assert.match(electronMain, /new VSCodeBridge/);
  assert.match(main, /import "\.\/projectMemory\.css";[\s\S]*import "\.\/vscodeBridge\.css";/);
  assert.match(style, /\.vscode-bridge-settings/);
  assert.doesNotMatch(style, /backdrop-filter/);
  assert.match(style, /@media \(max-width: 620px\)/);
  assertReducedMotionIsCentral();
});

test("Secure MCP stays contextual in Settings and routes mutation requests through Needs You", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/App.jsx"), "utf8");
  const component = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/McpGateway.jsx"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/mcpGateway.css"), "utf8");
  const protocol = fs.readFileSync(path.resolve(__dirname, "../src/protocol/index.cjs"), "utf8");
  assert.match(app, /<McpGatewaySettings workspace=\{workspace\}/);
  // MCP approvals reach the operator through the unified decision queue, not a
  // per-integration component mounted in Needs You. The old McpApprovalQueue
  // was dead code and is removed.
  assert.match(app, /decisionRecords=\{decisions\.records\}/);
  assert.match(app, /"mcp"/, "resolveDecision routes MCP through decisions.resolve");
  assert.doesNotMatch(component, /McpApprovalQueue|mcp\.approval\.resolve|<DecisionItem/);
  assert.match(component, /mcp\.configure/);
  assert.match(component, /mcp\.rotateToken/);
  // decisions.resolve routes an MCP decision to the gateway with the ceremony intact.
  assert.match(protocol, /callMcp\("resolveApproval", resolveApproval => resolveApproval\(nativeId, actionId\)\)/);
  assert.match(protocol, /requireConfirmation\("decisions\.resolve", params\)/);
  assert.match(component, /Terminal evidence/);
  assert.match(component, /Off by default/i);
  assert.match(css, /\.mcp-gateway-settings/);
  const primaryNavigation = app.slice(app.indexOf("const NAVIGATION"), app.indexOf("const ICON_PATHS"));
  assert.doesNotMatch(primaryNavigation, /\["mcp",\s*"MCP"/i, "MCP must not become primary navigation");
});

test("deeper AI supervision remains contextual, evidence-backed, and chat-free", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/App.jsx"), "utf8");
  const component = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/AgentWorkspace.jsx"), "utf8");
  const css = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/agentSupervision.css"), "utf8");
  const engine = fs.readFileSync(path.resolve(__dirname, "../src/engine/missionSupervision.cjs"), "utf8");
  assert.match(component, /MISSION CONTRACT/);
  assert.match(component, /EVIDENCE-BACKED PROGRESS/);
  assert.match(component, /CURRENT ACTION/);
  assert.match(component, /CURRENT FILES/);
  assert.match(component, /MISSION AUTHORITY/);
  assert.match(component, /mission\.checkpoint\.verify/);
  // Mission approvals flow through the unified decision queue in Needs You — the
  // standalone MissionApprovalQueue was dead code and is removed.
  assert.doesNotMatch(component, /MissionApprovalQueue/);
  assert.doesNotMatch(component, /mission\.approval\.resolve/);
  assert.match(app, /decisionRecords=\{decisions\.records\}/);
  assert.match(app, /record\.source === "mission"/);
  assert.match(engine, /observable-checkpoints/);
  assert.doesNotMatch(component, /<textarea|agent-chat|Send an instruction/);
  assert.doesNotMatch(app, /\["supervision",\s*"Supervision"/i, "AI supervision must not become primary navigation");
  assert.doesNotMatch(css, /backdrop-filter/);
});

test("Mobile Companion stays contextual, encrypted, revocable, and approval-gated", () => {
  const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
  const app = fs.readFileSync(path.join(rendererRoot, "App.jsx"), "utf8");
  const mobile = fs.readFileSync(path.join(rendererRoot, "MobileCompanion.jsx"), "utf8");
  const protocol = fs.readFileSync(path.resolve(__dirname, "../src/protocol/index.cjs"), "utf8");
  assert.match(app, /<MobileCompanionSettings workspace=\{workspace\}/);
  // Mobile approvals reach Needs You through the unified decision queue; the old
  // standalone queue component was dead code and is removed.
  assert.match(app, /decisionRecords=\{decisions\.records\}/);
  assert.doesNotMatch(app, /\["mobile",\s*"Mobile/);
  assert.match(mobile, /not a remote shell or mobile IDE/i);
  assert.match(mobile, /mobile\.invite/);
  assert.match(mobile, /mobile\.device\.revoke/);
  assert.doesNotMatch(mobile, /mobile\.approval\.resolve|<DecisionItem/);
  assert.match(protocol, /callMobile\("resolveApproval", resolveApproval => resolveApproval\(nativeId, actionId\)\)/);
  assert.doesNotMatch(mobile, /terminal\.write|terminal\.open|action\.dispatch/);
});

test("the plugin platform is gone from the renderer and the protocol", () => {
  const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
  const app = fs.readFileSync(path.join(rendererRoot, "App.jsx"), "utf8");
  const protocol = fs.readFileSync(path.resolve(__dirname, "../src/protocol/index.cjs"), "utf8");
  assert.equal(fs.existsSync(path.join(rendererRoot, "PluginPlatform.jsx")), false);
  assert.equal(fs.existsSync(path.join(rendererRoot, "PluginContributionSlot.jsx")), false);
  assert.doesNotMatch(app, /PluginPlatformSettings|PluginContributionSlot/);
  // Approvals still reach Needs You through the unified decision queue.
  assert.match(app, /decisionRecords=\{decisions\.records\}/);
  assert.doesNotMatch(protocol, /callPlugin|"plugin\./);
});

test("Groundstation build is isolated from parent PostCSS configurations", async () => {
  const configUrl = pathToFileURL(
    path.resolve(__dirname, "../vite.groundstation.config.mjs")
  ).href;
  const { default: config } = await import(`${configUrl}?postcss=${Date.now()}`);

  assert.deepEqual(config.css?.postcss, { plugins: [] });
  const forwarded = [];
  config.build.rollupOptions.onwarn({ code: "MODULE_LEVEL_DIRECTIVE", id: "D:/repo/node_modules/radix/index.mjs", message: '"use client" was ignored' }, warning => forwarded.push(warning));
  config.build.rollupOptions.onwarn({ code: "OTHER_WARNING", id: "renderer.jsx", message: "important" }, warning => forwarded.push(warning));
  assert.deepEqual(forwarded.map(warning => warning.code), ["OTHER_WARNING"]);
  const chunks = config.build?.rollupOptions?.output?.manualChunks;
  assert.equal(typeof chunks, "function");
  assert.equal(chunks("D:/repo/node_modules/react/index.js"), "vendor-react");
  assert.equal(chunks("D:/repo/src/groundstation/renderer/TerminalPane.jsx"), "workspace-terminal");
  assert.equal(chunks("D:/repo/src/groundstation/renderer/McpGateway.jsx"), "feature-integrations");
});

test("renderer bridge unwraps protocol results and preserves structured errors", async t => {
  const originalWindow = global.window;
  t.after(() => { global.window = originalWindow; });
  const subscriptions = [];
  global.window = {
    missionControl: {
      subscribe(callback) {
        subscriptions.push(callback);
        return () => subscriptions.splice(subscriptions.indexOf(callback), 1);
      },
      async request(method) {
        if (method === "state.get") return { version: 1, id: "a", ok: true, result: { sequence: 9 } };
        return {
          version: 1,
          id: "b",
          ok: false,
          error: { code: "ACTION_FAILED", message: "worker refused" }
        };
      }
    }
  };
  const { missionApi } = await import(`${moduleUrl}?bridge=${Date.now()}`);
  const api = missionApi();

  assert.deepEqual(await api.request("state.get"), { sequence: 9 });
  await assert.rejects(
    api.request("action.dispatch"),
    error => error.code === "ACTION_FAILED" && error.message === "worker refused"
  );
  const unsubscribe = api.subscribe(() => {});
  assert.equal(subscriptions.length, 1);
  unsubscribe();
  assert.equal(subscriptions.length, 0);
});

test("renderer notification helpers recognize engine and terminal frames", async () => {
  const {
    engineEventFrom,
    notificationType,
    streamIdentifier
  } = await import(`${moduleUrl}?frames=${Date.now()}`);
  const engineFrame = {
    version: 1,
    type: "engine:event",
    event: { sequence: 3, type: "session:status", id: "api" }
  };

  assert.deepEqual(engineEventFrom(engineFrame), engineFrame.event);
  assert.equal(notificationType({ type: "terminal:data" }), "terminal:data");
  assert.equal(streamIdentifier({ streamId: "stream-1" }), "stream-1");
});

test("worker form builds validated create definitions without weakening engine limits", async () => {
  const { buildWorkerDefinition, initialWorkerDraft } = await import(`${workerFormUrl}?create=${Date.now()}`);
  const defaultDraft = initialWorkerDraft();
  assert.equal(defaultDraft.command, "powershell.exe");
  assert.equal(defaultDraft.autoStart, false);
  assert.equal(defaultDraft.powershellCompatibility, false);
  const definition = buildWorkerDefinition({
    id: "api.dev",
    name: "API dev server",
    command: "npm",
    argsText: '["run", "dev"]',
    cwd: "./api",
    envText: '{"PORT":"3000"}',
    autoStart: false,
    powershellCompatibility: true
  });

  assert.deepEqual(definition, {
    id: "api.dev",
    name: "API dev server",
    command: "npm",
    args: ["run", "dev"],
    cwd: "./api",
    env: { PORT: "3000" },
    autoStart: false,
    powershellCompatibility: true
  });
  assert.throws(
    () => buildWorkerDefinition({ ...definition, argsText: "[]", envText: '{"PORT":3000}' }),
    /Environment values must be strings/
  );
  assert.throws(
    () => buildWorkerDefinition({ ...definition, id: "bad id", argsText: "[]", envText: "{}" }),
    /Worker ID may use only/
  );
});

test("Add terminal asks two questions and stays duplicate-safe", async () => {
  const { buildSimpleWorkerDefinition, initialWorkerDraft, nextAvailableWorkerId } = await import(
    `${workerFormUrl}?default=${Date.now()}`
  );

  // The create draft starts empty: there is no template to preselect, so the
  // form asks for a name and a command and derives everything else.
  const blank = initialWorkerDraft();
  assert.equal(blank.name, "");
  assert.equal(blank.startCommand, "");

  const created = buildSimpleWorkerDefinition({ name: "Storefront", startCommand: "npm run dev" }, { platform: "win32" });
  assert.equal(created.id, "Storefront");
  assert.equal(created.command, "powershell.exe");
  assert.equal(created.cwd, ".");
  assert.equal(created.autoStart, false);
  assert.equal(created.args.at(-1), "npm run dev", "the command line is not split on spaces");

  // Duplicate-safe ID generation mirrors the engine's "id already in use" rejection.
  assert.equal(nextAvailableWorkerId("terminal", []), "terminal");
  assert.equal(nextAvailableWorkerId("terminal", ["terminal"]), "terminal-2");
  assert.equal(nextAvailableWorkerId("terminal", ["terminal", "terminal-2"]), "terminal-3");
  assert.equal(nextAvailableWorkerId("terminal", ["TERMINAL"]), "terminal-2");
  assert.equal(nextAvailableWorkerId("frontend", ["terminal"]), "frontend");
});

test("worker edit patches preserve secret environment values unless replacement is explicit", async () => {
  const { buildWorkerPatch, initialWorkerDraft } = await import(`${workerFormUrl}?edit=${Date.now()}`);
  const draft = initialWorkerDraft({
    id: "api",
    name: "API",
    command: "npm run dev",
    args: [],
    cwd: ".",
    envKeys: ["TOKEN", "PORT"],
    autoStart: true,
    powershellCompatibility: false
  });
  const preserved = buildWorkerPatch(draft);
  assert.equal(Object.hasOwn(preserved, "env"), false);
  assert.equal(JSON.stringify(draft).includes("TOKEN"), false);

  const replaced = buildWorkerPatch({
    ...draft,
    replaceEnvironment: true,
    envText: '{"PORT":"4000"}'
  });
  assert.deepEqual(replaced.env, { PORT: "4000" });
});

test("terminal layouts support unique persisted 1, 2, 4, and 6-pane assignments", async () => {
  const {
    TERMINAL_LAYOUTS,
    assignTerminalSlot,
    normalizeTerminalLayout
  } = await import(`${terminalLayoutUrl}?layout=${Date.now()}`);
  const sessions = Array.from({ length: 7 }, (_, index) => ({ id: `worker-${index + 1}` }));
  assert.deepEqual(TERMINAL_LAYOUTS.map(layout => layout.slots), [1, 2, 2, 4, 6]);

  const six = normalizeTerminalLayout({
    layoutId: "grid-3x2",
    sessionIds: ["worker-3", "missing", "worker-3", "worker-1"]
  }, sessions);
  assert.equal(six.sessionIds.length, 6);
  assert.deepEqual(six.sessionIds.slice(0, 4), ["worker-3", null, null, "worker-1"]);
  assert.equal(new Set(six.sessionIds.filter(Boolean)).size, 4);
  assert.equal(
    new Set(normalizeTerminalLayout({ layoutId: "grid-3x2" }, sessions).sessionIds.filter(Boolean)).size,
    6
  );

  const swapped = assignTerminalSlot(six, 0, six.sessionIds[4], sessions);
  assert.equal(swapped.sessionIds[0], six.sessionIds[4]);
  assert.equal(swapped.sessionIds[4], six.sessionIds[0]);
  assert.equal(new Set(swapped.sessionIds.filter(Boolean)).size, 4);
  assert.equal(normalizeTerminalLayout({ layoutId: "horizontal", paneRatio: 68 }, sessions).paneRatio, 68);
  assert.equal(normalizeTerminalLayout({ layoutId: "horizontal", paneRatio: 99 }, sessions).paneRatio, 75);
  const appSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../src/groundstation/renderer/App.jsx"), "utf8");
  assert.match(appSource, /className=\{`tile-resize-grip is-edge/);
  // Each terminal is resized from its own edges and corners, pointer-driven,
  // with the grip naming which edge moves.
  assert.match(appSource, /onPointerDown=\{event => beginTileResize\(event, tileFrame, grip\)\}/);
  assert.match(appSource, /tileFrame\.grips\.map\(grip =>/);
  assert.doesNotMatch(appSource, /aria-label="Resize terminal panes" type="range"/);
  assert.match(appSource, /function WorkerFolders/);
  assert.match(appSource, /AI agents/);
  assert.match(appSource, /New folder/);
  assert.match(appSource, /mission-control\.worker-folders\.v1/);
});

test("Settings exclusive choices, the terminal range, and quiet hours are properly labelled (T124-T126)", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/App.jsx"), "utf8");
  const segmented = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/Segmented.jsx"), "utf8");
  // T124 — SettingChoice and the severity choice are real radiogroups.
  assert.match(app, /const SettingChoice = SegmentedChoice;/);
  assert.match(segmented, /role="radiogroup" aria-label=\{label\}/);
  assert.match(segmented, /role="radio"[\s\S]*?aria-checked=\{isSelected\}/);
  assert.match(app, /<div role="radiogroup" aria-labelledby="notify-from-label"/);
  // T125 — the terminal font-size range has an accessible name and an announced value.
  assert.match(app, /id="terminal-font-size-range" type="range"[\s\S]{0,160}aria-label="Terminal font size in pixels"/);
  assert.match(app, /aria-valuetext=\{`\$\{preferences\.terminalFontSize\} pixels`\}/);
  // T126 — quiet-hours inputs have independent Start / End labels.
  assert.match(app, /role="group" aria-label="Quiet hours window"/);
  assert.match(app, /aria-label="Quiet hours start time"/);
  assert.match(app, /aria-label="Quiet hours end time"/);
});

test("notification preference saves roll back and surface a persistent error on failure (T052)", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/App.jsx"), "utf8");
  assert.match(app, /const previous = policyRef\.current;/);
  assert.match(app, /catch \(value\) \{\s*setPolicy\(previous\);\s*setError\(/);
  assert.match(app, /notification preferences were not changed/);
  assert.match(app, /className="settings-save-error" role="alert"/);
});
