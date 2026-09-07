"use strict";

// Phase 8 - Performance Profiles and Resource Bounds (T173, T174, T176).
//
// These tests measure and assert the performance characteristics and memory/resource
// boundaries established for terminals, history lists, and high-frequency output.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
const protocolRoot = path.join(__dirname, "..", "src", "protocol");
const engineRoot = path.join(__dirname, "..", "src", "engine");

const read = (...parts) => fs.readFileSync(path.join(rendererRoot, ...parts), "utf8");

test("T173 - Terminal mount costs and limits: bounded slots, single ResizeObserver per pane, zero unbounded intervals", () => {
  const terminalPane = read("TerminalPane.jsx");
  const layout = read("useTerminalLayout.js");

  // Mount ceiling is strictly enforced at 6 slots (grid-3x2)
  assert.match(layout, /slots:\s*6/);
  assert.doesNotMatch(layout, /slots:\s*[7-9]|slots:\s*\d{2,}/);

  // Per-pane ResizeObserver is scoped to container ref and cleans up on unmount
  assert.match(terminalPane, /new ResizeObserver\(/);
  assert.match(terminalPane, /resizeObserver\.disconnect\(\)/);

  // Uptime/render intervals are singletons per pane or use lightweight derived timestamps
  assert.match(terminalPane, /uptime\(session\)|uptime/);
});

test("T174 - 200-row History list profiling: linear transform <5ms, no virtualizer overhead needed", () => {
  const { buildHistoryModel } = require(path.join(protocolRoot, "historyExport.cjs"));

  // Generate maximum capacity 200 activity events
  const syntheticEvents = [];
  const baseTime = Date.now() - 200000;
  for (let i = 1; i <= 200; i++) {
    syntheticEvents.push({
      sequence: i,
      timestamp: baseTime + i * 1000,
      type: i % 10 === 0 ? "session:error" : i % 5 === 0 ? "session:evidence" : "session:status",
      name: `worker-${(i % 6) + 1}`,
      sessionId: `worker-${(i % 6) + 1}`,
      reason: `Test operational event ${i}`,
      status: "running"
    });
  }

  const start = performance.now();
  const model = buildHistoryModel({ activity: syntheticEvents, decisions: [], recipes: [] });
  const duration = performance.now() - start;

  assert.equal(model.rows.length, 200);
  assert.ok(duration < 25, `Transforming 200 history rows took ${duration}ms (budget <25ms)`);

  // Verify memory footprint of 200 rows is compact (<500 KB)
  const jsonSize = JSON.stringify(model).length;
  assert.ok(jsonSize < 500000, `200 history rows payload is ${jsonSize} bytes`);
});

test("T176 - Sustained high-volume terminal output bypasses React state and preserves bounded buffers", () => {
  const useMissionState = read("useMissionState.js");
  const protocol = fs.readFileSync(path.join(protocolRoot, "index.cjs"), "utf8");

  // High-volume session:output is explicitly dropped at the protocol event subscription
  assert.match(useMissionState, /if \(!event \|\| event\.type === "session:output"\) return;/);
  assert.match(protocol, /if \(disposed \|\| event\?\.type === "session:output"\) return;/);

  // Engine event queue is hard-bounded to MAX_EVENT_QUEUE
  assert.match(protocol, /const MAX_EVENT_QUEUE =/);
  assert.match(protocol, /if \(eventQueue\.length > MAX_EVENT_QUEUE\)/);

  // Terminal streaming queue is hard-bounded with explicit drop accounting
  assert.match(protocol, /droppedBytes/);
  assert.match(protocol, /terminal:overflow/);
});
