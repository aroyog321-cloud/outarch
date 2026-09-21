"use strict";

// T001 — Renderer-to-Protocol request contract.
//
// Every string-literal `missionApi().request("<method>")` or
// `missionApi().confirmedRequest("<method>")` in the renderer must name a
// method that exists in the Protocol v1 allowlist. A visible control that
// calls an absent method fails silently at runtime (Broadcast / CrashLens Free
// Port were exactly this), so this test fails the build instead.
//
// Limitation: calls whose method is a variable or object field (for example the
// integration hub's `missionApi().request(integration.request)`) cannot be
// resolved statically and are not checked here.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const RENDERER_DIR = path.resolve(__dirname, "../src/groundstation/renderer");
const PROTOCOL_FILE = path.resolve(__dirname, "../src/protocol/index.cjs");

function protocolMethods() {
  const source = fs.readFileSync(PROTOCOL_FILE, "utf8");
  const start = source.indexOf("const METHODS = Object.freeze([");
  assert.notEqual(start, -1, "Protocol METHODS allowlist not found");
  const end = source.indexOf("]);", start);
  assert.notEqual(end, -1, "Protocol METHODS allowlist is not terminated");
  const block = source.slice(start, end);
  const methods = new Set([...block.matchAll(/"([A-Za-z][A-Za-z0-9_.]*)"/g)].map(match => match[1]));
  assert.ok(methods.size >= 80, `expected a substantial method allowlist, found ${methods.size}`);
  return methods;
}

function rendererFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...rendererFiles(full));
    else if (/\.(jsx?|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

test("every renderer request() and confirmedRequest() string literal exists in the Protocol allowlist", () => {
  const methods = protocolMethods();
  const offenders = [];
  const seen = [];

  for (const file of rendererFiles(RENDERER_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/\.(?:request|confirmedRequest)\(\s*["'`]([A-Za-z][A-Za-z0-9_.]*)["'`]/g)) {
      const method = match[1];
      const rel = path.relative(RENDERER_DIR, file).split(path.sep).join("/");
      seen.push(method);
      if (!methods.has(method)) offenders.push(`${rel} -> ${method}`);
    }
  }

  assert.ok(seen.length >= 30, `expected many renderer request() call sites, found ${seen.length}`);
  assert.deepEqual(
    offenders,
    [],
    `renderer controls call protocol methods that are not in the Protocol v1 allowlist:\n  ${offenders.join("\n  ")}`
  );
});

// T002 — Renderer event-subscription contract.
//
// Every renderer subscription must flow through the one transport
// (missionApi().subscribe), capture its unsubscribe, and tear it down in the
// effect cleanup. An unbounded or leaked consumer is exactly what T002 forbids;
// MISSION_CONTROL_EVENT_CONTRACT.md is the prose authority for the same rules.

test("every renderer event subscription is captured and torn down", () => {
  const wrapper = "missionApi.js";
  const offenders = [];

  for (const file of rendererFiles(RENDERER_DIR)) {
    const rel = path.relative(RENDERER_DIR, file).split(path.sep).join("/");
    if (rel === wrapper) continue; // defines the wrapper itself
    const source = fs.readFileSync(file, "utf8");
    if (!source.includes(".subscribe(")) continue;

    // The only subscription producer a consumer may use is missionApi().subscribe.
    const allSubs = [...source.matchAll(/\.subscribe\(/g)].length;
    const wrappedSubs = [...source.matchAll(/missionApi\(\)\.subscribe\(/g)].length;
    if (allSubs !== wrappedSubs) {
      offenders.push(`${rel}: ${allSubs - wrappedSubs} \`.subscribe(\` call(s) not routed through \`missionApi().subscribe(\``);
    }
    // The return value must be captured (never fire-and-forget).
    for (const match of source.matchAll(/(.{0,4})missionApi\(\)\.subscribe\(/g)) {
      if (!/=\s*$/.test(match[1])) offenders.push(`${rel}: a missionApi().subscribe() return value is not assigned`);
    }
    // The captured handle must be invoked inside an effect cleanup.
    if (!/return \(\) =>[\s\S]{0,400}?unsubscribe(?:\?\.)?\(\)/.test(source)) {
      offenders.push(`${rel}: no \`return () => … unsubscribe()\` cleanup found near the subscription`);
    }
  }

  assert.deepEqual(offenders, [], `renderer event-subscription contract violations:\n  ${offenders.join("\n  ")}`);
});

test("the event transport is bounded end to end (preload buffer, engine queue, gap detection)", () => {
  const preload = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/preload/index.cjs"), "utf8");
  const protocol = fs.readFileSync(PROTOCOL_FILE, "utf8");

  // Preload: the pre-subscriber buffer is capped and trims to the newest N, and
  // version-mismatched frames are dropped rather than delivered.
  assert.match(preload, /const MAX_BUFFERED_EVENTS = \d+;/);
  assert.match(preload, /bufferedEvents = bufferedEvents\.slice\(-MAX_BUFFERED_EVENTS\)/);
  assert.match(preload, /message\.version !== PROTOCOL_VERSION/);

  // Protocol: engine events queue against a bounded buffer, a snapshot mismatch
  // or an overflow past the snapshot is surfaced (never a silent gap), and
  // session:output is dropped at the producer so bulk output never broadcasts.
  assert.match(protocol, /const MAX_EVENT_QUEUE = \d+;/);
  assert.match(protocol, /eventQueue\.splice\(0, eventQueue\.length - MAX_EVENT_QUEUE\)/);
  assert.match(protocol, /"EVENT_GAP"/);
  assert.match(protocol, /"STALE_SNAPSHOT"/);
  assert.match(protocol, /"SNAPSHOT_REQUIRED"/);
  assert.match(protocol, /function onEngineEvent\(event\) \{\s*if \(disposed \|\| event\?\.type === "session:output"\) return;/);

  // Every service subscription the connection opens is released on dispose().
  for (const handle of ["unsubscribeEvents", "unsubscribeVSCode", "unsubscribeMcp", "unsubscribeMobile"]) {
    assert.match(protocol, new RegExp(`try \\{ ${handle}\\?\\.\\(\\); \\}`));
  }
});

test("T166 - typed and channel-filtered event subscriptions at preload boundary", () => {
  const preload = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/preload/index.cjs"), "utf8");
  const missionApi = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/missionApi.js"), "utf8");
  const stateHook = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/useMissionState.js"), "utf8");

  // Preload filter implementation
  assert.match(preload, /function matchesEventFilter\(message, filter\)/);
  assert.match(preload, /function subscribe\(callback, filter = null\)/);
  assert.match(preload, /subscribers\.set\(callback, filter\);/);
  assert.match(preload, /if \(matchesEventFilter\(message, filter\)\)/);

  // missionApi forwards filter parameter
  assert.match(missionApi, /subscribe:\s*\(callback,\s*filter\)\s*=>\s*api\.subscribe\(callback,\s*filter\)/);

  // useMissionState subscribes with typed filter
  assert.match(stateHook, /missionApi\(\)\.subscribe\([\s\S]*?,\s*\{\s*type:\s*"engine:event"\s*\}\);/);

  // Functional simulation of preload filter
  const filterExtract = preload.slice(
    preload.indexOf("function matchesEventFilter"),
    preload.indexOf("function request")
  );
  const evalFilter = new Function(`${filterExtract}; return matchesEventFilter;`)();

  // Test filter matching rules
  assert.equal(evalFilter({ type: "engine:event" }, null), true, "null filter matches all");
  assert.equal(evalFilter({ type: "session:output", sessionId: "w1" }, "session:output"), true);
  assert.equal(evalFilter({ type: "session:output", sessionId: "w1" }, "engine:event"), false);
  assert.equal(evalFilter({ type: "integration:event", integration: "mcp" }, ["integration:event"]), true);
  assert.equal(evalFilter({ type: "session:output", sessionId: "w1" }, { type: "session:output", sessionId: "w1" }), true);
  assert.equal(evalFilter({ type: "session:output", sessionId: "w2" }, { type: "session:output", sessionId: "w1" }), false);
  assert.equal(evalFilter({ type: "integration:event", integration: "mcp" }, { type: "integration:event", integration: "mcp" }), true);
  assert.equal(evalFilter({ type: "integration:event", integration: "vscode" }, { type: "integration:event", integration: "mcp" }), false);
});

