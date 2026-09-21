"use strict";

// Phase 5 - Integrations and Mission AI (T115, T116, T118).
//
// T115 - Mission AI, VS Code and Automation answer the same audit question MCP
//        and Mobile already did, so "this bridge keeps no record" can no
//        longer be mistaken for "this bridge did nothing".
// T116 - one bounded, side-effect-free self-test for every integration.
// T118 - Mission AI's provider, credential, availability and request-error
//        states are named separately, and none of them exposes a key.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
const read = (...parts) => fs.readFileSync(path.join(rendererRoot, ...parts), "utf8");
const protocolSource = fs.readFileSync(path.join(__dirname, "..", "src", "protocol", "index.cjs"), "utf8");

const { MissionAIService } = require("../src/service/missionAi.cjs");

function service(overrides = {}) {
  return new MissionAIService({
    credentialStore: {
      status: () => ({ configured: true, available: true, model: "gemini-2.5-flash" }),
      preferences: () => ({ model: "gemini-2.5-flash", includeTerminalEvidence: false }),
      apiKey: () => "AIzaSyTOPSECRETKEYVALUE0000000000000000",
      configure: () => ({ configured: true, available: true, model: "gemini-2.5-flash" }),
      clear: () => true,
      ...overrides.credentialStore
    },
    missionContext: { snapshot: () => ({ generatedAt: 1, project: {}, evidenceIndex: [] }) },
    fetch: overrides.fetch || (async () => { throw new Error("network refused"); }),
    ...overrides.service
  });
}

test("T115 - Mission AI keeps a bounded audit trail and it holds no content", async () => {
  const ai = service();
  ai.configure({ apiKey: "AIzaSyTOPSECRETKEYVALUE0000000000000000" });
  await assert.rejects(ai.ask({ question: "What is broken in src/auth/session.ts?" }));
  ai.clear();

  const audit = ai.listAudit();
  assert.ok(audit.length >= 3, `expected records, got ${audit.length}`);
  const serialised = JSON.stringify(audit);
  // Neither the key nor the question may appear anywhere in the trail.
  assert.doesNotMatch(serialised, /AIzaSy/);
  assert.doesNotMatch(serialised, /src\/auth\/session\.ts/);
  assert.doesNotMatch(serialised, /What is broken/);
  // Newest first, and every record names what happened rather than to what.
  assert.equal(audit[0].kind, "credential");
  assert.ok(audit.every(item => item.kind && item.outcome && Number.isFinite(item.at)));
  assert.ok(ai.status().auditCount >= 3);
});

test("T115 - the Mission AI audit ring is bounded", () => {
  const ai = service();
  for (let index = 0; index < 120; index += 1) ai.record("question", "answered");
  assert.equal(ai.listAudit(500).length, 50);
  assert.equal(ai.audit.length, 50);
});

test("T115 - the VS Code bridge records connection metadata and reports its endpoint", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "service", "vscodeBridge.cjs"), "utf8");
  assert.match(source, /const VSCODE_AUDIT_LIMIT = 50;/);
  assert.match(source, /listAudit\(limit = 50\)/);
  assert.match(source, /this\.record\("handshake", "accepted", \{ capability: capabilities\.join\(","\) \|\| "none" \}\);/);
  assert.match(source, /this\.record\("connection", "disconnected"/);
  assert.match(source, /endpoint: this\.port \? `127\.0\.0\.1:\$\{this\.port\}` : null,/);
  // The trail records that a capability was granted, never what moved through it.
  assert.doesNotMatch(source, /this\.record\([^)]*(?:message\.text|content|payload\.body)/);
});

test("T115 - all five integrations are audited by one protocol shape and one register", () => {
  for (const method of ["missionAi.audit.list", "vscode.audit.list", "automation.audit.list", "mcp.audit.list", "mobile.audit.list"]) {
    assert.ok(protocolSource.includes(`"${method}",`), `${method} is not in the protocol allowlist`);
    assert.ok(protocolSource.includes(`case "${method}"`), `${method} has no handler`);
  }
  // None of them is a confirmed method: reading an audit changes nothing.
  const confirmed = protocolSource.slice(protocolSource.indexOf("const CONFIRMED"), protocolSource.indexOf("const METHODS"));
  assert.doesNotMatch(confirmed, /audit\.list/);

  const register = read("IntegrationAuditLog.jsx");
  for (const label of ["Mission AI", "VS Code", "MCP", "Automation", "Mobile"]) {
    assert.ok(register.includes(`["${label}", "`), `${label} is missing from the unified audit register`);
  }
  // A source that fails is named, never silently dropped from the total.
  assert.match(register, /Audit history is incomplete\./);
});

test("T116 - every integration has the same bounded, side-effect-free self-test", () => {
  const diagnostics = read("IntegrationDiagnostics.jsx");
  const probes = diagnostics.slice(diagnostics.indexOf("const PROBES = {"), diagnostics.indexOf("function Fact("));

  // Automation left the Integrations surface on 2026-09-12. Its workflows still
  // run and still raise approvals; those are decisions, and Needs You is where
  // decisions are answered, so nothing became unreachable by removing the tab.
  for (const id of ["intelligence", "vscode", "mcp", "companion"]) {
    assert.ok(probes.includes(`${id}: {`), `${id} has no self-test descriptor`);
  }
  assert.ok(!probes.includes("extensions: {"), "the removed plugin platform has no self-test");
  // Each of the five facts T116 names has a reader on every descriptor.
  for (const fact of ["permissions", "endpoint", "lastSuccess", "lastError", "recovery"]) {
    assert.equal((probes.match(new RegExp(`\\b${fact}:`, "g")) || []).length, 4, `${fact} is not read for all four integrations`);
  }

  // Bounded: a deadline, and only status methods - nothing that mutates.
  assert.match(diagnostics, /const TIMEOUT_MS = 6000;/);
  assert.match(diagnostics, /Promise\.race\(\[/);
  const methods = [...probes.matchAll(/method: "([^"]+)"/g)].map(match => match[1]);
  assert.equal(methods.length, 4);
  assert.ok(methods.every(method => /\.(status|list)$/.test(method)), `a self-test calls a non-read method: ${methods.join(", ")}`);
  assert.ok(!methods.some(method => /configure|rotate|resolve|install|invite|revoke|launch|disconnect/.test(method)));

  // A missing value is reported as missing, not left blank or invented.
  assert.match(diagnostics, /missing = "Not reported"/);
  assert.match(diagnostics, /No successful use recorded/);

  // It is mounted for every detail section of the hub.
  assert.match(read("IntegrationsView.jsx"), /<IntegrationDiagnostics integrationId=\{section\} capability=\{currentCapability\}\/>/);
});

test("T118 - Mission AI's states are named separately and none exposes a key", () => {
  const missionAi = read("MissionAI.jsx");
  const states = missionAi.slice(missionAi.indexOf("function missionAiStates("), missionAi.indexOf("function MissionAIStateFacts("));

  for (const label of ["Built-in keys", "Models", "Your keys", "Access"]) {
    assert.ok(states.includes(`label: "${label}"`), `${label} is not reported as its own state`);
  }
  // Keys missing is not a model listing that failed, and neither is "we do not know".
  assert.match(states, /"Not set in this build"/);
  assert.match(states, /Failed - \$\{mission\.modelsError\}/);
  assert.match(states, /"Unknown - status could not be read"/);
  // Presence only: nothing here reads a key.
  assert.doesNotMatch(states, /apiKey|api_key|secret|token/i);
  assert.match(missionAi, /<MissionAIStateFacts status=\{status\} error=\{error\}\/>/);
});

test("T170 - integration status refreshes are coalesced with a debounce timer and support targeted refresh by integration id", () => {
  const integrationsView = read("IntegrationsView.jsx");

  // Targeted refresh function
  assert.match(integrationsView, /const refreshTargeted = React\.useCallback\(async \(targetIds = null\) =>/);
  assert.match(integrationsView, /targets = targetIds && targetIds\.length > 0\s*\?\s*INTEGRATIONS\.filter\(item => targetIds\.includes\(item\.id\)\)\s*:\s*INTEGRATIONS;/);

  // Debounced coalescing subscription
  assert.match(integrationsView, /let debounceTimer = null;/);
  assert.match(integrationsView, /let pendingTargets = new Set\(\);/);
  assert.match(integrationsView, /let refreshAll = false;/);
  assert.match(integrationsView, /const scheduleRefresh = \(targetId\) =>/);
  assert.match(integrationsView, /debounceTimer = setTimeout\(\(\) => \{/);
  assert.match(integrationsView, /void refreshTargeted\(targets\);/);
  assert.match(integrationsView, /scheduleRefresh\(notification\.integration \|\| notification\.integrationId \|\| null\);/);

  // Cleanup on unmount
  assert.match(integrationsView, /if \(debounceTimer\) clearTimeout\(debounceTimer\);/);
  assert.match(integrationsView, /unsubscribe\?\.\(\);/);
});
