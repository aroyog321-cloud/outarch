const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { PluginPlatformStore, normalizeManifest, evaluateContribution } = require("../src/service/pluginPlatformStore.cjs");

const manifest = {
  manifestVersion: 1,
  id: "dev.mission-control.tests",
  name: "Test Intelligence",
  version: "1.0.0",
  publisher: "Tests",
  description: "Bounded test health",
  permissions: ["health.read", "worker.lifecycle.request"],
  surfaces: ["settings.summary", "health.status", "needs.request"],
  contributions: [
    { id: "test-summary", surface: "settings.summary", title: "Test intelligence", value: "Ready", detail: "Bounded metadata only", tone: "neutral" },
    {
      id: "test-health",
      surface: "health.status",
      title: "Test health",
      value: "Observed",
      tone: "healthy",
      rules: [
        { metric: "workers.failed.count", operator: "gt", operand: 0, value: "{count} workers failing", tone: "critical", detail: "Check worker telemetry immediately" },
        { metric: "workers.running.count", operator: "gt", operand: 0, value: "{count} workers nominal", tone: "healthy" }
      ]
    }
  ],
  actions: [{ id: "restart-tests", label: "Restart tests", type: "worker", operations: ["restart"] }]
};

test("plugin manifests install disabled with zero grants and remain bounded", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-plugin-store-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "plugins.json");
  const store = new PluginPlatformStore(filePath, { now: () => 100 });
  const installed = store.install(manifest, "tests.plugin.json");
  assert.equal(installed.enabled, false);
  assert.deepEqual(installed.grantedPermissions, []);
  assert.equal(installed.manifest.contributions.length, 2);
  assert.equal(installed.manifest.contributions[1].tone, "healthy");
  assert.equal(store.status().pluginCount, 1);
  const configured = store.configure(manifest.id, { enabled: true, grantedPermissions: ["health.read"] });
  assert.equal(configured.enabled, true);
  assert.deepEqual(configured.grantedPermissions, ["health.read"]);
  assert.throws(() => store.configure(manifest.id, { grantedPermissions: ["context.read"] }), /did not declare/);
  assert.equal(fs.readFileSync(filePath).length < 512 * 1024, true);
});

test("plugin manifests reject executable and undeclared privileged authority", () => {
  assert.throws(() => normalizeManifest({ ...manifest, main: "index.cjs" }), /not allowed: main/);
  assert.throws(() => normalizeManifest({ ...manifest, permissions: ["filesystem.read"] }), /Unsupported plugin permission/);
  assert.throws(() => normalizeManifest({ ...manifest, actions: [{ id: "shell", label: "Shell", type: "worker", operations: ["execute"] }] }), /Unsupported plugin action operation/);
  assert.throws(() => normalizeManifest({ ...manifest, contributions: [{ id: "unsafe", surface: "settings.summary", title: "Unsafe", value: "No", onClick: "run" }] }), /Unsupported plugin contribution field/);
  assert.throws(() => normalizeManifest({ ...manifest, surfaces: ["settings.summary", "needs.request"], contributions: [{ id: "health", surface: "health.status", title: "Health", value: "Unknown" }] }), /requires declared surface health.status/);
  assert.throws(() => normalizeManifest({ ...manifest, permissions: ["worker.lifecycle.request"], contributions: [{ id: "health", surface: "health.status", title: "Health", value: "Unknown" }] }), /requires health.read/);
  assert.throws(() => normalizeManifest({ ...manifest, contributions: [{ id: "health", surface: "health.status", title: "Health", value: "Unknown", rules: [{ metric: "bad", evil: true }] }] }), /Unsupported plugin contribution rule field/);
});

test("safe declarative rules evaluate dynamically against bounded context snapshots", () => {
  const contribution = manifest.contributions[1];
  const nominalSnapshot = { workers: [{ id: "w1", status: "running", health: "nominal" }] };
  const evaluatedNominal = evaluateContribution(contribution, nominalSnapshot);
  assert.equal(evaluatedNominal.value, "1 workers nominal");
  assert.equal(evaluatedNominal.tone, "healthy");

  const failingSnapshot = { workers: [{ id: "w1", status: "failed", health: "critical" }] };
  const evaluatedFailing = evaluateContribution(contribution, failingSnapshot);
  assert.equal(evaluatedFailing.value, "1 workers failing");
  assert.equal(evaluatedFailing.tone, "critical");
  assert.equal(evaluatedFailing.detail, "Check worker telemetry immediately");

  // Zero / empty snapshot returns base default
  const emptySnapshot = { workers: [] };
  const evaluatedEmpty = evaluateContribution(contribution, emptySnapshot);
  assert.equal(evaluatedEmpty.value, "Observed");
  assert.equal(evaluatedEmpty.tone, "healthy");
});

test("composite all/any rules, regex, contains, and template variable placeholders", () => {
  const compositeContribution = {
    id: "guardian",
    surface: "cockpit.banner",
    title: "Project {project.name} Guardian",
    value: "All Good",
    detail: "Running: {workers.running.names}",
    tone: "healthy",
    rules: [
      {
        all: [
          { metric: "workers.failed.count", operator: "gt", operand: 0 },
          { metric: "overall.status", operator: "eq", operand: "critical" }
        ],
        title: "Critical Failure Alert",
        value: "Failing: {workers.failed.names}",
        detail: "Workers failed: {workers.failed.count}",
        tone: "critical",
        actionId: "restart-tests",
        actionLabel: "Emergency Restart"
      },
      {
        any: [
          { metric: "workers.failed.names", operator: "contains", operand: "api" },
          { metric: "project.name", operator: "regex", operand: "^test.*" }
        ],
        title: "Matched Rule",
        value: "Matched",
        tone: "warning"
      }
    ]
  };

  const snapshot1 = {
    project: { name: "test-app" },
    overall: { status: "critical" },
    workers: [
      { id: "api-server", name: "api-server", status: "failed", health: "critical" },
      { id: "web-client", name: "web-client", status: "running", health: "nominal" }
    ]
  };

  const res1 = evaluateContribution(compositeContribution, snapshot1);
  assert.equal(res1.title, "Critical Failure Alert");
  assert.equal(res1.value, "Failing: api-server");
  assert.equal(res1.detail, "Workers failed: 1");
  assert.equal(res1.tone, "critical");
  assert.equal(res1.actionId, "restart-tests");
  assert.equal(res1.actionLabel, "Emergency Restart");

  const snapshot2 = {
    project: { name: "production" },
    overall: { status: "nominal" },
    workers: [
      { id: "api-server", name: "api-server", status: "failed", health: "critical" }
    ]
  };

  const res2 = evaluateContribution(compositeContribution, snapshot2);
  assert.equal(res2.value, "Matched");
  assert.equal(res2.tone, "warning");

  const snapshot3 = {
    project: { name: "production" },
    overall: { status: "nominal" },
    workers: [
      { id: "db-node", name: "db-node", status: "running", health: "nominal" }
    ]
  };

  const res3 = evaluateContribution(compositeContribution, snapshot3);
  assert.equal(res3.title, "Project production Guardian");
  assert.equal(res3.value, "All Good");
  assert.equal(res3.detail, "Running: db-node");
  assert.equal(res3.tone, "healthy");
});

test("supports automation actions and new surfaces in manifest normalization", () => {
  const autoManifest = {
    manifestVersion: 1,
    id: "dev.mission-control.auto",
    name: "Automation Plugin",
    version: "1.0.0",
    permissions: ["automation.run.request", "health.read"],
    surfaces: ["cockpit.banner", "health.status"],
    actions: [{ id: "run-e2e", label: "Run E2E Tests", type: "automation", operations: ["run", "test"] }],
    contributions: [
      {
        id: "auto-banner",
        surface: "cockpit.banner",
        title: "E2E Automation",
        value: "Ready",
        actionId: "run-e2e",
        actionLabel: "Trigger E2E"
      }
    ]
  };

  const normalized = normalizeManifest(autoManifest);
  assert.equal(normalized.actions[0].type, "automation");
  assert.deepEqual(normalized.actions[0].operations, ["run", "test"]);
  assert.equal(normalized.contributions[0].actionId, "run-e2e");
  assert.equal(normalized.contributions[0].surface, "cockpit.banner");
});
