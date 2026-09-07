"use strict";

// T023 — broadcast: bounded targets, preview, exclusions, secret and
// destructive safeguards, approval binding, and audit logging.
//
// The guard is pure and tested directly; the protocol path is exercised against
// a real connection so the authority contract (token bound to the exact plan)
// is proven rather than asserted about in source strings.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { inspectBroadcastInput, planBroadcast, MAX_BROADCAST_TARGETS } = require("../src/service/broadcastGuard.cjs");
const { createProtocolConnection } = require("../src/protocol/index.cjs");

const request = (id, method, params = {}) => ({ version: 1, id, method, params });

/* ------------------------------------------------------------------- guard */

test("T023 — secrets are refused outright, not warned about", () => {
  const cases = [
    "export API_KEY=abcd1234efgh5678ijkl",
    "curl -H 'Authorization: Bearer abcdefghijklmnop' https://example.test",
    "echo '-----BEGIN RSA PRIVATE KEY-----' > key.pem",
    "npm config set //registry.npmjs.org/:_authToken=ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "PASSWORD=hunter2 ./deploy.sh"
  ];
  for (const input of cases) {
    const result = inspectBroadcastInput(input);
    assert.equal(result.ok, false, `must refuse: ${input}`);
    assert.ok(result.secrets.length > 0, `must name the secret in: ${input}`);
    assert.match(result.reason, /scrollback and shell history|will not send it/i);
  }
});

test("T023 — an ordinary command is not mistaken for a secret", () => {
  for (const input of ["git status", "npm run dev", "pytest -q", "ls -la", "docker compose up -d"]) {
    const result = inspectBroadcastInput(input);
    assert.equal(result.ok, true, `must allow: ${input}`);
    assert.deepEqual(result.secrets, []);
    assert.deepEqual(result.destructive, []);
  }
});

test("T023 — destructive commands are flagged for acknowledgement, not refused", () => {
  const cases = [
    ["rm -rf node_modules", "recursive-delete"],
    ["git reset --hard origin/main", "history-rewrite"],
    ["git push --force", "history-rewrite"],
    ["shutdown /r /t 0", "power"],
    ["Remove-Item -Recurse -Force ./dist", "recursive-delete"],
    ["DROP DATABASE staging;", "database"],
    ["taskkill /F /IM node.exe", "process-sweep"]
  ];
  for (const [input, id] of cases) {
    const result = inspectBroadcastInput(input);
    assert.equal(result.ok, true, `${input} must be allowed with acknowledgement`);
    assert.ok(result.destructive.some(item => item.id === id), `${input} must be flagged as ${id}`);
  }
  // `--force-with-lease` is the safe variant and must not be swept up with it.
  assert.deepEqual(inspectBroadcastInput("git push --force-with-lease").destructive, []);
});

test("T023 — the plan names who receives it, who does not, and why", () => {
  const sessions = [
    { id: "web", name: "Web server", isAlive: true },
    { id: "api", name: "API", isAlive: true },
    { id: "idle", name: "Batch job", isAlive: false }
  ];
  const plan = planBroadcast({ sessions, sessionIds: ["web", "idle", "ghost", "web"], input: "git status" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.targets, [{ id: "web", name: "Web server" }]);
  assert.deepEqual(plan.skipped, [
    { id: "idle", name: "Batch job", reason: "not-running" },
    { id: "ghost", reason: "unknown" }
  ]);
});

test("T023 — targets are bounded and an empty selection is refused", () => {
  const many = Array.from({ length: MAX_BROADCAST_TARGETS + 1 }, (_, index) => ({ id: `w${index}`, name: `Worker ${index}`, isAlive: true }));
  const over = planBroadcast({ sessions: many, sessionIds: many.map(item => item.id), input: "git status" });
  assert.equal(over.ok, false);
  assert.match(over.error, new RegExp(`limited to ${MAX_BROADCAST_TARGETS}`));

  const none = planBroadcast({ sessions: many, sessionIds: [], input: "git status" });
  assert.equal(none.ok, false);
  assert.match(none.error, /at least one running worker/i);

  const empty = planBroadcast({ sessions: many, sessionIds: ["w0"], input: "   " });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /Enter a command/i);
});

/* ---------------------------------------------------------------- protocol */

function makeEngine(sessions, writes, audit) {
  return {
    list: () => sessions,
    getSnapshot: id => sessions.find(session => session.id === id) || null,
    attachRawStream: id => {
      const session = sessions.find(item => item.id === id);
      if (!session || !session.isAlive) return null;
      return { write: (data, options) => { writes.push({ id, data, source: options?.source }); return session.acceptsWrites !== false; } };
    },
    recordConfirmationEvent: (kind, payload) => { audit.push({ kind, ...payload }); return { ok: true }; },
    subscribe: () => () => {},
    getState: () => ({}),
    listSavedCommands: () => []
  };
}

const SESSIONS = [
  { id: "web", name: "Web server", isAlive: true },
  { id: "api", name: "API", isAlive: true },
  { id: "idle", name: "Batch job", isAlive: false }
];

async function connect(engine) {
  return createProtocolConnection(engine, { send: () => {} });
}

test("T023 — preview needs no confirmation and reports the engine's own plan", async () => {
  const connection = await connect(makeEngine(SESSIONS, [], []));
  const response = await connection.handle(request("p1", "terminal.broadcast.preview", { sessionIds: ["web", "idle"], input: "git status" }));
  assert.equal(response.ok, true);
  assert.equal(response.result.ok, true);
  assert.equal(response.result.limit, MAX_BROADCAST_TARGETS);
  assert.deepEqual(response.result.targets, [{ id: "web", name: "Web server" }]);
  assert.equal(response.result.skipped[0].reason, "not-running");
  connection.dispose();
});

test("T023 — dispatch without a confirmation token is rejected", async () => {
  const writes = [];
  const connection = await connect(makeEngine(SESSIONS, writes, []));
  const response = await connection.handle(request("b1", "terminal.broadcast", { sessionIds: ["web"], input: "git status" }));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "CONFIRMATION_REQUIRED");
  assert.deepEqual(writes, [], "nothing may be written without authorization");
  connection.dispose();
});

test("T023 — a confirmed broadcast writes to every live target and audits the outcome", async () => {
  const writes = [];
  const audit = [];
  const connection = await connect(makeEngine(SESSIONS, writes, audit));
  const params = { sessionIds: ["web", "api"], input: "git status\r" };

  const issued = await connection.handle(request("c1", "confirmation.request", { targetMethod: "terminal.broadcast", targetParams: params }));
  assert.equal(issued.ok, true);

  const response = await connection.handle(request("b2", "terminal.broadcast", { ...params, confirmation: issued.result.token }));
  assert.equal(response.ok, true);
  assert.deepEqual(response.result.delivered, ["web", "api"]);
  assert.deepEqual(response.result.failed, []);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].data, "git status\r");
  assert.equal(writes[0].source, "groundstation");

  // The audit records that it happened and how it went — never the command.
  const completed = audit.find(entry => entry.operation === "terminal.broadcast" && entry.kind === "completed");
  assert.ok(completed, "a completed record must be written");
  assert.equal(completed.outcomeCode, "DELIVERED");
  for (const entry of audit) {
    assert.doesNotMatch(JSON.stringify(entry), /git status/, "the audit must never carry the broadcast input");
  }
  connection.dispose();
});

test("T023 — a token issued for one target list cannot be replayed against another", async () => {
  const writes = [];
  const connection = await connect(makeEngine(SESSIONS, writes, []));
  const params = { sessionIds: ["web"], input: "git status" };
  const issued = await connection.handle(request("c2", "confirmation.request", { targetMethod: "terminal.broadcast", targetParams: params }));

  const widened = await connection.handle(request("b3", "terminal.broadcast", {
    sessionIds: ["web", "api"],
    input: "git status",
    confirmation: issued.result.token
  }));
  assert.equal(widened.ok, false);
  assert.equal(widened.error.code, "CONFIRMATION_MISMATCH");
  assert.deepEqual(writes, [], "a widened blast radius must write nothing");
  connection.dispose();
});

test("T023 — a secret is refused at the protocol boundary even with a valid token", async () => {
  const writes = [];
  const connection = await connect(makeEngine(SESSIONS, writes, []));
  const params = { sessionIds: ["web"], input: "export API_KEY=abcd1234efgh5678ijkl" };
  const issued = await connection.handle(request("c3", "confirmation.request", { targetMethod: "terminal.broadcast", targetParams: params }));
  const response = await connection.handle(request("b4", "terminal.broadcast", { ...params, confirmation: issued.result.token }));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "BROADCAST_REFUSED");
  assert.deepEqual(writes, []);
  connection.dispose();
});

test("T023 — a destructive command needs an explicit acknowledgement on top of the token", async () => {
  const writes = [];
  const connection = await connect(makeEngine(SESSIONS, writes, []));
  const params = { sessionIds: ["web", "api"], input: "rm -rf node_modules" };

  const first = await connection.handle(request("c4", "confirmation.request", { targetMethod: "terminal.broadcast", targetParams: params }));
  const refused = await connection.handle(request("b5", "terminal.broadcast", { ...params, confirmation: first.result.token }));
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "BROADCAST_ACKNOWLEDGEMENT_REQUIRED");
  assert.match(refused.error.message, /recursive delete/);
  assert.deepEqual(writes, []);

  const acknowledged = { ...params, acknowledgeDestructive: true };
  const second = await connection.handle(request("c5", "confirmation.request", { targetMethod: "terminal.broadcast", targetParams: acknowledged }));
  const sent = await connection.handle(request("b6", "terminal.broadcast", { ...acknowledged, confirmation: second.result.token }));
  assert.equal(sent.ok, true);
  assert.equal(writes.length, 2);
  connection.dispose();
});

test("T023 — a worker that dies between preview and dispatch is reported, not silently dropped", async () => {
  const writes = [];
  const audit = [];
  const sessions = [
    { id: "web", name: "Web server", isAlive: true },
    { id: "api", name: "API", isAlive: true, acceptsWrites: false }
  ];
  const connection = await connect(makeEngine(sessions, writes, audit));
  const params = { sessionIds: ["web", "api"], input: "git status" };
  const issued = await connection.handle(request("c6", "confirmation.request", { targetMethod: "terminal.broadcast", targetParams: params }));
  const response = await connection.handle(request("b7", "terminal.broadcast", { ...params, confirmation: issued.result.token }));

  assert.equal(response.ok, true);
  assert.deepEqual(response.result.delivered, ["web"]);
  assert.deepEqual(response.result.failed, [{ id: "api", name: "API", reason: "write-failed" }]);
  assert.equal(audit.find(entry => entry.kind === "completed").outcomeCode, "PARTIAL_DELIVERY");
  connection.dispose();
});

test("T023 — broadcast is on the public method allowlist and its confirmation set", () => {
  const { METHODS } = require("../src/protocol/index.cjs");
  assert.ok(METHODS.includes("terminal.broadcast"));
  assert.ok(METHODS.includes("terminal.broadcast.preview"));
});
