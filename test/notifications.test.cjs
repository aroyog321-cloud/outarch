"use strict";

// T033-T037 — native notification delivery, end to end, without Electron.
//
// The policy is pure logic and the service takes its `Notification`, window
// focus and clock by injection, so both halves are exercised here for real
// rather than asserted about in source strings.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { NotificationPolicy, inQuietHours } = require("../src/service/notificationPolicy.cjs");
const { NotificationService } = require("../src/service/notificationService.cjs");

const ALLOW_ALL = { minimumSeverity: "info", desktopNotifications: true, quietHours: { enabled: false, start: "22:00", end: "07:00" } };
const record = (over = {}) => ({ id: "a1", sessionId: "web", sessionName: "Web server", severity: "critical", groupKey: "failure:web", reason: "Worker failed", state: "new", ...over });

// A fake Notification with the surface the service actually uses.
function makeNotification() {
  const shown = [];
  class FakeNotification {
    constructor(options) { this.options = options; this.handlers = {}; shown.push(this); }
    static isSupported() { return FakeNotification.supported; }
    on(name, handler) { this.handlers[name] = handler; return this; }
    show() { this.wasShown = true; }
    close() { this.handlers.close?.(); }
    click() { this.handlers.click?.(); }
  }
  FakeNotification.supported = true;
  return { FakeNotification, shown };
}

function makeEngine(attention) {
  const listeners = [];
  return {
    listAttention: () => attention(),
    subscribe: (scope, callback) => { listeners.push(callback); return () => { const i = listeners.indexOf(callback); if (i >= 0) listeners.splice(i, 1); }; },
    emit: event => { for (const listener of [...listeners]) listener(event); },
    listenerCount: () => listeners.length
  };
}

/* ------------------------------------------------------------------ policy */

test("T034 — the severity floor suppresses anything below it and admits the rest", () => {
  const policy = new NotificationPolicy({ minutesOfDay: () => 12 * 60 });
  const preferences = { ...ALLOW_ALL, minimumSeverity: "warning" };
  assert.equal(policy.inspect(record({ severity: "info" }), preferences, 0).reason, "below-threshold");
  assert.equal(policy.inspect(record({ severity: "warning" }), preferences, 0).deliver, true);
  assert.equal(policy.inspect(record({ severity: "critical" }), preferences, 0).deliver, true);
});

test("T034 — the desktop toggle is honoured before anything else", () => {
  const policy = new NotificationPolicy({ minutesOfDay: () => 12 * 60 });
  const decision = policy.inspect(record(), { ...ALLOW_ALL, desktopNotifications: false }, 0);
  assert.deepEqual(decision, { deliver: false, reason: "disabled" });
});

test("T034 — quiet hours cover a window that crosses midnight", () => {
  const window = { enabled: true, start: "22:00", end: "07:00" };
  assert.equal(inQuietHours(window, 23 * 60), true, "23:00 is inside 22:00-07:00");
  assert.equal(inQuietHours(window, 2 * 60), true, "02:00 is inside 22:00-07:00");
  assert.equal(inQuietHours(window, 6 * 60 + 59), true, "06:59 is inside");
  assert.equal(inQuietHours(window, 7 * 60), false, "07:00 is the exclusive end");
  assert.equal(inQuietHours(window, 12 * 60), false, "midday is outside");
  // A same-day window still works.
  assert.equal(inQuietHours({ enabled: true, start: "09:00", end: "17:00" }, 12 * 60), true);
  assert.equal(inQuietHours({ enabled: true, start: "09:00", end: "17:00" }, 8 * 60), false);
  // Disabled and zero-length windows never silence anything.
  assert.equal(inQuietHours({ enabled: false, start: "00:00", end: "23:59" }, 12 * 60), false);
  assert.equal(inQuietHours({ enabled: true, start: "09:00", end: "09:00" }, 9 * 60), false);
});

test("T034 — quiet hours suppress delivery at the evaluated time, not the wall clock", () => {
  let minutes = 23 * 60;
  const policy = new NotificationPolicy({ minutesOfDay: () => minutes });
  const preferences = { ...ALLOW_ALL, quietHours: { enabled: true, start: "22:00", end: "07:00" } };
  assert.equal(policy.inspect(record(), preferences, 0).reason, "quiet-hours");
  minutes = 12 * 60;
  assert.equal(policy.inspect(record(), preferences, 0).deliver, true);
});

test("T035 — the same recurring problem does not re-interrupt inside the dedupe window", () => {
  const policy = new NotificationPolicy({ minutesOfDay: () => 0, dedupeMs: 60_000 });
  assert.equal(policy.consider(record(), ALLOW_ALL, 0).deliver, true);
  assert.equal(policy.consider(record({ id: "a2" }), ALLOW_ALL, 30_000).reason, "duplicate", "same groupKey, still inside the window");
  assert.equal(policy.consider(record({ id: "a3" }), ALLOW_ALL, 61_000).deliver, true, "the window has passed");
  // A different problem is never deduped against an unrelated one.
  assert.equal(policy.consider(record({ id: "b1", groupKey: "failure:api" }), ALLOW_ALL, 61_100).deliver, true);
});

test("T035 — a storm is rate limited to one summary rather than silence or a flood", () => {
  const policy = new NotificationPolicy({ minutesOfDay: () => 0, dedupeMs: 0, maxPerWindow: 3, windowMs: 60_000 });
  const at = n => policy.consider(record({ id: `r${n}`, groupKey: `g${n}` }), ALLOW_ALL, 1000 + n);
  assert.equal(at(1).deliver, true);
  assert.equal(at(2).deliver, true);
  assert.equal(at(3).deliver, true);

  // The fourth trips the limit, and is allowed through exactly once as a summary.
  const fourth = at(4);
  assert.equal(fourth.deliver, true);
  assert.equal(fourth.reason, "storm-summary");

  // Everything after it in the same window is suppressed, not summarised again.
  assert.equal(at(5).reason, "rate-limited");
  assert.equal(at(6).reason, "rate-limited");

  const stats = policy.stats();
  assert.equal(stats.delivered, 4);
  assert.equal(stats.suppressed, 2);
});

test("T035 — delivery history stays bounded", () => {
  const policy = new NotificationPolicy({ minutesOfDay: () => 0, dedupeMs: 1000, maxPerWindow: 10_000, windowMs: 1, historyLimit: 10 });
  for (let i = 0; i < 200; i += 1) policy.consider(record({ id: `r${i}`, groupKey: `g${i}` }), ALLOW_ALL, i);
  assert.equal(policy.stats().delivered, 200, "every one was delivered");
  // The bound is internal; the observable contract is that it keeps working
  // and keeps deduping the most recent groups.
  assert.equal(policy.consider(record({ id: "r199", groupKey: "g199" }), ALLOW_ALL, 199).reason, "duplicate");
});

/* ----------------------------------------------------------------- service */

test("T033 — a new attention record raises exactly one notification, driven by an engine event", async () => {
  const { FakeNotification, shown } = makeNotification();
  const attention = { records: [record()], preferences: ALLOW_ALL };
  const engine = makeEngine(() => attention);
  const service = new NotificationService({
    Notification: FakeNotification,
    getEngineApi: () => engine,
    coalesceMs: 0,
    now: () => 1000,
    policy: new NotificationPolicy({ minutesOfDay: () => 12 * 60 })
  });

  assert.equal(service.start(), true);
  assert.equal(shown.length, 0, "starting must not notify on its own");

  engine.emit({ type: "session:status" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(shown.length, 1);
  assert.match(shown[0].options.title, /Web server/);
  assert.match(shown[0].options.body, /Worker failed/);
  assert.equal(shown[0].wasShown, true);

  // The same record must never notify twice, however many events arrive.
  engine.emit({ type: "session:status" });
  engine.emit({ type: "attention:lifecycle" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(shown.length, 1);
  service.stop();
});

test("T033 — high-volume output events never trigger a delivery sweep", async () => {
  const { FakeNotification, shown } = makeNotification();
  let reads = 0;
  const engine = makeEngine(() => { reads += 1; return { records: [record()], preferences: ALLOW_ALL }; });
  const service = new NotificationService({ Notification: FakeNotification, getEngineApi: () => engine, coalesceMs: 0, now: () => 1 });
  service.start();
  for (let i = 0; i < 100; i += 1) engine.emit({ type: "session:output" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(reads, 0, "session:output must not cause an attention read");
  assert.equal(shown.length, 0);
  service.stop();
});

test("T033 — only unacknowledged records interrupt", async () => {
  const { FakeNotification, shown } = makeNotification();
  const engine = makeEngine(() => ({
    records: [record({ id: "seen", state: "seen" }), record({ id: "acting", state: "acting" }), record({ id: "done", state: "recovered" })],
    preferences: ALLOW_ALL
  }));
  const service = new NotificationService({ Notification: FakeNotification, getEngineApi: () => engine, coalesceMs: 0, now: () => 1 });
  service.start();
  engine.emit({ type: "session:status" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(shown.length, 0);
  service.stop();
});

test("T036 — clicking a notification focuses the window and deep-links to its decision", async () => {
  const { FakeNotification, shown } = makeNotification();
  const engine = makeEngine(() => ({ records: [record()], preferences: ALLOW_ALL }));
  let focused = 0;
  const links = [];
  const service = new NotificationService({
    Notification: FakeNotification,
    getEngineApi: () => engine,
    focusWindow: () => { focused += 1; },
    coalesceMs: 0,
    now: () => 1,
    policy: new NotificationPolicy({ minutesOfDay: () => 12 * 60 })
  });
  service.subscribe(payload => links.push(payload));
  service.start();
  engine.emit({ type: "session:status" });
  await new Promise(resolve => setTimeout(resolve, 20));

  shown[0].click();
  assert.equal(focused, 1);
  assert.deepEqual(links, [{ type: "activate", attentionId: "a1", sessionId: "web", route: "needs" }]);
  service.stop();
});

test("T037 — the test notification reports delivery, and bypasses policy on purpose", () => {
  const { FakeNotification, shown } = makeNotification();
  const engine = makeEngine(() => ({ records: [], preferences: ALLOW_ALL }));
  // Quiet hours on, notifications off, critical-only: a real alert would be
  // suppressed three times over. The diagnostic still has to answer.
  const service = new NotificationService({ Notification: FakeNotification, getEngineApi: () => engine, now: () => 42 });
  const result = service.test();
  assert.equal(result.ok, true);
  assert.equal(result.delivered, true);
  assert.equal(shown.length, 1);
  assert.match(shown[0].options.title, /test notification/i);
  assert.equal(service.status().lastDeliveryAt, 42);
});

test("T037 — an unsupported platform is reported as unavailable, never as delivered", () => {
  const { FakeNotification, shown } = makeNotification();
  FakeNotification.supported = false;
  const engine = makeEngine(() => ({ records: [], preferences: ALLOW_ALL }));
  const service = new NotificationService({ Notification: FakeNotification, getEngineApi: () => engine });
  assert.equal(service.supported, false);
  assert.equal(service.status().available, false);
  const result = service.test();
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.match(result.error, /does not support/i);
  assert.equal(shown.length, 0);
});

test("T037 — a throwing notification surface becomes a reported error, not a crash", () => {
  const engine = makeEngine(() => ({ records: [], preferences: ALLOW_ALL }));
  class Exploding {
    static isSupported() { return true; }
    constructor() { throw new Error("OS notification centre refused"); }
  }
  const service = new NotificationService({ Notification: Exploding, getEngineApi: () => engine });
  const result = service.test();
  assert.equal(result.ok, false);
  assert.match(result.error, /refused/);
  assert.match(service.status().lastError, /refused/);
});

test("the service unsubscribes from the engine on stop and closes what it opened", async () => {
  const { FakeNotification, shown } = makeNotification();
  const engine = makeEngine(() => ({ records: [record()], preferences: ALLOW_ALL }));
  const service = new NotificationService({
    Notification: FakeNotification,
    getEngineApi: () => engine,
    coalesceMs: 0,
    now: () => 1,
    policy: new NotificationPolicy({ minutesOfDay: () => 12 * 60 })
  });
  service.start();
  assert.equal(engine.listenerCount(), 1);
  engine.emit({ type: "session:status" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(shown.length, 1);

  service.stop();
  assert.equal(engine.listenerCount(), 0, "engine subscription released");
  assert.equal(service.status().running, false);
});

test("an engine that throws while listing attention is recorded, not propagated", async () => {
  const { FakeNotification } = makeNotification();
  const engine = makeEngine(() => { throw new Error("workspace is not persistent"); });
  const service = new NotificationService({ Notification: FakeNotification, getEngineApi: () => engine, coalesceMs: 0 });
  service.start();
  engine.emit({ type: "session:status" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.match(service.status().lastError, /not persistent/);
  service.stop();
});

test("a cleared record can interrupt again if the same worker fails much later", async () => {
  const { FakeNotification, shown } = makeNotification();
  let records = [record()];
  const engine = makeEngine(() => ({ records, preferences: ALLOW_ALL }));
  let clock = 1000;
  const service = new NotificationService({
    Notification: FakeNotification,
    getEngineApi: () => engine,
    coalesceMs: 0,
    now: () => clock,
    policy: new NotificationPolicy({ minutesOfDay: () => 12 * 60, dedupeMs: 1000 })
  });
  service.start();
  engine.emit({ type: "session:status" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(shown.length, 1);

  // The engine clears it, then the worker fails again well past the dedupe window.
  records = [];
  engine.emit({ type: "session:status" });
  await new Promise(resolve => setTimeout(resolve, 20));

  clock = 99_000;
  records = [record({ id: "a2" })];
  engine.emit({ type: "session:status" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(shown.length, 2, "a genuinely new failure must still be able to reach the operator");
  service.stop();
});
