const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const extensionRoot = path.join(__dirname, "..", "integrations", "vscode");
const { projectId, projectRelativePath, resolveProjectFile } = require("../integrations/vscode/bridgeModel.cjs");

test("VS Code extension owns the expected URI handler and bounded capabilities", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extensionRoot, "package.json"), "utf8"));
  const source = fs.readFileSync(path.join(extensionRoot, "extension.cjs"), "utf8");

  assert.equal(`${manifest.publisher}.${manifest.name}`, "mission-control.bridge");
  assert.equal(manifest.main, "./extension.cjs");
  assert.ok(manifest.activationEvents.includes("onUri"));
  assert.match(source, /registerUriHandler/);
  assert.match(source, /host: "127\.0\.0\.1"/);
  assert.match(source, /MAX_MESSAGE_BYTES = 64 \* 1024/);
  assert.match(source, /MAX_DIAGNOSTICS = 50/);
  assert.match(source, /relativeFile/);
  assert.match(source, /resolveProjectFile/);
  assert.match(source, /command:open-file/);
  assert.match(source, /workbench\.actions\.view\.problems/);
  assert.match(source, /terminals\.slice\(0, 32\).*ownership/s);
  assert.match(source, /mission-control-managed/);
  assert.match(source, /vscode-owned/);
  assert.match(source, /vscode\.window\.createTerminal/);
  assert.match(source, /managed\.terminal\.sendText/);
  assert.match(source, /This terminal is not managed by OUTARCH/);
  assert.doesNotMatch(source, /node-pty|child_process|onDidWriteTerminalData/);
  assert.doesNotMatch(source, /terminal\.processId/);
});

test("VS Code editor commands reject parent traversal and resolved symlink escape", () => {
  const realpathSync = value => {
    if (value === "/project") return "/project";
    if (value === "/project/src/app.js") return "/project/src/app.js";
    if (value === "/project/link/secret.txt") return "/outside/secret.txt";
    throw new Error("missing");
  };

  assert.equal(resolveProjectFile("/project", "src/app.js", { platform: "linux", realpathSync }), "/project/src/app.js");
  assert.equal(resolveProjectFile("/project", "../secret.txt", { platform: "linux", realpathSync }), null);
  assert.equal(resolveProjectFile("/project", "link/secret.txt", { platform: "linux", realpathSync }), null);
  assert.equal(projectRelativePath("C:\\work\\app", "C:\\work\\app\\src\\main.ts", "win32"), "src/main.ts");
  assert.equal(projectId("C:\\WORK\\App", "win32"), projectId("c:\\work\\app", "win32"));
});

test("VS Code extension source passes Node syntax checking without loading the VS Code host", () => {
  const result = spawnSync(process.execPath, ["--check", path.join(extensionRoot, "extension.cjs")], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});
