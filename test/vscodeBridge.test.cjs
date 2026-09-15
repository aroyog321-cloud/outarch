const assert = require("node:assert/strict");
const net = require("node:net");
const { once } = require("node:events");
const { test } = require("node:test");
const {
  ALLOWED_CAPABILITIES,
  MAX_DIAGNOSTICS,
  VSCodeBridge,
  relativeWorkspaceFile
} = require("../src/service/vscodeBridge.cjs");

function lineReader(socket) {
  let buffer = "";
  const queued = [];
  const waiters = [];
  socket.setEncoding("utf8");
  socket.on("data", chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const value = JSON.parse(line);
      const waiter = waiters.shift();
      if (waiter) waiter(value);
      else queued.push(value);
    }
  });
  return () => queued.length ? Promise.resolve(queued.shift()) : new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for VS Code Bridge frame")), 1000);
    waiters.push(value => { clearTimeout(timer); resolve(value); });
  });
}

async function connect(uri, workspacePath, overrides = {}) {
  const parsed = new URL(uri);
  const socket = net.createConnection({ host: "127.0.0.1", port: Number(parsed.searchParams.get("port")) });
  const read = lineReader(socket);
  await once(socket, "connect");
  socket.write(`${JSON.stringify({
    type: "hello",
    protocolVersion: 1,
    token: overrides.token ?? parsed.searchParams.get("token"),
    clientId: "test-vscode",
    extensionVersion: "0.2.0",
    workspacePath,
    capabilities: overrides.capabilities || [...ALLOWED_CAPABILITIES]
  })}\n`);
  return { socket, read, parsed };
}

function fixture(options = {}) {
  const uris = [];
  const workspace = options.workspace || { persistent: true, name: "Project", directory: "/workspace/project" };
  const bridge = new VSCodeBridge({
    getWorkspace: () => workspace,
    openExternal: async uri => { uris.push(uri); return true; },
    handshakeTtlMs: 2000,
    socketHandshakeTimeoutMs: 500,
    ...options.bridgeOptions
  });
  return { bridge, uris, workspace };
}

test("VS Code Bridge performs a one-time authenticated loopback handshake", async t => {
  const { bridge, uris, workspace } = fixture();
  t.after(() => bridge.dispose());
  const launch = await bridge.launch();

  assert.equal(launch.awaitingHandshake, true);
  assert.equal(uris.length, 1);
  assert.match(uris[0], /^vscode:\/\/mission-control\.bridge\/connect\?/);
  assert.equal(JSON.stringify(launch).includes("token"), false, "renderer result must never receive the handshake token");

  const client = await connect(uris[0], workspace.directory, { capabilities: [...ALLOWED_CAPABILITIES, "terminal.output.read"] });
  t.after(() => client.socket.destroy());
  const ack = await client.read();

  assert.equal(ack.type, "hello:ack");
  assert.equal(ack.project.name, "Project");
  assert.deepEqual(ack.permissions, [...ALLOWED_CAPABILITIES]);
  const status = bridge.status();
  assert.equal(status.connected, true);
  assert.equal(status.awaitingHandshake, false);
  assert.equal(status.connection.capabilities.includes("terminal.output.read"), false);
});

test("VS Code Bridge synchronizes bounded editor, diagnostics, Git, task, and terminal identity state", async t => {
  const { bridge, uris, workspace } = fixture();
  t.after(() => bridge.dispose());
  await bridge.launch();
  const client = await connect(uris[0], workspace.directory);
  t.after(() => client.socket.destroy());
  await client.read();

  const diagnostics = Array.from({ length: MAX_DIAGNOSTICS + 10 }, (_, index) => ({
    relativePath: index === 0 ? "../secret.txt" : `src/file-${index}.js`,
    line: index + 1,
    severity: index % 2 ? "warning" : "error",
    code: `E${index}`,
    message: "x".repeat(400)
  }));
  const finalUpdate = once(bridge, "status");
  client.socket.write([
    { type: "editor:state", relativePath: "src/app.js", line: 12, column: 4, languageId: "javascript", dirty: true },
    { type: "diagnostics", errors: 12, warnings: 7, items: diagnostics },
    { type: "git:state", branch: "feature/bridge", changedPaths: 3, ahead: 1, behind: 0, clean: false },
    { type: "task:state", name: "npm test", state: "succeeded", exitCode: 0 },
    { type: "terminals:state", terminals: [
      { id: "terminal-api", name: "API", state: "open", ownership: "mission-control-managed", active: true, shellIntegration: true, currentCommand: "npm run dev", commandState: "running", cwd: "apps/api" },
      { id: "terminal-tests", name: "Tests", state: "open", ownership: "vscode-owned", commandState: "idle" }
    ] }
  ].map(value => `${JSON.stringify(value)}\n`).join(""));
  await finalUpdate;
  await new Promise(resolve => setImmediate(resolve));

  const status = bridge.status();
  assert.deepEqual(status.editor, { relativePath: "src/app.js", line: 12, column: 4, languageId: "javascript", dirty: true, savedAt: null });
  assert.equal(status.diagnostics.errors, 12);
  assert.equal(status.diagnostics.items.length, MAX_DIAGNOSTICS - 1, "outside-project diagnostics are removed after bounding");
  assert.ok(status.diagnostics.items.every(item => !item.relativePath.includes("..") && item.message.length <= 240));
  assert.equal(status.git.branch, "feature/bridge");
  assert.equal(status.tasks[0].state, "succeeded");
  assert.deepEqual(status.terminals.map(item => item.name), ["API", "Tests"]);
  assert.equal(status.terminals[0].ownership, "mission-control-managed");
  assert.equal(status.terminals[0].controllable, true);
  assert.equal(status.terminals[0].currentCommand, "npm run dev");
  assert.equal(status.terminals[1].controllable, false);
  assert.ok(Number.isInteger(status.lastSyncAt));
  assert.equal(JSON.stringify(status).includes("terminal output"), false);
});

test("VS Code Bridge controls only explicit managed terminals through acknowledged commands", async t => {
  const { bridge, uris, workspace } = fixture();
  t.after(() => bridge.dispose());
  await bridge.launch();
  const client = await connect(uris[0], workspace.directory);
  t.after(() => client.socket.destroy());
  await client.read();

  const created = bridge.createManagedTerminal({ name: "Backend", cwd: "apps/api" });
  const createFrame = await client.read();
  assert.equal(createFrame.type, "command:terminal-create");
  assert.equal(createFrame.name, "Backend");
  assert.equal(createFrame.cwd, "apps/api");
  client.socket.write(`${JSON.stringify({ type: "command:result", requestId: createFrame.requestId, ok: true, terminalId: "terminal-managed" })}\n`);
  assert.deepEqual(await created, { ok: true, terminalId: "terminal-managed" });

  const written = bridge.writeManagedTerminal({ terminalId: "terminal-managed", input: "npm run dev" });
  const writeFrame = await client.read();
  assert.equal(writeFrame.type, "command:terminal-write");
  assert.equal(writeFrame.input, "npm run dev");
  client.socket.write(`${JSON.stringify({ type: "command:result", requestId: writeFrame.requestId, ok: true, terminalId: "terminal-managed" })}\n`);
  assert.equal((await written).ok, true);

  await assert.rejects(bridge.writeManagedTerminal({ terminalId: "terminal-managed", input: "API_KEY=secret-value" }), /secret/);
  await assert.rejects(bridge.writeManagedTerminal({ terminalId: "terminal-managed", input: "first\nsecond" }), /one non-empty/);
});

test("VS Code Bridge rejects invalid tokens without consuming the valid pending handshake", async t => {
  const { bridge, uris, workspace } = fixture();
  t.after(() => bridge.dispose());
  await bridge.launch();
  const rejected = await connect(uris[0], workspace.directory, { token: "wrong-token" });
  await once(rejected.socket, "close");

  assert.equal(bridge.status().connected, false);
  assert.equal(bridge.status().awaitingHandshake, true);

  const accepted = await connect(uris[0], workspace.directory);
  t.after(() => accepted.socket.destroy());
  assert.equal((await accepted.read()).type, "hello:ack");
  assert.equal(bridge.status().connected, true);
});

test("VS Code Bridge enforces negotiated capabilities in both directions", async t => {
  const { bridge, uris, workspace } = fixture();
  t.after(() => bridge.dispose());
  await bridge.launch();
  const client = await connect(uris[0], workspace.directory, { capabilities: ["editor.activeFile.read"] });
  t.after(() => client.socket.destroy());

  const ack = await client.read();
  assert.deepEqual(ack.permissions, ["editor.activeFile.read"]);
  client.socket.write([
    { type: "editor:state", relativePath: "src/app.js", line: 7, column: 2 },
    { type: "diagnostics", errors: 99, warnings: 99, items: [{ relativePath: "src/app.js", message: "not granted" }] },
    { type: "git:state", branch: "private", changedPaths: 99 },
    { type: "task:state", name: "not granted", state: "started" },
    { type: "terminals:state", terminals: [{ name: "not granted" }] }
  ].map(value => `${JSON.stringify(value)}\n`).join(""));
  await once(bridge, "status");

  const status = bridge.status();
  assert.equal(status.editor.relativePath, "src/app.js");
  assert.equal(status.diagnostics.errors, 0);
  assert.equal(status.git, null);
  assert.deepEqual(status.tasks, []);
  assert.deepEqual(status.terminals, []);
  await assert.rejects(bridge.openProblems(), /did not grant editor\.open/);
});

test("queued editor commands are not disclosed without editor.open", async t => {
  const { bridge, uris, workspace } = fixture();
  t.after(() => bridge.dispose());
  await bridge.openFile({ relativePath: "src/server.js", line: 24, column: 7 });
  const client = await connect(uris[0], workspace.directory, { capabilities: ["editor.activeFile.read"] });
  t.after(() => client.socket.destroy());

  assert.equal((await client.read()).type, "hello:ack");
  assert.match(bridge.status().lastError, /did not grant editor\.open/);
});

test("open-file commands stay project-relative and queue behind launch handshake", async t => {
  const { bridge, uris, workspace } = fixture();
  t.after(() => bridge.dispose());

  await assert.rejects(bridge.openFile({ relativePath: "../outside.txt" }), /inside the active project/);
  const queued = await bridge.openFile({ relativePath: "src/server.js", line: 24, column: 7 });
  assert.deepEqual(queued, { sent: false, launched: true, awaitingHandshake: true });
  const client = await connect(uris[0], workspace.directory);
  t.after(() => client.socket.destroy());

  assert.equal((await client.read()).type, "hello:ack");
  assert.deepEqual(await client.read(), {
    type: "command:open-file",
    relativePath: "src/server.js",
    line: 24,
    column: 7
  });

  const sent = await bridge.openProblems();
  assert.deepEqual(sent, { sent: true, launched: false });
  assert.deepEqual(await client.read(), { type: "command:open-problems" });
});

test("workspace path validation uses native Windows semantics", () => {
  assert.equal(relativeWorkspaceFile("C:\\work\\app", "C:\\work\\app\\src\\main.ts", "win32"), "src/main.ts");
  assert.equal(relativeWorkspaceFile("C:\\work\\app", "C:\\work\\secret.txt", "win32"), null);
  assert.equal(relativeWorkspaceFile("C:\\work\\app", "..\\secret.txt", "win32"), null);
});

test("VS Code Bridge records and streams terminal inputs and output logs", async t => {
  const { bridge, uris, workspace } = fixture();
  t.after(() => bridge.dispose());
  await bridge.launch();
  const client = await connect(uris[0], workspace.directory);
  t.after(() => client.socket.destroy());
  await client.read();

  // Send terminal state
  const statusPromise = once(bridge, "status");
  client.socket.write(`${JSON.stringify({
    type: "terminals:state",
    terminals: [{ id: "terminal-1", name: "Build", state: "open", ownership: "mission-control-managed" }]
  })}\n`);
  await statusPromise;

  // Stream output and input
  const outputPromise = once(bridge, "status");
  client.socket.write(`${JSON.stringify({
    type: "terminal:output",
    terminalId: "terminal-1",
    input: "npm run build",
    data: "Building project...\nCompiled in 240ms\n",
    state: "succeeded",
    exitCode: 0
  })}\n`);
  await outputPromise;

  const status = bridge.status();
  const terminal = status.terminals.find(t => t.id === "terminal-1");
  assert.ok(terminal);
  assert.equal(terminal.logs.length, 4);
  assert.equal(terminal.logs[0].type, "input");
  assert.equal(terminal.logs[0].text, "npm run build");
  assert.equal(terminal.logs[1].type, "output");
  assert.equal(terminal.logs[1].text, "Building project...");
  assert.equal(terminal.logs[2].type, "output");
  assert.equal(terminal.logs[2].text, "Compiled in 240ms");
  assert.equal(terminal.logs[3].type, "system");
  assert.equal(terminal.logs[3].exitCode, 0);
});
