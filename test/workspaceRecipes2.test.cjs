"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { EngineAPI } = require("../src/engine/index.cjs");
const {
  MAX_RECIPE_PARALLELISM,
  MAX_RECIPE_RETRIES,
  cloneRun,
  dependencyCycle,
  normalizeRecipe
} = require("../src/engine/workspaceRecipes.cjs");
const { FakePty, makeFakePtyFactory } = require("./fakePty.cjs");

function workspace(t, sessions) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-recipes-2-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "termctl.config.json");
  fs.writeFileSync(filePath, `${JSON.stringify({ version: 1, project: "Recipes 2", sessions }, null, 2)}\n`);
  return filePath;
}

async function waitForRun(api, recipeId, accepted = ["completed", "failed", "cancelled"]) {
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    const run = api.listRecipes().find(recipe => recipe.id === recipeId)?.run;
    if (run && accepted.includes(run.phase)) return run;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`recipe ${recipeId} did not finish`);
}

test("Recipes 2 normalizes bounded DAG policy and rejects dependency cycles", () => {
  const sessions = new Set(["db", "api", "web"]);
  const recipe = normalizeRecipe({
    id: "daily",
    name: "Daily stack",
    steps: [
      { workerId: "db", dependsOn: [], readiness: "database", timeoutMs: 2000 },
      { workerId: "api", dependsOn: ["db"], readiness: "service" },
      { workerId: "web", dependsOn: ["api"], readiness: "build" }
    ],
    maxParallel: 99,
    retryAttempts: 99,
    retryDelayMs: 1,
    restartPolicy: "restart-running",
    recoveryPolicy: "rollback-started"
  }, sessions);
  assert.equal(recipe.recipeVersion, 2);
  assert.equal(recipe.maxParallel, MAX_RECIPE_PARALLELISM);
  assert.equal(recipe.retryAttempts, MAX_RECIPE_RETRIES);
  assert.equal(recipe.retryDelayMs, 100);
  assert.equal(recipe.restartPolicy, "restart-running");
  assert.equal(recipe.recoveryPolicy, "rollback-started");
  assert.deepEqual(dependencyCycle(recipe.steps), []);
  assert.throws(() => normalizeRecipe({
    id: "cycle",
    name: "Cycle",
    steps: [
      { workerId: "db", dependsOn: ["web"] },
      { workerId: "api", dependsOn: ["db"] },
      { workerId: "web", dependsOn: ["api"] }
    ]
  }, sessions), /dependency cycle/);
  assert.throws(() => normalizeRecipe({
    id: "bad-gate",
    name: "Bad gate",
    steps: [{ workerId: "db", dependsOn: [], readiness: "guess-ready" }]
  }, sessions), /readiness gate is invalid/);
  assert.throws(() => normalizeRecipe({
    id: "bad-policy",
    name: "Bad policy",
    workerIds: ["db"],
    recoveryPolicy: "kill-everything"
  }, sessions), /recovery policy is invalid/);
});

test("Recipes 2 launches independent DAG roots in a parallel wave", async t => {
  const filePath = workspace(t, [
    { id: "db", command: "db", cwd: ".", autoStart: false },
    { id: "api", command: "api", cwd: ".", autoStart: false },
    { id: "web", command: "web", cwd: ".", autoStart: false },
    { id: "tests", command: "tests", cwd: ".", autoStart: false }
  ]);
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory, activityPersistDelayMs: 0, resourceSampleIntervalMs: 0 });
  t.after(() => api.dispose());
  api.loadProject(filePath);
  assert.equal(api.saveRecipe({
    id: "parallel",
    name: "Parallel stack",
    steps: [
      { workerId: "db", dependsOn: [], readiness: "running" },
      { workerId: "api", dependsOn: [], readiness: "running" },
      { workerId: "web", dependsOn: ["api"], readiness: "running" },
      { workerId: "tests", dependsOn: ["db", "api"], readiness: "running" }
    ],
    maxParallel: 2
  }).ok, true);
  assert.equal(api.runRecipe("parallel").ok, true);
  const run = await waitForRun(api, "parallel");
  assert.equal(run.phase, "completed");
  assert.equal(run.wave, 2);
  assert.deepEqual(new Set(run.completed), new Set(["db", "api", "web", "tests"]));
  assert.equal(run.stepStates.tests.phase, "ready");
  assert.equal(factory.instances.length, 4);
  const phases = api.getActivity().events.filter(event => event.type === "recipe:step").map(event => event.phase);
  assert.deepEqual(phases.slice(0, 2), ["starting", "starting"]);
});

test("Recipes 2 unlocks a ready branch without waiting for an unrelated slow root", async t => {
  const filePath = workspace(t, [
    { id: "slow", command: "slow", cwd: ".", autoStart: false },
    { id: "fast", command: "fast", cwd: ".", autoStart: false },
    { id: "child", command: "child", cwd: ".", autoStart: false }
  ]);
  const instances = new Map();
  const factory = shell => {
    const pty = new FakePty();
    instances.set(shell, pty);
    return pty;
  };
  const api = new EngineAPI({ ptyFactory: factory, activityPersistDelayMs: 0, resourceSampleIntervalMs: 0 });
  t.after(() => api.dispose());
  api.loadProject(filePath);
  api.saveRecipe({
    id: "dynamic",
    name: "Dynamic DAG",
    steps: [
      { workerId: "slow", dependsOn: [], readiness: "service", timeoutMs: 1000 },
      { workerId: "fast", dependsOn: [], readiness: "running" },
      { workerId: "child", dependsOn: ["fast"], readiness: "running" }
    ],
    maxParallel: 2
  });
  api.runRecipe("dynamic");
  const branchDeadline = Date.now() + 500;
  while (!instances.has("child") && Date.now() < branchDeadline) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(instances.has("child"), true);
  assert.equal(api.listRecipes()[0].run.phase, "running");
  instances.get("slow").emitData("server running on http://localhost:4000\n");
  const run = await waitForRun(api, "dynamic");
  assert.equal(run.phase, "completed");
  assert.deepEqual(new Set(run.completed), new Set(["slow", "fast", "child"]));
});

test("Recipes 2 retries a failed start and records the successful attempt", async t => {
  const filePath = workspace(t, [{ id: "api", command: "api", cwd: ".", autoStart: false }]);
  let calls = 0;
  const instances = [];
  const factory = () => {
    calls++;
    if (calls === 1) throw new Error("transient launch failure");
    const pty = new FakePty();
    instances.push(pty);
    return pty;
  };
  const api = new EngineAPI({ ptyFactory: factory, activityPersistDelayMs: 0, resourceSampleIntervalMs: 0 });
  t.after(() => api.dispose());
  api.loadProject(filePath);
  api.saveRecipe({ id: "retry", name: "Retry API", workerIds: ["api"], retryAttempts: 1, retryDelayMs: 100 });
  api.runRecipe("retry");
  const run = await waitForRun(api, "retry");
  assert.equal(run.phase, "completed");
  assert.equal(run.stepStates.api.attempt, 2);
  assert.equal(calls, 2);
  assert.equal(instances.length, 1);
  assert.equal(api.getActivity().events.some(event => event.type === "recipe:step" && event.phase === "retry-wait"), true);
});

test("Recipes 2 rolls back only workers it started after a parallel failure", async t => {
  const filePath = workspace(t, [
    { id: "good", command: "good", cwd: ".", autoStart: false },
    { id: "bad", command: "bad", cwd: ".", autoStart: false }
  ]);
  let goodPty;
  const factory = shell => {
    if (shell === "bad") throw new Error("bad worker failed");
    goodPty = new FakePty({ autoExitOnKill: true });
    return goodPty;
  };
  const api = new EngineAPI({ ptyFactory: factory, activityPersistDelayMs: 0, resourceSampleIntervalMs: 0 });
  t.after(() => api.dispose());
  api.loadProject(filePath);
  api.saveRecipe({
    id: "rollback",
    name: "Rollback stack",
    workerIds: ["good", "bad"],
    steps: [
      { workerId: "good", dependsOn: [], readiness: "running" },
      { workerId: "bad", dependsOn: [], readiness: "running" }
    ],
    maxParallel: 2,
    recoveryPolicy: "rollback-started"
  });
  api.runRecipe("rollback");
  const run = await waitForRun(api, "rollback");
  assert.equal(run.phase, "failed");
  assert.equal(run.rollback.phase, "requested");
  assert.deepEqual(run.rollback.workerIds, ["good"]);
  assert.equal(goodPty.killed, true);
});

test("Recipes 2 cancellation stops scheduling and preserves cloned run state", async t => {
  const filePath = workspace(t, [
    { id: "api", command: "api", cwd: ".", autoStart: false },
    { id: "web", command: "web", cwd: ".", autoStart: false }
  ]);
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory, activityPersistDelayMs: 0, resourceSampleIntervalMs: 0 });
  t.after(() => api.dispose());
  api.loadProject(filePath);
  api.saveRecipe({
    id: "cancel",
    name: "Cancel stack",
    steps: [
      { workerId: "api", dependsOn: [], readiness: "service", timeoutMs: 1000 },
      { workerId: "web", dependsOn: ["api"], readiness: "running" }
    ]
  });
  api.runRecipe("cancel");
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(api.deleteRecipe("cancel").error, /cancel the active recipe/);
  assert.equal(api.cancelRecipe("cancel").ok, true);
  const run = await waitForRun(api, "cancel");
  assert.equal(run.phase, "cancelled");
  assert.equal(factory.instances.length, 1);
  const cloned = cloneRun(run);
  cloned.stepStates.api.phase = "changed";
  assert.equal(run.stepStates.api.phase, "cancelled");
});

// T076 — two windows editing one recipe must not silently overwrite each other.
function recipeApi(t, sessions) {
  const filePath = workspace(t, sessions);
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory, activityPersistDelayMs: 0, resourceSampleIntervalMs: 0 });
  t.after(() => api.dispose());
  api.loadProject(filePath);
  return api;
}

test("T076 — a save that names a stale revision is refused, and says what changed", t => {
  const api = recipeApi(t, [{ id: "web", name: "Web", command: "x", cwd: ".", autoStart: false }]);

  const first = api.saveRecipe({ id: "stack", name: "Stack", steps: [{ workerId: "web" }] });
  assert.equal(first.ok, true);
  assert.equal(first.recipe.revision, 1, "a new recipe starts at revision 1");

  // A second editor saves first and moves the recipe on.
  const second = api.saveRecipe({ id: "stack", name: "Stack renamed", steps: [{ workerId: "web" }], baseRevision: 1 });
  assert.equal(second.ok, true);
  assert.equal(second.recipe.revision, 2, "each accepted save advances the revision");

  // The first editor, still holding revision 1, is told rather than overwriting.
  const stale = api.saveRecipe({ id: "stack", name: "Stack from the stale window", steps: [{ workerId: "web" }], baseRevision: 1 });
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict, true);
  assert.equal(stale.currentRevision, 2);
  assert.match(stale.error, /revision 1/);
  assert.match(stale.error, /revision 2/);
  assert.equal(api.listRecipes().find(item => item.id === "stack").name, "Stack renamed", "the winning edit must survive");
});

test("T076 — a save with no base revision is still an explicit overwrite", t => {
  const api = recipeApi(t, [{ id: "web", name: "Web", command: "x", cwd: ".", autoStart: false }]);
  api.saveRecipe({ id: "stack", name: "Stack", steps: [{ workerId: "web" }] });
  api.saveRecipe({ id: "stack", name: "Second", steps: [{ workerId: "web" }], baseRevision: 1 });
  // Protocol v1 clients predate the field; omitting it must keep working.
  const forced = api.saveRecipe({ id: "stack", name: "Forced", steps: [{ workerId: "web" }] });
  assert.equal(forced.ok, true);
  assert.equal(forced.recipe.revision, 3, "the revision still advances so the next conflict is detected");
  assert.equal(api.listRecipes().find(item => item.id === "stack").name, "Forced");
});

// T077 — the run history is what you read when deciding whether to recover.
test("T077 — finished runs are kept per recipe, bounded, newest first", async t => {
  const api = recipeApi(t, [{ id: "web", name: "Web", command: "x", cwd: ".", autoStart: false }]);
  api.saveRecipe({ id: "stack", name: "Stack", steps: [{ workerId: "web", readiness: "running" }] });

  assert.deepEqual(api.listRecipeRunHistory("stack"), [], "nothing has run yet");

  for (let index = 0; index < 12; index += 1) {
    assert.equal(api.runRecipe("stack").ok, true, `run ${index} should start`);
    await waitForRun(api, "stack");
  }

  const history = api.listRecipeRunHistory("stack");
  assert.equal(history.length, 10, "history is bounded to the recorded limit");
  assert.ok(history[0].finishedAt >= history.at(-1).finishedAt, "newest first");
  for (const entry of history) {
    assert.ok(entry.runId, "every entry identifies its run");
    assert.ok(Number.isInteger(entry.durationMs), "every entry carries how long it took");
    assert.ok(Array.isArray(entry.completed) && Array.isArray(entry.failures));
  }
  // The history travels with the recipe, so one read answers the whole page.
  assert.equal(api.listRecipes().find(item => item.id === "stack").runHistory.length, 10);
});

test("T077 — deleting a recipe forgets its run history too", async t => {
  const api = recipeApi(t, [{ id: "web", name: "Web", command: "x", cwd: ".", autoStart: false }]);
  api.saveRecipe({ id: "stack", name: "Stack", steps: [{ workerId: "web", readiness: "running" }] });
  api.runRecipe("stack");
  await waitForRun(api, "stack");
  assert.equal(api.listRecipeRunHistory("stack").length, 1);

  assert.equal(api.deleteRecipe("stack").ok, true);
  assert.deepEqual(api.listRecipeRunHistory("stack"), [], "a deleted recipe leaves no history behind");
});
