"use strict";

// Project memory, as the operator meets it: the introduction that asks before
// anything is written, the question on the way out, the Settings panel, and
// the wiring that makes closing the window ask first.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("the introduction asks before writing, explains itself, and remembers not now versus never", () => {
  const ui = read("src/groundstation/renderer/ProjectMemory.jsx");
  assert.match(ui, /Give \$\{projectName\} a memory/);
  assert.match(ui, /Every AI agent starts informed/);
  assert.match(ui, /You never write it by hand/);
  assert.match(ui, /Nothing is lost between sessions/);
  // Pointing agents to it is a visible choice, on by default, and says what it touches.
  assert.match(ui, /const \[pointers, setPointers\] = React\.useState\(true\);/);
  assert.match(ui, /Adds a short note to CLAUDE\.md and AGENTS\.md/);
  // Declining: "Not now" asks again next launch, the checkbox makes it never.
  assert.match(ui, /Don't ask me again/);
  assert.match(ui, /missionApi\(\)\.request\("projectMemory\.decline", \{ never: !manual && never \}\)/);
  // Nothing is created until the button is pressed.
  assert.match(ui, /missionApi\(\)\.request\("projectMemory\.enable", \{ pointers \}\)/);
  assert.match(ui, /Create project memory/);
  // Offered once per project per launch, and never over another dialog.
  assert.match(ui, /document\.querySelector\("\[role='dialog'\], \[role='alertdialog'\], \[cmdk-root\]"\)/);
  assert.match(ui, /offered\.current\.add\(workspaceKey\)/);
});

test("the question on the way out writes with Mission AI, can be skipped, and closes the app itself", () => {
  const ui = read("src/groundstation/renderer/ProjectMemory.jsx");
  assert.match(ui, /Update project memory before you close\?/);
  assert.match(ui, /What did you work on\?/);
  assert.match(ui, /missionApi\(\)\.request\("projectMemory\.update", \{ reason: "close", note \}\)/);
  assert.match(ui, /Close without updating/);
  assert.match(ui, /Don't ask when I close/);
  assert.match(ui, /missionApi\(\)\.request\("projectMemory\.closePrompt", \{ state: "shown" \}\)/);
  assert.match(ui, /missionApi\(\)\.request\("projectMemory\.closePrompt", \{ state: "cancel" \}\)/);
  assert.match(ui, /missionApi\(\)\.request\("system\.shutdown"\)/);
  assert.match(ui, /missionApi\(\)\.request\("projectMemory\.closePrompt", \{ state: "ready" \}\)/);
});

test("the app mounts it, Settings holds it, and closing the window asks through it", () => {
  const app = read("src/groundstation/renderer/App.jsx");
  assert.match(app, /<ProjectMemoryHost workspace=\{workspace\}\/>/);
  assert.match(app, /<ProjectMemorySettings workspace=\{workspace\} onConfirm=\{onConfirm\}\/>/);
  assert.match(app, /project: "Memory and defaults",/);
  assert.match(app, /id: "project-memory", label: "Project memory"/);
  const settings = read("src/groundstation/renderer/ProjectMemory.jsx");
  assert.match(settings, /<ModelSwitcher status=\{aiStatus\} surface="memory"/, "memory can use its own model and key");
  assert.match(settings, /Turn it off for this project/);

  const main = read("src/groundstation/main/index.cjs");
  assert.match(main, /window\.on\("close", event => \{\n    if \(shutdownComplete\) return;\n    event\.preventDefault\(\);\n    void requestClose\(window\);\n  \}\);/);
  assert.match(main, /async function requestClose\(window\) \{[\s\S]{0,400}try \{ decision = await projectMemory\.requestClose\(\); \} catch \{ decision = "close"; \}/);
  assert.match(main, /projectMemory\.on\("close-request", payload => ipcHost\?\.broadcast\(\{ type: "projectMemory:close-requested", \.\.\.payload \}\)\);/);

  const protocol = read("src/protocol/index.cjs");
  for (const method of ["status", "preview", "enable", "decline", "disable", "configure", "update", "summarize", "refreshFacts", "pointers", "open", "closePrompt"]) {
    assert.match(protocol, new RegExp(`"projectMemory\\.${method}",`), `${method} is allowed`);
    assert.match(protocol, new RegExp(`case "projectMemory\\.${method}":`), `${method} is handled`);
  }
});

test("Mission AI keeps a separate model for memory and is told the file exists", () => {
  const assistant = read("src/service/aiAssistant.cjs");
  assert.match(assistant, /const SELECTION_SURFACES = Object\.freeze\(\["missionAi", "workspace", "memory"\]\);/);
  assert.match(assistant, /async compose\(\{ surface = "memory", system, text, timeoutMs = COMPOSE_TIMEOUT_MS \} = \{\}\) \{/);
  assert.match(assistant, /allowedTools: new Set\(\)/, "compose offers the model no tools");
  assert.match(assistant, /arch_memory\.md` at its root/);
});

test("through the protocol: status, turning it on, bad input and a failing write all reach the operator as they should", async t => {
  const os = require("node:os");
  const { PROTOCOL_VERSION, createProtocolConnection } = require("../src/protocol/connection.cjs");
  const { ProjectMemoryFile } = require("../src/service/projectMemoryFile.cjs");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-memory-protocol-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const engine = {
    subscribe: () => () => {},
    getState: () => ({ contractVersion: 1, sequence: 0, generatedAt: Date.now(), sessions: [] }),
    getActivity: () => ({ contractVersion: 1, events: [] }),
    getWorkspace: () => ({ version: 1, name: "proto", persistent: true, directory, path: path.join(directory, "termctl.config.json") }),
    list: () => []
  };
  const memory = new ProjectMemoryFile({ getEngineApi: () => engine, preferencesPath: path.join(directory, ".prefs", "project-memory.json") });
  const connection = createProtocolConnection(engine, { send: () => {}, projectMemory: memory });
  const call = (method, params = {}) => connection.handle({ version: PROTOCOL_VERSION, id: method, method, params });

  const status = await call("projectMemory.status");
  assert.equal(status.ok, true, status.error?.message);
  assert.equal(status.result.prompt, "open");
  const enabled = await call("projectMemory.enable", { pointers: false });
  assert.equal(enabled.ok, true, enabled.error?.message);
  assert.ok(fs.existsSync(path.join(directory, "arch_memory.md")));
  assert.equal(fs.existsSync(path.join(directory, "CLAUDE.md")), false, "no note for agents when it was turned off");

  const badSetting = await call("projectMemory.configure", { configuration: { askOnClose: "later" } });
  assert.equal(badSetting.ok, false);
  assert.equal(badSetting.error.code, "INVALID_PARAMS");
  const badState = await call("projectMemory.closePrompt", { state: "whenever" });
  assert.equal(badState.error.code, "INVALID_PARAMS");
  // With no model on this connection, the write fails in words, and nothing is written.
  const before = fs.readFileSync(path.join(directory, "arch_memory.md"), "utf8");
  const update = await call("projectMemory.update", { note: "Changed the build" });
  assert.equal(update.ok, false);
  assert.equal(update.error.code, "PROJECT_MEMORY_ERROR");
  assert.match(update.error.message, /Mission AI is not available/);
  assert.equal(fs.readFileSync(path.join(directory, "arch_memory.md"), "utf8"), before);

  const unavailable = createProtocolConnection(engine, { send: () => {} });
  const refused = await unavailable.handle({ version: PROTOCOL_VERSION, id: "x", method: "projectMemory.status", params: {} });
  assert.equal(refused.error.code, "UNAVAILABLE");
});
