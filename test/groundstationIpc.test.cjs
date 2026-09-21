const assert = require("node:assert/strict");
const EventEmitter = require("node:events");
const { test } = require("node:test");
const {
  GroundstationIpcHost,
  REQUEST_CHANNEL
} = require("../src/groundstation/main/ipcHost.cjs");

class FakeIpcMain {
  constructor() {
    this.handlers = new Map();
  }
  handle(channel, callback) { this.handlers.set(channel, callback); }
  removeHandler(channel) { this.handlers.delete(channel); }
}

class FakeWebContents extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.mainFrame = {};
    this.messages = [];
    this.destroyed = false;
  }
  send(channel, message) { this.messages.push([channel, message]); }
  isDestroyed() { return this.destroyed; }
}

test("IPC host creates one isolated protocol connection per renderer and disposes it", async () => {
  const ipcMain = new FakeIpcMain();
  const created = [];
  const host = new GroundstationIpcHost({
    ipcMain,
    engineApi: {},
    createProtocolConnection: (_engine, options) => {
      const connection = {
        disposed: false,
        handle: request => ({ version: 1, id: request.id, ok: true, result: request.method }),
        dispose() { this.disposed = true; }
      };
      created.push({ connection, options });
      return connection;
    }
  });
  host.bind();
  const handler = ipcMain.handlers.get(REQUEST_CHANNEL);
  const renderer = new FakeWebContents(7);
  const event = { sender: renderer, senderFrame: renderer.mainFrame };

  assert.equal((await handler(event, { id: "a", method: "state.get" })).result, "state.get");
  assert.equal((await handler(event, { id: "b", method: "workspace.get" })).result, "workspace.get");
  assert.equal(created.length, 1);

  renderer.emit("destroyed");
  assert.equal(created[0].connection.disposed, true);
  host.dispose();
  assert.equal(ipcMain.handlers.has(REQUEST_CHANNEL), false);
});

test("IPC host rejects subframe requests before protocol dispatch", async () => {
  const ipcMain = new FakeIpcMain();
  let created = 0;
  const host = new GroundstationIpcHost({
    ipcMain,
    engineApi: {},
    createProtocolConnection: () => {
      created++;
      return { handle() {}, dispose() {} };
    }
  });
  host.bind();
  const renderer = new FakeWebContents(2);
  const response = await ipcMain.handlers.get(REQUEST_CHANNEL)(
    { sender: renderer, senderFrame: {} },
    { id: "blocked", method: "state.get" }
  );

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "FORBIDDEN_FRAME");
  assert.equal(created, 0);
  host.dispose();
});

test("main-frame reload disposes terminal subscriptions before reconnecting", async () => {
  const ipcMain = new FakeIpcMain();
  const created = [];
  const host = new GroundstationIpcHost({
    ipcMain,
    engineApi: {},
    createProtocolConnection: () => {
      const connection = {
        disposed: false,
        handle: request => ({ version: 1, id: request.id, ok: true, result: true }),
        dispose() { this.disposed = true; }
      };
      created.push(connection);
      return connection;
    }
  });
  host.bind();
  const renderer = new FakeWebContents(9);
  const handler = ipcMain.handlers.get(REQUEST_CHANNEL);
  const event = { sender: renderer, senderFrame: renderer.mainFrame };

  await handler(event, { id: "before", method: "state.get" });
  renderer.emit("did-start-navigation", {}, "file:///next", false, true);
  assert.equal(created[0].disposed, true);

  await handler(event, { id: "after", method: "state.get" });
  assert.equal(created.length, 2);
  assert.equal(created[1].disposed, false);
  assert.equal(renderer.listenerCount("did-start-navigation"), 1);
  renderer.emit("render-process-gone", {}, { reason: "crashed" });
  assert.equal(created[1].disposed, true);
  host.dispose();
});

test("IPC host passes integrations only through the protocol connection", async () => {
  const ipcMain = new FakeIpcMain();
  const vscodeBridge = { status: () => ({ connected: false }) };
  const missionAi = { status: () => ({ configured: false }) };
  const missionSupervisor = { status: () => ({ pendingApprovalCount: 0 }) };
  const projectSupervision = { snapshot: () => ({ supervisionVersion: 1 }) };
  const mobileCompanion = { status: () => ({ running: false }) };
  let receivedOptions = null;
  const host = new GroundstationIpcHost({
    ipcMain,
    engineApi: {},
    vscodeBridge,
    missionAi,
    missionSupervisor,
    projectSupervision,
    mobileCompanion,
    createProtocolConnection: (_engine, options) => {
      receivedOptions = options;
      return { handle: request => ({ version: 1, id: request.id, ok: true, result: true }), dispose() {} };
    }
  });
  host.bind();
  const renderer = new FakeWebContents(11);
  await ipcMain.handlers.get(REQUEST_CHANNEL)(
    { sender: renderer, senderFrame: renderer.mainFrame },
    { id: "bridge", method: "vscode.status" }
  );

  assert.equal(receivedOptions.vscodeBridge, vscodeBridge);
  assert.equal(receivedOptions.missionAi, missionAi);
  assert.equal(receivedOptions.missionSupervisor, missionSupervisor);
  assert.equal(receivedOptions.projectSupervision, projectSupervision);
  assert.equal(receivedOptions.mobileCompanion, mobileCompanion);
  assert.equal(Object.hasOwn(receivedOptions, "pluginPlatform"), false, "the plugin platform was removed");
  assert.equal(Object.hasOwn(global, "vscodeBridge"), false);
  assert.equal(Object.hasOwn(global, "missionAi"), false);
  assert.equal(Object.hasOwn(global, "mobileCompanion"), false);
  host.dispose();
});
