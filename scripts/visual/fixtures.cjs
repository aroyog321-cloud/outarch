// Fixture router for the visual harness. `state.get` comes from a REAL
// EngineAPI driven by test/fakePty.cjs, so session/workspace/activity shapes
// stay faithful to the protocol. Everything else returns a representative
// payload so each route renders populated rather than empty.
const { EngineAPI } = require("../../src/engine/index.cjs");
const { makeFakePtyFactory } = require("../../test/fakePty.cjs");
const { buildDecisionQuery } = require("../../src/protocol/decisionBroker.cjs");
const { buildHistoryModel, exportHistory } = require("../../src/protocol/historyExport.cjs");

const MINUTE = 60000;
const now = Date.now();

function buildEngine() {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  api.loadProject({
    // MC_FIXTURE_EMPTY=1 is a project with nothing in it yet (the first run).
    sessions: process.env.MC_FIXTURE_EMPTY === "1" ? [] : [
      { id: "web", name: "Web dev server", command: "npm", args: ["run", "dev"], cwd: "D:/work/acme-console" },
      { id: "api", name: "API gateway", command: "npm", args: ["run", "start:api"], cwd: "D:/work/acme-console/services/api" },
      { id: "tests", name: "Unit tests (watch)", command: "npm", args: ["run", "test:watch"], cwd: "D:/work/acme-console" },
      { id: "worker", name: "Queue worker", command: "node", args: ["worker.js"], cwd: "D:/work/acme-console/services/jobs" },
      { id: "agent-claude", name: "Claude - refactor auth", command: "claude", args: ["--continue"], cwd: "D:/work/acme-console" },
      { id: "agent-codex", name: "Codex - migration review", command: "codex", args: [], cwd: "D:/work/acme-console" },
      { id: "db", name: "Postgres tunnel", command: "ssh", args: ["-L", "5432:localhost:5432", "bastion"], cwd: "D:/work/acme-console", autoStart: false },
      // MC_FIXTURE_SHELLS=1 adds workers exactly as the two-field Add terminal
      // form creates them on Windows (workerForm.buildShellLaunch): a plain
      // PowerShell, and PowerShell wrapping a typed start command.
      ...(process.env.MC_FIXTURE_SHELLS === "1" ? [
        { id: "shell-idle", name: "sample", command: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NoExit"], cwd: "D:/first", autoStart: false },
        { id: "shell-claude", name: "wsgsgv", command: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "claude"], cwd: "D:/first", autoStart: false },
        { id: "shell-live", name: "zcvdc", command: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NoExit"], cwd: "D:/first" },
        { id: "shell-dev", name: "server", command: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NoExit", "-Command", "npm run dev -- --port 5173"], cwd: "D:/first" }
      ] : []),
      // MC_FIXTURE_CROWD=1 is a busy project: twenty workers across every
      // folder kind, so the off-canvas strip and the folder row overflow.
      ...(process.env.MC_FIXTURE_CROWD === "1" ? [
        ["frontend", "frontend", "npm", ["run", "dev"]], ["backend", "backend", "npm", ["run", "start"]],
        ["svc-cvnv", "svc cvnv", "node", ["svc.js"]], ["compose", "compose stack", "docker", ["compose", "up"]],
        ["redis", "redis cache", "docker", ["run", "redis"]], ["db-migrate", "db-migrate", "npx", ["prisma", "migrate", "dev"]],
        ["db-seed", "db seed", "psql", ["-f", "seed.sql"]], ["git-watch", "git", "git", ["status"]],
        ["e2e", "tests e2e", "npx", ["playwright", "test"]], ["build", "build", "npm", ["run", "build"]],
        ["shell-a", "scratch", "powershell.exe", ["-NoLogo"]], ["shell-b", "logs", "powershell.exe", ["-NoLogo"]],
        ["shell-c", "ops", "powershell.exe", ["-NoLogo"]]
      ].map(([id, name, command, args]) => ({ id, name, command, args, cwd: "D:/work/acme-console", autoStart: false })) : [])
    ]
  });

  const emit = (index, lines) => {
    const pty = factory.instances[index];
    if (!pty) return;
    for (const line of lines) pty.emitData(line + "\r\n");
  };
  const isNominal = process.env.MC_FIXTURE_NOMINAL === "1";
  emit(0, ["> acme-console@2.4.0 dev", "  VITE v6.4.3  ready in 412 ms", "  Local:   http://localhost:5173/", "  Network: http://10.0.0.14:5173/"]);
  emit(1, ["[api] listening on :8080", "[api] connected to postgres", "[api] GET /v1/health 200 3ms", "[api] GET /v1/projects 200 41ms"]);
  emit(2, isNominal ? ["PASS  src/auth/session.test.ts", "PASS  src/billing/invoice.test.ts", "PASS  src/auth/token.test.ts", "Tests: 85 passed, 85 total"] : ["PASS  src/auth/session.test.ts", "PASS  src/billing/invoice.test.ts", "FAIL  src/auth/token.test.ts", "  refresh token rotates on use", "Tests: 1 failed, 84 passed, 85 total"]);
  emit(3, isNominal ? ["[jobs] worker online, concurrency=4", "[jobs] processed email.welcome in 122ms", "[jobs] redis connected"] : ["[jobs] worker online, concurrency=4", "[jobs] processed email.welcome in 122ms", "[jobs] FATAL redis connection refused"]);
  emit(4, isNominal ? ["Reading src/auth/session.ts", "Refactoring complete: auth session validated"] : ["Reading src/auth/session.ts", "Editing src/auth/session.ts", "Waiting for approval to run: npm run test:auth", "Error: refusing to write src/auth/session.ts without an approved scope"]);
  emit(5, ["Reviewing migration 0042_add_billing_index.sql", "All checks passed"]);

  if (!isNominal) {
    const failing = factory.instances[3];
    if (failing) failing.emitExit(1);
  }

  return { api, factory };
}

const built = buildEngine();
const engine = built.api;

// Each queue reads a different record shape; all three filter on `state`.
const supervisorApproval = {
  id: "sup-1",
  state: "pending",
  model: "gemini-2.5-pro",
  instruction: "Get the auth refactor verified before I continue",
  plan: {
    summary: "Verify the auth refactor with the existing suite before continuing",
    assumptions: ["The refactor branch is already checked out", "No migration is pending"],
    actions: [
      { type: "terminal-input", reason: "Run the scoped suite that covers the changed module", input: "npm run test:auth" },
      { type: "worker-restart", reason: "Restart the watcher so it picks up the new files" }
    ]
  }
};

const missionApproval = {
  id: "m-1",
  state: "pending",
  missionId: "mission-1",
  missionTitle: "Write src/auth/session.ts",
  requestedScopes: ["fs:write", "workspace:src/auth"],
  reason: "Mission step 3 of 6 edits a protected path.",
  impact: "One file is rewritten. No process is started.",
  expiresAt: now + 11 * MINUTE
};

const mcpApproval = {
  id: "mcp-1",
  state: "pending",
  type: "worker",
  client: "Claude Desktop",
  action: "restart",
  targetName: "API gateway",
  reason: "The client reports the gateway stopped answering health checks.",
  expiresAt: now + 9 * MINUTE
};

const FIXTURES = {
  "system.recovery.get": () => ({ phase: "Ready", attempts: 0, lastRecoveredAt: now - 42 * MINUTE }),
  "events.activate": () => ({ active: true }),
  "supervision.get": () => ({ contractVersion: 3, sequence: 120, projects: [], workers: [] }),
  "memory.summary": () => engine.getProjectMemory({ afterSequence: 0 }),
  // A bare array (App.jsx:1505).
  "agents.list": () => ([
    { id: "claude", name: "Claude Code", command: "claude", available: true, description: "Anthropic CLI agent" },
    { id: "codex", name: "Codex CLI", command: "codex", available: true, description: "OpenAI CLI agent" },
    { id: "gemini", name: "Gemini CLI", command: "gemini", available: false, description: "Google CLI agent" }
  ]),
  "attention.list": () => ({
    records: process.env.MC_FIXTURE_NOMINAL === "1" ? [] : [
      { id: "att-1", sessionId: "worker", groupKey: "exit-nonzero", state: "new", severity: "critical", createdAt: now - 3 * MINUTE },
      { id: "att-2", sessionId: "tests", groupKey: "test-failure", state: "seen", severity: "warning", createdAt: now - 11 * MINUTE },
      { id: "att-3", sessionId: "api", groupKey: "exit-nonzero", state: "recovered", severity: "info", createdAt: now - 60 * MINUTE }
    ],
    preferences: { minimumSeverity: "info", desktopNotifications: true, sound: true, quietHours: { enabled: false, start: "22:00", end: "07:00" } }
  }),
  "notification.status": () => ({ available: true, running: true, delivered: 3, suppressed: 1, lastDeliveryAt: now - MINUTE, lastSuppressedReason: "app-focused", lastError: null }),
  "notification.test": () => ({ ok: true, delivered: true, at: now }),
  "attention.transition": () => ({ ok: true }),
  "attention.preferences.save": () => ({ ok: true }),
  // MC_FIXTURE_DECISIONS=degraded makes MCP fail to load and Mobile unavailable so
  // the completeness signal is visible; the default is every source healthy.
  "decisions.list": () => (process.env.MC_FIXTURE_NOMINAL === "1"
    ? Promise.resolve({ records: [], total: 0, sources: [] })
    : buildDecisionQuery({
        engineApi: engine,
        missionSupervisor: { listApprovals: () => [supervisorApproval] },
        mcpGateway: process.env.MC_FIXTURE_DECISIONS === "degraded"
          ? { listApprovals: () => { throw new Error("gateway timed out"); } }
          : { listApprovals: () => [mcpApproval] },
        mobileCompanion: process.env.MC_FIXTURE_DECISIONS === "degraded"
          ? null
          : { listApprovals: () => [] },
        pluginPlatform: { listApprovals: () => [] }
      })),
  // T114/T113 - the unified history model and its sanitized export, built by
  // the same protocol module the real connection uses.
  "history.model": async () => buildHistoryModel({
    activity: engine.getActivity({ limit: 200 }).events,
    decisions: (await FIXTURES["decisions.list"]()).records,
    recipes: engine.listRecipes()
  }),
  "history.export": async params => exportHistory({
    model: await FIXTURES["history.model"](),
    format: (params && params.format) || "json",
    filter: (params && params.filter) || {},
    project: (params && params.project) || "Visual acceptance"
  }),
  // `recipe.list` returns a bare array (RecipesView.jsx:20).
  "recipe.list": () => ([
    {
      id: "r-morning",
      name: "Morning stack",
      maxParallel: 3,
      workerIds: ["api", "web", "tests"],
      steps: [
        { workerId: "api", dependsOn: [] },
        { workerId: "web", dependsOn: ["api"] },
        { workerId: "tests", dependsOn: ["api", "web"] }
      ],
      run: { phase: "completed", startedAt: now - 3 * 3600000, finishedAt: now - 3 * 3600000 + 9000 },
      runHistory: [{ runId: "run-1", phase: "completed", startedAt: now - 3 * 3600000, finishedAt: now - 3 * 3600000 + 9000, durationMs: 9000, completed: ["api", "web"], failures: [] }]
    },
    {
      id: "r-review",
      name: "Review agents",
      maxParallel: 2,
      workerIds: ["agent-claude", "agent-codex"],
      steps: [
        { workerId: "agent-claude", dependsOn: [] },
        { workerId: "agent-codex", dependsOn: ["agent-claude"] }
      ],
      run: { phase: "failed", startedAt: now - 26 * 3600000, finishedAt: now - 26 * 3600000 + 4200, error: "codex exited 127" }
    },
    {
      id: "r-db",
      name: "Database session",
      maxParallel: 1,
      workerIds: ["db"],
      steps: [{ workerId: "db", dependsOn: [] }],
      run: null
    }
  ]),
  "recipe.run": () => ({ ok: true, runId: "run-3" }),
  "recipe.save": () => ({ ok: true }),
  // IntegrationsView reads status / capability / permission / projectRequired.
  "integration.list": () => ([
    { id: "mission-ai", name: "Mission AI", status: "available", enabled: true, capability: "Ask questions about live workspace state.", permission: "Reads engine evidence; never writes", projectRequired: true },
    { id: "vscode", name: "VS Code Bridge", status: "available", enabled: false, capability: "Managed terminals inside the editor.", permission: "Editor-scoped terminal control", projectRequired: true },
    { id: "mcp", name: "MCP Gateway", status: "available", enabled: true, capability: "Secure tool gateway for agents.", permission: "Approval-gated tool calls", projectRequired: true },
    { id: "mobile", name: "Mobile companion", status: "foundation", enabled: false, capability: "Approve from a paired device.", permission: "Paired devices only", projectRequired: false },
    { id: "plugins", name: "Plugins", status: "available", enabled: true, capability: "Local extension points.", permission: "Declared plugin manifest", projectRequired: false },
    { id: "automation", name: "Automation", status: "foundation", enabled: true, capability: "Scheduled and triggered workflows.", permission: "Runs saved recipes only", projectRequired: true },
    { id: "github", name: "GitHub", status: "planned", enabled: false, capability: "Pull request and check context.", permission: "Read-only repository metadata", projectRequired: true, blockedReason: "Not available in this release." }
  ]),
  "missionAi.status": () => ({ configured: true, provider: "anthropic", model: "claude-opus-5", history: [] }),
  "missionSupervisor.status": () => ({ configured: true, autonomy: "supervised" }),
  "missionSupervisor.approval.list": () => ([supervisorApproval]),
  "mission.approval.list": () => ([missionApproval]),
  "mcp.approval.list": () => ([mcpApproval]),
  "mcp.status": () => ({ enabled: true, tools: 14, tokenRotatedAt: now - 5 * 86400000 }),
  "mcp.audit.list": () => ([]),
  "mobile.audit.list": () => ([]),
  "automation.approval.list": () => ([]),
  "automation.list": () => ({ approvals: [], workflows: [{ id: "w1", name: "Nightly integration run", enabled: true, trigger: "schedule", lastRunAt: now - 8 * 3600000 }] }),
  "mobile.approval.list": () => ([]),
  // MOBILE_RUNNING=1 photographs the pairing state instead of the switched-off one.
  "mobile.status": () => process.env.MOBILE_RUNNING
    ? { enabled: true, running: true, available: true, port: 37422, scopes: ["summary.read", "workers.read", "needs.read", "memory.read", "assistant.ask"], endpoints: ["http://192.168.1.50:37422"], deviceCount: 2, revokedDeviceCount: 1, activeClientCount: 1, pendingApprovalCount: 1, activeInvitation: { pairingId: "pair-1", code: "482913", expiresAt: Date.now() + 272000 } }
    : { enabled: false, running: false, available: true, scopes: ["summary.read", "workers.read", "needs.read", "memory.read"], deviceCount: 0, revokedDeviceCount: 0, activeClientCount: 0, pendingApprovalCount: 0 },
  "mobile.device.list": () => process.env.MOBILE_RUNNING
    ? [{ id: "mobile-1", name: "Pixel 9", lastSeenAt: Date.now() - 120000, scopes: ["summary.read", "workers.read", "needs.read", "memory.read", "assistant.ask"], state: "active" }, { id: "mobile-2", name: "iPad", lastSeenAt: Date.now() - 7200000, scopes: ["summary.read", "workers.read"], state: "active" }]
    : [],
  "plugin.approval.list": () => ([]),
  "plugin.status": () => ({ enabled: true, installed: 2 }),
  "plugin.list": () => ([
    { enabled: true, source: "import", installedAt: Date.now() - 86400000, grantedPermissions: ["context.read"], manifest: { id: "jira-links", name: "Jira links", publisher: "acme", version: "1.2.0", description: "Links terminal output that mentions a ticket to its Jira issue.", surfaces: ["workspace"], actions: [], permissions: ["context.read"], contributions: [] } },
    { enabled: false, source: "import", installedAt: Date.now() - 3 * 86400000, grantedPermissions: [], manifest: { id: "slack-notify", name: "Slack notify", publisher: "acme", version: "0.9.1", description: "Posts a message when a worker fails.", surfaces: [], actions: [], permissions: ["context.read"], contributions: [] } }
  ]),
  "plugin.audit.list": () => ([]),
  // MC_FIXTURE_VSCODE=connected renders the bridge in its live state so the
  // terminal-control half of the panel can be reviewed too.
  "vscode.status": () => (process.env.MC_FIXTURE_VSCODE === "connected" ? {
    connected: true,
    awaitingHandshake: false,
    connection: { clientId: "vscode-1", extensionVersion: "2.19.0", connectedAt: now - 12 * MINUTE, capabilities: ["editor.activeFile.read", "terminals.manage"] },
    editor: { relativePath: "src/service/engineHost.cjs", line: 214, column: 8, dirty: true },
    diagnostics: { errors: 2, warnings: 5, information: 0, hints: 1, items: [{ path: "src/service/engineHost.cjs", severity: "error" }, { path: "src/groundstation/renderer/App.jsx", severity: "warning" }] },
    git: { branch: "feature/bridge-ui", changedPaths: 7, ahead: 2, behind: 0 },
    tasks: [],
    terminals: [
      { id: "t-1", name: "dev server", controllable: false, active: true, currentCommand: "npm run dev", commandState: "running", cwd: "apps/web", shellIntegration: true },
      { id: "t-2", name: "OUTARCH · migrations", controllable: true, active: false, currentCommand: "", commandState: "idle", cwd: "services/api", shellIntegration: true }
    ],
    lastSyncAt: now - 40 * 1000,
    lastError: null
  } : { connected: false, awaitingHandshake: false }),
  "mission.list": () => ([
    { id: "mission-1", title: "Refactor authentication", state: "running", agentId: "agent-claude", steps: 6, completedSteps: 3, updatedAt: now - 2 * MINUTE },
    { id: "mission-2", title: "Review billing migration", state: "blocked", agentId: "agent-codex", steps: 4, completedSteps: 1, updatedAt: now - 19 * MINUTE }
  ]),
  // Real shape from projectCoordinator.list(): a wrapper with registryError plus
  // rich per-project inspection records. The bare array the harness used before
  // rendered a switcher with no status, which hid the row layout defect.
  "projects.list": () => ({
    registryError: null,
    projects: [
      { id: "p-first", name: "first", rootPath: "D:\\first", configPath: "D:\\first\\termctl.config.json", status: "ready", current: true, error: null, lastOpenedAt: now - 45 * MINUTE },
      { id: "p-v1", name: "Visual acceptance", rootPath: "C:\\Users\\Satish kumar\\AppData\\Local\\Temp\\mission-control-visual-xhkMBr", configPath: "x", status: "missing", current: false, error: "project folder is missing", lastOpenedAt: now - 3 * MINUTE },
      { id: "p-v2", name: "Visual acceptance", rootPath: "C:\\Users\\Satish kumar\\AppData\\Local\\Temp\\mission-control-visual-WpoibM", configPath: "y", status: "missing", current: false, error: "project folder is missing", lastOpenedAt: now - 9 * MINUTE },
      { id: "p-api", name: "acme-console", rootPath: "D:\\work\\acme-console", configPath: "z", status: "warning", current: false, error: null, lastOpenedAt: now - MINUTE },
      { id: "p-new", name: "payments-service", rootPath: "D:\\work\\payments-service", configPath: "w", status: "uninitialized", current: false, error: null, lastOpenedAt: null }
    ]
  }),
  "project.removeRecent": () => ({ removed: true })
};

Object.assign(FIXTURES, require("./aiFixtures.cjs")({ now, MINUTE }));

function handle(method, params) {
  if (method === "state.get") {
    const state = engine.getState();
    // The renderer forces the Projects route unless a persistent workspace is
    // open; the harness inspects the operational routes, so present one.
    return {
      ...state,
      workspace: {
        ...state.workspace,
        persistent: true,
        name: "acme-console",
        directory: "D:/work/acme-console",
        path: "D:/work/acme-console/.termctl/workspace.json"
      }
    };
  }
  // MC_FIXTURE_FAIL=<regex> makes the matching requests fail the way a
  // stopped service does, to exercise every error state.
  if (process.env.MC_FIXTURE_FAIL && new RegExp(process.env.MC_FIXTURE_FAIL).test(method)) {
    throw new Error("The service did not answer (harness failure)");
  }
  const fixture = FIXTURES[method];
  const value = fixture ? fixture(params) : { ok: true };
  return process.env.MC_FIXTURE_EMPTY === "1" ? emptied(value) : value;
}

// Every list in a payload is emptied; the shapes stay what consumers expect.
function emptied(value) {
  if (value && typeof value.then === "function") return value.then(emptied);
  if (Array.isArray(value)) return [];
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Array.isArray(item) ? [] : item]));
}

module.exports = { handle, engine };
