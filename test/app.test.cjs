const assert = require("node:assert/strict");
const { PassThrough } = require("node:stream");
const { test } = require("node:test");
const { EngineAPI } = require("../src/engine/index.cjs");
const { makeFakePtyFactory } = require("./fakePty.cjs");

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Ink commits can be delayed when the full Windows suite runs beside dozens of
// worker processes. Keep the 10 ms polling cadence, but allow enough wall time
// for a healthy render instead of turning scheduler contention into a UI flake.
async function waitFor(condition, label = "test condition", timeoutMs = 10_000) {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started >= timeoutMs) throw new Error(`timed out waiting for ${typeof label === "function" ? label() : label}`);
    await wait(10);
  }
}

// Ink writes styled output, so every assertion about what the operator can
// actually read has to work on the text, not the escape sequences.
const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

// The last few non-blank rendered rows, for a readable timeout message.
function formFrame(mounted) {
  return mounted.plain().split(/\r?\n/).filter(row => row.trim()).slice(-8).join("\n");
}

// Typing into a guided form is a two-step handoff: the keystrokes update
// ink-text-input's state, and only a committed render makes that value visible
// to the Enter that submits it. Waiting a fixed 10 ms between the two lost that
// race under load and submitted a stale value, which is what made these tests
// flaky. Both prompts echo the field as `> <value>` on its own line, and no
// hint carries that prefix, so the echo is an exact gate: Enter is sent only
// once the form is demonstrably holding what was typed.
async function typeField(mounted, value, echo = value) {
  await drainInput(mounted);
  mounted.clearOutput();
  mounted.stdin.write(value);
  await waitFor(
    () => mounted.plain().includes(`> ${echo}`),
    () => `the form to echo ${JSON.stringify(echo)} (still pending: ${mounted.stdin.readableLength} bytes of input)\n${formFrame(mounted)}`
  );
  mounted.stdin.write("\r");
}

// Two stdin writes issued back to back land in one stream chunk, and ink then
// dispatches them as a single input string, so the second keystroke is never
// seen as its own key. Waiting for the stream to drain proves the app consumed
// the first one before the next is sent.
async function drainInput(mounted) {
  await wait(0);
  await waitFor(() => mounted.stdin.readableLength === 0);
}

// Enter on its own accepts the field's default; there is nothing to echo, so
// the gate is the next thing the form draws.
async function acceptField(mounted, nextMarker) {
  await drainInput(mounted);
  mounted.clearOutput();
  mounted.stdin.write("\r");
  await waitFor(() => mounted.plain().includes(nextMarker), () => `${JSON.stringify(nextMarker)}; last frame was:
${formFrame(mounted)}`);
}

async function mountApp(options = {}) {
  const React = (await import("react")).default;
  const { render } = await import("ink");
  const App = (await import("../src/tui/App.js")).default;
  const factory = makeFakePtyFactory(options.factoryOptions);
  const api = new EngineAPI({ ptyFactory: factory });
  api.loadProject({
    sessions: options.sessions || [{ id: "a", name: "shell", command: "x", cwd: "." }],
    commands: options.commands || []
  });

  let listCalls = 0;
  let snapshotCalls = 0;
  const realList = api.list.bind(api);
  const realGetSnapshot = api.getSnapshot.bind(api);
  api.list = () => {
    listCalls++;
    return realList();
  };
  api.getSnapshot = id => {
    snapshotCalls++;
    return realGetSnapshot(id);
  };

  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.setRawMode = () => stdin;
  stdin.ref = () => {};
  stdin.unref = () => {};
  const stdout = new PassThrough();
  stdout.isTTY = true;
  stdout.columns = 100;
  stdout.rows = 30;
  let output = "";
  stdout.on("data", chunk => { output += chunk.toString(); });
  const fullAttachIds = [];

  const instance = render(
    React.createElement(App, {
      engineApi: api,
      requestFullAttach: id => fullAttachIds.push(id),
      onQuit: () => {}
    }),
    { stdin, stdout, exitOnCtrlC: false, debug: false }
  );

  await waitFor(() => stdin.listenerCount("readable") > 0);
  await new Promise(resolve => setImmediate(resolve));
  return {
    api,
    factory,
    stdin,
    instance,
    fullAttachIds,
    output: () => output,
    plain: () => output.replace(ANSI, ""),
    clearOutput: () => { output = ""; },
    counts: () => ({ listCalls, snapshotCalls })
  };
}

test("Escape returns from Tail to the session list, including Windows enhanced input", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("\r");
  await waitFor(() => mounted.output().includes("Esc snapshot"));
  assert.match(mounted.output(), /Esc snapshot/);

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("\x1b[27;1;27~");
  await waitFor(() => mounted.output().includes("Enter tail"));
  assert.match(mounted.output(), /Enter tail/);
});

test("Tail is read-only, follows real output, and F targets the same session", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("\r");
  await waitFor(() => mounted.output().includes("Esc snapshot"));
  const writesBefore = mounted.factory.last().written.length;
  await drainInput(mounted);
  mounted.stdin.write("z");
  await drainInput(mounted);
  mounted.factory.last().emitData("real tail line\n");
  await waitFor(() => mounted.api.getSnapshot("a").lastLine === "real tail line");

  assert.equal(mounted.factory.last().written.length, writesBefore, "Tail must not forward input");
  assert.equal(mounted.api.getSnapshot("a").lastLine, "real tail line");

  await drainInput(mounted);
  mounted.stdin.write("F");
  await waitFor(() => mounted.fullAttachIds.length > 0);
  assert.deepEqual(mounted.fullAttachIds, ["a"]);
});

test("F on an exited session stays in Mission Control and explains why attach is unavailable", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  mounted.factory.last().emitExit(0);
  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("F");
  await waitFor(() => mounted.output().includes("Cannot attach: shell is exited"));

  assert.deepEqual(mounted.fullAttachIds, []);
  assert.match(mounted.output(), /Cannot attach: shell is exited/);
});

test("output bursts are coalesced without refreshing the whole session list", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });
  const before = mounted.counts();

  for (let i = 0; i < 250; i++) mounted.factory.last().emitData(`line ${i}\n`);
  // A fixed settle is deliberate here. Both assertions below are upper
  // bounds, so scheduler delay can only make them pass, and the gate cannot
  // poll api.getSnapshot because that call is the thing being counted.
  await wait(140);
  const after = mounted.counts();

  assert.ok(after.snapshotCalls - before.snapshotCalls <= 2, "one burst should cause one throttled snapshot refresh");
  assert.equal(after.listCalls - before.listCalls, 0, "output alone must not rebuild the session list");
});

test("recent activity shows real engine lifecycle changes", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  assert.match(mounted.output(), /RECENT ACTIVITY/);
  mounted.clearOutput();
  mounted.factory.last().emitExit(0);
  await waitFor(() => mounted.output().includes("shell exited (0)"));
  assert.match(mounted.output(), /shell exited \(0\)/);
});

test("attention output is surfaced and can be acknowledged from the snapshot", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  mounted.factory.last().emitData("Error: build failed\n");
  await waitFor(() => mounted.output().includes("NEEDS ATTENTION"));
  assert.equal(mounted.api.getSnapshot("a").attentionRequired, true);
  assert.match(mounted.output(), /NEEDS ATTENTION/);

  await drainInput(mounted);
  mounted.stdin.write("a");
  await waitFor(() => mounted.output().includes("Attention acknowledged"));
  assert.equal(mounted.api.getSnapshot("a").attentionRequired, false);
  assert.match(mounted.output(), /Attention acknowledged/);
});

test("attention navigation cycles through every session that needs action", async t => {
  const mounted = await mountApp({ sessions: [
    { id: "a", name: "API", command: "x", cwd: "." },
    { id: "b", name: "Build", command: "x", cwd: "." },
    { id: "c", name: "Checks", command: "x", cwd: "." }
  ] });
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  mounted.factory.instances[0].emitData("Error: API failed\n");
  mounted.factory.instances[2].emitData("FAILED checks\n");
  await waitFor(() => mounted.output().includes("2 attention"));

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("g");
  await waitFor(() => mounted.output().includes("Attention 2 of 2"));
  assert.match(mounted.output(), /Attention 2 of 2/);

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("g");
  await waitFor(() => mounted.output().includes("Attention 1 of 2"));
  assert.match(mounted.output(), /Attention 1 of 2/);
});

test("keyboard guide opens and closes with Windows enhanced Escape", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("?");
  await waitFor(() => mounted.output().includes("KEYBOARD GUIDE"));
  assert.match(mounted.output(), /One PTY per session/);

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("\x1b[27;1;27~");
  await waitFor(() => mounted.output().includes("Enter tail"));
  assert.match(mounted.output(), /next attention/);
});

test("unmount removes EngineAPI subscription and cancels pending output timer", async () => {
  const mounted = await mountApp();
  assert.equal(mounted.api.listenerCount("engine:event"), 1);

  mounted.factory.last().emitData("pending\n");
  mounted.instance.unmount();
  await waitFor(() => mounted.api.listenerCount("engine:event") === 0);

  assert.equal(mounted.api.listenerCount("engine:event"), 0);
  mounted.api.dispose();
});

test("guided create flow adds exactly one engine-owned PTY", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  await drainInput(mounted);
  mounted.stdin.write("c");
  await waitFor(() => mounted.plain().includes("Step 1 of 5"));
  await typeField(mounted, "web");
  await waitFor(() => mounted.plain().includes("Step 2 of 5"));
  await typeField(mounted, "Web server");
  await waitFor(() => mounted.plain().includes("Step 3 of 5"));
  await typeField(mounted, "npm run dev");
  await waitFor(() => mounted.plain().includes("Step 4 of 5"));
  // The directory field arrives pre-filled with "."; a second one echoes "..".
  await typeField(mounted, ".", "..");
  await waitFor(() => mounted.plain().includes("Step 5 of 5"));
  await acceptField(mounted, "Session created");
  await waitFor(() => mounted.api.list().some(session => session.id === "web"));
  await waitFor(() => mounted.output().includes("Session created"));
  await waitFor(() => mounted.output().includes("Web server"));

  assert.deepEqual(mounted.api.list().map(session => session.id), ["a", "web"]);
  assert.equal(mounted.factory.instances.length, 2);
  assert.match(mounted.output(), /Web server/, "the created session must appear in the visible list");
});

test("guided create can register a manual session without spawning it", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  await drainInput(mounted);
  mounted.stdin.write("c");
  await waitFor(() => mounted.plain().includes("Step 1 of 5"));
  await typeField(mounted, "db");
  await waitFor(() => mounted.plain().includes("Step 2 of 5"));
  await typeField(mounted, "Database");
  await waitFor(() => mounted.plain().includes("Step 3 of 5"));
  await typeField(mounted, "docker compose up db");
  await waitFor(() => mounted.plain().includes("Step 4 of 5"));
  await typeField(mounted, ".", "..");
  await waitFor(() => mounted.plain().includes("Step 5 of 5"));
  await typeField(mounted, "no");

  await waitFor(() => mounted.api.list().some(session => session.id === "db"));
  await waitFor(() => mounted.output().includes("Session created"));
  assert.equal(mounted.factory.instances.length, 1);
  assert.equal(mounted.api.getSnapshot("db").status, "idle");
  assert.equal(mounted.api.getSnapshot("db").autoStart, false);
});

test("saved preset picker adds a manual worker without spawning it", async t => {
  const mounted = await mountApp({ commands: [
    { id: "checks", name: "Run checks", command: "npm test", cwd: "." }
  ] });
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("p");
  await waitFor(() => mounted.output().includes("SAVED WORKER PRESETS"));
  assert.match(mounted.output(), /Run checks · manual start/);

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("\r");
  // Ink may coalesce the transient success frame under a saturated parallel
  // suite. Assert the durable engine result and the settled visible row.
  await waitFor(() => mounted.api.list().some(session => session.id === "checks"));
  await waitFor(() => mounted.output().includes("Run checks"));
  assert.equal(mounted.api.getSnapshot("checks").status, "idle");
  assert.equal(mounted.factory.instances.length, 1, "only the original shell PTY should exist");
});

test("idle sessions start explicitly and startup policy toggles independently", async t => {
  const mounted = await mountApp({ sessions: [
    { id: "manual", name: "Database", command: "x", cwd: ".", autoStart: false }
  ] });
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  assert.equal(mounted.factory.instances.length, 0);
  assert.equal(mounted.api.getSnapshot("manual").status, "idle");
  assert.match(mounted.output(), /startup  manual/);

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("s");
  await waitFor(() => mounted.output().includes("Started"));
  assert.equal(mounted.factory.instances.length, 1);
  assert.equal(mounted.api.getSnapshot("manual").status, "running");
  assert.equal(mounted.api.getSnapshot("manual").autoStart, false);

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("u");
  await waitFor(() => mounted.output().includes("Startup set to automatic"));
  assert.equal(mounted.api.getSnapshot("manual").autoStart, true);
  assert.equal(mounted.factory.instances.length, 1);
});

test("stopped workers can be edited without launching until explicitly started", async t => {
  const mounted = await mountApp({ sessions: [
    { id: "manual", name: "API", command: "old", cwd: ".", autoStart: false }
  ] });
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  await drainInput(mounted);
  mounted.stdin.write("e");
  await waitFor(() => mounted.plain().includes("EDIT WORKER"));
  await typeField(mounted, "node");
  await waitFor(() => mounted.plain().includes("Arguments"));
  await typeField(mounted, '["server.js"]');
  await waitFor(() => mounted.plain().includes("Working directory"));
  await acceptField(mounted, "PowerShell compatibility");
  await acceptField(mounted, "Environment overrides");
  await typeField(mounted, '{"API_TOKEN":"secret"}');

  await waitFor(() => mounted.output().includes("Worker configuration updated"));
  assert.equal(mounted.factory.instances.length, 0);
  assert.equal(mounted.api.getSnapshot("manual").command, "node");
  assert.deepEqual(mounted.api.getSnapshot("manual").args, ["server.js"]);
  assert.deepEqual(mounted.api.getSnapshot("manual").envKeys, ["API_TOKEN"]);

  await drainInput(mounted);
  mounted.stdin.write("s");
  await waitFor(() => mounted.output().includes("Started"));
  assert.equal(mounted.factory.instances.length, 1);
  assert.equal(mounted.factory.last()._spawnArgs.opts.env.API_TOKEN, "secret");
});

test("running workers refuse edit mode without stopping their PTY", async t => {
  const mounted = await mountApp();
  t.after(() => {
    mounted.instance.unmount();
    mounted.api.dispose();
  });

  mounted.clearOutput();
  await drainInput(mounted);
  mounted.stdin.write("e");
  await waitFor(() => mounted.output().includes("Stop the worker before editing"));
  assert.equal(mounted.output().includes("EDIT WORKER"), false);
  assert.equal(mounted.factory.instances.length, 1);
  assert.equal(mounted.factory.last().killed, false);
});
