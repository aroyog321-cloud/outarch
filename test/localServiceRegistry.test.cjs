"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { LocalServiceRegistry } = require("../src/service/localServiceRegistry.cjs");

test("LocalServiceRegistry processes terminal lines and tracks service discovery", () => {
  const registry = new LocalServiceRegistry();
  const discovered = registry.processTerminalOutput(
    "proj-1",
    "worker-web",
    "run-1",
    "  ➜  Local:   http://localhost:5173/"
  );

  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].port, 5173);
  // Vite printing "Local:" is the worker advertising itself. That is recorded as
  // the advertised confidence, but the record stays detected until something
  // verifies the port; only markReady() promotes it.
  assert.equal(discovered[0].state, "detected");
  assert.equal(discovered[0].advertisedConfidence, "ready");

  const services = registry.listServices("proj-1");
  assert.equal(services.length, 1);
  assert.equal(services[0].port, 5173);
});

test("LocalServiceRegistry bumps generation on in-terminal restart and marks old services stale", () => {
  const registry = new LocalServiceRegistry();
  registry.processTerminalOutput("proj-1", "worker-web", "run-1", "Local: http://localhost:5173/");

  const nextGen = registry.bumpGeneration("proj-1", "worker-web");
  assert.equal(nextGen, 2);

  const services = registry.listServices("proj-1");
  assert.equal(services[0].state, "stale");

  // New output updates generation
  registry.processTerminalOutput("proj-1", "worker-web", "run-1", "Local: http://localhost:5173/");
  const refreshed = registry.listServices("proj-1");
  assert.equal(refreshed[0].generation, 2);
  assert.equal(refreshed[0].state, "detected", "a new generation starts unverified");
});

test("LocalServiceRegistry invalidates on worker exit", () => {
  const registry = new LocalServiceRegistry();
  registry.processTerminalOutput("proj-1", "worker-api", "run-1", "Listening on http://localhost:4000/api");
  registry.invalidateWorker("proj-1", "worker-api");

  const services = registry.listServices("proj-1", "worker-api");
  assert.equal(services[0].state, "stale");
});

test("a verified service stays ready across re-prints but not across a restart", () => {
  const registry = new LocalServiceRegistry();
  registry.processTerminalOutput("proj-1", "web", "run-1", "Local: http://localhost:5173/");
  const [service] = registry.listServices("proj-1");

  registry.markReady(service.id, { evidence: "listening" });
  assert.equal(registry.getService(service.id).state, "ready");
  assert.equal(registry.getService(service.id).readyEvidence, "listening");

  // A hot reload re-prints the address; the verification still holds.
  registry.processTerminalOutput("proj-1", "web", "run-1", "Local: http://localhost:5173/");
  assert.equal(registry.getService(service.id).state, "ready");

  // A restart is a new cycle, so the old proof no longer applies.
  registry.bumpGeneration("proj-1", "web");
  registry.processTerminalOutput("proj-1", "web", "run-1", "Local: http://localhost:5173/");
  const afterRestart = registry.getService(service.id);
  assert.equal(afterRestart.state, "detected");
  assert.equal(afterRestart.readyEvidence, undefined);
});

test("servicesForWorker reports the full stop impact for a multi-service worker", () => {
  const registry = new LocalServiceRegistry();
  registry.processTerminalOutput("proj-1", "api", "run-1", "Listening on http://localhost:4000");
  registry.processTerminalOutput("proj-1", "api", "run-1", "Admin at http://localhost:4001/admin");
  registry.processTerminalOutput("proj-1", "web", "run-1", "Local: http://localhost:5173/");

  const owned = registry.servicesForWorker("proj-1", "api");
  assert.equal(owned.length, 2, "stopping this worker takes both addresses down");
  assert.deepEqual(owned.map(s => s.port).sort((a, b) => a - b), [4000, 4001]);
});
