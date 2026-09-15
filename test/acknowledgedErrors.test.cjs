"use strict";

// An error acknowledged in Needs You came back — with a second notification —
// as soon as its terminal was opened. Opening a terminal re-fits it; the resize
// makes the terminal repaint its screen; the repaint arrives as output and
// still contains the old error line, which was read as a new failure.
//
// These tests pin both halves of the fix: a repaint is not output, and an
// acknowledged error printed again stays acknowledged until something changes.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { SessionEngine } = require("../src/engine/sessionEngine.cjs");
const { WorkspaceIntelligence } = require("../src/groundstation/main/workspaceIntelligence.cjs");
const { NotificationCenter, fromSemanticEvent } = require("../src/service/notificationCenter.cjs");
const { makeFakePtyFactory } = require("./fakePty.cjs");

const ESC = String.fromCharCode(27);
// What ConPTY sends after a resize: hide the cursor, home, every row with an
// erase-to-end, then put the cursor back.
const repaint = rows => `${ESC}[?25l${ESC}[H${rows.map(row => `${row}${ESC}[K`).join("\r\n")}${ESC}[3;20H${ESC}[?25h`;

function setup(t) {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "web", name: "Web", command: "x", cwd: "." });
  const metadata = [];
  engine.attachRawStream("web").onData((_chunk, meta) => metadata.push(meta));
  return { engine, pty: () => factory.last(), metadata, factory };
}

test("a repaint after a resize does not bring back an acknowledged error", t => {
  const { engine, pty, metadata } = setup(t);
  pty().emitData("booting\r\nTypeError: Cannot read properties of undefined\r\nPS D:\\app> ");
  assert.equal(engine.getSnapshot("web").attentionRequired, true);
  assert.deepEqual(engine.acknowledge("web"), { ok: true });
  const before = engine.getSnapshot("web");

  assert.equal(engine.resize("web", 100, 30), true);
  pty().emitData(repaint(["booting", "TypeError: Cannot read properties of undefined", "PS D:\\app>"]));

  const after = engine.getSnapshot("web");
  assert.equal(after.attentionRequired, false, "the repaint is the screen, not a new failure");
  assert.equal(after.lastOutputAt, before.lastOutputAt, "a repaint is not activity");
  assert.equal(after.lines.filter(line => line.includes("TypeError")).length, 1, "the log does not gain a copy of the screen");
  assert.equal(metadata.at(-1).redraw, true, "readers of the raw stream are told it is a repaint");
  assert.equal(metadata.at(-1).analysisText, "");
});

test("a repaint never raises an error that was on screen, acknowledged or not", t => {
  const { engine, pty } = setup(t);
  // An error, then a recovery that cleared it on its own.
  pty().emitData("Error: build failed\r\n");
  pty().emitData("Compiled successfully in 812ms\r\n");
  assert.equal(engine.getSnapshot("web").attentionRequired, false);

  engine.resize("web", 80, 24);
  pty().emitData(repaint(["Error: build failed", "Compiled successfully in 812ms"]));
  assert.equal(engine.getSnapshot("web").attentionRequired, false);
});

test("new output that arrives with a repaint is still read", t => {
  const { engine, pty, metadata } = setup(t);
  pty().emitData("server started\r\n");
  engine.resize("web", 80, 24);
  pty().emitData(repaint(["server started", "Error: connect ECONNREFUSED 127.0.0.1:5432"]));
  const snapshot = engine.getSnapshot("web");
  assert.equal(snapshot.attentionRequired, true, "the row that was not on screen before is real output");
  assert.match(snapshot.attentionReason, /ECONNREFUSED/);
  assert.match(metadata.at(-1).analysisText, /ECONNREFUSED/);
  assert.doesNotMatch(metadata.at(-1).analysisText, /server started/);
});

test("output after a resize that repeats nothing on screen is ordinary output", t => {
  const { engine, pty, metadata } = setup(t);
  pty().emitData("hello\r\n");
  engine.resize("web", 80, 24);
  pty().emitData("Error: brand new\r\n");
  assert.equal(engine.getSnapshot("web").attentionRequired, true);
  assert.equal(metadata.at(-1).redraw, undefined);
});

test("an acknowledged error printed again stays acknowledged until something changes", t => {
  const { engine, pty, metadata } = setup(t);
  pty().emitData("GET /orders 500\r\nTypeError: Cannot read properties of undefined (reading 'map')\r\n");
  engine.acknowledge("web");

  // The same request fails the same way: the operator already knows.
  pty().emitData("GET /orders 500\r\nTypeError: Cannot read properties of undefined (reading 'map')\r\n");
  assert.equal(engine.getSnapshot("web").attentionRequired, false);
  assert.equal(metadata.at(-1).acknowledged, true, "the event readers are told, so no build-failed notice either");

  // A different error is news.
  pty().emitData("Error: connect ECONNREFUSED 127.0.0.1:5432\r\n");
  assert.equal(engine.getSnapshot("web").attentionRequired, true);
});

test("a typed command, a success or a restart makes the same error news again", t => {
  const { engine, pty } = setup(t);
  const error = "TypeError: Cannot read properties of undefined\r\n";

  pty().emitData(error);
  engine.acknowledge("web");
  engine.write("web", "npm run dev\r");
  pty().emitData(error);
  assert.equal(engine.getSnapshot("web").attentionRequired, true, "after a command, it failed again");

  engine.acknowledge("web");
  pty().emitData("Compiled successfully\r\n");
  pty().emitData(error);
  assert.equal(engine.getSnapshot("web").attentionRequired, true, "it recovered and then broke again");

  engine.acknowledge("web");
  pty().emitData("Compiling modules\r\n");
  pty().emitData(error);
  assert.equal(engine.getSnapshot("web").attentionRequired, true, "a new build cycle failed");
});

test("a restart forgets what the last run acknowledged", async t => {
  const factory = makeFakePtyFactory({ autoExitOnKill: true });
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "web", name: "Web", command: "x", cwd: "." });
  factory.last().emitData("Error: boom\r\n");
  engine.acknowledge("web");
  await engine.restart("web");
  factory.last().emitData("Error: boom\r\n");
  assert.equal(engine.getSnapshot("web").attentionRequired, true);
});

test("the reason is the error line, not the prompt printed after it", t => {
  const { engine, pty } = setup(t);
  pty().emitData("Error: Cannot find module 'express'\r\nPS D:\\app> ");
  assert.equal(engine.getSnapshot("web").attentionReason, "Error: Cannot find module 'express'");
});

/* ------------------------------------------------ the event readers agree */

function fakeEngine() {
  let handler = null;
  return {
    api: {
      subscribe: () => () => {},
      list: () => [{ id: "web", name: "Web", isAlive: true, command: "npm" }],
      attachRawStream: () => ({ onData: callback => { handler = callback; return () => { handler = null; }; } })
    },
    emit: (chunk, meta) => handler?.(chunk, meta)
  };
}

test("service discovery and build events skip repaints and acknowledged errors", () => {
  const engine = fakeEngine();
  const intelligence = new WorkspaceIntelligence({ waitForListening: async () => ({ listening: false }) });
  const events = [];
  intelligence.events.on("event", event => events.push(event.type));
  intelligence.attachEngine(engine.api, "p");

  engine.emit("TypeError: x is not a function\n", { redraw: true, analysisText: "" });
  assert.deepEqual(events, [], "a repaint of an old failure is not a failure");

  engine.emit("TypeError: x is not a function\n", { acknowledged: true });
  assert.deepEqual(events, [], "an acknowledged error is not a new build failure");

  engine.emit("SyntaxError: Unexpected token\n", {});
  assert.deepEqual(events, ["build.failed"], "a new one still is");
  intelligence.dispose();
});

/* ------------------------------------------ the Windows toast is taken back */

test("clearing a worker's alert withdraws its problem toasts from Windows, not its good news", () => {
  const shown = [];
  class FakeNotification {
    constructor(options) { this.options = options; this.handlers = {}; this.closed = false; shown.push(this); }
    static isSupported() { return true; }
    on(name, handler) { this.handlers[name] = handler; return this; }
    show() {}
    close() { this.closed = true; this.handlers.close?.(); }
  }
  let now = 1_000_000;
  const center = new NotificationCenter({ Notification: FakeNotification, platform: "win32", now: () => now, isAppFocused: () => false, mergeWindowMs: 0, minutesOfDay: () => 720 });
  center.publish(fromSemanticEvent({ type: "build.failed", workerId: "web", workerName: "Web", runId: "r1", description: "SyntaxError" }));
  now += 30_000;
  center.publish(fromSemanticEvent({ type: "service.ready", workerId: "web", workerName: "Web", runId: "r1", data: { serviceId: "s1", url: "http://localhost:5173", port: 5173, generation: 1, kind: "frontend" } }));
  now += 30_000;
  center.publish(fromSemanticEvent({ type: "build.failed", workerId: "api", workerName: "API", runId: "r1", description: "SyntaxError" }));
  assert.equal(shown.length, 3);

  assert.equal(center.withdrawWorker("web"), 1);
  assert.equal(shown[0].closed, true, "the failure the operator dealt with");
  assert.equal(shown[1].closed, false, "a server coming up is still worth seeing");
  assert.equal(shown[2].closed, false, "another worker's failure is untouched");
  center.dispose();
});
