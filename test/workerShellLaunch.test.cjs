"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// workerForm.js is an ES module in the renderer bundle. Loading it through a
// tiny transform keeps these semantics under test without adding a build step.
function loadWorkerForm() {
  const source = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/workerForm.js"), "utf8");
  const commonjs = source.replace(/^export function /gm, "function ");
  const exported = [...source.matchAll(/^export function (\w+)/gm)].map(match => match[1]);
  const context = { module: { exports: {} }, exports: {} };
  vm.createContext(context);
  vm.runInContext(`${commonjs}\nmodule.exports = { ${exported.join(", ")} };`, context);
  return context.module.exports;
}

const { buildShellLaunch, buildSimpleWorkerDefinition } = loadWorkerForm();

test("a start command is handed to the shell whole, never split on spaces", () => {
  const launch = buildShellLaunch("npm run dev -- --host 0.0.0.0", "win32");
  assert.equal(launch.command, "powershell.exe");
  // The whole command line survives as one argument.
  assert.equal(launch.args.at(-1), "npm run dev -- --host 0.0.0.0");
  assert.equal(launch.args.at(-2), "-Command");
});

test("quotes, paths with spaces, Unicode and .cmd shims survive unchanged", () => {
  const cases = [
    'cd "C:\\Program Files\\My App" ; .\\run.cmd',
    "npm.cmd run build -- --out \"dist folder\"",
    "python -c \"print('héllo wörld — ok')\"",
    "echo 'single quotes stay'",
    "git commit -m \"fix: don't split this\""
  ];
  for (const text of cases) {
    const launch = buildShellLaunch(text, "win32");
    assert.equal(launch.args.at(-1), text, `command text must be preserved exactly: ${text}`);
  }
});

test("an empty command opens a plain interactive shell rather than running nothing", () => {
  const launch = buildShellLaunch("", "win32");
  assert.equal(launch.command, "powershell.exe");
  assert.equal(launch.args.includes("-Command"), false);
  assert.equal(launch.args.includes("-NoExit"), true, "the terminal stays open");
});

test("the shell is kept open so a failed command still leaves a usable prompt", () => {
  assert.equal(buildShellLaunch("exit 1", "win32").args.includes("-NoExit"), true);
  const posix = buildShellLaunch("exit 1", "linux");
  assert.match(posix.args.at(-1), /exec bash -i$/);
});

test("null bytes and oversized commands are refused", () => {
  assert.throws(() => buildShellLaunch("echo \0", "win32"), /null bytes/);
  assert.throws(() => buildShellLaunch("x".repeat(4097), "win32"), /4096/);
});

test("the two-field create derives a collision-safe id and the project folder", () => {
  const definition = buildSimpleWorkerDefinition(
    { name: "Storefront", startCommand: "npm run dev" },
    { platform: "win32", existingIds: [] }
  );
  assert.equal(definition.id, "Storefront");
  assert.equal(definition.name, "Storefront");
  assert.equal(definition.cwd, ".", "the open project folder, not a typed path");
  assert.equal(definition.autoStart, false);
  assert.equal(definition.args.at(-1), "npm run dev");

  // A second terminal with the same name must not collide with the first.
  const second = buildSimpleWorkerDefinition(
    { name: "Storefront", startCommand: "npm run dev" },
    { platform: "win32", existingIds: ["Storefront"] }
  );
  assert.equal(second.id, "Storefront-2");
});

test("a name that is only punctuation still yields a usable worker id", () => {
  const definition = buildSimpleWorkerDefinition(
    { name: "··· ✱ ···", startCommand: "" },
    { platform: "win32", existingIds: [] }
  );
  assert.match(definition.id, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.equal(definition.name, "··· ✱ ···", "the display name keeps what was typed");
});

test("a missing name is refused rather than silently named for you", () => {
  assert.throws(
    () => buildSimpleWorkerDefinition({ name: "  ", startCommand: "npm run dev" }, { platform: "win32" }),
    /Name is required/
  );
});
