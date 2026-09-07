const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { parseCliArgs } = require("../src/cli/options.cjs");
const { leasePathFor } = require("../src/engine/workspaceLease.cjs");
const packageJson = require("../package.json");

const root = path.resolve(__dirname, "..");
const cliPath = path.join(root, "bin", "termctl.js");
// The full parallel suite saturates Windows process startup with syntax-check,
// renderer-build, and TUI workers. Five seconds was below the observed clean
// startup time under that load and produced `status: null` despite a healthy CLI.
const CLI_TEST_TIMEOUT_MS = 15_000;

function runCli(args, cwd = root) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd,
    encoding: "utf8",
    timeout: CLI_TEST_TIMEOUT_MS
  });
}

test("CLI options resolve workspace paths and reject unknown flags", () => {
  const parsed = parseCliArgs(["--config", "work/control.json", "--check"], { cwd: "/tmp/project" });
  assert.equal(parsed.configPath, path.resolve("/tmp/project/work/control.json"));
  assert.equal(parsed.configExplicit, true);
  assert.equal(parsed.check, true);
  assert.throws(() => parseCliArgs(["--unknown"]), /unknown option/);
  assert.throws(() => parseCliArgs(["--config"]), /requires a file path/);
});

test("help and version exit without mounting the TUI", () => {
  const help = runCli(["--help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: termctl/);
  assert.match(help.stdout, /--check/);

  const version = runCli(["--version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.equal(version.stdout.trim(), packageJson.version);
});

test("check validates a workspace without starting sessions", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const validPath = path.join(directory, "valid.json");
  const invalidPath = path.join(directory, "invalid.json");
  fs.writeFileSync(validPath, JSON.stringify({ project: "Checked", sessions: [
    { id: "web", command: "this-command-must-not-run", cwd: "." }
  ], commands: [{ id: "tests", command: "also-must-not-run" }] }));
  fs.writeFileSync(invalidPath, JSON.stringify({
    sessions: [{ id: "bad id", command: "node" }],
    commands: [{ id: "also bad", command: "npm test" }]
  }));

  const valid = runCli(["--config", validPath, "--check"]);
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Workspace OK: Checked \(1 session\)/);
  assert.match(valid.stdout, /1 saved command/);

  const invalid = runCli(["--config", invalidPath, "--check"]);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /invalid session definition/);
  assert.match(invalid.stderr, /bad id/);
  assert.match(invalid.stderr, /invalid saved command definition/);
});

test("explicit missing and malformed workspaces fail closed", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-cli-fail-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const missing = path.join(directory, "missing.json");
  const malformed = path.join(directory, "broken.json");
  fs.writeFileSync(malformed, "{broken");

  const missingResult = runCli(["--config", missing]);
  assert.equal(missingResult.status, 1);
  assert.match(missingResult.stderr, /does not exist/);

  const malformedResult = runCli(["--config", malformed]);
  assert.equal(malformedResult.status, 1);
  assert.match(malformedResult.stderr, /invalid JSON/);
});

test("a live workspace lease blocks CLI startup before configured commands run", t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-cli-lock-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "workspace.json");
  fs.writeFileSync(configPath, JSON.stringify({ sessions: [
    { id: "must-not-start", command: "definitely-not-a-command", cwd: "." }
  ] }));
  fs.writeFileSync(leasePathFor(configPath), JSON.stringify({
    pid: process.pid,
    hostname: os.hostname(),
    token: "test-owner"
  }));

  const result = runCli(["--config", configPath]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /refusing to start duplicate sessions/);
  assert.doesNotMatch(result.stderr, /failed to start/);
});
