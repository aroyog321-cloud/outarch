"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { createProtocolConnection } = require("../src/protocol/index.cjs");
const { LocalServiceRegistry } = require("../src/service/localServiceRegistry.cjs");
const { UsageLedger } = require("../src/service/usageLedger.cjs");
const { TerminalWindowManager } = require("../src/groundstation/main/terminalWindowManager.cjs");
const { SessionRecoveryService } = require("../src/service/sessionRecoveryService.cjs");
const { SessionJournal } = require("../src/service/sessionJournal.cjs");
const { MissionAIConversation } = require("../src/service/missionAiConversation.cjs");

function createMockEngineApi(sessions = [{ id: "worker-1", name: "Storefront", status: "running", isAlive: true }]) {
  return {
    subscribe: () => () => {},
    getState: () => ({ contractVersion: 1, sequence: 1 }),
    getActivity: () => ({ events: [] }),
    getWorkspace: () => ({}),
    listIntegrations: () => [],
    list: () => sessions,
    getSnapshot: id => sessions.find(session => session.id === id) || null,
    listSavedCommands: () => [],
    listMissions: () => [],
    listAttention: () => ({ records: [], preferences: {} }),
    listRecipes: () => [],
    listAutomations: () => ({ automations: [], audit: [] })
  };
}

test("protocol handles expanded methods (services, usage, terminal windows, recovery, conversation)", async () => {
  const engineApi = createMockEngineApi();
  const serviceRegistry = new LocalServiceRegistry();
  const usageLedger = new UsageLedger();
  const terminalWindowManager = new TerminalWindowManager({
    createWindow: async () => ({ on: () => {}, isDestroyed: () => false, focus: () => {}, show: () => {}, destroy: () => {} })
  });
  const journal = new SessionJournal();
  const sessionRecoveryService = new SessionRecoveryService(journal);
  const missionAiConversation = new MissionAIConversation({
    missionAi: { ask: async () => ({ answer: "hello", citations: [] }) }
  });

  serviceRegistry.recordOutput("worker-1", "run-1", "Frontend: http://localhost:3000\nAPI: http://localhost:8080");

  let sentMessages = [];
  const connection = createProtocolConnection(engineApi, {
    send: msg => { sentMessages.push(msg); },
    localServiceRegistry: serviceRegistry,
    usageLedger,
    terminalWindowManager,
    sessionRecoveryService,
    missionAiConversation
  });

  // Test system.hello capabilities
  const helloRes = await connection.handle({
    version: 1,
    id: "req-1",
    method: "system.hello",
    params: {}
  });
  assert.equal(helloRes.ok, true);
  assert.ok(helloRes.result.capabilities.services);
  assert.ok(helloRes.result.capabilities.usage);
  assert.ok(helloRes.result.capabilities["terminal-windows"]);
  assert.ok(helloRes.result.capabilities.recovery);

  // Test services.list
  const servicesRes = await connection.handle({
    version: 1,
    id: "req-2",
    method: "services.list",
    params: {}
  });
  assert.equal(servicesRes.ok, true);
  assert.equal(servicesRes.result.services.length, 2);

  // Test usage.query
  usageLedger.record({ projectId: "p-1", inputTokens: 50, outputTokens: 25 });
  const usageRes = await connection.handle({
    version: 1,
    id: "req-3",
    method: "usage.query",
    params: {}
  });
  assert.equal(usageRes.ok, true);
  assert.equal(usageRes.result.totals.totalTokens, 75);

  // Test terminal.window.detach
  const detachRes = await connection.handle({
    version: 1,
    id: "req-4",
    method: "terminal.window.detach",
    params: { workerId: "worker-1" }
  });
  assert.equal(detachRes.ok, true);
  assert.equal(detachRes.result.workerId, "worker-1");
  assert.equal(detachRes.result.detachedSlot, 1);

  // Test recovery.inspect
  const recoveryRes = await connection.handle({
    version: 1,
    id: "req-5",
    method: "recovery.inspect",
    params: {}
  });
  assert.equal(recoveryRes.ok, true);

  // Test missionAi.conversation.send
  const convRes = await connection.handle({
    version: 1,
    id: "req-6",
    method: "missionAi.conversation.send",
    params: { text: "Hello AI" }
  });
  assert.equal(convRes.ok, true);
  assert.equal(convRes.result.message.text, "hello");

  connection.dispose();
});

test("opening a service resolves the id against the registry instead of trusting a supplied URL", async () => {
  const registry = new LocalServiceRegistry();
  registry.recordOutput("worker-1", "run-1", "Local: http://localhost:5173/");
  const [service] = registry.listServices();
  const opened = [];

  const connection = createProtocolConnection(createMockEngineApi(), {
    send: () => {},
    localServiceRegistry: registry,
    openServiceUrl: async url => opened.push(url)
  });

  const res = await connection.handle({
    version: 1,
    id: "open-1",
    method: "services.open",
    params: { serviceId: service.id }
  });
  assert.equal(res.ok, true);
  assert.deepEqual(opened, ["http://localhost:5173"]);

  // A record that has since gone is refused rather than opened blindly.
  const missing = await connection.handle({
    version: 1,
    id: "open-2",
    method: "services.open",
    params: { serviceId: "svc_does_not_exist" }
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, "NOT_FOUND");
  assert.equal(opened.length, 1);

  // An action rendered before a restart names the generation it was built for.
  const stale = await connection.handle({
    version: 1,
    id: "open-3",
    method: "services.open",
    params: { serviceId: service.id, expectedGeneration: service.generation + 5 }
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, "CONFLICT");
  assert.equal(opened.length, 1, "a stale action must not open anything");

  connection.dispose();
});

test("only loopback http addresses can be opened", async () => {
  const registry = new LocalServiceRegistry();
  const opened = [];
  const connection = createProtocolConnection(createMockEngineApi(), {
    send: () => {},
    localServiceRegistry: registry,
    openServiceUrl: async url => opened.push(url)
  });

  // Something a dependency printed that happens to parse as a service record.
  const remote = { id: "svc_remote", url: "http://example.com:8080/admin", generation: 1, workerName: "Logs" };
  registry.listServices = () => [remote];
  registry.getService = id => (id === remote.id ? remote : null);

  const res = await connection.handle({
    version: 1,
    id: "open-remote",
    method: "services.open",
    params: { serviceId: "svc_remote" }
  });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, "FORBIDDEN");
  assert.deepEqual(opened, []);

  connection.dispose();
});

test("a fourth pop-out is refused with a recall instruction rather than opening a window", async () => {
  const sessions = ["w1", "w2", "w3", "w4"].map(id => ({ id, name: id.toUpperCase(), status: "running", isAlive: true }));
  const created = [];
  const manager = new TerminalWindowManager({
    createWindow: async spec => {
      created.push(spec);
      return { on: () => {}, isDestroyed: () => false, focus: () => {}, show: () => {}, destroy: () => {} };
    }
  });
  const connection = createProtocolConnection(createMockEngineApi(sessions), {
    send: () => {},
    terminalWindowManager: manager
  });

  for (const id of ["w1", "w2", "w3"]) {
    const res = await connection.handle({ version: 1, id: `d-${id}`, method: "terminal.window.detach", params: { workerId: id } });
    assert.equal(res.ok, true, `${id} should detach`);
  }

  const fourth = await connection.handle({
    version: 1,
    id: "d-w4",
    method: "terminal.window.detach",
    params: { workerId: "w4" }
  });
  assert.equal(fourth.ok, false);
  assert.match(fourth.error.message, /Recall one to open another/);
  assert.equal(created.length, 3, "no fourth window is created");

  const listed = await connection.handle({ version: 1, id: "list", method: "terminal.window.list", params: {} });
  assert.equal(listed.result.detached.length, 3);
  assert.deepEqual(listed.result.detached.map(entry => entry.detachedSlot), [1, 2, 3]);

  connection.dispose();
});

test("only the view holding the lease may type into a terminal", async () => {
  const { TerminalViewLeaseManager } = require("../src/groundstation/main/terminalViewLease.cjs");
  const leases = new TerminalViewLeaseManager();
  const writes = [];
  const resizes = [];
  const rawStream = {
    id: "worker-1",
    replay: () => ({ data: "", complete: true }),
    onData: () => () => {},
    onExit: () => () => {},
    write: data => { writes.push(data); return true; },
    resize: (cols, rows) => { resizes.push([cols, rows]); return true; }
  };

  const openFrom = async viewId => {
    const connection = createProtocolConnection(
      { ...createMockEngineApi(), attachRawStream: () => rawStream },
      { send: () => {}, terminalLeases: leases, getViewId: () => viewId }
    );
    const opened = await connection.handle({
      version: 1, id: `open-${viewId}`, method: "terminal.open", params: { sessionId: "worker-1" }
    });
    return { connection, streamId: opened.result.streamId };
  };

  // An undetached terminal is unmanaged, so the docked view types normally.
  const main = await openFrom("main");
  const beforeDetach = await main.connection.handle({
    version: 1, id: "w1", method: "terminal.write", params: { streamId: main.streamId, data: "ls\r" }
  });
  assert.equal(beforeDetach.ok, true);
  assert.deepEqual(writes, ["ls\r"]);

  // The terminal moves to a pop-out: authority moves with it.
  leases.acquireLease("worker-1", { windowId: "popout-1-worker-1", slotId: "slot-0", detachedSlot: 1 });

  const refused = await main.connection.handle({
    version: 1, id: "w2", method: "terminal.write", params: { streamId: main.streamId, data: "rm -rf .\r" }
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "TERMINAL_NOT_AUTHORIZED");
  assert.deepEqual(writes, ["ls\r"], "the docked view's keystrokes never reach the PTY");

  const refusedResize = await main.connection.handle({
    version: 1, id: "r1", method: "terminal.resize", params: { streamId: main.streamId, cols: 200, rows: 50 }
  });
  assert.equal(refusedResize.ok, false);
  assert.deepEqual(resizes, [], "a background view cannot resize the PTY out from under the active one");

  const popout = await openFrom("popout-1-worker-1");
  const allowed = await popout.connection.handle({
    version: 1, id: "w3", method: "terminal.write", params: { streamId: popout.streamId, data: "npm test\r" }
  });
  assert.equal(allowed.ok, true);
  assert.deepEqual(writes, ["ls\r", "npm test\r"]);

  // Recall hands authority back to the docked pane.
  leases.releaseLease("worker-1", "popout-1-worker-1");
  const afterRecall = await main.connection.handle({
    version: 1, id: "w4", method: "terminal.write", params: { streamId: main.streamId, data: "echo back\r" }
  });
  assert.equal(afterRecall.ok, true);
  assert.deepEqual(writes, ["ls\r", "npm test\r", "echo back\r"]);

  main.connection.dispose();
  popout.connection.dispose();
});

test("usage totals report unknown coverage instead of implying a free request", async () => {
  const ledger = new UsageLedger();
  ledger.record({ projectId: "p-1", model: "gemini-2.5-flash", tokens: { input: 1000, output: 500 } });
  // A failed attempt: the request happened, its token counts never arrived.
  ledger.record({ projectId: "p-1", model: "gemini-2.5-flash", outcome: "failed", tokens: {} });

  const connection = createProtocolConnection(createMockEngineApi(), { send: () => {}, usageLedger: ledger });
  const res = await connection.handle({ version: 1, id: "u-1", method: "usage.query", params: {} });

  assert.equal(res.ok, true);
  assert.equal(res.result.totals.callCount, 2);
  assert.equal(res.result.totals.totalTokens, 1500, "unknown counts are not summed as zero tokens");
  assert.equal(res.result.totals.unknownTokenRequests, 1);
  assert.equal(res.result.totals.coverage, "partial");
  assert.equal(res.result.totals.failedRequests, 1);

  connection.dispose();
});
