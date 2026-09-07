"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  sortDecisions,
  buildDecisionQuery
} = require("../src/protocol/decisionBroker.cjs");
const { PROTOCOL_VERSION, createProtocolConnection } = require("../src/protocol/connection.cjs");

/* ------------------------------------------------------------------ helpers */

function attention(overrides = {}) {
  return {
    id: "api",
    sessionId: "api",
    sessionName: "API server",
    state: "new",
    severity: "critical",
    reason: "Worker failed",
    createdAt: 1000,
    updatedAt: 1000,
    history: [{ state: "new", at: 1000 }],
    ...overrides
  };
}

function approval(overrides = {}) {
  return { id: "a1", state: "pending", reason: "Needs a decision", createdAt: 2000, ...overrides };
}

function sourcesStub(overrides = {}) {
  return {
    engineApi: {
      listAttention: () => ({ records: [attention()], preferences: {} }),
      listMissionApprovals: () => [approval({ id: "m1", missionTitle: "Ship auth", requestedScopes: ["worker.start"] })],
      listAutomations: () => ({ automations: [], approvals: [approval({ id: "au1", action: { type: "restart" } })] })
    },
    missionSupervisor: { listApprovals: () => [approval({ id: "s1", plan: { summary: "Two steps", actions: [{}, {}] } })] },
    mcpGateway: { listApprovals: () => [approval({ id: "mcp1", client: "codex", action: "restart", targetName: "api" })] },
    mobileCompanion: { listApprovals: () => [approval({ id: "mob1", deviceName: "Pixel", action: "restart", targetName: "api" })] },
    pluginPlatform: { listApprovals: () => [approval({ id: "pl1", pluginName: "Formatter", operation: "run", targetName: "repo" })] },
    ...overrides
  };
}

/* -------------------------------------------------------------------- tests */

test("sortDecisions orders by status, severity, expiry, age, then id", () => {
  const ordered = sortDecisions([
    { id: "z", status: "pending", severity: "info", expiresAt: null, createdAt: 5 },
    { id: "a", status: "resolved", severity: "critical", expiresAt: null, createdAt: 1 },
    { id: "c", status: "pending", severity: "critical", expiresAt: 900, createdAt: 9 },
    { id: "b", status: "pending", severity: "critical", expiresAt: 900, createdAt: 9 }
  ]).map(record => record.id);
  assert.deepEqual(ordered, ["b", "c", "z", "a"]);
});

test("buildDecisionQuery normalises every healthy source into one sorted list", async () => {
  const query = await buildDecisionQuery(sourcesStub());

  assert.equal(query.complete, true);
  assert.equal(query.records.length, 7, "session + supervisor + mission + mcp + automation + mobile + plugin pending");
  assert.equal(query.counts.pending, 7);
  assert.equal(query.counts.critical, 1);
  assert.equal(query.records[0].id, "session:api", "the critical failure sorts first");
  assert.equal(query.records[0].source, "session");
  assert.equal(query.records[0].origin, "engine");
  assert.equal(query.records[0].deepLink.view, "workspace");

  for (const source of query.sources) {
    assert.equal(source.availability, "ready", `${source.id} healthy`);
    assert.ok(source.lastSuccessAt, `${source.id} has a success timestamp`);
  }
  // Every record id is namespaced by its source, so ids never collide.
  assert.ok(query.records.every(record => record.id.includes(":")));
});

test("a failed source is isolated: it reports error, the rest are unaffected, the count is not zeroed", async () => {
  const stub = sourcesStub({
    mcpGateway: { listApprovals: () => { throw new Error("gateway offline"); } }
  });
  const query = await buildDecisionQuery(stub);

  assert.equal(query.complete, false, "one source down => not complete");
  const mcp = query.sources.find(source => source.id === "mcp");
  assert.equal(mcp.availability, "error");
  assert.equal(mcp.error, "gateway offline");
  assert.equal(mcp.pending, 0);

  // The other six sources still contributed their records.
  assert.equal(query.records.length, 6);
  assert.equal(query.counts.pending, 6);
  assert.ok(query.sources.filter(source => source.availability === "ready").length === 6);
});

test("a missing source handle is 'unavailable', never a silent zero", async () => {
  const query = await buildDecisionQuery({
    engineApi: { listAttention: () => ({ records: [] }) }
    // no missionSupervisor / mcpGateway / mobileCompanion / pluginPlatform
  });
  assert.equal(query.complete, false);
  const mobile = query.sources.find(source => source.id === "mobile");
  assert.equal(mobile.availability, "unavailable");
  assert.equal(query.records.length, 0);
});

test("already-resolved approvals never inflate the pending count", async () => {
  const stub = sourcesStub({
    mcpGateway: { listApprovals: () => [approval({ id: "mcp1", state: "pending" }), approval({ id: "mcp2", state: "approved" })] }
  });
  const query = await buildDecisionQuery(stub);
  // Only mcp1 is active; mcp2 (approved) is not counted. Total stays at 7.
  assert.equal(query.counts.pending, 7);
  assert.ok(!query.records.some(record => record.id === "mcp:mcp2"));
});

test("decisions.resolve routes to the owning resolver and enforces the confirmation ceremony", async () => {
  const calls = [];
  const engineApi = {
    subscribe: () => () => {},
    getState: () => ({ contractVersion: 1, sequence: 0, sessions: [] }),
    listAttention: () => ({ records: [] }),
    listMissionApprovals: () => [],
    listAutomations: () => ({ approvals: [] }),
    resolveMissionApproval: (missionId, approvalId, decision) => { calls.push(["mission", missionId, approvalId, decision]); return { ok: true }; },
    resolveAutomationApproval: (approvalId, decision) => { calls.push(["automation", approvalId, decision]); return { ok: true }; },
    transitionAttention: (id, state) => { calls.push(["session", id, state]); return { ok: true, record: { id, state } }; }
  };
  const connection = createProtocolConnection(engineApi, {
    send: () => {},
    mcpGateway: { resolveApproval: (approvalId, decision) => { calls.push(["mcp", approvalId, decision]); return { state: "approved" }; } }
  });
  const call = (id, params) => connection.handle({ version: PROTOCOL_VERSION, id: "r", method: "decisions.resolve", params: { id, ...params } });
  const confirmedCall = async (id, params) => {
    const targetParams = { id, ...params };
    const issued = await connection.handle({ version: PROTOCOL_VERSION, id: "confirm-r", method: "confirmation.request", params: { targetMethod: "decisions.resolve", targetParams } });
    return call(id, { ...params, confirmation: issued.result.token });
  };

  // Missing confirmation on a consequential approval is rejected.
  const noConfirm = await call("mcp:approval-7", { actionId: "approve" });
  assert.equal(noConfirm.error.code, "CONFIRMATION_REQUIRED");

  // A server-issued confirmation routes to the owning resolver with the native id.
  const ok = await confirmedCall("mcp:approval-7", { actionId: "approve" });
  assert.equal(ok.ok !== false, true, ok.error && ok.error.message);
  assert.deepEqual(calls.at(-1), ["mcp", "approval-7", "approve"]);

  // Mission needs its missionId; the engine resolver gets the un-namespaced id.
  await confirmedCall("mission:appr-2", { actionId: "deny", missionId: "mission-1" });
  assert.deepEqual(calls.at(-1), ["mission", "mission-1", "appr-2", "deny"]);

  // Session lifecycle transitions need no ceremony.
  const ack = await call("session:api", { actionId: "acknowledge" });
  assert.equal(ack.ok !== false, true);
  assert.deepEqual(calls.at(-1), ["session", "api", "seen"]);

  const unknown = await call("bogus:x", { actionId: "approve" });
  assert.equal(unknown.error.code, "INVALID_PARAMS");
  connection.dispose();
});

test("decisions.acknowledge is visibility-only and never resolves", async () => {
  const calls = [];
  const engineApi = {
    subscribe: () => () => {},
    getState: () => ({ contractVersion: 1, sequence: 0, sessions: [] }),
    listAttention: () => ({ records: [] }),
    listMissionApprovals: () => [],
    listAutomations: () => ({ approvals: [] }),
    transitionAttention: (id, state) => { calls.push([id, state]); return { ok: true }; }
  };
  const connection = createProtocolConnection(engineApi, { send: () => {} });
  const ack = method => connection.handle({ version: PROTOCOL_VERSION, id: "a", method: "decisions.acknowledge", params: { id: method } });

  await ack("session:api");
  assert.deepEqual(calls.at(-1), ["api", "seen"]);

  const external = await ack("mcp:approval-1");
  assert.equal(external.result.scope, "renderer-local");
  assert.equal(external.result.acknowledged, false);
  connection.dispose();
});

test("protocol decisions.list returns the envelope for a live connection", async () => {
  const engineApi = {
    subscribe: () => () => {},
    getState: () => ({ contractVersion: 1, sequence: 0, sessions: [] }),
    listAttention: () => ({ records: [attention({ state: "new" })], preferences: {} }),
    listMissionApprovals: () => [],
    listAutomations: () => ({ approvals: [] })
  };
  const connection = createProtocolConnection(engineApi, {
    send: () => {},
    missionSupervisor: { listApprovals: () => [approval({ id: "s1" })] }
  });

  const response = await connection.handle({
    version: PROTOCOL_VERSION,
    id: "d1",
    method: "decisions.list",
    params: {}
  });

  assert.equal(response.ok !== false, true, response.error && response.error.message);
  const query = response.result;
  assert.ok(Array.isArray(query.records));
  assert.equal(query.counts.pending, 2, "one session + one supervisor approval");
  const supervisor = query.sources.find(source => source.id === "missionSupervisor");
  assert.equal(supervisor.availability, "ready");
  const mcp = query.sources.find(source => source.id === "mcp");
  assert.equal(mcp.availability, "unavailable", "no mcpGateway passed to this connection");
  connection.dispose();
});
