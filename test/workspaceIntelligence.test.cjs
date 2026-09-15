"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { WorkspaceIntelligence } = require("../src/groundstation/main/workspaceIntelligence.cjs");

// A minimal stand-in for EngineAPI: enough surface for the intelligence layer to
// find live workers and read their output the way it does in the desktop app.
function createFakeEngine() {
  const sessions = new Map();
  const dataHandlers = new Map();
  const engineListeners = new Set();

  return {
    engineApi: {
      subscribe(listener) {
        engineListeners.add(listener);
        return () => engineListeners.delete(listener);
      },
      list: () => Array.from(sessions.values()),
      getSnapshot: id => sessions.get(id) || null,
      attachRawStream(id) {
        const session = sessions.get(id);
        if (!session || !session.isAlive) return null;
        return {
          id,
          onData: callback => {
            dataHandlers.set(id, callback);
            return () => dataHandlers.delete(id);
          }
        };
      }
    },
    addSession(session) {
      sessions.set(session.id, { isAlive: true, name: session.id, command: "sh", ...session });
      for (const listener of engineListeners) listener({ type: "session" });
    },
    updateSession(id, patch) {
      sessions.set(id, { ...sessions.get(id), ...patch });
      for (const listener of engineListeners) listener({ type: "session" });
    },
    removeSession(id) {
      sessions.delete(id);
      for (const listener of engineListeners) listener({ type: "session" });
    },
    emitOutput(id, text) {
      dataHandlers.get(id)?.(text);
    },
    isObserved: id => dataHandlers.has(id)
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

test("a dev server address printed by a live worker becomes a listed service", async () => {
  const engine = createFakeEngine();
  const intelligence = new WorkspaceIntelligence();
  engine.addSession({ id: "storefront", name: "Storefront" });
  intelligence.attachEngine(engine.engineApi, "proj-1");

  engine.emitOutput("storefront", "  ➜  Local:   http://localhost:5173/\n");

  const services = intelligence.services.listServices({ projectId: "proj-1" });
  assert.equal(services.length, 1);
  assert.equal(services[0].port, 5173);
  assert.equal(services[0].url, "http://localhost:5173");
  assert.equal(services[0].workerId, "storefront");
  assert.equal(services[0].workerName, "Storefront", "the panel needs the worker's display name, not its id");

  intelligence.dispose();
});

test("an address split across two PTY chunks is still detected", async () => {
  const engine = createFakeEngine();
  const intelligence = new WorkspaceIntelligence();
  engine.addSession({ id: "api", name: "API" });
  intelligence.attachEngine(engine.engineApi, "proj-1");

  // Chunk boundaries fall wherever the PTY flushes, not on line endings.
  engine.emitOutput("api", "Server listening on htt");
  assert.equal(intelligence.services.listServices().length, 0, "a partial line is not yet evidence");
  engine.emitOutput("api", "p://localhost:4000/health\n");

  const services = intelligence.services.listServices();
  assert.equal(services.length, 1);
  assert.equal(services[0].url, "http://localhost:4000/health", "the advertised path is preserved");

  intelligence.dispose();
});

test("restarting a worker supersedes the addresses its previous run advertised", async () => {
  const engine = createFakeEngine();
  const intelligence = new WorkspaceIntelligence();
  engine.addSession({ id: "storefront", name: "Storefront", correlationId: "run-1" });
  intelligence.attachEngine(engine.engineApi, "proj-1");
  engine.emitOutput("storefront", "Local: http://localhost:5173/\n");
  assert.equal(intelligence.services.listServices()[0].state !== "stale", true);

  // A new correlation id means a new PTY: the old readiness no longer holds.
  engine.updateSession("storefront", { correlationId: "run-2" });
  await flush();

  const afterRestart = intelligence.services.listServices();
  assert.equal(afterRestart[0].state, "stale", "the previous run's address is marked stale, not left as ready");

  engine.emitOutput("storefront", "Local: http://localhost:5173/\n");
  const republished = intelligence.services.listServices();
  assert.notEqual(republished[0].state, "stale", "the new run re-advertising the address clears it");

  intelligence.dispose();
});

test("a worker that exits has its services invalidated and its stream released", async () => {
  const engine = createFakeEngine();
  const intelligence = new WorkspaceIntelligence();
  engine.addSession({ id: "api", name: "API" });
  intelligence.attachEngine(engine.engineApi, "proj-1");
  engine.emitOutput("api", "listening on http://localhost:4000\n");
  assert.equal(intelligence.services.listServices().length, 1);

  engine.updateSession("api", { isAlive: false });
  await flush();

  assert.equal(intelligence.services.listServices()[0].state, "stale");
  assert.equal(engine.isObserved("api"), false, "the output listener is detached when the run ends");

  intelligence.dispose();
});

test("output is classified for agent activity and build failures, not only services", async () => {
  const engine = createFakeEngine();
  const intelligence = new WorkspaceIntelligence();
  engine.addSession({ id: "build", name: "Build" });
  intelligence.attachEngine(engine.engineApi, "proj-1");

  engine.emitOutput("build", "error: TS2345: Argument of type string is not assignable\n");

  const failures = intelligence.events.query({ type: "build.failed" });
  assert.equal(failures.length, 1);
  assert.equal(failures[0].workerId, "build");

  intelligence.dispose();
});

test("observers stop and services are cleared when the engine detaches", async () => {
  const engine = createFakeEngine();
  const intelligence = new WorkspaceIntelligence();
  engine.addSession({ id: "api", name: "API" });
  intelligence.attachEngine(engine.engineApi, "proj-1");
  engine.emitOutput("api", "listening on http://localhost:4000\n");

  intelligence.detachEngine();

  assert.equal(engine.isObserved("api"), false);
  assert.equal(intelligence.services.listServices()[0].state, "stale");
});

test("renderers are told when discovery changes rather than having to poll", async () => {
  const engine = createFakeEngine();
  const changes = [];
  const intelligence = new WorkspaceIntelligence({ onChange: message => changes.push(message.type) });
  engine.addSession({ id: "api", name: "API" });
  intelligence.attachEngine(engine.engineApi, "proj-1");

  engine.emitOutput("api", "listening on http://localhost:4000\n");

  assert.ok(changes.includes("services:changed"), `expected a services change notification, saw ${changes.join(", ")}`);
  intelligence.dispose();
});
