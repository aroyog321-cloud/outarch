const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const electronPath = require("electron");
const root = path.resolve(__dirname, "../..");
const stamp = new Date().toISOString().replaceAll(":", "-").replace(/\.\d{3}Z$/, "Z");
const requested = process.argv[2];
const outputDirectory = path.resolve(root, requested || path.join("artifacts", "visual", stamp));
const main = path.join(root, "src", "groundstation", "main", "index.cjs");
const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-visual-"));
const fixturePath = path.join(fixtureDirectory, "termctl.config.json");

// Visual acceptance must not restore the operator's recent project, mutate its
// activity history, or launch configured ConPTY processes. The real EngineAPI
// still loads and owns this representative workspace; every worker is manual.
fs.writeFileSync(fixturePath, `${JSON.stringify({
  version: 1,
  project: "Visual acceptance",
  sessions: [
    { id: "shell", name: "Project shell", command: "powershell.exe", args: ["-NoLogo"], cwd: root, autoStart: false },
    { id: "git-status", name: "Git status", command: "git", args: ["status", "--short", "--branch"], cwd: root, autoStart: false },
    { id: "agent-claude", name: "Claude Code agent", command: "claude", cwd: root, autoStart: false },
    { id: "agent-gemini", name: "Gemini CLI agent", command: "gemini", cwd: root, autoStart: false }
  ]
}, null, 2)}\n`, "utf8");

function cleanupFixture() {
  // Delete only the directory returned by mkdtemp directly beneath the OS
  // temp directory. Engine activity and lease sidecars stay inside it.
  if (path.dirname(fixtureDirectory) === path.resolve(os.tmpdir())) {
    fs.rmSync(fixtureDirectory, { recursive: true, force: true });
  }
}

const child = spawn(electronPath, [main, "--config", fixturePath], {
  cwd: root,
  env: {
    ...process.env,
    MISSION_CONTROL_VISUAL_CAPTURE_DIR: outputDirectory
  },
  stdio: "inherit",
  windowsHide: true
});

child.once("error", error => {
  cleanupFixture();
  console.error(`Could not start the Groundstation capture harness: ${error.message}`);
  process.exitCode = 1;
});

child.once("exit", code => {
  cleanupFixture();
  if (code === 0) console.log(`Visual contact sheet: ${path.join(outputDirectory, "index.html")}`);
  process.exitCode = code ?? 1;
});
