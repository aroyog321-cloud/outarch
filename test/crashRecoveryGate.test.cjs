"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SessionJournal } = require("../src/service/sessionJournal.cjs");
const { SessionRecoveryService } = require("../src/service/sessionRecoveryService.cjs");
const { SessionEngine } = require("../src/engine/sessionEngine.cjs");
const { WorkspaceIntelligence } = require("../src/groundstation/main/workspaceIntelligence.cjs");

function tempJournal() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-journal-"));
  return { dir, journal: new SessionJournal(dir), cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function createFakeEngine() {
  const sessions = new Map();
  const dataHandlers = new Map();
  const listeners = new Set();
  return {
    engineApi: {
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      list: () => Array.from(sessions.values()),
      getSnapshot: id => sessions.get(id) || null,
      attachRawStream(id) {
        const session = sessions.get(id);
        if (!session || !session.isAlive) return null;
        return { id, onData: cb => { dataHandlers.set(id, cb); return () => dataHandlers.delete(id); } };
      }
    },
    addSession(session) {
      sessions.set(session.id, { isAlive: true, name: session.id, command: "sh", pid: 4242, ...session });
      for (const listener of listeners) listener({ type: "session" });
    },
    updateSession(id, patch) {
      sessions.set(id, { ...sessions.get(id), ...patch });
      for (const listener of listeners) listener({ type: "session" });
    }
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 10));

test("a run that was alive when the app died is journalled and reported as interrupted", async () => {
  const { dir, journal, cleanup } = tempJournal();
  try {
    const engine = createFakeEngine();
    const intelligence = new WorkspaceIntelligence({ journal, waitForListening: async () => ({ listening: false }) });

    // A normal boot: nothing prior, so nothing to recover.
    const firstBoot = intelligence.inspectPriorSession("proj-1");
    assert.equal(firstBoot.recoveryRequired, false);

    intelligence.beginSession("proj-1");
    engine.addSession({ id: "storefront", name: "Storefront", correlationId: "run-1" });
    intelligence.attachEngine(engine.engineApi, "proj-1");
    await flush();

    // The app dies here: dispose without markCleanShutdown, exactly as a crash.
    intelligence.dispose();

    const afterCrash = new SessionRecoveryService(new SessionJournal(dir)).inspect("proj-1", []);
    assert.equal(afterCrash.cleanShutdown, false);
    assert.equal(afterCrash.recoveryRequired, true, "a run still marked running means recovery is needed");
    const worker = afterCrash.workers.find(item => item.workerId === "storefront");
    assert.ok(worker, "the crashed worker is in the report");
    assert.equal(worker.recoveryState, "interrupted");
    assert.equal(worker.pid, 4242, "the pid is recorded so ownership can be checked later");
  } finally {
    cleanup();
  }
});

test("a clean shutdown leaves nothing to recover on the next launch", async () => {
  const { dir, journal, cleanup } = tempJournal();
  try {
    const engine = createFakeEngine();
    const intelligence = new WorkspaceIntelligence({ journal, waitForListening: async () => ({ listening: false }) });
    intelligence.beginSession("proj-1");
    engine.addSession({ id: "api", name: "API", correlationId: "run-1" });
    intelligence.attachEngine(engine.engineApi, "proj-1");
    await flush();

    intelligence.markCleanShutdown();
    intelligence.dispose();

    const report = new SessionRecoveryService(new SessionJournal(dir)).inspect("proj-1", []);
    assert.equal(report.cleanShutdown, true);
    assert.equal(report.recoveryRequired, false);
  } finally {
    cleanup();
  }
});

test("a worker that exited on its own is not reported as interrupted", async () => {
  const { dir, journal, cleanup } = tempJournal();
  try {
    const engine = createFakeEngine();
    const intelligence = new WorkspaceIntelligence({ journal, waitForListening: async () => ({ listening: false }) });
    intelligence.beginSession("proj-1");
    engine.addSession({ id: "tests", name: "Tests", correlationId: "run-1" });
    intelligence.attachEngine(engine.engineApi, "proj-1");
    await flush();

    // The test run finishes normally, then the app crashes.
    engine.updateSession("tests", { isAlive: false });
    await flush();
    intelligence.dispose();

    const report = new SessionRecoveryService(new SessionJournal(dir)).inspect("proj-1", []);
    assert.equal(report.recoveryRequired, false, "nothing was still running, so there is nothing to recover");
    const worker = report.workers.find(item => item.workerId === "tests");
    assert.equal(worker.recoveryState, "exited");
  } finally {
    cleanup();
  }
});

test("deferring autostart loads every worker but launches none, and keeps their saved preference", () => {
  const spawned = [];
  const ptyFactory = () => {
    throw new Error("no worker may spawn while launches are deferred");
  };
  const engine = new SessionEngine({ deferAutoStart: true, ptyFactory });

  const session = engine.create({ id: "storefront", name: "Storefront", command: "node", args: [], autoStart: true });

  assert.equal(engine.list().length, 1, "the definition still loads");
  assert.equal(session.autoStart, true, "the saved preference is untouched");
  assert.equal(session.isAlive(), false, "but nothing was launched");
  assert.equal(session.status, "idle", "and it reads as idle rather than perpetually starting");
  assert.deepEqual(spawned, []);
});

test("releasing the deferral starts exactly the workers whose autoStart was held", () => {
  const spawnedIds = [];
  const ptyFactory = () => ({
    onData() {}, onExit() {}, write() {}, resize() {}, kill() {}, pid: 1
  });
  const engine = new SessionEngine({ deferAutoStart: true, ptyFactory });

  engine.create({ id: "storefront", command: "node", args: [], autoStart: true });
  engine.create({ id: "manual", command: "node", args: [], autoStart: false });

  const started = engine.releaseAutoStart();

  assert.deepEqual(started, ["storefront"], "only the held autoStart worker starts");
  assert.equal(engine.deferAutoStart, false, "the deferral is over");
  assert.equal(spawnedIds.length, 0);

  // Releasing twice must not double-start anything already running.
  assert.deepEqual(engine.releaseAutoStart(), []);
});

test("without the deferral a worker launches at create time as before", () => {
  let spawnCount = 0;
  const ptyFactory = () => {
    spawnCount += 1;
    return { onData() {}, onExit() {}, write() {}, resize() {}, kill() {}, pid: 1 };
  };
  const engine = new SessionEngine({ ptyFactory });
  engine.create({ id: "storefront", command: "node", args: [], autoStart: true });
  assert.equal(spawnCount, 1, "normal boots are unchanged");
});
