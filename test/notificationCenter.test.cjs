"use strict";

// The notification center: one decision about every notice — which surface,
// whether it rings, and whether two signals are really one incident. Electron
// is injected, so every rule here runs for real rather than being asserted
// about in source strings.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  NotificationCenter,
  buildToastXml,
  fromAttentionRecord,
  fromSemanticEvent,
  SOUND_GAP_MS
} = require("../src/service/notificationCenter.cjs");
const { NotificationService, TRIGGER_EVENTS } = require("../src/service/notificationService.cjs");

function fakeNotification() {
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

function center(overrides = {}) {
  const { FakeNotification, shown } = fakeNotification();
  let now = overrides.start ?? 1_000_000;
  let focused = overrides.focused ?? false;
  let preferences = overrides.preferences ?? { minimumSeverity: "info", desktopNotifications: true, sound: true, quietHours: { enabled: false, start: "22:00", end: "07:00" } };
  const notices = [];
  const activations = [];
  const flashes = [];
  const instance = new NotificationCenter({
    Notification: FakeNotification,
    platform: "win32",
    now: () => now,
    minutesOfDay: () => overrides.minutes ?? 12 * 60,
    isAppFocused: () => focused,
    getPreferences: () => preferences,
    getProjectName: () => "acme",
    flashWindow: () => flashes.push(now),
    onActivate: payload => activations.push(payload),
    mergeWindowMs: overrides.mergeWindowMs ?? 0
  });
  instance.on("notification", notice => notices.push(notice));
  return {
    instance, shown, notices, activations, flashes, FakeNotification,
    advance: ms => { now += ms; },
    focus: value => { focused = value; },
    prefs: value => { preferences = { ...preferences, ...value }; }
  };
}

const ready = (over = {}) => fromSemanticEvent({ type: "service.ready", workerId: "web", workerName: "Web dev server", projectId: "p", runId: "r1", data: { serviceId: "svc-web-5173", url: "http://localhost:5173", port: 5173, generation: 1, kind: "frontend" }, ...over });
const conflict = (over = {}) => fromSemanticEvent({ type: "port.conflict", workerId: "billing", workerName: "Billing", projectId: "p", runId: "r1", description: "Error: listen EADDRINUSE: address already in use 0.0.0.0:4000", data: { port: 4000 }, ...over });
const crashRecord = { id: "attention-billing-1", sessionId: "billing", sessionName: "Billing", severity: "critical", groupKey: "failure:process-exited", reason: "Process exited with code 1", state: "new" };

/* ---------------------------------------------------------------- surfaces */

test("while Mission Control is the window in use, a notice shows in the app only", () => {
  const c = center({ focused: true });
  c.instance.publish(conflict());
  assert.equal(c.notices.length, 1);
  assert.equal(c.shown.length, 0, "no Windows toast while the app is focused");
  assert.equal(c.notices[0].delivery.windows, false);
  assert.equal(c.notices[0].delivery.windowsReason, "app-focused");
  // It still rings, and the app is the one ringing.
  assert.equal(c.notices[0].delivery.sound, "alert");
  assert.equal(c.notices[0].delivery.soundBy, "app");
  assert.equal(c.flashes.length, 0);
});

test("in the background, a notice becomes a silent Windows toast and the app rings at once", () => {
  const c = center({ focused: false });
  c.instance.publish(conflict());
  assert.equal(c.shown.length, 1);
  const xml = c.shown[0].options.toastXml;
  assert.match(xml, /<text hint-maxLines="1">Billing couldn&apos;t start<\/text>/);
  assert.match(xml, /Port 4000 is already in use/);
  assert.match(xml, /<text placement="attribution">OUTARCH · acme<\/text>/);
  // Windows played its sound only once the banner was up, well after the
  // notice, and at the system notification level: operators heard it late and
  // quiet. The toast is silent and the app's own chime rings immediately.
  assert.match(xml, /<audio silent="true"\/>/);
  assert.equal(c.notices[0].delivery.sound, "alert");
  // One button, and only an action that makes sense from a single click.
  assert.match(xml, /<action content="Open terminal"/);
  assert.doesNotMatch(xml, /Who&apos;s using it/);
  assert.equal(c.notices[0].delivery.soundBy, "app", "the app rings, the moment the notice arrives");
  assert.equal(c.flashes.length, 1, "a failure flashes the taskbar button");
});

test("a click on a Windows toast focuses its terminal through the app", () => {
  const c = center({ focused: false });
  const links = [];
  c.instance.subscribe(payload => links.push(payload));
  c.instance.publish(conflict());
  c.shown[0].click();
  assert.equal(c.activations.length, 1);
  assert.equal(links[0].actionId, "focus-worker");
  assert.equal(links[0].route, "workspace");
  assert.equal(links[0].sessionId, "billing");

  c.instance.publish(ready());
  c.shown[1].click();
  assert.equal(links[1].actionId, "open-service");
  assert.equal(links[1].notice.data.serviceId, "svc-web-5173");
});

/* --------------------------------------------------------------- incidents */

test("a port conflict and the crash that follows it are one notification", () => {
  const c = center({ focused: true, mergeWindowMs: 50 });
  c.instance.publish(fromAttentionRecord(crashRecord, { status: "failed", exitCode: 1 }));
  c.instance.publish(conflict());
  assert.equal(c.notices.length, 0, "held for a moment to see what else arrives");
  c.instance.flush();
  assert.equal(c.notices.length, 1);
  assert.equal(c.notices[0].kind, "port.conflict", "the most specific signal wins");

  // The crash record that arrives a few seconds later is the same incident.
  c.advance(3000);
  const late = c.instance.publish(fromAttentionRecord({ ...crashRecord, id: "attention-billing-2" }, { status: "failed", exitCode: 1 }));
  c.instance.flush();
  assert.equal(late.merged, true);
  assert.equal(c.notices.length, 1);
});

test("a restart that fails the same way says so again", () => {
  const c = center({ focused: true });
  c.instance.publish(conflict());
  assert.equal(c.notices.length, 1);
  c.advance(4000);
  c.instance.forgetWorker("p", "billing");
  c.instance.publish(conflict({ runId: "r2" }));
  assert.equal(c.notices.length, 2);
});

test("the same readiness cycle notifies once; the next generation notifies again", () => {
  const c = center({ focused: true });
  c.instance.publish(ready());
  c.advance(500);
  assert.equal(c.instance.publish(ready()).reason, "duplicate");
  c.advance(500);
  c.instance.publish(ready({ data: { serviceId: "svc-web-5173", url: "http://localhost:5173", port: 5173, generation: 2, kind: "frontend" } }));
  assert.equal(c.notices.length, 2);
  assert.equal(c.notices[1].title, "Web dev server is ready");
  assert.deepEqual(c.notices[1].actions.map(action => action.id), ["open-service", "copy-url", "restart", "stop"]);
});

/* -------------------------------------------------------------- not a nuisance */

test("chimes are spaced apart, so a burst rings once", () => {
  const c = center({ focused: true });
  c.instance.publish(conflict());
  c.instance.publish(ready());
  assert.equal(c.notices[0].delivery.sound, "alert");
  assert.equal(c.notices[1].delivery.sound, null, "too soon after the last chime");
  c.advance(SOUND_GAP_MS);
  c.instance.publish(fromSemanticEvent({ type: "tests.completed", workerId: "tests", workerName: "Unit tests", title: "Tests passed" }));
  assert.equal(c.notices[2].delivery.sound, "soft");
});

test("quiet hours silence the sound and Windows, but the notice still arrives", () => {
  const c = center({ focused: false, minutes: 23 * 60, preferences: { minimumSeverity: "info", desktopNotifications: true, sound: true, quietHours: { enabled: true, start: "22:00", end: "07:00" } } });
  c.instance.publish(conflict());
  assert.equal(c.notices.length, 1);
  assert.equal(c.notices[0].delivery.sound, null);
  assert.equal(c.shown.length, 0);
  assert.equal(c.notices[0].delivery.windowsReason, "quiet-hours");
});

test("the Sound setting and the severity floor are honoured", () => {
  const muted = center({ focused: false, preferences: { sound: false } });
  muted.instance.publish(conflict());
  assert.equal(muted.notices[0].delivery.sound, null);
  assert.match(muted.shown[0].options.toastXml, /<audio silent="true"\/>/);

  const floor = center({ focused: false, preferences: { minimumSeverity: "critical", sound: true } });
  floor.instance.publish(ready());
  assert.equal(floor.notices.length, 1, "below the floor it still reaches the list");
  assert.equal(floor.notices[0].delivery.sound, null);
  assert.equal(floor.shown.length, 0);
  assert.equal(floor.notices[0].delivery.windowsReason, "below-threshold");
});

test("Windows notifications can be switched off without losing the in-app notice", () => {
  const c = center({ focused: false, preferences: { desktopNotifications: false, sound: true } });
  c.instance.publish(conflict());
  assert.equal(c.shown.length, 0);
  assert.equal(c.notices[0].delivery.windowsReason, "disabled");
  assert.equal(c.notices[0].delivery.soundBy, "app", "with no toast to carry it, the app rings");
});

test("a storm collapses into the list instead of a wall of toasts", () => {
  const c = center({ focused: true });
  for (let index = 0; index < 8; index += 1) {
    c.instance.publish(fromSemanticEvent({ type: "tests.completed", workerId: `tests-${index}`, workerName: `Suite ${index}`, title: `Suite ${index} finished` }));
    c.advance(SOUND_GAP_MS);
  }
  assert.equal(c.notices.length, 8, "every notice is still recorded");
  assert.equal(c.notices.filter(notice => notice.delivery.collapsed).length, 2);
  assert.ok(c.notices.filter(notice => notice.delivery.collapsed).every(notice => notice.delivery.sound === null));
});

/* ----------------------------------------------------------------- mapping */

test("attention records become notices that say what actually happened", () => {
  const spawn = fromAttentionRecord({ id: "a1", sessionId: "api", sessionName: "API", severity: "critical", reason: "Failed to start: spawn npx ENOENT" }, { status: "failed", spawnError: "spawn npx ENOENT" });
  assert.equal(spawn.kind, "worker.spawnFailed");
  assert.equal(spawn.title, "API couldn't start");

  const crash = fromAttentionRecord(crashRecord, { status: "failed", exitCode: 1 });
  assert.equal(crash.kind, "worker.crashed");
  assert.equal(crash.title, "Billing stopped with an error");
  assert.equal(crash.body, "Exited with code 1");

  // A Node crash inside a PowerShell -NoExit terminal never exits; the error
  // in its output is the only signal.
  const printed = fromAttentionRecord({ id: "a3", sessionId: "web", sessionName: "Web", severity: "info", reason: "TypeError: Cannot read properties of undefined (reading 'map')" }, { status: "running" });
  assert.equal(printed.kind, "worker.error");
  assert.equal(printed.title, "Web reported an error");
  assert.match(printed.body, /TypeError/);

  const agent = fromAttentionRecord({ id: "a4", sessionId: "agent-claude", sessionName: "Claude", severity: "warning", reason: "Waiting for approval" }, { status: "running" });
  assert.equal(agent.kind, "attention.needed");
  assert.equal(agent.actions[0].id, "review");
});

test("only events worth a notification become one", () => {
  assert.equal(fromSemanticEvent({ type: "session:output", workerId: "web" }), null);
  assert.equal(fromSemanticEvent({ type: "service.ready", workerId: "web", data: {} }), null, "no service, nothing to open");
  const moved = fromSemanticEvent({ type: "port.conflict", workerId: "web", workerName: "Web", data: { port: 5173, movedOn: true } });
  assert.equal(moved.tone, "warning", "Vite stepping to the next port is worth knowing, not a failure");
  assert.equal(moved.title, "Web moved to another port");
});

test("toast XML escapes everything it is given", () => {
  const xml = buildToastXml({ title: `<img src=x onerror="a">`, body: "a & b", actionLabel: "Open", audio: null });
  assert.doesNotMatch(xml, /<img/);
  assert.match(xml, /&lt;img src=x onerror=&quot;a&quot;&gt;/);
  assert.match(xml, /a &amp; b/);
  assert.match(xml, /<audio silent="true"\/>/);
});

/* ---------------------------------------------------------------- the test */

test("the test notification shows in Windows even while the app is focused", () => {
  const c = center({ focused: true, preferences: { desktopNotifications: false, sound: true, quietHours: { enabled: true, start: "00:00", end: "23:59" } } });
  const result = c.instance.test();
  assert.equal(result.ok, true);
  assert.equal(c.shown.length, 1, "the thing being tested is Windows delivery");
  assert.equal(c.notices.length, 1, "and the app shows it too");
  assert.equal(c.notices[0].delivery.test, true);

  const unsupported = center({ focused: true });
  unsupported.FakeNotification.supported = false;
  const outcome = unsupported.instance.test();
  assert.equal(outcome.ok, false);
  assert.match(outcome.error, /does not support/);
  assert.equal(unsupported.instance.status().available, false);
});

/* ----------------------------------------------- the attention source feeds it */

test("errors printed by a running worker and failed spawns now wake the attention sweep", async () => {
  // "session:error" was listed for years; the engine never emitted it.
  assert.equal(TRIGGER_EVENTS.has("session:supervision"), true);
  assert.equal(TRIGGER_EVENTS.has("session:spawn-error"), true);
  assert.equal(TRIGGER_EVENTS.has("session:error"), false);

  const listeners = [];
  const engine = {
    listAttention: () => ({ records: [{ id: "a1", sessionId: "web", sessionName: "Web", severity: "info", reason: "TypeError: boom", state: "new" }], preferences: {} }),
    subscribe: (_scope, callback) => { listeners.push(callback); return () => {}; }
  };
  const published = [];
  const { FakeNotification, shown } = fakeNotification();
  const service = new NotificationService({ Notification: FakeNotification, getEngineApi: () => engine, coalesceMs: 0, publish: record => published.push(record) });
  service.start();
  for (const listener of listeners) listener({ type: "session:supervision" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(published.length, 1, "handed to the center");
  assert.equal(shown.length, 0, "the service no longer raises its own Windows toast");
  service.stop();
});

/* ------------------------------------------------------- opening another project */

test("after a project switch, failures in the new project still notify", async () => {
  // Opening a project replaces the EngineAPI. The sweep used to stay subscribed
  // to the disposed one, so nothing after a switch was ever announced.
  const makeEngine = records => {
    const engine = { listeners: [], unsubscribed: 0, records };
    engine.listAttention = () => ({ records: engine.records, preferences: {} });
    engine.subscribe = (_scope, callback) => { engine.listeners.push(callback); return () => { engine.unsubscribed += 1; }; };
    engine.emit = event => { for (const listener of engine.listeners) listener(event); };
    return engine;
  };
  const first = makeEngine([]);
  // The project being opened already holds a record from before: it is on the
  // Needs You list, not news.
  const second = makeEngine([{ id: "old", sessionId: "api", sessionName: "API", severity: "critical", reason: "Process exited with code 1", state: "new" }]);
  let current = first;
  const published = [];
  const service = new NotificationService({ getEngineApi: () => current, coalesceMs: 0, publish: record => published.push(record.id) });
  service.start();

  current = second;
  assert.equal(service.rebind(), true);
  assert.equal(first.unsubscribed, 1, "the old engine is let go");

  second.records = [...second.records, { id: "fresh", sessionId: "web", sessionName: "Web", severity: "critical", reason: "Process exited with code 1", state: "new" }];
  second.emit({ type: "session:exit" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(published, ["fresh"]);

  first.emit({ type: "session:exit" });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(published, ["fresh"], "the disposed engine is no longer heard");
  service.stop();
});

test("a worker id reused by the next project is not swallowed by the last project's incident", () => {
  const c = center({ focused: true });
  c.instance.publish(conflict());
  assert.equal(c.notices.length, 1);
  c.advance(1_000);
  // Same id, weaker signal, inside the incident window: merged while in one project.
  c.instance.publish(fromAttentionRecord({ ...crashRecord, id: "attention-billing-2" }, { status: "failed", exitCode: 1 }));
  assert.equal(c.notices.length, 1);

  c.instance.forgetAll();
  c.advance(1_000);
  c.instance.publish(fromAttentionRecord({ ...crashRecord, id: "attention-billing-3" }, { status: "failed", exitCode: 1 }));
  assert.equal(c.notices.length, 2, "the new project's failure is its own notice");
});
