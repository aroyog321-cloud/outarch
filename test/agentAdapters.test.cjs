const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createAgentDefinition, listAgentAdapters, resolveAdapterCommand } = require("../src/service/agentAdapters.cjs");

test("agent adapters are fixed and create inert worker definitions", () => {
  const fakePath = path.posix.join("/", "agent-bin");
  const options = { platform: "linux", env: { PATH: fakePath } };
  const originalStat = require("node:fs").statSync;
  require("node:fs").statSync = candidate => ({ isFile: () => candidate === path.posix.join(fakePath, "codex") });
  assert.deepEqual(listAgentAdapters(options).map(({ id, command }) => ({ id, command })), [
    { id: "claude", command: "claude" },
    { id: "codex", command: "codex" },
    { id: "gemini", command: "gemini" },
    { id: "antigravity", command: "agy" },
    { id: "opencode", command: "opencode" }
  ]);
  const worker = createAgentDefinition("codex", options);
  assert.match(worker.id, /^agent-codex-[a-f0-9]{8}$/);
  assert.deepEqual(worker, {
    id: worker.id,
    name: "Codex agent",
    command: path.posix.join(fakePath, "codex"),
    args: [],
    cwd: ".",
    autoStart: false
  });
  assert.throws(() => createAgentDefinition("custom-shell", options), /unsupported agent adapter/);
  require("node:fs").statSync = originalStat;
});

test("Windows npm command shims launch through cmd and missing CLIs fail clearly", () => {
  const fs = require("node:fs");
  const originalStat = fs.statSync;
  const fakePath = path.win32.join("C:\\", "npm");
  fs.statSync = candidate => ({ isFile: () => candidate === path.win32.join(fakePath, "gemini.cmd") });
  const options = { platform: "win32", env: { Path: fakePath }, comSpec: "C:\\Windows\\System32\\cmd.exe" };
  assert.equal(resolveAdapterCommand("gemini", options), path.win32.join(fakePath, "gemini.cmd"));
  const worker = createAgentDefinition("gemini", options);
  assert.equal(worker.command, options.comSpec);
  assert.deepEqual(worker.args, ["/d", "/s", "/c", "gemini"]);
  assert.throws(() => createAgentDefinition("codex", options), /CLI was not found on PATH/);
  fs.statSync = originalStat;
});
