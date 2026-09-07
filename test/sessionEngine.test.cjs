const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  SessionEngine,
  MAX_BUFFERED_LINES,
  SNAPSHOT_LINES,
  resolveLaunch,
  RawReplayBuffer,
  MAX_RAW_REPLAY_BYTES
} = require("../src/engine/sessionEngine.cjs");
const { makeFakePtyFactory } = require("./fakePty.cjs");

test("create owns exactly one PTY and exposes running lifecycle metadata", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());

  engine.create({ id: "a", name: "server", command: "node", args: ["server.js"], cwd: "." });
  const snapshot = engine.getSnapshot("a");

  assert.equal(factory.instances.length, 1);
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.command, "node");
  assert.deepEqual(snapshot.args, ["server.js"]);
  assert.equal(snapshot.isAlive, true);
  assert.equal(typeof snapshot.startTime, "number");
  assert.equal(typeof snapshot.runtimeMs, "number");
  assert.equal(snapshot.autoStart, true);
});

test("manual sessions stay idle until an explicit start owns exactly one PTY", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());

  engine.create({ id: "manual", name: "database", command: "x", cwd: ".", autoStart: false });
  let snapshot = engine.getSnapshot("manual");
  assert.equal(factory.instances.length, 0);
  assert.equal(snapshot.status, "idle");
  assert.equal(snapshot.isAlive, false);
  assert.equal(snapshot.startTime, null);
  assert.equal(snapshot.autoStart, false);

  assert.deepEqual(engine.start("manual"), { ok: true });
  snapshot = engine.getSnapshot("manual");
  assert.equal(factory.instances.length, 1);
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.autoStart, false, "starting manually must not change restore policy");

  assert.equal(engine.start("manual").ok, false);
  assert.equal(factory.instances.length, 1, "start must never duplicate a live PTY");
});

test("spawn failure remains visible and does not crash create", t => {
  const factory = makeFakePtyFactory({ throwOnSpawn: true });
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());

  assert.doesNotThrow(() => {
    engine.create({ id: "bad", name: "bad", command: "missing", cwd: "." });
  });
  const snapshot = engine.getSnapshot("bad");
  assert.equal(snapshot.status, "failed");
  assert.match(snapshot.spawnError, /command not found/);
  assert.match(snapshot.lastLine, /failed to start/);
});

test("PTY listener setup failure kills the partial process instead of leaking it", t => {
  let dataDisposed = false;
  const proc = {
    killed: false,
    onData() { return { dispose: () => { dataDisposed = true; } }; },
    onExit() { throw new Error("listener setup failed"); },
    kill() { this.killed = true; }
  };
  const engine = new SessionEngine({ ptyFactory: () => proc });
  t.after(() => engine.dispose());

  assert.doesNotThrow(() => engine.create({ id: "a", name: "bad PTY", command: "x", cwd: "." }));
  assert.equal(engine.getSnapshot("a").status, "failed");
  assert.match(engine.getSnapshot("a").spawnError, /listener setup failed/);
  assert.equal(proc.killed, true);
  assert.equal(dataDisposed, true);
});

test("duplicate ids are rejected before another PTY can spawn", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());

  engine.create({ id: "a", name: "first", command: "x", cwd: "." });
  assert.throws(
    () => engine.create({ id: "a", name: "duplicate", command: "y", cwd: "." }),
    /already in use/
  );
  assert.equal(factory.instances.length, 1);
  assert.equal(engine.list().length, 1);
});

test("output and snapshots stay bounded and strip ANSI", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "a", name: "logs", command: "x", cwd: "." });

  for (let i = 0; i < MAX_BUFFERED_LINES + 50; i++) {
    factory.last().emitData(`\x1b[32mline ${i}\x1b[0m\n`);
  }
  const session = engine.get("a");
  const snapshot = session.snapshot();

  assert.equal(session.lines.length, MAX_BUFFERED_LINES);
  assert.equal(snapshot.lines.length, SNAPSHOT_LINES);
  assert.equal(snapshot.lastLine, `line ${MAX_BUFFERED_LINES + 49}`);
  assert.equal(snapshot.lastLine.includes("\x1b"), false);
  assert.equal(typeof snapshot.lastOutputAt, "number");
});

test("session snapshots expose isolated structured evidence and reset it on restart", async t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "evidence", command: "x", cwd: "." });

  factory.last().emitData("Tests 8 passed 0 failed\nOn branch main\nnothing to commit, working tree clean\n");
  const snapshot = engine.getSnapshot("evidence");
  assert.equal(snapshot.evidence.tests.passed, 8);
  assert.equal(snapshot.evidence.git.branch, "main");
  snapshot.evidence.git.branch = "mutated";
  assert.equal(engine.getSnapshot("evidence").evidence.git.branch, "main");

  const restart = engine.restart("evidence");
  factory.last().emitExit(0);
  await restart;
  assert.deepEqual(engine.getSnapshot("evidence").evidence, {});
});

test("structured evidence emits only when safe facts change", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  const events = [];
  engine.on("session:evidence", event => events.push(event));
  engine.create({ id: "facts", name: "Facts", command: "x", cwd: "." });

  factory.last().emitData("8 passed, 0 failed\n");
  factory.last().emitData("8 passed, 0 failed\n");
  factory.last().emitData("9 passed, 0 failed\n");

  assert.equal(events.length, 2);
  assert.deepEqual(events.map(event => event.evidence.passed), [8, 9]);
  assert.equal(events.every(event => event.category === "tests" && event.name === "Facts"), true);
});

test("claim detection survives split PTY chunks and remains sticky until acknowledged", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "a", name: "build", command: "x", cwd: "." });
  const events = [];
  engine.on("session:supervision", event => events.push(event));

  factory.last().emitData("Err");
  factory.last().emitData("or: build failed\n");
  let snapshot = engine.getSnapshot("a");
  assert.equal(snapshot.activity, "claim");
  assert.equal(snapshot.attentionRequired, true);
  assert.match(snapshot.attentionReason, /Error: build failed/);

  factory.last().emitData("Building recovery bundle\n");
  snapshot = engine.getSnapshot("a");
  assert.equal(snapshot.activity, "progress");
  assert.equal(snapshot.attentionRequired, true, "progress must not silently clear an earlier failure");

  assert.deepEqual(engine.acknowledge("a"), { ok: true });
  snapshot = engine.getSnapshot("a");
  assert.equal(snapshot.activity, null);
  assert.equal(snapshot.attentionRequired, false);
  assert.equal(events.at(-1).attentionRequired, false);
});

test("modern terminal error formats raise engine attention", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "npm", name: "npm worker", command: "x", cwd: "." });

  factory.last().emitData("npm error code ENOENT\n");
  const snapshot = engine.getSnapshot("npm");
  assert.equal(snapshot.attentionRequired, true);
  assert.match(snapshot.attentionReason, /npm error code ENOENT/i);
});

test("spawn errors and unexpected non-zero exits require attention", t => {
  const spawnFactory = makeFakePtyFactory({ throwOnSpawn: true });
  const spawnEngine = new SessionEngine({ ptyFactory: spawnFactory });
  t.after(() => spawnEngine.dispose());
  spawnEngine.create({ id: "spawn", command: "missing", cwd: "." });
  assert.equal(spawnEngine.getSnapshot("spawn").attentionRequired, true);
  assert.match(spawnEngine.getSnapshot("spawn").attentionReason, /Failed to start/);

  const exitFactory = makeFakePtyFactory();
  const exitEngine = new SessionEngine({ ptyFactory: exitFactory });
  t.after(() => exitEngine.dispose());
  exitEngine.create({ id: "exit", command: "x", cwd: "." });
  exitFactory.last().emitExit(2);
  assert.equal(exitEngine.getSnapshot("exit").attentionRequired, true);
  assert.match(exitEngine.getSnapshot("exit").attentionReason, /code 2/);
});

test("exit lifecycle distinguishes success, failure, and intentional kill", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());

  engine.create({ id: "ok", name: "ok", command: "x", cwd: "." });
  factory.last().emitExit(0);
  assert.equal(engine.getSnapshot("ok").status, "exited");
  assert.equal(engine.getSnapshot("ok").exitCode, 0);

  engine.create({ id: "bad", name: "bad", command: "x", cwd: "." });
  factory.last().emitExit(2);
  assert.equal(engine.getSnapshot("bad").status, "failed");
  assert.equal(engine.getSnapshot("bad").exitCode, 2);

  engine.create({ id: "stopped", name: "stopped", command: "x", cwd: "." });
  const stoppedPty = factory.last();
  assert.deepEqual(engine.kill("stopped"), { ok: true });
  stoppedPty.emitExit(137);
  assert.equal(engine.getSnapshot("stopped").status, "exited");
});

test("write and resize are safe no-ops after exit", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  const session = engine.create({ id: "a", name: "short", command: "x", cwd: "." });
  factory.last().emitExit(0);

  assert.doesNotThrow(() => session.write("ignored"));
  assert.doesNotThrow(() => session.resize(80, 24));
  assert.equal(session.write("ignored"), false);
  assert.equal(session.resize(80, 24), false);
  assert.equal(engine.attachRawStream("a"), null);
});

test("terminal input evidence is bounded, source-attributed, and secret-redacted", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  const session = engine.create({ id: "input", command: "x", cwd: "." });

  session.write("npm run dev\r", { source: "groundstation" });
  session.write("deploy --token=super-secret-value\r", { source: "mission-ai" });
  const snapshot = session.snapshot();

  assert.equal(snapshot.inputEvidence.length, 2);
  assert.equal(snapshot.inputEvidence[0].preview, "npm run dev");
  assert.equal(snapshot.inputEvidence[1].source, "mission-ai");
  assert.equal(snapshot.inputEvidence[1].redacted, true);
  assert.equal(JSON.stringify(snapshot.inputEvidence).includes("super-secret-value"), false);
  assert.equal(typeof snapshot.lastInputAt, "number");
});

test("restart waits for the old PTY exit before spawning one replacement", async t => {
  const factory = makeFakePtyFactory({ autoExitOnKill: true, killExitCode: 0 });
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "a", name: "server", command: "x", cwd: "." });
  const firstCorrelationId = engine.getSnapshot("a").correlationId;

  const result = await engine.restart("a");
  assert.deepEqual(result, { ok: true });
  assert.equal(factory.instances.length, 2);
  assert.equal(factory.instances[0].killed, true);
  assert.equal(engine.getSnapshot("a").status, "running");
  assert.match(firstCorrelationId, /^a:run:\d+:1$/);
  assert.match(engine.getSnapshot("a").correlationId, /^a:run:\d+:2$/);
  assert.notEqual(engine.getSnapshot("a").correlationId, firstCorrelationId);
});

test("restart aborts instead of creating a duplicate if the old PTY never exits", async t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  const session = engine.create({ id: "a", name: "server", command: "x", cwd: "." });

  const result = await session.restart(10);
  assert.equal(result.ok, false);
  assert.match(result.error, /duplicate process/);
  assert.equal(factory.instances.length, 1);
});

test("remove waits for PTY exit and emits only after ownership is released", async t => {
  const factory = makeFakePtyFactory({ autoExitOnKill: true });
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "a", name: "server", command: "x", cwd: "." });
  const events = [];
  engine.on("session:removed", event => events.push(event));

  assert.deepEqual(await engine.remove("a"), { ok: true });
  assert.equal(factory.instances.length, 1);
  assert.equal(factory.last().killed, true);
  assert.equal(engine.get("a"), undefined);
  assert.deepEqual(events, [{ id: "a" }]);
});

test("remove aborts when a PTY does not exit and keeps the session tracked", async t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "a", name: "server", command: "x", cwd: "." });

  const result = await engine.remove("a", 10);
  assert.equal(result.ok, false);
  assert.match(result.error, /ownership/);
  assert.equal(engine.get("a") !== undefined, true);
  assert.equal(factory.instances.length, 1);
});

test("dispose cancels pending restart and remove waits without leaving timers", async () => {
  const restartFactory = makeFakePtyFactory();
  const restartEngine = new SessionEngine({ ptyFactory: restartFactory });
  const restartSession = restartEngine.create({ id: "restart", command: "x", cwd: "." });
  const restarting = restartSession.restart(5000);
  restartEngine.dispose();
  const restartResult = await restarting;
  assert.equal(restartResult.ok, false);
  assert.match(restartResult.error, /disposed/);

  const removeFactory = makeFakePtyFactory();
  const removeEngine = new SessionEngine({ ptyFactory: removeFactory });
  removeEngine.create({ id: "remove", command: "x", cwd: "." });
  const removing = removeEngine.remove("remove", 5000);
  removeEngine.dispose();
  const removeResult = await removing;
  assert.equal(removeResult.ok, false);
  assert.match(removeResult.error, /disposed/);
});

test("environment overrides reach the PTY but summaries expose keys only", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({
    id: "a",
    name: "server",
    command: "x",
    cwd: ".",
    env: { MISSION_CONTROL_TEST_TOKEN: "secret-value" }
  });

  assert.equal(factory.last()._spawnArgs.opts.env.MISSION_CONTROL_TEST_TOKEN, "secret-value");
  const snapshot = engine.getSnapshot("a");
  assert.deepEqual(snapshot.envKeys, ["MISSION_CONTROL_TEST_TOKEN"]);
  assert.equal(JSON.stringify(snapshot).includes("secret-value"), false);
});

test("stopped sessions reconfigure without spawning and use the new launch definition", async t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({
    id: "a",
    name: "API",
    command: "old",
    args: [],
    cwd: ".",
    env: { OLD_SECRET: "hidden" },
    autoStart: false
  });
  const events = [];
  engine.on("session:reconfigured", event => events.push(event));

  const result = engine.reconfigure("a", {
    id: "a",
    name: "API",
    command: "node",
    args: ["server.js"],
    cwd: "/tmp/api",
    env: { API_TOKEN: "new-secret" },
    powershellCompatibility: false,
    autoStart: false
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.changedFields.sort(), ["args", "command", "cwd", "env"]);
  assert.equal(factory.instances.length, 0, "editing must not launch a PTY");
  assert.equal(engine.getSnapshot("a").status, "idle");
  assert.equal(JSON.stringify(events).includes("new-secret"), false);

  assert.deepEqual(engine.start("a"), { ok: true });
  assert.equal(factory.instances.length, 1);
  assert.equal(factory.last()._spawnArgs.shell, "node");
  assert.deepEqual(factory.last()._spawnArgs.args, ["server.js"]);
  assert.equal(factory.last()._spawnArgs.opts.cwd, "/tmp/api");
  assert.equal(factory.last()._spawnArgs.opts.env.API_TOKEN, "new-secret");
});

test("running sessions reject reconfiguration without changing their process", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "a", name: "API", command: "old", cwd: "." });

  const result = engine.reconfigure("a", {
    id: "a",
    name: "API",
    command: "new",
    args: [],
    cwd: ".",
    env: {},
    powershellCompatibility: false,
    autoStart: true
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /stop the session/);
  assert.equal(engine.getSnapshot("a").command, "old");
  assert.equal(factory.instances.length, 1);
  assert.equal(factory.last().killed, false);
});

test("raw attachment is the existing PTY and cleans up its listeners", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  const session = engine.create({ id: "a", name: "shell", command: "x", cwd: "." });
  const stream = engine.attachRawStream("a");
  const baselineDataListeners = session.listenerCount("data");
  const received = [];
  const off = stream.onData(data => received.push(data));

  stream.write("echo hello\r");
  factory.last().emitData("hello\r\n");
  assert.equal(factory.instances.length, 1);
  assert.equal(factory.last().written[0], "echo hello\r");
  assert.deepEqual(received, ["hello\r\n"]);

  off();
  assert.equal(session.listenerCount("data"), baselineDataListeners);
});

test("rename emits through the engine and rejects blank names", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "a", name: "old", command: "x", cwd: "." });
  const events = [];
  engine.on("session:renamed", event => events.push(event));

  assert.deepEqual(engine.rename("a", "new"), { ok: true });
  assert.equal(engine.getSnapshot("a").name, "new");
  assert.equal(events.length, 1);
  assert.equal(engine.rename("a", "  ").ok, false);
});

test("PowerShell compatibility is explicit and other configured shells preserve native UX", () => {
  assert.deepEqual(resolveLaunch("node", ["server.js"]), { file: "node", args: ["server.js"] });
  assert.deepEqual(resolveLaunch("powershell.exe", ["-NoLogo"], { platform: "win32" }), {
    file: "powershell.exe",
    args: ["-NoLogo"]
  });
  assert.deepEqual(resolveLaunch("powershell.exe", ["-NoLogo"], {
    platform: "win32",
    powershellCompatibility: true
  }), {
    file: "powershell.exe",
    args: ["-NoLogo", "-NoExit", "-Command", "Remove-Module PSReadLine -ErrorAction SilentlyContinue"]
  });
  assert.deepEqual(resolveLaunch("C:\\Program Files\\PowerShell\\7\\pwsh.exe", ["-NoLogo"], {
    platform: "win32",
    powershellCompatibility: true
  }), {
    file: "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    args: ["-NoLogo", "-NoExit", "-Command", "Remove-Module PSReadLine -ErrorAction SilentlyContinue"]
  });
  assert.deepEqual(resolveLaunch("powershell.exe", ["-NoLogo", "-Command", "echo ok"], {
    platform: "win32",
    powershellCompatibility: true
  }), {
    file: "powershell.exe",
    args: ["-NoLogo", "-Command", "echo ok"]
  });
  assert.throws(
    () => resolveLaunch("powershell.exe -NoLogo", [], {
      platform: "win32",
      powershellCompatibility: true
    }),
    /args array/
  );
  const launch = resolveLaunch("npm run dev", []);
  assert.notEqual(launch.file, "npm run dev");
  assert.ok(launch.args.includes("npm run dev"));
});

test("raw replay buffering is byte-bounded without per-chunk string rebuilding", () => {
  const replay = new RawReplayBuffer(12);
  replay.append("alpha");
  replay.append("🙂🙂");
  replay.append("omega");
  const snapshot = replay.snapshot();

  assert.ok(snapshot.byteLength <= 12);
  assert.equal(Buffer.byteLength(snapshot.data), snapshot.byteLength);
  assert.equal(snapshot.data.includes("�"), false, "truncation must not split UTF-8 characters");
  assert.equal(snapshot.complete, false);

  const large = new RawReplayBuffer(MAX_RAW_REPLAY_BYTES);
  large.append("x".repeat(MAX_RAW_REPLAY_BYTES + 10));
  assert.equal(large.snapshot().byteLength, MAX_RAW_REPLAY_BYTES);

  const noisy = new RawReplayBuffer(32 * 1024);
  for (let index = 0; index < 100_000; index++) noisy.append("x");
  assert.ok(noisy.chunks.length < 100, "small PTY chunks should be coalesced into bounded blocks");
});

test("dispose kills PTYs, clears sessions, and removes engine listeners", () => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  engine.create({ id: "a", name: "a", command: "x", cwd: "." });
  engine.create({ id: "b", name: "b", command: "x", cwd: "." });
  engine.on("session:output", () => {});

  engine.dispose();
  assert.ok(factory.instances.every(instance => instance.killed));
  assert.equal(engine.sessions.size, 0);
  assert.equal(engine.listenerCount("session:output"), 0);
});

test("stopAll waits for every PTY concurrently before shutdown can release ownership", async () => {
  const factory = makeFakePtyFactory({ autoExitOnKill: true });
  const engine = new SessionEngine({ ptyFactory: factory });
  for (let index = 0; index < 25; index++) {
    engine.create({ id: `s${index}`, command: "x", cwd: "." });
  }

  const result = await engine.stopAll(100);
  assert.deepEqual(result, { ok: true, pendingIds: [] });
  assert.equal(factory.instances.length, 25);
  assert.ok(factory.instances.every(instance => instance.killed));
  assert.ok(engine.list().every(session => session.status === "exited"));
  engine.dispose();
});

test("stopAll reports a stuck PTY and keeps it tracked", async t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "stuck", command: "x", cwd: "." });

  const result = await engine.stopAll(10);
  assert.deepEqual(result, { ok: false, pendingIds: ["stuck"] });
  assert.equal(engine.get("stuck") !== undefined, true);
  assert.equal(factory.instances.length, 1);
});

// T069 — a completed build belongs in History, not in the decision queue.
//
// Attention inferred from a log line is a guess, and a later success from the
// same worker supersedes it. Attention raised by the lifecycle is a fact about
// a dead process and must survive any amount of later text.
test("a later success clears attention that was inferred from output", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "web", name: "Web server", command: "x", cwd: "." });
  const events = [];
  engine.on("session:supervision", event => events.push(event));

  factory.last().emitData("Error: build failed\n");
  assert.equal(engine.getSnapshot("web").attentionRequired, true);

  // Progress still must not clear it — only a reported success does.
  factory.last().emitData("Compiling modules\n");
  assert.equal(engine.getSnapshot("web").attentionRequired, true, "progress is not recovery");

  factory.last().emitData("Compiled successfully in 812ms\n");
  const snapshot = engine.getSnapshot("web");
  assert.equal(snapshot.attentionRequired, false, "a watch-mode server that recovered is not a pending decision");
  assert.equal(snapshot.attentionReason, null);
  assert.equal(snapshot.activity, "nominal");
  assert.equal(events.at(-1).attentionRequired, false, "the clearing must be published, not just stored");
});

test("a non-zero exit is never cleared by later output", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "tests", name: "Test suite", command: "x", cwd: "." });

  factory.last().emitExit(1);
  assert.equal(engine.getSnapshot("tests").attentionRequired, true);
  assert.equal(engine.getSnapshot("tests").status, "failed");

  // Output arriving after the process died cannot argue it away.
  factory.last().emitData("All checks passed\n");
  const snapshot = engine.getSnapshot("tests");
  assert.equal(snapshot.attentionRequired, true, "a dead process is a fact, not an inference");
  assert.match(snapshot.attentionReason, /exited with code 1/);
});

test("output that looked bad and then really failed stops being clearable", t => {
  const factory = makeFakePtyFactory();
  const engine = new SessionEngine({ ptyFactory: factory });
  t.after(() => engine.dispose());
  engine.create({ id: "api", name: "API", command: "x", cwd: "." });

  factory.last().emitData("Error: connection refused\n");
  factory.last().emitExit(2);
  assert.equal(engine.getSnapshot("api").attentionRequired, true);

  factory.last().emitData("listening on 3000\n");
  assert.equal(
    engine.getSnapshot("api").attentionRequired,
    true,
    "the origin must upgrade to lifecycle so a later nominal line cannot clear a real exit"
  );
});
