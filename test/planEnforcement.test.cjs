"use strict";

// What each plan allows is decided once, in the main process: the protocol
// refuses a request outside the plan before any service sees it, and the
// engine refuses to start a process past the plan's terminal count however
// the start was asked for. The renderer only draws crowns.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Entitlements, PlanRefusal, normalizeLimits, normalizePlanCatalogue } = require("../src/service/entitlements.cjs");
const { createProtocolConnection } = require("../src/protocol/index.cjs");
const { SessionEngine } = require("../src/engine/sessionEngine.cjs");
const { makeFakePtyFactory } = require("./fakePty.cjs");

const CATALOGUE = [
  { id: "free", name: "Free", rank: 0, limits: { terminals: 3, projects: 1, projectSwitching: false, mcp: "none", mobileCompanion: false, vscodeBridge: false, recipes: 1, recipeTrialDays: 3, byokKeys: 0, missionAiMessages: 3, missionAiPeriod: "day" } },
  { id: "pro", name: "Pro", rank: 1, limits: { terminals: 8, projects: null, projectSwitching: true, mcp: "read", mobileCompanion: true, vscodeBridge: false, recipes: 3, recipeTrialDays: null, byokKeys: 1, missionAiMessages: null, missionAiPeriod: "day" } },
  { id: "ultimate", name: "Ultimate", rank: 2, limits: { terminals: null, projects: null, projectSwitching: true, mcp: "full", mobileCompanion: true, vscodeBridge: true, recipes: null, recipeTrialDays: null, byokKeys: null, missionAiMessages: null, missionAiPeriod: "day" } }
];

function plan(id, extra = {}) {
  const row = CATALOGUE.find(item => item.id === id);
  return new Entitlements({ plan: { id: row.id, name: row.name, rank: row.rank }, limits: row.limits, plans: CATALOGUE, ...extra }, { now: () => Date.parse("2026-09-19T12:00:00Z") });
}

test("each plan's limits match the subscription table", () => {
  const free = plan("free");
  assert.equal(free.terminalLimit(), 3);
  assert.ok(free.checkCreateTerminal(3) instanceof PlanRefusal);
  assert.equal(free.checkCreateTerminal(2), null);
  assert.ok(free.checkRunTerminal(3));
  assert.equal(free.mcpLevel(), "none");
  assert.ok(free.checkMcp());
  assert.ok(free.checkMobile());
  assert.ok(free.checkVsCode());
  assert.ok(free.checkByokAdd(0), "Free brings no keys of its own");

  const pro = plan("pro");
  assert.equal(pro.terminalLimit(), 8);
  assert.equal(pro.checkMcp(), null);
  assert.ok(pro.checkMcpAction(), "Pro's MCP is read-only");
  assert.equal(pro.checkMobile(), null);
  assert.ok(pro.checkVsCode(), "the VS Code bridge is Ultimate only");
  assert.equal(pro.checkByokAdd(0), null);
  assert.ok(pro.checkByokAdd(1), "Pro holds one key of its own");
  assert.ok(pro.checkRecipeCreate(3));
  assert.equal(pro.checkProjectSwitch({ currentPersistent: true }), null);

  const ultimate = plan("ultimate");
  assert.equal(ultimate.terminalLimit(), null);
  assert.equal(ultimate.checkRunTerminal(500), null);
  assert.equal(ultimate.checkMcpAction(), null);
  assert.equal(ultimate.checkVsCode(), null);
  assert.equal(ultimate.checkByokAdd(50), null);
  assert.equal(ultimate.checkRecipeCreate(99), null);
});

test("a refusal names the cheapest plan that would allow it", () => {
  const free = plan("free");
  assert.equal(free.checkCreateTerminal(3).requiredPlan.id, "pro");
  assert.equal(free.checkVsCode().requiredPlan.id, "ultimate");
  assert.equal(plan("pro").checkCreateTerminal(8).requiredPlan.id, "ultimate");
  assert.match(free.checkMobile().message, /Upgrade to Pro/);
  assert.equal(free.checkMobile().toJSON().code, "PLAN_REQUIRED");
});

test("Free keeps one project, but the first one can always be opened", () => {
  const free = plan("free");
  assert.equal(free.checkProjectSwitch({ currentPersistent: false }), null, "the onboarding shell is not a project");
  assert.equal(free.checkProjectSwitch({ currentPersistent: true, sameProject: true }), null);
  assert.ok(free.checkProjectSwitch({ currentPersistent: true }));
});

test("the Free recipe trial ends after its days, and then recipes need a paid plan", () => {
  const during = plan("free", { recipeTrial: { days: 3, endsAt: "2026-09-21T12:00:00Z" } });
  assert.equal(during.recipeTrial().active, true);
  assert.equal(during.checkRecipeCreate(0), null);
  assert.ok(during.checkRecipeCreate(1), "one recipe during the trial");
  const after = plan("free", { recipeTrial: { days: 3, endsAt: "2026-09-18T12:00:00Z" } });
  assert.ok(after.checkRecipeUse(), "launching is refused once the trial ends");
  assert.equal(after.checkRecipeUse().feature, "recipeTrial");
});

test("only the oldest keys, up to the plan's count, answer", () => {
  const keys = [{ id: "b", createdAt: 20 }, { id: "a", createdAt: 10 }, { id: "c", createdAt: 30 }];
  assert.deepEqual([...plan("pro").allowedByokKeyIds(keys)], ["a"]);
  assert.deepEqual([...plan("free").allowedByokKeyIds(keys)], []);
  assert.equal(plan("ultimate").allowedByokKeyIds(keys).size, 3);
});

test("limits are read defensively: unknown values fall back to Free, null is unlimited", () => {
  assert.deepEqual(normalizeLimits({ terminals: "7", mcp: "sideways" }).terminals, 7);
  assert.equal(normalizeLimits({ mcp: "sideways" }).mcp, "none");
  assert.equal(normalizeLimits({ terminals: null }).terminals, null);
  assert.equal(normalizeLimits(null).terminals, 3);
  assert.deepEqual(normalizePlanCatalogue([{ id: "pro", name: "Pro", rank: 1, price_label: "₹499", limits: {} }]).map(row => row.priceLabel), ["₹499"]);
});

// ---------------------------------------------------------------- protocol

function engineStub(sessions = [], extra = {}) {
  return {
    subscribe: () => () => {},
    getState: () => ({ contractVersion: 1, sequence: 0, sessions }),
    list: () => sessions,
    getSnapshot: id => sessions.find(session => session.id === id) || null,
    getWorkspace: () => ({ name: "Test", persistent: true }),
    listRecipes: () => [],
    ...extra
  };
}

function request(id, method, params = {}) {
  return { version: 1, id, method, params };
}

test("the protocol refuses a request outside the plan with PLAN_REQUIRED and the plan that allows it", async () => {
  let gate = plan("free");
  const dispatched = [];
  const sessions = [{ id: "a", status: "running" }, { id: "b", status: "running" }, { id: "c", status: "running" }, { id: "d", status: "stopped" }];
  const connection = createProtocolConnection(engineStub(sessions, { create: definition => { dispatched.push(definition); return { ok: true, session: definition }; }, start: id => { dispatched.push(id); return { ok: true }; } }), {
    send: () => {},
    planGate: { entitlements: () => gate },
    mcpGateway: { configure: () => ({ enabled: true }), status: () => ({}) },
    vscodeBridge: { launch: () => ({ launched: true }), status: () => ({}) }
  });

  const create = await connection.handle(request("c1", "action.dispatch", { sessionId: null, action: { type: "create", definition: { id: "e", command: "node" } } }));
  assert.equal(create.ok, false);
  assert.equal(create.error.code, "PLAN_REQUIRED");
  assert.equal(create.error.plan.requiredPlan.id, "pro");

  const start = await connection.handle(request("s1", "action.dispatch", { sessionId: "d", action: { type: "start" } }));
  assert.equal(start.error.code, "PLAN_REQUIRED", "a fourth running terminal is refused");

  assert.equal((await connection.handle(request("m1", "mcp.configure", { configuration: { enabled: true } }))).error.code, "PLAN_REQUIRED");
  assert.equal((await connection.handle(request("m2", "mcp.configure", { configuration: { enabled: false } }))).ok, true, "turning a feature off is always allowed");
  assert.equal((await connection.handle(request("v1", "vscode.launch"))).error.code, "PLAN_REQUIRED");
  assert.equal((await connection.handle(request("p1", "project.choose"))).error.code, "PLAN_REQUIRED");
  assert.deepEqual(dispatched, [], "nothing refused reached the engine");

  gate = plan("ultimate");
  assert.equal((await connection.handle(request("v2", "vscode.launch"))).ok, true);
  assert.equal((await connection.handle(request("c2", "action.dispatch", { sessionId: null, action: { type: "create", definition: { id: "e", command: "node" } } }))).ok, true);
  connection.dispose();
});

test("status reads are never refused, so a locked feature can still show itself", async () => {
  const connection = createProtocolConnection(engineStub(), {
    send: () => {},
    planGate: { entitlements: () => plan("free") },
    mcpGateway: { status: () => ({ running: false }) },
    mobileCompanion: { status: () => ({ running: false }) },
    vscodeBridge: { status: () => ({ connected: false }) }
  });
  for (const method of ["mcp.status", "mobile.status", "vscode.status"]) {
    assert.equal((await connection.handle(request(method, method))).ok, true, method);
  }
  connection.dispose();
});

test("an engine start refused for the plan keeps its PLAN_REQUIRED code", async () => {
  const connection = createProtocolConnection(engineStub([{ id: "a", status: "stopped" }], { start: () => ({ ok: false, error: "Your Free plan runs up to 3 terminals at once.", code: "PLAN_REQUIRED" }) }), { send: () => {} });
  const response = await connection.handle(request("s", "action.dispatch", { sessionId: "a", action: { type: "start" } }));
  assert.equal(response.error.code, "PLAN_REQUIRED");
  connection.dispose();
});

test("a keystroke into a terminal is reported, so an agent's question can be marked answered", async () => {
  const typed = [];
  const stream = { onData: () => () => {}, onExit: () => () => {}, replay: () => ({ data: "", complete: true, throughSequence: 0 }), write: () => true };
  const connection = createProtocolConnection(engineStub([{ id: "w", status: "running" }], { attachRawStream: () => stream }), { send: () => {}, onTerminalInput: id => typed.push(id) });
  const opened = await connection.handle(request("o", "terminal.open", { sessionId: "w" }));
  await connection.handle(request("w", "terminal.write", { streamId: opened.result.streamId, data: "1" }));
  assert.deepEqual(typed, ["w"]);
  connection.dispose();
});

// ---------------------------------------------------------------- engine

test("the engine's spawn guard caps running terminals however a start is asked for", t => {
  const factory = makeFakePtyFactory();
  const limit = 2;
  const engine = new SessionEngine({ ptyFactory: factory, spawnGuard: ({ running }) => (running >= limit ? `Your plan runs up to ${limit} terminals at once.` : null) });
  t.after(() => engine.dispose());

  // autoStart on load: the first two start, the third waits.
  engine.create({ id: "a", name: "a", command: "node" });
  engine.create({ id: "b", name: "b", command: "node" });
  engine.create({ id: "c", name: "c", command: "node" });
  assert.equal(factory.instances.length, 2);
  assert.equal(engine.getSnapshot("c").isAlive, false);

  const refused = engine.start("c");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "PLAN_REQUIRED");
  assert.match(refused.error, /2 terminals at once/);

  // A running terminal restarting is not a new one.
  engine.get("a").proc.emitExit(0);
  assert.equal(engine.start("c").ok, true, "a slot freed by an exit can be used");
});
