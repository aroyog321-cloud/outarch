"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { AgentActivityService } = require("../src/service/agentActivityService.cjs");
const { SemanticEventRouter } = require("../src/service/semanticEventRouter.cjs");

test("agentActivityService detects dynamic transitions and agent states", () => {
  let clock = 1000;
  const service = new AgentActivityService({ now: () => clock });

  let activity = service.getWorkerActivity("worker-1");
  assert.equal(activity.isAgent, false);
  assert.equal(activity.state, "idle");

  // Output from Claude Code
  service.recordOutput("worker-1", "run-1", "Welcome to Claude Code (v1.0.0)");
  activity = service.getWorkerActivity("worker-1");
  assert.equal(activity.isAgent, true);
  assert.equal(activity.agentType, "claude");

  // Thinking state
  service.recordOutput("worker-1", "run-1", "Claude is thinking...");
  activity = service.getWorkerActivity("worker-1");
  assert.equal(activity.state, "thinking");

  // Tool use
  service.recordOutput("worker-1", "run-1", "tool use: file_write");
  activity = service.getWorkerActivity("worker-1");
  assert.equal(activity.state, "executing_tool");
  assert.equal(activity.currentTool, "file_write");

  // Awaiting approval event
  let approvalEvent = null;
  service.once("awaiting_approval", e => { approvalEvent = e; });
  service.recordOutput("worker-1", "run-1", "Do you want to run this command? Confirm [y/N]");
  activity = service.getWorkerActivity("worker-1");
  assert.equal(activity.state, "awaiting_approval");
  assert.ok(approvalEvent);
  assert.equal(approvalEvent.workerId, "worker-1");

  // Turn complete & cost
  let completeEvent = null;
  service.once("turn_completed", e => { completeEvent = e; });
  service.recordOutput("worker-1", "run-1", "Cost: $0.045, Tokens: 1,500");
  service.recordOutput("worker-1", "run-1", "Task completed in 2.3s");
  activity = service.getWorkerActivity("worker-1");
  assert.equal(activity.state, "idle");
  assert.equal(activity.lastTurnTokens.totalTokens, 1500);
  assert.equal(activity.lastTurnCost, 0.045);
  assert.ok(completeEvent);
});

test("semanticEventRouter publishes, queries, and detects build errors", () => {
  let clock = 5000;
  const router = new SemanticEventRouter({ now: () => clock });

  const published = router.publish({
    type: "service.ready",
    severity: "info",
    workerId: "w-1",
    projectId: "p-1",
    title: "Vite dev server ready",
    data: { url: "http://localhost:5173" }
  });
  assert.ok(published.id);
  assert.equal(published.type, "service.ready");

  const queryAll = router.query();
  assert.equal(queryAll.length, 1);
  assert.equal(queryAll[0].type, "service.ready");

  // Inspect build failure output
  const failEvent = router.inspectOutput("w-2", "run-1", "npm ERR! code ELIFECYCLE\nSyntaxError: Unexpected token", { projectId: "p-1" });
  assert.ok(failEvent);
  assert.equal(failEvent.type, "build.failed");
  assert.equal(failEvent.severity, "error");

  const errors = router.query({ type: "build.failed" });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].workerId, "w-2");
});

test("a server that cannot bind its port raises one port conflict, naming the port", () => {
  const { SemanticEventRouter } = require("../src/service/semanticEventRouter.cjs");
  const router = new SemanticEventRouter();
  const first = router.inspectOutput("billing", "run-1", "Error: listen EADDRINUSE: address already in use 0.0.0.0:4000", { workerName: "Billing" });
  assert.equal(first.type, "port.conflict");
  assert.equal(first.data.port, 4000);
  assert.equal(first.severity, "error");
  // The same crash repeats the code further down its stack; that is not a second conflict.
  assert.equal(router.inspectOutput("billing", "run-1", "  code: 'EADDRINUSE',", { workerName: "Billing" }), null);
  // A new run is a new conflict.
  assert.equal(router.inspectOutput("billing", "run-2", "Error: listen EADDRINUSE: address already in use 0.0.0.0:4000").type, "port.conflict");
  // Vite stepping to the next port is worth knowing, not a failure.
  const moved = router.inspectOutput("web", "run-1", "Port 5173 is in use, trying another one...");
  assert.equal(moved.severity, "warning");
  assert.equal(moved.data.movedOn, true);
  assert.equal(router.inspectOutput("go", "run-1", "listen tcp :8080: bind: Only one usage of each socket address (protocol/network address/port) is normally permitted.").data.port, 8080);
});
