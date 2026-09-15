"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const net = require("node:net");
const { probeOnce, waitForListening } = require("../src/service/serviceReadiness.cjs");
const { detectRestartSignal } = require("../src/engine/serviceEndpointParser.cjs");
const { WorkspaceIntelligence } = require("../src/groundstation/main/workspaceIntelligence.cjs");

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
      sessions.set(session.id, { isAlive: true, name: session.id, command: "sh", ...session });
      for (const listener of listeners) listener({ type: "session" });
    },
    emitOutput(id, text) { dataHandlers.get(id)?.(text); }
  };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 10));

test("probeOnce resolves true against a real listener and false against a closed port", async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  assert.equal(await probeOnce({ host: "127.0.0.1", port }), true);
  await new Promise(resolve => server.close(resolve));
  assert.equal(await probeOnce({ host: "127.0.0.1", port, timeoutMs: 300 }), false);
});

// The production retry timer is unref'd so it can never hold the app open; a
// test that awaits it needs a sleep that does keep the loop alive.
const refSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

test("waitForListening retries a server that is not up yet, and stops when cancelled", async () => {
  let attempts = 0;
  const result = await waitForListening({
    host: "127.0.0.1",
    port: 1234,
    attempts: 4,
    retryMs: 0,
    sleep: refSleep,
    connect: () => {
      attempts += 1;
      // Succeeds only on the third attempt, like a dev server still booting.
      const socket = { once(event, handler) { if ((attempts >= 3 && event === "connect") || (attempts < 3 && event === "error")) setImmediate(handler); return socket; }, setTimeout() {}, destroy() {} };
      return socket;
    }
  });
  assert.deepEqual(result, { listening: true, cancelled: false, attempts: 3, host: "127.0.0.1" });

  let cancelled = false;
  const stopped = await waitForListening({
    host: "127.0.0.1", port: 1234, attempts: 5, retryMs: 0,
    sleep: refSleep,
    isCancelled: () => cancelled,
    connect: () => {
      cancelled = true;
      const socket = { once(event, handler) { if (event === "error") setImmediate(handler); return socket; }, setTimeout() {}, destroy() {} };
      return socket;
    }
  });
  assert.equal(stopped.cancelled, true);
  assert.equal(stopped.listening, false);
});

test("restart signals are recognised from adapter output, not from the keystroke", () => {
  assert.equal(detectRestartSignal("  [vite] server restarted."), true);
  assert.equal(detectRestartSignal("[nodemon] restarting due to changes..."), true);
  assert.equal(detectRestartSignal("Restarting server after config change"), true);

  // Pressing r is a request, not evidence that anything restarted.
  assert.equal(detectRestartSignal("r"), false);
  assert.equal(detectRestartSignal("press r to restart the server"), false);
  assert.equal(detectRestartSignal("ready in 412 ms"), false);
});

test("a printed address is only called ready once the port actually accepts a connection", async () => {
  const engine = createFakeEngine();
  let probed = null;
  const intelligence = new WorkspaceIntelligence({
    waitForListening: async ({ port }) => { probed = port; return { listening: true, cancelled: false, attempts: 1 }; }
  });
  const events = [];
  intelligence.events.on("event", event => events.push(event));

  engine.addSession({ id: "storefront", name: "Storefront" });
  intelligence.attachEngine(engine.engineApi, "proj-1");
  engine.emitOutput("storefront", "  ➜  Local:   http://localhost:5173/\n");

  // Before verification resolves the record exists but is not ready.
  const immediately = intelligence.services.listServices()[0];
  assert.equal(immediately.state !== "ready" || immediately.readyEvidence === undefined, true);

  await flush();

  assert.equal(probed, 5173, "the discovered port is what gets checked");
  const verified = intelligence.services.listServices()[0];
  assert.equal(verified.state, "ready");
  assert.equal(verified.readyEvidence, "listening");

  const ready = events.filter(event => event.type === "service.ready");
  assert.equal(ready.length, 1);
  assert.equal(ready[0].title, "Storefront is ready");
  assert.equal(ready[0].data.url, "http://localhost:5173");
  assert.equal(ready[0].data.serviceId, verified.id);

  intelligence.dispose();
});

test("an address that never listens produces no ready state and no notification", async () => {
  const engine = createFakeEngine();
  const intelligence = new WorkspaceIntelligence({
    waitForListening: async () => ({ listening: false, cancelled: false, attempts: 6 })
  });
  const events = [];
  intelligence.events.on("event", event => events.push(event));

  engine.addSession({ id: "api", name: "API" });
  intelligence.attachEngine(engine.engineApi, "proj-1");
  engine.emitOutput("api", "Server listening on http://localhost:4000\n");
  await flush();

  assert.notEqual(intelligence.services.listServices()[0].state, "ready");
  assert.deepEqual(events.filter(event => event.type === "service.ready"), []);

  intelligence.dispose();
});

test("an in-terminal restart produces a second readiness cycle for the same address", async () => {
  const engine = createFakeEngine();
  const intelligence = new WorkspaceIntelligence({
    waitForListening: async () => ({ listening: true, cancelled: false, attempts: 1 })
  });
  const ready = [];
  intelligence.events.on("event", event => { if (event.type === "service.ready") ready.push(event); });

  engine.addSession({ id: "storefront", name: "Storefront" });
  intelligence.attachEngine(engine.engineApi, "proj-1");

  engine.emitOutput("storefront", "  ➜  Local:   http://localhost:5173/\n");
  await flush();
  assert.equal(ready.length, 1);
  const firstGeneration = ready[0].data.generation;

  // Re-printing the same address inside one cycle is not a new readiness event.
  engine.emitOutput("storefront", "  ➜  Local:   http://localhost:5173/\n");
  await flush();
  assert.equal(ready.length, 1, "a re-print without a restart is not news");

  // The adapter says it restarted, so the next address is a new cycle.
  engine.emitOutput("storefront", "[vite] server restarted.\n");
  engine.emitOutput("storefront", "  ➜  Local:   http://localhost:5173/\n");
  await flush();

  assert.equal(ready.length, 2, "a restart re-advertises readiness");
  assert.notEqual(ready[1].data.generation, firstGeneration, "the second cycle carries a new generation");

  intelligence.dispose();
});

test("a server bound only to IPv6 localhost is still found listening", async () => {
  // Vite on Windows binds "localhost" as ::1, so a check of 127.0.0.1 alone
  // reported a running dev server as never up, and no notification came.
  const tried = [];
  const result = await waitForListening({
    hosts: ["127.0.0.1", "::1"],
    port: 5173,
    attempts: 1,
    retryMs: 0,
    sleep: refSleep,
    connect: ({ host }) => {
      tried.push(host);
      const socket = { once(event, handler) { if ((host === "::1" && event === "connect") || (host !== "::1" && event === "error")) setImmediate(handler); return socket; }, setTimeout() {}, destroy() {} };
      return socket;
    }
  });
  assert.deepEqual(tried, ["127.0.0.1", "::1"]);
  assert.deepEqual(result, { listening: true, cancelled: false, attempts: 1, host: "::1" });
});
