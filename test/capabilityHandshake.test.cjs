"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(root, relativePath), "utf8");

test("renderer obtains the Protocol capability map before exposing integration controls", () => {
  const hook = read("src/groundstation/renderer/useCapabilities.js");
  const app = read("src/groundstation/renderer/App.jsx");
  const integrations = read("src/groundstation/renderer/IntegrationsView.jsx");

  assert.match(hook, /missionApi\(\)\.request\("system\.hello"\)/);
  assert.match(hook, /hello\?\.capabilities/);
  assert.match(app, /const capabilityHandshake = useCapabilities\(\)/);
  assert.match(app, /capabilityHandshake=\{capabilityHandshake\}/);
  assert.match(integrations, /currentCapability\?\.support === "unavailable"/);
  assert.match(integrations, /const detailContent = capabilityHandshake\?\.status === "loading"/);
  assert.match(integrations, /capabilityHandshake\?\.status === "error"/);
  // T116 added the self-test above the panel; the gate is unchanged - the
  // children (and the self-test) are reached only after the unavailable branch.
  assert.match(integrations, /: capabilityUnavailable[\s\S]*<IntegrationDiagnostics integrationId=\{section\}[\s\S]*\{children\}/);
  assert.match(integrations, /Integration controls remain unavailable until the engine contract is verified/);
  assert.match(integrations, /No action has been attempted/);
  assert.match(integrations, /disabled=\{capabilityHandshake\?\.capabilities\?\.intelligence\?\.support === "unavailable"/);
  assert.match(integrations, /capabilityHandshake\?\.status !== "ready"/);
});

test("capability states stay engine-owned facts rather than renderer guesses", () => {
  const protocol = read("src/protocol/index.cjs");
  // T023/T026 — both of the concepts that were once "explicitly unavailable"
  // are now backed by a real service. Broadcast is an approval-gated engine
  // method; Free Port is read-only port-owner inspection.
  assert.match(protocol, /id: "terminal-broadcast", service: engineApi, methods: \["terminal\.broadcast\.preview", "terminal\.broadcast"\]/);
  assert.match(protocol, /id: "crashlens-free-port", service: portInspector, methods: \["crashlens\.port\.inspect"\]/);
  // The unavailable path is still real and still reachable: a capability whose
  // service reports `available: false` (Free Port off Windows, Mobile without
  // protected storage) must resolve to "unavailable" rather than be hidden.
  assert.match(protocol, /support: "unavailable", state: "unavailable"/);
  assert.match(protocol, /support: "supported"/);
  assert.match(protocol, /value\?\.available === false \? "unavailable" : "ready"/);
  for (const state of ["unavailable", "disabled", "loading", "error", "ready"]) {
    assert.match(protocol, new RegExp(`"${state}"`));
  }
});
