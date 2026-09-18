"use strict";

// Plugin cards could never request their actions (wrong request shape, no
// operation, no target), a manifest's regular expression could stall the
// process evaluating it, and an automation "run" was quietly reported as done.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { PluginPlatformStore, normalizeRule, evaluateContribution } = require("../src/service/pluginPlatformStore.cjs");
const { PermissionedPluginPlatform } = require("../src/service/pluginPlatform.cjs");

const root = path.resolve(__dirname, "..");
const read = rel => fs.readFileSync(path.join(root, rel), "utf8");
const BACKSLASH = String.fromCharCode(92);

function platformWith(t, manifest, engine) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-plugin-actions-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new PluginPlatformStore(path.join(directory, "plugins.json"), { now: () => 50_000 });
  const platform = new PermissionedPluginPlatform({
    store,
    missionContext: { snapshot: () => ({ generatedAt: 50_000 }) },
    getEngineApi: () => engine,
    now: () => 50_000,
    chooseManifest: async () => ({ manifest, source: "test.plugin.json" })
  });
  return platform;
}

const baseManifest = extra => ({
  manifestVersion: 1,
  id: "dev.outarch.actions",
  name: "Action Tests",
  version: "1.0.0",
  publisher: "Tests",
  description: "Plugin action tests",
  surfaces: ["needs.request"],
  ...extra
});

test("a manifest cannot ship a pattern that repeats a repeating group, or nest rules without end", () => {
  const rule = operand => () => normalizeRule({ metric: "overall.status", operator: "regex", operand });
  for (const hostile of ["(a+)+$", "(a*)*b", `(${BACKSLASH}d{2})+x`, `(x)${BACKSLASH}1`, "(.*a){12}", "x".repeat(65)]) {
    assert.throws(rule(hostile), /simple regular expression/, hostile);
  }
  for (const fine of ["^api", "fail(ed|ure)", "a+b", `${BACKSLASH}d+ failed`]) {
    assert.doesNotThrow(rule(fine), fine);
  }
  let nested = { metric: "overall.status", operator: "eq", operand: "critical" };
  for (let level = 0; level < 3; level++) nested = { all: [nested] };
  assert.doesNotThrow(() => normalizeRule(nested), "four levels are allowed");
  assert.throws(() => normalizeRule({ any: [nested] }), /nest at most 4 levels/);
});

test("evaluation never runs an unvetted pattern and bounds the text it tests", () => {
  const started = Date.now();
  const card = evaluateContribution({ id: "x", surface: "cockpit.banner", title: "T", value: "base", rules: [{ metric: "project.name", operator: "regex", operand: "(a+)+$", value: "matched" }] }, { project: { name: `${"a".repeat(40)}!` } });
  assert.equal(card.value, "base");
  assert.ok(Date.now() - started < 200, "a hostile stored rule is skipped, not run");
  const long = evaluateContribution({ id: "y", surface: "cockpit.banner", title: "T", value: "base", rules: [{ metric: "project.name", operator: "regex", operand: "end$", value: "matched" }] }, { project: { name: `${"b".repeat(400)}end` } });
  assert.equal(long.value, "base", "only the first 256 characters are tested");
});

test("a card's target can name the worker its rule is about", () => {
  const snapshot = { workers: [{ id: "web", name: "Web", status: "running" }, { id: "api", name: "API", status: "failed" }] };
  const card = evaluateContribution({ id: "c", surface: "cockpit.banner", title: "Guardian", value: "Nominal", actionId: "restart", rules: [{ metric: "workers.failed.count", operator: "gt", operand: 0, value: "{count} failing", target: "{workers.failed.first.id}", detail: "Down: {workers.failed.first.name}" }] }, snapshot);
  assert.equal(card.value, "1 failing");
  assert.equal(card.target, "api");
  assert.equal(card.detail, "Down: API");
  const calm = evaluateContribution({ id: "c", surface: "cockpit.banner", title: "Guardian", value: "Nominal", target: "{workers.failed.first.id}" }, { workers: [] });
  assert.equal(calm.target, "", "no failing worker, no target");
});

test("an action that declares one operation needs no operation in the request", async t => {
  const calls = [];
  const engine = { getSnapshot: id => (id === "api" ? { id, name: "API", status: "failed" } : null), listRecipes: () => [], restart: async id => { calls.push(id); return { ok: true }; } };
  const manifest = baseManifest({ permissions: ["worker.lifecycle.request"], actions: [{ id: "restart-api", label: "Restart", type: "worker", operations: ["restart"] }] });
  const platform = platformWith(t, manifest, engine);
  await platform.chooseAndInstall();
  platform.configure(manifest.id, { enabled: true, grantedPermissions: ["worker.lifecycle.request"] });
  const approval = platform.requestAction(manifest.id, { actionId: "restart-api", target: "api", reason: "card" });
  assert.equal(approval.operation, "restart");
  assert.equal((await platform.resolveApproval(approval.id, "approve")).state, "approved");
  assert.deepEqual(calls, ["api"]);
});

test("automation requests name a real workflow and are never quietly downgraded or faked", async t => {
  const tested = [];
  const engine = {
    listRecipes: () => [{ id: "stack", name: "Stack" }],
    // EngineAPI's own shape.
    listAutomations: () => ({ definitions: [{ id: "ci", name: "CI checks" }], approvals: [], audit: [] }),
    testAutomation: id => { tested.push(id); return { ok: true, result: { executed: false } }; }
  };
  const manifest = baseManifest({
    permissions: ["automation.run.request", "recipe.run.request"],
    actions: [
      { id: "ci", label: "CI", type: "automation", operations: ["test", "run"] },
      { id: "pause-stack", label: "Pause", type: "recipe", operations: ["pause"] }
    ]
  });
  const platform = platformWith(t, manifest, engine);
  await platform.chooseAndInstall();
  platform.configure(manifest.id, { enabled: true, grantedPermissions: ["automation.run.request", "recipe.run.request"] });

  assert.throws(() => platform.requestAction(manifest.id, { actionId: "ci", operation: "test", target: "missing" }), /automation target was not found/);
  assert.throws(() => platform.requestAction(manifest.id, { actionId: "ci", operation: "run", target: "ci" }), /cannot run an automation workflow/);
  assert.throws(() => platform.requestAction(manifest.id, { actionId: "ci", target: "ci" }), /operation is not declared/, "two operations: the request must choose");

  const dryRun = platform.requestAction(manifest.id, { actionId: "ci", operation: "test", target: "ci" });
  assert.equal(dryRun.targetName, "CI checks");
  assert.equal((await platform.resolveApproval(dryRun.id, "approve")).state, "approved");
  assert.deepEqual(tested, ["ci"]);

  // The engine here has no pauseRecipe: the approval fails instead of claiming success.
  const pause = platform.requestAction(manifest.id, { actionId: "pause-stack", target: "stack" });
  const resolved = await platform.resolveApproval(pause.id, "approve");
  assert.equal(resolved.state, "failed");
  assert.match(resolved.error, /not available/);

  const source = read("src/service/pluginPlatform.cjs");
  assert.doesNotMatch(source, /result = \{ ok: true/, "no fabricated success");
});

test("the plugin card sends the request the protocol accepts and stays quiet without plugins", () => {
  const slot = read("src/groundstation/renderer/PluginContributionSlot.jsx");
  assert.match(slot, /request\("plugin\.action\.request", \{\n\s*pluginId: item\.pluginId,\n\s*request: \{\n\s*actionId: item\.actionId,\n\s*operation: item\.actionOperation,\n\s*target: item\.target,/);
  assert.match(slot, /actionOperation: action\?\.operations\?\.\[0\] \|\| null/);
  assert.match(slot, /\{item\.actionId && item\.target && item\.actionOperation && <div className="plugin-contribution-action-row">/);
  // Styling belongs to the design system, not inline fallbacks.
  assert.doesNotMatch(slot, /style=\{\{/);
  // Snapshots only for a slot with something to show, and throttled.
  assert.match(slot, /const SNAPSHOT_REFRESH_MS = 1500;/);
  assert.match(slot, /if \(suppliedSnapshot \|\| !relevant\) return undefined;/);
  assert.match(slot, /for \(const timer of feedbackTimers\.current\.values\(\)\) clearTimeout\(timer\);/);
  const protocol = read("src/protocol/index.cjs");
  assert.match(protocol, /case "plugin\.action\.request": \{[\s\S]{0,200}params\.request/);
  const css = read("src/groundstation/renderer/redesign/surfaces.css");
  for (const name of ["plugin-contribution-action-row", "plugin-contribution-action-btn", "plugin-contribution-action-feedback"]) assert.match(css, new RegExp(`\\.${name}`));
  const example = JSON.parse(read("plugins/examples/cockpit-guardian.plugin.json"));
  assert.ok(example.contributions[0].rules.every(rule => rule.target === "{workers.failed.first.id}"));
});
