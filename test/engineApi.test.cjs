const assert = require("node:assert/strict");
const { test } = require("node:test");
const { EngineAPI, ENGINE_CONTRACT_VERSION } = require("../src/engine/index.cjs");
const { makeFakePtyFactory } = require("./fakePty.cjs");

test("confirmation lifecycle activity is engine-owned, bounded, and payload-free", t => {
  const api = new EngineAPI({ ptyFactory: makeFakePtyFactory(), maxActivityEvents: 8 });
  t.after(() => api.dispose());

  const recorded = api.recordConfirmationEvent("requested", {
    operation: "recipe.delete",
    outcomeCode: "CONFIRMATION_REQUIRED",
    token: "must-not-persist",
    targetParams: { recipeId: "secret-project-path" }
  });
  assert.equal(recorded.ok, true);
  assert.deepEqual(api.getActivity({ limit: 8 }).events.at(-1), {
    operation: "recipe.delete",
    outcomeCode: "CONFIRMATION_REQUIRED",
    contractVersion: ENGINE_CONTRACT_VERSION,
    sequence: recorded.sequence,
    timestamp: recorded.timestamp,
    type: "confirmation:requested"
  });
  assert.deepEqual(api.recordConfirmationEvent("unknown", { operation: "recipe.delete" }), {
    ok: false,
    error: "confirmation event kind is invalid"
  });
  assert.deepEqual(api.recordConfirmationEvent("completed", { operation: "invalid operation" }), {
    ok: false,
    error: "confirmation operation is invalid"
  });
});

test("loadProject reports one bad definition without blocking valid sessions", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());

  const errors = api.loadProject({
    sessions: [
      { id: "a", name: "one", command: "x", cwd: "." },
      { id: "a", name: "duplicate", command: "y", cwd: "." },
      { id: "b", name: "two", command: "z", cwd: "." }
    ]
  });

  assert.equal(errors.length, 1);
  assert.equal(api.list().length, 2);
  assert.equal(factory.instances.length, 2);
});

test("loading a second workspace is rejected before sessions can be mixed", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [] });

  assert.throws(
    () => api.loadProject({ sessions: [{ id: "b", command: "x", cwd: "." }] }),
    /already loaded/
  );
  assert.deepEqual(api.list(), []);
  assert.equal(factory.instances.length, 0);
});

test("invalid in-memory workspace roots fail before locking the EngineAPI instance", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());

  assert.throws(() => api.loadProject({ sessions: [], commands: {} }), /commands must be an array/);
  assert.doesNotThrow(() => api.loadProject({ sessions: [], commands: [] }));
  assert.equal(factory.instances.length, 0);
});

test("workspace restore registers manual sessions without launching them", async t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  const events = [];
  api.subscribe("all", event => events.push(event));

  api.loadProject({
    sessions: [
      { id: "manual", name: "Database", command: "x", cwd: ".", autoStart: false },
      { id: "automatic", name: "Frontend", command: "x", cwd: "." }
    ]
  });

  assert.equal(factory.instances.length, 1);
  assert.equal(api.getSnapshot("manual").status, "idle");
  assert.equal(api.getSnapshot("automatic").status, "running");
  assert.equal(events.find(event => event.type === "session:created" && event.id === "manual").session.autoStart, false);

  assert.deepEqual(await api.start("manual"), { ok: true });
  assert.equal(factory.instances.length, 2);
  assert.equal(api.getSnapshot("manual").status, "running");
  assert.deepEqual(
    events.filter(event => event.id === "manual").map(event => [event.type, event.status]),
    [
      ["session:created", undefined],
      ["session:status", "starting"],
      ["session:status", "running"]
    ]
  );
});

test("saved command presets isolate invalid definitions and use one creation path", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  const events = [];
  api.subscribe("all", event => events.push(event));

  api.loadProject({
    sessions: [],
    commands: [
      { id: "bad id", command: "x" },
      { id: "build", name: "Build", command: "x", cwd: ".", autoStart: true },
      { id: "manual", name: "Manual task", command: "y", cwd: "." }
    ]
  });

  assert.equal(api.getWorkspace().savedCommandCount, 2);
  assert.equal(api.getWorkspace().savedCommandErrorCount, 1);
  assert.equal(api.getWorkspace().loadErrorCount, 1);
  assert.deepEqual(api.listSavedCommands().map(command => [command.id, command.autoStart]), [
    ["build", true],
    ["manual", false]
  ]);
  assert.equal(factory.instances.length, 0, "loading presets must not launch anything");

  const created = api.createFromSavedCommand("build");
  assert.equal(created.ok, true);
  assert.equal(factory.instances.length, 1);
  assert.equal(api.getSnapshot("build").status, "running");
  assert.deepEqual(events.map(event => event.type), [
    "project:command-errors",
    "session:created",
    "session:status",
    "saved-command:instantiated"
  ]);
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4]);
  assert.equal(api.getState().savedCommandErrors.length, 1);
  assert.equal(JSON.stringify(api.getState()).includes("bad id"), true);
});

test("manual start serializes with removal and cannot orphan its PTY", async t => {
  const factory = makeFakePtyFactory({ autoExitOnKill: true });
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "manual", command: "x", cwd: ".", autoStart: false }] });

  const starting = api.start("manual");
  const removing = api.remove("manual");
  assert.deepEqual(await starting, { ok: true });
  assert.deepEqual(await removing, { ok: true });

  assert.equal(factory.instances.length, 1);
  assert.equal(factory.last().killed, true);
  assert.equal(api.getSnapshot("manual"), null);
});

test("subscribe exposes meaningful events and unsubscribe stops delivery", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  const events = [];
  const unsubscribe = api.subscribe("all", event => events.push(event));

  api.loadProject({ sessions: [{ id: "a", name: "one", command: "x", cwd: "." }] });
  factory.last().emitData("hello\n");
  factory.last().emitExit(0);

  assert.deepEqual(
    events.map(event => event.type),
    ["session:created", "session:status", "session:output", "session:status", "session:exit"]
  );
  assert.ok(events.every(event => event.contractVersion === ENGINE_CONTRACT_VERSION));
  assert.deepEqual(events.map(event => event.sequence), [1, 2, 3, 4, 5]);
  assert.ok(events.every(event => Number.isInteger(event.timestamp)));

  unsubscribe();
  api.rename("a", "renamed");
  assert.equal(events.length, 5);
});

test("observer exceptions cannot interrupt engine lifecycle or later subscribers", t => {
  const factory = makeFakePtyFactory();
  const reported = [];
  const api = new EngineAPI({
    ptyFactory: factory,
    onSubscriberError: (error, context) => reported.push({ error, context })
  });
  t.after(() => api.dispose());
  const events = [];

  api.on("engine:event", () => {
    throw new Error("broken observer");
  });
  api.subscribe("all", event => events.push(event));
  api.loadProject({ sessions: [{ id: "a", command: "x", cwd: "." }] });

  assert.equal(factory.instances.length, 1);
  assert.equal(api.getSnapshot("a").status, "running");
  assert.deepEqual(events.map(event => event.type), ["session:created", "session:status"]);
  assert.equal(reported.length, 2);
  assert.ok(reported.every(entry => entry.error.message === "broken observer"));
});

test("re-entrant subscribers cannot reorder event sequences for later observers", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  const observed = [];
  let renamed = false;

  api.subscribe("all", event => {
    if (!renamed && event.type === "session:created") {
      assert.equal(Object.isFrozen(event), true);
      assert.equal(Object.isFrozen(event.session), true);
      event.type = "corrupted";
      event.session.name = "corrupted";
      renamed = true;
      assert.deepEqual(api.rename("a", "renamed during delivery"), { ok: true });
    }
  });
  api.subscribe("all", event => observed.push(event));
  api.loadProject({ sessions: [{ id: "a", command: "x", cwd: "." }] });

  assert.deepEqual(observed.map(event => event.sequence), [1, 2, 3]);
  assert.deepEqual(observed.map(event => event.type), [
    "session:created",
    "session:renamed",
    "session:status"
  ]);
  assert.equal(observed[0].session.name, "a");
  assert.deepEqual(api.getActivity().events.map(event => event.sequence), [1, 2, 3]);
});

test("session-scoped subscription filters other session output", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({
    sessions: [
      { id: "a", name: "one", command: "x", cwd: "." },
      { id: "b", name: "two", command: "x", cwd: "." }
    ]
  });
  const ids = [];
  api.subscribe("session:a", event => ids.push(event.id));

  factory.instances[0].emitData("a\n");
  factory.instances[1].emitData("b\n");
  assert.deepEqual(ids, ["a"]);
});

test("list and getSnapshot return plain facade data", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "a", name: "one", command: "x", cwd: "." }] });

  const listed = api.list()[0];
  assert.equal(listed.id, "a");
  assert.equal(listed.status, "running");
  assert.equal("proc" in listed, false);
  assert.equal(typeof listed.write, "undefined");
  assert.deepEqual(api.getSnapshot("a").lines, []);

  const state = api.getState();
  assert.equal(state.contractVersion, ENGINE_CONTRACT_VERSION);
  assert.equal(state.sessions.length, 1);
  assert.equal(state.workspace.name, "Unsaved workspace");
  assert.doesNotThrow(() => JSON.stringify(state));
  assert.equal("sessionEngine" in api, false);
});

test("bounded activity timeline replays operational events without duplicating terminal output", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory, maxActivityEvents: 4 });
  t.after(() => api.dispose());

  api.loadProject({ sessions: [{ id: "a", name: "API", command: "x", cwd: "." }] });
  factory.last().emitData("secret output that belongs only in the terminal snapshot\n");
  factory.last().emitData("Error: build failed\n");
  api.acknowledge("a");
  api.rename("a", "Backend");

  const activity = api.getActivity({ limit: 4 });
  assert.equal(activity.events.length, 4);
  assert.equal(activity.events.some(event => event.type === "session:output"), false);
  assert.equal(JSON.stringify(activity).includes("secret output"), false);
  assert.equal(activity.gap, false);
  assert.equal(activity.hasEarlier, true);
  assert.equal(activity.hasMore, false);
  assert.ok(activity.droppedThroughSequence > 0);
  assert.deepEqual(
    activity.events.map(event => event.type),
    ["session:evidence", "session:supervision", "session:supervision", "session:renamed"]
  );

  const replay = api.getActivity({ afterSequence: 0, limit: 2 });
  assert.equal(replay.gap, true);
  assert.equal(replay.hasEarlier, true);
  assert.equal(replay.hasMore, true);
  assert.equal(replay.events.length, 2);
  replay.events[0].type = "corrupted";
  assert.notEqual(api.getActivity({ limit: 4 }).events[0].type, "corrupted");
  assert.doesNotThrow(() => JSON.stringify(api.getState()));
});

test("structured worker evidence enters durable activity without raw terminal output", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "tests", name: "Tests", command: "x", cwd: "." }] });

  factory.last().emitData("24 passed, 2 failed secret-token=never-store-this\n");
  const event = api.getActivity().events.find(item => item.type === "session:evidence");

  assert.equal(event.id, "tests");
  assert.equal(event.name, "Tests");
  assert.equal(event.category, "tests");
  assert.deepEqual({ passed: event.evidence.passed, failed: event.evidence.failed }, { passed: 24, failed: 2 });
  assert.equal(JSON.stringify(event).includes("never-store-this"), false);
});

test("workspace and attach failures use the same ordered public event contract", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  const events = [];
  const rawLoadErrors = [];
  api.subscribe("all", event => events.push(event));
  api.on("project:load-errors", errors => rawLoadErrors.push(errors));

  api.loadProject({
    sessions: [
      { id: "good", command: "x", cwd: "." },
      { id: "bad id", command: "x", cwd: "." }
    ]
  });
  assert.equal(api.attachRawStream("missing"), null);

  assert.ok(events.some(event => event.type === "project:load-errors"));
  assert.ok(events.some(event => event.type === "attach:rejected"));
  assert.deepEqual(events.map(event => event.sequence), events.map((_, index) => index + 1));
  const loadErrorActivity = api.getActivity().events.find(event => event.type === "project:load-errors");
  assert.equal(loadErrorActivity.errorCount, 1);
  assert.equal("errors" in loadErrorActivity, false);
  assert.equal(Array.isArray(rawLoadErrors[0]), true);
  assert.equal(rawLoadErrors[0].length, 1);
  assert.ok(api.getActivity().events.some(event => event.type === "attach:rejected"));
});

test("attachRawStream rejects missing or exited sessions and never spawns", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  const rejected = [];
  api.on("attach:rejected", event => rejected.push(event));

  assert.equal(api.attachRawStream("missing"), null);
  api.loadProject({ sessions: [{ id: "a", name: "one", command: "x", cwd: "." }] });
  factory.last().emitExit(0);
  assert.equal(api.attachRawStream("a"), null);

  assert.equal(factory.instances.length, 1);
  assert.deepEqual(rejected, [
    { id: "missing", reason: "missing" },
    { id: "a", reason: "exited" }
  ]);
});

test("restart, kill, and rename stay behind the facade", async t => {
  const factory = makeFakePtyFactory({ autoExitOnKill: true });
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "a", name: "one", command: "x", cwd: "." }] });

  assert.deepEqual(api.rename("a", "new name"), { ok: true });
  assert.equal(api.getSnapshot("a").name, "new name");
  assert.deepEqual(await api.restart("a"), { ok: true });
  assert.equal(factory.instances.length, 2);
  assert.deepEqual(api.kill("a"), { ok: true });
});

test("startup policy changes stay behind the facade and do not start a process", async t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "a", command: "x", cwd: ".", autoStart: false }] });
  const events = [];
  api.subscribe("session:a", event => events.push(event));

  assert.deepEqual(await api.setAutoStart("a", true), { ok: true });
  assert.equal(api.getSnapshot("a").autoStart, true);
  assert.equal(api.getSnapshot("a").status, "idle");
  assert.equal(factory.instances.length, 0);
  assert.deepEqual(events.map(event => event.type), ["session:autostart"]);
});

test("reconfiguration serializes with start and never exposes environment values", async t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({
    sessions: [{ id: "manual", name: "Worker", command: "old", cwd: ".", autoStart: false }]
  });
  const events = [];
  api.subscribe("all", event => events.push(event));

  const editing = api.reconfigure("manual", {
    command: "node",
    args: ["worker.js"],
    env: { PRIVATE_TOKEN: "do-not-publish" }
  });
  const starting = api.start("manual");

  assert.equal((await editing).ok, true);
  assert.deepEqual(await starting, { ok: true });
  assert.equal(factory.instances.length, 1);
  assert.equal(factory.last()._spawnArgs.shell, "node");
  assert.deepEqual(factory.last()._spawnArgs.args, ["worker.js"]);
  assert.equal(JSON.stringify(events).includes("do-not-publish"), false);
  assert.equal(JSON.stringify(api.getState()).includes("do-not-publish"), false);
});

test("reconfiguration rejects running sessions, id changes, and unsupported fields", async t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "a", name: "API", command: "old", cwd: "." }] });

  assert.match((await api.reconfigure("a", { command: "new" })).error, /stop the session/);
  factory.last().emitExit(0);
  assert.match((await api.reconfigure("a", { id: "b" })).error, /id cannot be changed/);
  assert.match((await api.reconfigure("a", { shell: "node" })).error, /unsupported/);
  assert.equal(api.getSnapshot("a").command, "old");
  assert.equal(api.getSnapshot("b"), null);
});

test("attention acknowledgement stays behind the facade and emits a meaningful event", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "a", name: "one", command: "x", cwd: "." }] });
  const events = [];
  api.subscribe("session:a", event => events.push(event));

  factory.last().emitData("Error: type mismatch\n");
  assert.equal(api.getSnapshot("a").attentionRequired, true);
  assert.deepEqual(api.acknowledge("a"), { ok: true });
  assert.equal(api.getSnapshot("a").attentionRequired, false);
  assert.equal(events.filter(event => event.type === "session:supervision").length, 2);
});

test("dispose removes forwarding and subscription listeners", () => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  api.subscribe("all", () => {});
  api.loadProject({ sessions: [{ id: "a", name: "one", command: "x", cwd: "." }] });

  api.dispose();
  assert.equal(api.listenerCount("engine:event"), 0);
  assert.equal("sessionEngine" in api, false);
});

test("safe shutdown coordination stays behind the Engine API facade", async t => {
  const factory = makeFakePtyFactory({ autoExitOnKill: true });
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "a", command: "x", cwd: "." }] });

  assert.deepEqual(await api.stopAll(100), { ok: true, pendingIds: [] });
  assert.equal(api.getSnapshot("a").status, "exited");
});

test("shutdown waits for an in-flight restart and stops the replacement PTY", async t => {
  const factory = makeFakePtyFactory({ autoExitOnKill: true });
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "a", command: "x", cwd: "." }] });

  const restarting = api.restart("a");
  const stopping = api.stopAll(100);
  assert.deepEqual(await restarting, { ok: true });
  assert.deepEqual(await stopping, { ok: true, pendingIds: [] });
  assert.equal(factory.instances.length, 2);
  assert.equal(factory.instances.every(instance => instance.killed), true);
  assert.equal(api.getSnapshot("a").status, "exited");
});

test("a failed shutdown reopens the API for corrective actions", async t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({ sessions: [{ id: "a", command: "x", cwd: "." }] });

  assert.deepEqual(await api.stopAll(5), { ok: false, pendingIds: ["a"] });
  assert.equal(api.create({ id: "b", command: "x", cwd: "." }).ok, true);
  assert.equal(factory.instances.length, 2);
});

test("50 noisy sessions remain bounded and keep one PTY each", t => {
  const factory = makeFakePtyFactory();
  const api = new EngineAPI({ ptyFactory: factory });
  t.after(() => api.dispose());
  api.loadProject({
    sessions: Array.from({ length: 50 }, (_, index) => ({
      id: `s${index}`,
      name: `session ${index}`,
      command: "x",
      cwd: "."
    }))
  });

  for (const instance of factory.instances) {
    for (let line = 0; line < 600; line++) instance.emitData(`line ${line}\n`);
  }

  assert.equal(api.list().length, 50);
  assert.equal(factory.instances.length, 50);
  for (const session of api.list()) {
    assert.equal(api.getSnapshot(session.id).lines.length, 200);
  }
});
