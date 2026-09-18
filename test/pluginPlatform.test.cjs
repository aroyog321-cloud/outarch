const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { PluginPlatformStore } = require("../src/service/pluginPlatformStore.cjs");
const { PermissionedPluginPlatform } = require("../src/service/pluginPlatform.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-plugin-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = 10_000;
  const calls = [];
  const manifest = { manifestVersion: 1, id: "dev.mission-control.tests", name: "Test Intelligence", version: "1.0.0", publisher: "Tests", description: "Bounded test health", permissions: ["health.read", "events.read", "worker.lifecycle.request"], surfaces: ["health.status", "needs.request"], actions: [{ id: "restart-tests", label: "Restart tests", type: "worker", operations: ["restart"] }] };
  const store = new PluginPlatformStore(path.join(directory, "plugins.json"), { now: () => now });
  const engine = {
    getSnapshot: id => id === "tests" ? { id, name: "Tests", status: "failed" } : null,
    getActivity: () => ({ gap: false, hasMore: false, latestSequence: 1, events: [{ sequence: 1, at: now, type: "session:failed", id: "tests", reason: "failed" }] }),
    listRecipes: () => [],
    restart: async id => { calls.push(["restart", id]); return { ok: true }; }
  };
  const snapshotOptions = [];
  const platform = new PermissionedPluginPlatform({ store, missionContext: { snapshot: options => { snapshotOptions.push(options); return { contextVersion: 1, generatedAt: now, project: { name: "Test" }, overall: { status: "attention" }, workers: [{ id: "tests", name: "Tests", status: "failed", recentLines: ["must-not-leak"] }], missions: [], recipes: [], attention: [], projectMemory: { chapters: [] }, visibility: {}, privacy: {} }; } }, getEngineApi: () => engine, now: () => now, chooseManifest: async () => ({ manifest, source: "tests.plugin.json" }) });
  return { calls, manifest, platform, snapshotOptions, store, tick: value => { now += value; } };
}

test("plugins receive only explicitly granted bounded resources", async t => {
  const { manifest, platform, snapshotOptions } = fixture(t);
  const installed = await platform.chooseAndInstall();
  assert.equal(installed.plugin.enabled, false);
  assert.throws(() => platform.read(manifest.id, { permission: "health.read" }), /disabled/);
  platform.configure(manifest.id, { enabled: true, grantedPermissions: ["health.read"] });
  const health = platform.read(manifest.id, { permission: "health.read" });
  assert.equal(health.workers[0].status, "failed");
  assert.equal(JSON.stringify(health).includes("must-not-leak"), false);
  assert.equal(snapshotOptions[0].includeOutput, false);
  assert.throws(() => platform.read(manifest.id, { permission: "events.read" }), /permission required/);
});

test("plugin actions wait for local approval and revoked grants cancel authority", async t => {
  const { calls, manifest, platform } = fixture(t);
  await platform.chooseAndInstall();
  platform.configure(manifest.id, { enabled: true, grantedPermissions: ["worker.lifecycle.request"] });
  const approval = platform.requestAction(manifest.id, { actionId: "restart-tests", operation: "restart", target: "tests", reason: "Tests need a clean retry" });
  assert.equal(approval.state, "pending");
  assert.deepEqual(calls, []);
  const result = await platform.resolveApproval(approval.id, "approve");
  assert.equal(result.state, "approved");
  assert.deepEqual(calls, [["restart", "tests"]]);
  const later = platform.requestAction(manifest.id, { actionId: "restart-tests", operation: "restart", target: "tests", reason: "Retry" });
  platform.configure(manifest.id, { grantedPermissions: [] });
  assert.equal(platform.listApprovals().find(item => item.id === later.id).state, "revoked");
});

test("plugin can request and execute approved automation actions", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-plugin-auto-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = 20_000;
  const calls = [];
  const autoManifest = {
    manifestVersion: 1,
    id: "dev.mission-control.auto-test",
    name: "Auto Tester",
    version: "1.0.0",
    publisher: "Tests",
    description: "Automation tests",
    permissions: ["automation.run.request"],
    surfaces: ["settings.summary", "needs.request"],
    actions: [{ id: "trigger-ci", label: "Trigger CI", type: "automation", operations: ["test", "run"] }]
  };
  const store = new PluginPlatformStore(path.join(directory, "plugins.json"), { now: () => now });
  const engine = {
    listAutomations: () => [{ id: "ci-pipeline", name: "CI Pipeline" }],
    testAutomation: async id => { calls.push(["testAutomation", id]); return { ok: true }; }
  };
  const platform = new PermissionedPluginPlatform({
    store,
    missionContext: { snapshot: () => ({ generatedAt: now }) },
    getEngineApi: () => engine,
    now: () => now,
    chooseManifest: async () => ({ manifest: autoManifest, source: "auto.plugin.json" })
  });

  await platform.chooseAndInstall();
  platform.configure(autoManifest.id, { enabled: true, grantedPermissions: ["automation.run.request"] });
  const approval = platform.requestAction(autoManifest.id, { actionId: "trigger-ci", operation: "test", target: "ci-pipeline", reason: "Run automated tests" });
  assert.equal(approval.state, "pending");
  assert.equal(approval.targetName, "CI Pipeline");
  assert.equal(approval.type, "automation");
  
  const result = await platform.resolveApproval(approval.id, "approve");
  assert.equal(result.state, "approved");
  assert.deepEqual(calls, [["testAutomation", "ci-pipeline"]]);
});
