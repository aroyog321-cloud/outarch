const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EngineAPI } = require("../src/engine/index.cjs");
const {
  PROTOCOL_VERSION,
  MAX_REQUEST_BYTES,
  MAX_TERMINAL_BATCH_BYTES,
  MAX_TERMINAL_INPUT_BYTES,
  MAX_TERMINAL_QUEUE_BYTES,
  createProtocolConnection
} = require("../src/protocol/connection.cjs");
const { makeFakePtyFactory } = require("./fakePty.cjs");

function request(id, method, params = {}) {
  return { version: PROTOCOL_VERSION, id, method, params };
}

async function confirmed(connection, id, method, params = {}) {
  const issued = await connection.handle(request(`${id}-confirmation`, "confirmation.request", {
    targetMethod: method,
    targetParams: params
  }));
  assert.equal(issued.ok, true, issued.error?.message);
  return connection.handle(request(id, method, { ...params, confirmation: issued.result.token }));
}

function makeEngineStub(overrides = {}) {
  let subscriber = null;
  let sequence = 0;
  return {
    subscribe(scope, callback) {
      assert.equal(scope, "all");
      subscriber = callback;
      return () => { subscriber = null; };
    },
    emit(event) {
      sequence = Math.max(sequence, event.sequence || 0);
      subscriber?.(event);
    },
    setSequence(value) { sequence = value; },
    getState() {
      return { contractVersion: 1, sequence, generatedAt: Date.now(), sessions: [] };
    },
    getActivity() { return { contractVersion: 1, events: [] }; },
    getWorkspace() { return { version: 1, name: "Test" }; },
    listIntegrations() { return [{ id: "vscode", name: "VS Code Bridge", enabled: false }]; },
    getSnapshot(id) { return id === "worker" ? { id, status: "running", lines: [] } : null; },
    getSessionConfiguration(id) { return id === "worker" ? { id, envKeys: [] } : null; },
    listSavedCommands() { return []; },
    ...overrides
  };
}

test("protocol validates versions, fixed request shape, malformed JSON, and byte limits", async () => {
  const sent = [];
  const connection = createProtocolConnection(makeEngineStub(), { send: message => sent.push(message) });

  const version = await connection.handle({ version: 2, id: "version", method: "state.get", params: {} });
  assert.deepEqual(version.error, {
    code: "VERSION_MISMATCH",
    message: "unsupported protocol version: 2"
  });
  assert.equal(version.id, "version");

  const malformed = await connection.handle("{not-json");
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, "INVALID_REQUEST");

  const extra = await connection.handle({
    ...request("extra", "state.get"),
    unexpected: true
  });
  assert.equal(extra.error.code, "INVALID_REQUEST");

  const oversized = await connection.handle(request("large", "state.get", {
    value: "x".repeat(MAX_REQUEST_BYTES)
  }));
  assert.equal(oversized.error.code, "REQUEST_TOO_LARGE");
  assert.equal(sent.length, 4);
  connection.dispose();
});

test("action dispatch calls the public action exactly once and gates destructive actions", async () => {
  let restarts = 0;
  let kills = 0;
  const engine = makeEngineStub({
    restart(id) {
      assert.equal(id, "worker");
      restarts++;
      return { ok: true };
    },
    kill(id) {
      assert.equal(id, "worker");
      kills++;
      return { ok: true };
    }
  });
  const connection = createProtocolConnection(engine, { send: () => {} });

  const restarted = await connection.handle(request("restart", "action.dispatch", {
    sessionId: "worker",
    action: { type: "restart" }
  }));
  assert.equal(restarted.ok, true);
  assert.equal(restarts, 1);

  const rejected = await connection.handle(request("kill-no", "action.dispatch", {
    sessionId: "worker",
    action: { type: "kill" }
  }));
  assert.equal(rejected.error.code, "CONFIRMATION_REQUIRED");
  assert.equal(kills, 0);

  const killed = await confirmed(connection, "kill-yes", "action.dispatch", {
    sessionId: "worker",
    action: { type: "kill" }
  });
  assert.equal(killed.ok, true);
  assert.equal(kills, 1);
  connection.dispose();
});

test("confirmation tokens are unpredictable, exact-operation-bound, expiring, and single use", async () => {
  let clock = 1_000;
  let kills = 0;
  const audit = [];
  const engine = makeEngineStub({
    getSnapshot: id => id === "worker" || id === "other" ? { id } : null,
    kill: () => { kills++; return { ok: true }; },
    recordConfirmationEvent: (kind, payload) => { audit.push({ kind, ...payload }); return { ok: true }; }
  });
  const connection = createProtocolConnection(engine, { send: () => {}, now: () => clock });
  const targetParams = { sessionId: "worker", action: { type: "kill" } };

  const first = await connection.handle(request("issue-first", "confirmation.request", { targetMethod: "action.dispatch", targetParams }));
  const second = await connection.handle(request("issue-second", "confirmation.request", { targetMethod: "action.dispatch", targetParams }));
  assert.equal(first.ok, true);
  assert.equal(first.result.confirmationProtocolVersion, 2);
  assert.notEqual(first.result.token, second.result.token);
  assert.doesNotMatch(first.result.token, /^confirm:/);

  const safeTarget = await connection.handle(request("issue-safe", "confirmation.request", {
    targetMethod: "state.get",
    targetParams: {}
  }));
  assert.equal(safeTarget.error.code, "INVALID_PARAMS");

  const mismatch = await connection.handle(request("mismatch", "action.dispatch", {
    sessionId: "other",
    action: { type: "kill" },
    confirmation: first.result.token
  }));
  assert.equal(mismatch.error.code, "CONFIRMATION_MISMATCH");
  assert.equal(kills, 0);
  const mismatchReplay = await connection.handle(request("mismatch-replay", "action.dispatch", { ...targetParams, confirmation: first.result.token }));
  assert.equal(mismatchReplay.error.code, "CONFIRMATION_INVALID");

  const executed = await connection.handle(request("execute", "action.dispatch", { ...targetParams, confirmation: second.result.token }));
  assert.equal(executed.ok, true);
  assert.equal(kills, 1);
  const replay = await connection.handle(request("replay", "action.dispatch", { ...targetParams, confirmation: second.result.token }));
  assert.equal(replay.error.code, "CONFIRMATION_INVALID");

  const expiring = await connection.handle(request("issue-expiring", "confirmation.request", { targetMethod: "action.dispatch", targetParams }));
  clock = expiring.result.expiresAt;
  const expired = await connection.handle(request("expired", "action.dispatch", { ...targetParams, confirmation: expiring.result.token }));
  assert.equal(expired.error.code, "CONFIRMATION_EXPIRED");

  const predictable = await connection.handle(request("predictable", "action.dispatch", { ...targetParams, confirmation: "confirm:kill:worker" }));
  assert.equal(predictable.error.code, "CONFIRMATION_INVALID");
  assert.equal(kills, 1);
  assert.deepEqual(audit, [
    { kind: "requested", operation: "action.dispatch" },
    { kind: "requested", operation: "action.dispatch" },
    { kind: "rejected", operation: "action.dispatch", outcomeCode: "CONFIRMATION_MISMATCH" },
    { kind: "rejected", operation: "action.dispatch", outcomeCode: "CONFIRMATION_INVALID" },
    { kind: "confirmed", operation: "action.dispatch" },
    { kind: "completed", operation: "action.dispatch" },
    { kind: "rejected", operation: "action.dispatch", outcomeCode: "CONFIRMATION_INVALID" },
    { kind: "requested", operation: "action.dispatch" },
    { kind: "expired", operation: "action.dispatch", outcomeCode: "CONFIRMATION_EXPIRED" },
    { kind: "rejected", operation: "action.dispatch", outcomeCode: "CONFIRMATION_INVALID" }
  ]);
  connection.dispose();
});

test("Recipes 2 routes enforce delete confirmation and route lifecycle actions through EngineAPI", async () => {
  const calls = [];
  const engine = makeEngineStub({
    deleteRecipe(id) { calls.push(["delete", id]); return { ok: true }; },
    runRecipe(id, options) { calls.push(["run", id, options]); return { ok: true }; },
    pauseRecipe(id) { calls.push(["pause", id]); return { ok: true }; },
    resumeRecipe(id) { calls.push(["resume", id]); return { ok: true }; },
    cancelRecipe(id) { calls.push(["cancel", id]); return { ok: true }; }
  });
  const connection = createProtocolConnection(engine, { send: () => {} });
  const unconfirmedDelete = await connection.handle(request("delete-blocked", "recipe.delete", { recipeId: "daily" }));
  assert.equal(unconfirmedDelete.error.code, "CONFIRMATION_REQUIRED");
  assert.equal((await confirmed(connection, "delete", "recipe.delete", { recipeId: "daily" })).ok, true);
  assert.equal((await connection.handle(request("run", "recipe.run", { recipeId: "daily", recover: true }))).ok, true);
  assert.equal((await connection.handle(request("pause", "recipe.pause", { recipeId: "daily" }))).ok, true);
  assert.equal((await connection.handle(request("resume", "recipe.resume", { recipeId: "daily" }))).ok, true);
  assert.equal((await connection.handle(request("cancel", "recipe.cancel", { recipeId: "daily" }))).ok, true);
  assert.deepEqual(calls, [
    ["delete", "daily"],
    ["run", "daily", { recover: true }],
    ["pause", "daily"],
    ["resume", "daily"],
    ["cancel", "daily"]
  ]);
  const hello = await connection.handle(request("hello", "system.hello"));
  assert.equal(hello.result.methods.includes("recipe.cancel"), true);
  assert.deepEqual(hello.result.confirmation, {
    version: 2,
    method: "confirmation.request",
    binding: "method-and-exact-params",
    singleUse: true,
    legacyPredictableTokens: false,
    ttlMs: 60_000,
    maxPendingPerConnection: 128
  });
  connection.dispose();
});

test("system.hello reports supported and unavailable capabilities with truthful runtime states", async () => {
  const connection = createProtocolConnection(makeEngineStub(), {
    send: () => {},
    projectService: {},
    missionAi: { status: () => ({ available: true, configured: false, busy: false }) },
    missionSupervisor: { status: () => ({}) },
    vscodeBridge: { status: () => ({ awaitingHandshake: true, connected: false, lastError: null }) },
    mcpGateway: { status: () => { throw new Error("gateway status failed"); } },
    mobileCompanion: { status: () => ({ available: false, error: "protected storage unavailable" }) }
  });

  const hello = await connection.handle(request("hello-capabilities", "system.hello"));
  const capabilities = hello.result.capabilities;
  assert.equal(capabilities.engine.support, "supported");
  assert.equal(capabilities.engine.state, "ready");
  assert.equal(capabilities.intelligence.state, "disabled");
  assert.equal(capabilities.vscode.state, "loading");
  assert.equal(capabilities.mcp.support, "supported");
  assert.equal(capabilities.mcp.state, "error");
  assert.match(capabilities.mcp.reason, /gateway status failed/);
  assert.equal(capabilities.companion.state, "unavailable");
  // The plugin platform was removed; no capability advertises it.
  assert.equal(capabilities.extensions, undefined);
  // T023 — broadcast is a real, approval-backed capability now.
  assert.equal(capabilities["terminal-broadcast"].support, "supported");
  assert.equal(capabilities["terminal-broadcast"].state, "ready");
  assert.ok(capabilities["terminal-broadcast"].methods.includes("terminal.broadcast"));
  assert.ok(capabilities["terminal-broadcast"].methods.includes("terminal.broadcast.preview"));
  assert.equal(capabilities["crashlens-free-port"].state, "unavailable");
  assert.ok(capabilities.vscode.methods.includes("vscode.terminal.create"));
  connection.dispose();
});

test("VS Code Bridge methods stay behind Protocol v1 and stream bounded integration status", async () => {
  const sent = [];
  const calls = [];
  const subscribers = new Set();
  const vscodeBridge = {
    status: () => ({ connected: true, editor: { relativePath: "src/app.js" } }),
    subscribe(callback) { subscribers.add(callback); return () => subscribers.delete(callback); },
    launch() { calls.push(["launch"]); return { launched: true, awaitingHandshake: true }; },
    openFile(value) { calls.push(["openFile", value]); return { sent: true }; },
    openProblems() { calls.push(["openProblems"]); return { sent: true }; },
    createManagedTerminal(value) { calls.push(["createManagedTerminal", value]); return { ok: true, terminalId: "terminal-managed" }; },
    writeManagedTerminal(value) { calls.push(["writeManagedTerminal", value]); return { ok: true, terminalId: value.terminalId }; },
    focusManagedTerminal(value) { calls.push(["focusManagedTerminal", value]); return { ok: true, terminalId: value.terminalId }; },
    closeManagedTerminal(value) { calls.push(["closeManagedTerminal", value]); return { ok: true, terminalId: value.terminalId }; },
    disconnect(reason) { calls.push(["disconnect", reason]); return true; }
  };
  const connection = createProtocolConnection(makeEngineStub(), { send: message => sent.push(message), vscodeBridge });

  const integrations = await connection.handle(request("integrations", "integration.list"));
  assert.equal(integrations.result[0].enabled, true);
  assert.equal(integrations.result[0].bridge.editor.relativePath, "src/app.js");
  assert.equal((await connection.handle(request("status", "vscode.status"))).result.connected, true);
  assert.equal((await connection.handle(request("launch", "vscode.launch"))).result.launched, true);
  assert.equal((await connection.handle(request("file", "vscode.openFile", { relativePath: "src/app.js", line: 8, column: 2 }))).ok, true);
  assert.equal((await connection.handle(request("problems", "vscode.openProblems"))).ok, true);
  assert.equal((await confirmed(connection, "create-terminal", "vscode.terminal.create", { name: "Backend", cwd: "apps/api" })).result.terminalId, "terminal-managed");
  assert.equal((await confirmed(connection, "write-terminal", "vscode.terminal.write", { terminalId: "terminal-managed", input: "npm run dev" })).ok, true);
  assert.equal((await connection.handle(request("focus-terminal", "vscode.terminal.focus", { terminalId: "terminal-managed" }))).ok, true);
  assert.equal((await confirmed(connection, "close-terminal", "vscode.terminal.close", { terminalId: "terminal-managed" })).ok, true);
  assert.equal((await connection.handle(request("write-without-approval", "vscode.terminal.write", { terminalId: "terminal-managed", input: "npm test" }))).error.code, "CONFIRMATION_REQUIRED");
  assert.equal((await connection.handle(request("disconnect", "vscode.disconnect"))).result.disconnected, true);
  assert.deepEqual(calls, [
    ["launch"],
    ["openFile", { relativePath: "src/app.js", line: 8, column: 2 }],
    ["openProblems"],
    ["createManagedTerminal", { name: "Backend", cwd: "apps/api" }],
    ["writeManagedTerminal", { terminalId: "terminal-managed", input: "npm run dev", addNewLine: undefined }],
    ["focusManagedTerminal", { terminalId: "terminal-managed" }],
    ["closeManagedTerminal", { terminalId: "terminal-managed" }],
    ["disconnect", "renderer-request"]
  ]);

  for (const subscriber of subscribers) subscriber({ connected: false, lastError: null });
  assert.deepEqual(sent.at(-1), {
    version: 1,
    type: "integration:event",
    integration: "vscode",
    status: { connected: false, lastError: null }
  });
  connection.dispose();
  assert.equal(subscribers.size, 0);
});

test("Mission Context is exposed as a read-only Protocol v1 snapshot with validated options", async () => {
  const calls = [];
  const missionContext = {
    snapshot(options) {
      calls.push(options);
      if (typeof options.includeOutput !== "boolean") throw new TypeError("includeOutput must be a boolean");
      return { contextVersion: 1, workers: [], visibility: { terminalOutput: options.includeOutput ? "sanitized-bounded" : "omitted" } };
    }
  };
  const connection = createProtocolConnection(makeEngineStub(), {
    send: () => {},
    missionContext
  });

  const context = await connection.handle(request("context", "context.snapshot", {
    includeOutput: true,
    workerIds: ["worker"]
  }));
  assert.equal(context.ok, true);
  assert.equal(context.result.contextVersion, 1);
  assert.equal(context.result.visibility.terminalOutput, "sanitized-bounded");
  assert.deepEqual(calls, [{ includeOutput: true, workerIds: ["worker"] }]);

  const invalid = await connection.handle(request("context-invalid", "context.snapshot", {
    includeOutput: "yes"
  }));
  assert.equal(invalid.error.code, "INVALID_PARAMS");
  connection.dispose();
});

test("Project Supervision is exposed as the shared read-only Groundstation snapshot", async () => {
  const calls = [];
  const projectSupervision = { snapshot: options => { calls.push(options); return { supervisionVersion: 1, overview: { whatIsRunning: { summary: "One worker is active." } }, facts: {}, inferences: [], evidenceIndex: [] }; } };
  const connection = createProtocolConnection(makeEngineStub(), { send: () => {}, projectSupervision });
  const response = await connection.handle(request("supervision", "supervision.get", { afterSequence: 8 }));
  assert.equal(response.result.supervisionVersion, 1);
  assert.equal(response.result.overview.whatIsRunning.summary, "One worker is active.");
  assert.deepEqual(calls, [{ afterSequence: 8, includeOutput: false }]);
  connection.dispose();
});

test("Built-in Mission AI stays behind Protocol v1 with observe-only queries and credential confirmation", async () => {
  const calls = [];
  const missionAi = {
    status: () => ({ configured: true, authority: "observe", model: "gemini-2.5-flash" }),
    configure: configuration => { calls.push(["configure", configuration]); return { configured: true, authority: "observe" }; },
    ask: value => { calls.push(["ask", value]); return { text: "Grounded answer", authority: "observe", grounded: true }; },
    clear: () => { calls.push(["clear"]); return { removed: true }; }
  };
  const engine = makeEngineStub({
    listIntegrations: () => [
      { id: "vscode", enabled: false },
      { id: "mission-ai", enabled: false }
    ]
  });
  const connection = createProtocolConnection(engine, { send: () => {}, missionAi });

  assert.equal((await connection.handle(request("status", "missionAi.status"))).result.authority, "observe");
  const configured = await connection.handle(request("configure", "missionAi.configure", {
    configuration: { apiKey: "AIzaSyExampleMissionControlKey123456789", includeTerminalEvidence: false }
  }));
  assert.equal(configured.ok, true);
  assert.equal(JSON.stringify(configured).includes("AIzaSy"), false);
  const answer = await connection.handle(request("ask", "missionAi.ask", { question: "What is happening?", afterSequence: 12 }));
  assert.equal(answer.result.text, "Grounded answer");
  const integrations = await connection.handle(request("integrations-ai", "integration.list"));
  assert.equal(integrations.result.find(item => item.id === "mission-ai").enabled, true);

  const refused = await connection.handle(request("clear-no", "missionAi.clear"));
  assert.equal(refused.error.code, "CONFIRMATION_REQUIRED");
  assert.equal((await confirmed(connection, "clear-yes", "missionAi.clear")).ok, true);
  assert.deepEqual(calls.map(call => call[0]), ["configure", "ask", "clear"]);
  assert.deepEqual(calls[1][1], { question: "What is happening?", afterSequence: 12 });
  connection.dispose();
});

test("Mission Supervisor plans and resolves only through explicit local approval", async () => {
  const calls = [];
  const missionSupervisor = {
    status: () => ({ pendingApprovalCount: 1, authority: "local-approval-required" }),
    propose: value => { calls.push(["propose", value]); return { id: "approval-1", state: "pending", plan: { actions: [] } }; },
    listApprovals: () => [{ id: "approval-1", state: "pending" }],
    resolve: (id, decision) => { calls.push(["resolve", id, decision]); return { id, state: decision === "approve" ? "executed" : "denied" }; }
  };
  const connection = createProtocolConnection(makeEngineStub(), { send: () => {}, missionSupervisor });
  assert.equal((await connection.handle(request("supervisor-status", "missionSupervisor.status"))).result.pendingApprovalCount, 1);
  assert.equal((await connection.handle(request("supervisor-plan", "missionSupervisor.plan", { instruction: "Create backend" }))).result.state, "pending");
  assert.equal((await connection.handle(request("supervisor-list", "missionSupervisor.approval.list"))).result.length, 1);
  const refused = await connection.handle(request("supervisor-refused", "missionSupervisor.approval.resolve", { approvalId: "approval-1", decision: "approve" }));
  assert.equal(refused.error.code, "CONFIRMATION_REQUIRED");
  const resolved = await confirmed(connection, "supervisor-resolve", "missionSupervisor.approval.resolve", {
    approvalId: "approval-1",
    decision: "approve"
  });
  assert.equal(resolved.result.state, "executed");
  assert.deepEqual(calls, [
    ["propose", { instruction: "Create backend", afterSequence: undefined }],
    ["resolve", "approval-1", "approve"]
  ]);
  connection.dispose();
});

test("Secure MCP Gateway configuration, audit, and approvals stay behind Protocol v1 confirmations", async () => {
  const calls = [];
  let subscriber = null;
  const mcpGateway = {
    status: () => ({ running: true, pendingApprovalCount: 1, scopes: ["context.read"] }),
    configure: async value => { calls.push(["configure", value]); return { running: value.enabled === true }; },
    rotateToken: () => { calls.push(["rotate"]); return { token: "one-time", status: { running: true } }; },
    getToken: () => ({ token: "active-token", configured: true, endpoint: "http://127.0.0.1:37421/mcp" }),
    installClient: ({ target, workspacePath }) => { calls.push(["installClient", target, workspacePath]); return { ok: true, target }; },
    removeClient: ({ target, workspacePath }) => { calls.push(["removeClient", target, workspacePath]); return { ok: true, target, removed: true }; },
    clientStatus: ({ workspacePath }) => { calls.push(["clientStatus", workspacePath]); return { "claude-code": { installed: true } }; },
    listApprovals: () => [{ id: "approval-1", state: "pending" }],
    resolveApproval: async (id, decision) => { calls.push(["resolve", id, decision]); return { id, state: decision === "approve" ? "approved" : "denied" }; },
    listAudit: limit => [{ id: "audit-1", limit }],
    subscribe: callback => { subscriber = callback; return () => { subscriber = null; }; }
  };
  const sent = [];
  const engine = makeEngineStub({ listIntegrations: () => [{ id: "assistant", status: "available", enabled: false }] });
  const connection = createProtocolConnection(engine, { send: message => sent.push(message), mcpGateway });

  assert.equal((await connection.handle(request("status", "mcp.status"))).result.running, true);
  assert.equal((await connection.handle(request("token", "mcp.getToken"))).result.token, "active-token");
  assert.equal((await connection.handle(request("install", "mcp.installClient", { target: "claude-code" }))).result.ok, true);
  assert.equal((await connection.handle(request("remove", "mcp.removeClient", { target: "claude-code" }))).result.removed, true);
  assert.equal((await connection.handle(request("cstatus", "mcp.clientStatus"))).result["claude-code"].installed, true);
  assert.equal((await connection.handle(request("configure", "mcp.configure", { configuration: { enabled: true, scopes: ["context.read"] } }))).ok, true);
  assert.equal((await connection.handle(request("rotate-no", "mcp.rotateToken"))).error.code, "CONFIRMATION_REQUIRED");
  assert.equal((await confirmed(connection, "rotate", "mcp.rotateToken")).result.token, "one-time");
  assert.equal((await connection.handle(request("approval-no", "mcp.approval.resolve", { approvalId: "approval-1", decision: "approve" }))).error.code, "CONFIRMATION_REQUIRED");
  assert.equal((await confirmed(connection, "approval", "mcp.approval.resolve", { approvalId: "approval-1", decision: "approve" })).result.state, "approved");
  assert.equal((await connection.handle(request("audit", "mcp.audit.list", { limit: 7 }))).result[0].limit, 7);
  assert.equal((await connection.handle(request("integrations-mcp", "integration.list"))).result[0].enabled, true);

  subscriber({ running: false, pendingApprovalCount: 0 });
  assert.deepEqual(sent.at(-1), { version: 1, type: "integration:event", integration: "mcp", status: { running: false, pendingApprovalCount: 0 } });
  assert.deepEqual(calls, [
    ["installClient", "claude-code", ""],
    ["removeClient", "claude-code", ""],
    ["clientStatus", ""],
    ["configure", { enabled: true, scopes: ["context.read"] }],
    ["rotate"],
    ["resolve", "approval-1", "approve"]
  ]);
  connection.dispose();
  assert.equal(subscriber, null);
});

test("deeper mission supervision keeps lifecycle, checkpoints, and approvals behind EngineAPI", async () => {
  const calls = [];
  const engine = makeEngineStub({
    listMissionApprovals: () => [{ id: "approval-1", state: "pending" }],
    requestMissionApproval: (agentId, value) => { calls.push(["request", agentId, value]); return { ok: true, approval: { id: "approval-1" } }; },
    resolveMissionApproval: (missionId, approvalId, decision) => { calls.push(["resolve", missionId, approvalId, decision]); return { ok: true, approval: { id: approvalId, state: decision === "approve" ? "approved" : "denied" } }; },
    verifyMissionCheckpoint: (missionId, checkpointId) => { calls.push(["checkpoint", missionId, checkpointId]); return { ok: true }; },
    transitionMission: (missionId, state) => { calls.push(["transition", missionId, state]); return { ok: true }; }
  });
  const connection = createProtocolConnection(engine, { send: () => {} });

  assert.equal((await connection.handle(request("list", "mission.approval.list"))).result[0].state, "pending");
  assert.equal((await connection.handle(request("request", "mission.approval.request", { agentId: "agent-codex", scopes: ["write"], reason: "Update manifest", impact: "One write" }))).ok, true);
  assert.equal((await connection.handle(request("resolve-no", "mission.approval.resolve", { missionId: "mission-1", approvalId: "approval-1", decision: "approve" }))).error.code, "CONFIRMATION_REQUIRED");
  assert.equal((await confirmed(connection, "resolve", "mission.approval.resolve", { missionId: "mission-1", approvalId: "approval-1", decision: "approve" })).ok, true);
  assert.equal((await connection.handle(request("checkpoint-no", "mission.checkpoint.verify", { missionId: "mission-1", checkpointId: "review" }))).error.code, "CONFIRMATION_REQUIRED");
  assert.equal((await confirmed(connection, "checkpoint", "mission.checkpoint.verify", { missionId: "mission-1", checkpointId: "review" })).ok, true);
  assert.equal((await confirmed(connection, "transition", "mission.transition", { missionId: "mission-1", state: "completed" })).ok, true);
  assert.deepEqual(calls, [
    ["request", "agent-codex", { scopes: ["write"], reason: "Update manifest", impact: "One write" }],
    ["resolve", "mission-1", "approval-1", "approve"],
    ["checkpoint", "mission-1", "review"],
    ["transition", "mission-1", "completed"]
  ]);
  connection.dispose();
});

test("automation workflows stay behind Protocol v1 confirmations", async () => {
  let resolved = 0;
  const engine = makeEngineStub({
    listAutomations() { return { definitions: [], approvals: [], audit: [] }; },
    saveAutomation(automation) { return { ok: true, automation }; },
    deleteAutomation() { return { ok: true }; },
    testAutomation() { return { ok: true, result: { executed: false } }; },
    async resolveAutomationApproval(id, decision) { resolved++; return { ok: true, approval: { id, state: decision === "approve" ? "executed" : "denied" } }; }
  });
  const connection = createProtocolConnection(engine, { send: () => {} });
  const listed = await connection.handle(request("automation-list", "automation.list"));
  assert.equal(listed.ok, true);
  const blocked = await connection.handle(request("automation-resolve-blocked", "automation.approval.resolve", { approvalId: "approval-1", decision: "approve" }));
  assert.equal(blocked.error.code, "CONFIRMATION_REQUIRED");
  assert.equal(resolved, 0);
  const approved = await confirmed(connection, "automation-resolve", "automation.approval.resolve", { approvalId: "approval-1", decision: "approve" });
  assert.equal(approved.ok, true);
  assert.equal(resolved, 1);
  connection.dispose();
});

test("Mobile Companion pairing, revocation, and approvals stay behind Protocol v1", async () => {
  let revoked = 0;
  let resolved = 0;
  const mobileCompanion = {
    subscribe: () => () => {},
    status: () => ({ running: true, deviceCount: 1 }),
    configure: value => ({ running: value.enabled === true }),
    createInvitation: () => ({ pairingId: "pair-1", code: "123456" }),
    listDevices: () => [{ id: "phone-1", state: "paired" }],
    revokeDevice: id => { revoked++; return { revoked: true, deviceId: id }; },
    listApprovals: () => [{ id: "mobile-approval-1", state: "pending" }],
    resolveApproval: async (id, decision) => { resolved++; return { id, state: decision === "approve" ? "approved" : "denied" }; },
    listAudit: () => []
  };
  const connection = createProtocolConnection(makeEngineStub(), { send: () => {}, mobileCompanion });
  assert.equal((await connection.handle(request("mobile-status", "mobile.status"))).result.running, true);
  const blockedRevoke = await connection.handle(request("mobile-revoke-blocked", "mobile.device.revoke", { deviceId: "phone-1" }));
  assert.equal(blockedRevoke.error.code, "CONFIRMATION_REQUIRED");
  assert.equal(revoked, 0);
  const revokedResult = await confirmed(connection, "mobile-revoke", "mobile.device.revoke", { deviceId: "phone-1" });
  assert.equal(revokedResult.ok, true);
  assert.equal(revoked, 1);
  const blockedApproval = await connection.handle(request("mobile-approval-blocked", "mobile.approval.resolve", { approvalId: "mobile-approval-1", decision: "approve" }));
  assert.equal(blockedApproval.error.code, "CONFIRMATION_REQUIRED");
  assert.equal(resolved, 0);
  const approval = await confirmed(connection, "mobile-approval", "mobile.approval.resolve", { approvalId: "mobile-approval-1", decision: "approve" });
  assert.equal(approval.ok, true);
  assert.equal(resolved, 1);
  connection.dispose();
});

test("project changes invalidate the active VS Code workspace handshake", async () => {
  let workspaceChanges = 0;
  const vscodeBridge = {
    subscribe: () => () => {},
    status: () => ({ connected: false }),
    workspaceChanged() { workspaceChanges++; }
  };
  const projectService = {
    open: async () => ({ changed: true }),
    initialize: async () => ({ changed: true })
  };
  const connection = createProtocolConnection(makeEngineStub(), { send: () => {}, vscodeBridge, projectService });

  assert.equal((await confirmed(connection, "open", "project.open", { projectId: "project-1" })).ok, true);
  assert.equal((await confirmed(connection, "init", "project.initialize", { selectionToken: "selection-1" })).ok, true);
  assert.equal(workspaceChanges, 2);
  connection.dispose();
});

test("Groundstation worker management stays routed through public protocol actions", async () => {
  const calls = [];
  const engine = makeEngineStub({
    create(definition) {
      calls.push(["create", definition]);
      return { ok: true, session: { id: definition.id } };
    },
    createFromSavedCommand(commandId) {
      calls.push(["preset", commandId]);
      return { ok: true, session: { id: commandId } };
    },
    reconfigure(id, patch) {
      calls.push(["reconfigure", id, patch]);
      return { ok: true };
    },
    remove(id) {
      calls.push(["remove", id]);
      return { ok: true };
    }
  });
  const connection = createProtocolConnection(engine, { send: () => {} });

  assert.equal((await connection.handle(request("create", "action.dispatch", {
    sessionId: null,
    action: { type: "create", definition: { id: "new", command: "npm test" } }
  }))).ok, true);
  assert.equal((await connection.handle(request("preset", "action.dispatch", {
    sessionId: null,
    action: { type: "instantiateSavedCommand", commandId: "checks" }
  }))).ok, true);
  assert.equal((await connection.handle(request("edit", "action.dispatch", {
    sessionId: "worker",
    action: { type: "reconfigure", patch: { command: "npm run dev" } }
  }))).ok, true);

  const unconfirmed = await connection.handle(request("remove-no", "action.dispatch", {
    sessionId: "worker",
    action: { type: "remove" }
  }));
  assert.equal(unconfirmed.error.code, "CONFIRMATION_REQUIRED");
  assert.equal((await confirmed(connection, "remove-yes", "action.dispatch", {
    sessionId: "worker",
    action: { type: "remove" }
  })).ok, true);

  assert.deepEqual(calls.map(call => call[0]), ["create", "preset", "reconfigure", "remove"]);
  connection.dispose();
});

test("agent adapters create only allow-listed manual workers", async () => {
  const definitions = [];
  const engine = makeEngineStub({
    create(definition) {
      definitions.push(definition);
      return { ok: true, session: { id: definition.id } };
    }
  });
  const connection = createProtocolConnection(engine, {
    send: () => {},
    agentAdapterOptions: { platform: "linux", resolveCommand: command => command }
  });
  const listed = await connection.handle(request("agents", "agents.list"));
  assert.deepEqual(listed.result.map(adapter => adapter.id), ["claude", "codex", "gemini", "antigravity", "opencode"]);
  assert.deepEqual(listed.result.map(adapter => adapter.command), ["claude", "codex", "gemini", "agy", "opencode"]);

  const created = await connection.handle(request("create-agent", "agent.create", { adapterId: "claude" }));
  assert.equal(created.ok, true);
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].command, "claude");
  assert.equal(definitions[0].autoStart, false);
  assert.deepEqual(definitions[0].args, []);

  const rejected = await connection.handle(request("reject-agent", "agent.create", { adapterId: "powershell" }));
  assert.equal(rejected.error.code, "INVALID_PARAMS");
  assert.equal(definitions.length, 1);
  connection.dispose();
});

test("state snapshot activation drops earlier events, excludes output, and preserves later order", async () => {
  const sent = [];
  const engine = makeEngineStub();
  const connection = createProtocolConnection(engine, { send: message => sent.push(message) });

  engine.emit({ contractVersion: 1, sequence: 1, timestamp: 1, type: "session:created", id: "worker" });
  const snapshot = await connection.handle(request("state", "state.get"));
  assert.equal(snapshot.result.sequence, 1);
  engine.emit({ contractVersion: 1, sequence: 2, timestamp: 2, type: "session:output", id: "worker", data: "secret" });
  engine.emit({ contractVersion: 1, sequence: 3, timestamp: 3, type: "session:renamed", id: "worker", name: "API" });

  const startIndex = sent.length;
  const activated = await connection.handle(request("events", "events.activate", { afterSequence: 1 }));
  assert.equal(activated.ok, true);
  assert.deepEqual(sent.slice(startIndex).map(message => message.type || "response"), [
    "response",
    "engine:event"
  ]);
  assert.equal(sent.at(-1).event.sequence, 3);

  engine.emit({ contractVersion: 1, sequence: 4, timestamp: 4, type: "session:status", id: "worker", status: "running" });
  const events = sent.filter(message => message.type === "engine:event");
  assert.deepEqual(events.map(message => message.event.sequence), [3, 4]);
  assert.equal(JSON.stringify(events).includes("secret"), false);
  connection.dispose();
});

test("terminal protocol replays then streams without duplication and routes to the same PTY", async t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "worker", command: "x", cwd: "." }] });
  const pty = factory.last();
  pty.emitData("before open\r\n");

  const sent = [];
  const connection = createProtocolConnection(api, { send: message => sent.push(message) });
  t.after(() => connection.dispose());
  const opened = await connection.handle(request("open", "terminal.open", { sessionId: "worker" }));
  assert.equal(opened.ok, true);
  assert.match(opened.result.replay.data, /before open/);
  assert.equal(opened.result.replay.complete, true);

  pty.emitData("after open\r\n");
  const activated = await connection.handle(request("activate", "terminal.activate", {
    streamId: opened.result.streamId,
    terminalEpoch: opened.result.terminalEpoch
  }));
  assert.equal(activated.ok, true);
  const live = sent.filter(message => message.type === "terminal:data").map(message => message.data).join("");
  assert.equal(live, "after open\r\n");
  assert.equal(live.includes("before open"), false);

  assert.equal((await connection.handle(request("write", "terminal.write", {
    streamId: opened.result.streamId,
    terminalEpoch: opened.result.terminalEpoch,
    data: "npm test\r"
  }))).ok, true);
  assert.equal((await connection.handle(request("resize", "terminal.resize", {
    streamId: opened.result.streamId,
    terminalEpoch: opened.result.terminalEpoch,
    cols: 100,
    rows: 32
  }))).ok, true);
  assert.deepEqual(pty.written, ["npm test\r"]);
  assert.deepEqual(pty.resized, [[100, 32]]);
  assert.equal(factory.instances.length, 1);

  assert.equal((await connection.handle(request("close", "terminal.close", {
    streamId: opened.result.streamId
  }))).ok, true);
  const stale = await connection.handle(request("stale", "terminal.write", {
    streamId: opened.result.streamId,
    data: "ignored"
  }));
  assert.equal(stale.error.code, "TERMINAL_STALE");
});

test("terminal replay handoff retains output emitted after the replay checkpoint", async () => {
  const sent = [];
  const dataListeners = new Set();
  const exitListeners = new Set();
  let sequence = 1;
  const rawStream = {
    replay() {
      const checkpoint = sequence;
      for (const callback of [...dataListeners]) {
        callback("during replay\r\n", { sequence: ++sequence, source: "pty" });
      }
      return { data: "before replay\r\n", complete: true, throughSequence: checkpoint };
    },
    onData(callback) { dataListeners.add(callback); return () => dataListeners.delete(callback); },
    onExit(callback) { exitListeners.add(callback); return () => exitListeners.delete(callback); },
    write: () => true,
    resize: () => true
  };
  const engine = makeEngineStub({ attachRawStream: () => rawStream });
  const connection = createProtocolConnection(engine, { send: message => sent.push(message) });
  const opened = await connection.handle(request("open-race", "terminal.open", { sessionId: "worker" }));

  assert.equal(opened.result.replay.data, "before replay\r\n");
  await connection.handle(request("activate-race", "terminal.activate", {
    streamId: opened.result.streamId,
    terminalEpoch: opened.result.terminalEpoch
  }));
  assert.equal(
    sent.filter(message => message.type === "terminal:data").map(message => message.data).join(""),
    "during replay\r\n"
  );
  connection.dispose();
});

test("terminal replay handoff de-duplicates queued output already inside the checkpoint", async () => {
  const sent = [];
  const dataListeners = new Set();
  const rawStream = {
    replay() {
      for (const callback of [...dataListeners]) callback("captured\r\n", { sequence: 4 });
      return { data: "captured\r\n", complete: true, throughSequence: 4 };
    },
    onData(callback) { dataListeners.add(callback); return () => dataListeners.delete(callback); },
    onExit() { return () => {}; },
    write: () => true,
    resize: () => true
  };
  const connection = createProtocolConnection(makeEngineStub({ attachRawStream: () => rawStream }), {
    send: message => sent.push(message)
  });
  const opened = await connection.handle(request("open-dedupe", "terminal.open", { sessionId: "worker" }));
  await connection.handle(request("activate-dedupe", "terminal.activate", {
    streamId: opened.result.streamId,
    terminalEpoch: opened.result.terminalEpoch
  }));
  assert.equal(sent.some(message => message.type === "terminal:data"), false);
  connection.dispose();
});

test("terminal input and dimensions are bounded", async () => {
  const sent = [];
  const dataListeners = new Set();
  const exitListeners = new Set();
  const rawStream = {
    replay: () => ({ data: "", complete: true }),
    onData(callback) { dataListeners.add(callback); return () => dataListeners.delete(callback); },
    onExit(callback) { exitListeners.add(callback); return () => exitListeners.delete(callback); },
    write: () => true,
    resize: () => true
  };
  const engine = makeEngineStub({ attachRawStream: () => rawStream });
  const connection = createProtocolConnection(engine, { send: message => sent.push(message) });
  const opened = await connection.handle(request("open", "terminal.open", { sessionId: "worker" }));
  const competing = await connection.handle(request("open-again", "terminal.open", { sessionId: "worker" }));
  assert.equal(competing.error.code, "TERMINAL_ALREADY_OPEN");

  const input = await connection.handle(request("input", "terminal.write", {
    streamId: opened.result.streamId,
    data: "x".repeat(MAX_TERMINAL_INPUT_BYTES + 1)
  }));
  assert.equal(input.error.code, "TERMINAL_INPUT_TOO_LARGE");
  const dimensions = await connection.handle(request("dimensions", "terminal.resize", {
    streamId: opened.result.streamId,
    cols: 0,
    rows: 24
  }));
  assert.equal(dimensions.error.code, "INVALID_PARAMS");

  const unicodeOutput = "😀".repeat(Math.floor(MAX_TERMINAL_BATCH_BYTES / 4) + 3);
  for (const callback of [...dataListeners]) callback(unicodeOutput);
  await connection.handle(request("activate", "terminal.activate", {
    streamId: opened.result.streamId
  }));
  assert.equal(
    sent.filter(message => message.type === "terminal:data").map(message => message.data).join(""),
    unicodeOutput
  );
  for (const callback of [...exitListeners]) callback({ exitCode: 0, intentional: false });
  assert.equal(dataListeners.size, 0);
  assert.equal(exitListeners.size, 0);
  assert.equal(sent.some(message => message.type === "terminal:exit"), true);
  const exitedWrite = await connection.handle(request("exited-write", "terminal.write", {
    streamId: opened.result.streamId,
    data: "ignored"
  }));
  assert.equal(exitedWrite.error.code, "TERMINAL_NOT_RUNNING");
  connection.dispose();
  assert.equal(dataListeners.size, 0);
  assert.equal(exitListeners.size, 0);
});

test("terminal output overflow is explicit, bounded, and subscriptions clean up", async () => {
  const sent = [];
  const dataListeners = new Set();
  const exitListeners = new Set();
  const rawStream = {
    replay: () => ({ data: "", complete: true }),
    onData(callback) { dataListeners.add(callback); return () => dataListeners.delete(callback); },
    onExit(callback) { exitListeners.add(callback); return () => exitListeners.delete(callback); },
    write: () => true,
    resize: () => true
  };
  const engine = makeEngineStub({ attachRawStream: () => rawStream });
  const connection = createProtocolConnection(engine, { send: message => sent.push(message) });
  const opened = await connection.handle(request("open", "terminal.open", { sessionId: "worker" }));
  const output = "x".repeat(MAX_TERMINAL_QUEUE_BYTES + 128 * 1024);
  for (const callback of [...dataListeners]) callback(output);

  await connection.handle(request("activate", "terminal.activate", {
    streamId: opened.result.streamId
  }));
  const overflow = sent.find(message => message.type === "terminal:overflow");
  assert.ok(overflow.droppedBytes > 0);
  const retainedBytes = sent
    .filter(message => message.type === "terminal:data")
    .reduce((total, message) => total + Buffer.byteLength(message.data), 0);
  assert.ok(retainedBytes <= MAX_TERMINAL_QUEUE_BYTES);

  connection.dispose();
  assert.equal(dataListeners.size, 0);
  assert.equal(exitListeners.size, 0);
});

test("the removed plugin platform answers no protocol method", async () => {
  const connection = createProtocolConnection(makeEngineStub(), { send: () => {} });
  for (const method of ["plugin.status", "plugin.list", "plugin.install", "plugin.approval.resolve", "plugin.audit.list"]) {
    const response = await connection.handle(request(`removed-${method}`, method));
    assert.equal(response.ok, false, `${method} must not be served`);
    assert.equal(response.error.code, "METHOD_NOT_FOUND");
  }
  connection.dispose();
});
