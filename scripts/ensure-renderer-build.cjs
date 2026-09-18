"use strict";

// Build the desktop renderer only when its sources are newer than the last
// build. Opening OUTARCH again only brings the open window forward, and a
// rebuild on every launch would first empty dist/ underneath that running
// window. `--force` always builds; `npm run groundstation:build` still does.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const OUTPUT = path.join(root, "dist", "groundstation", "renderer", "index.html");
const INPUTS = [
  path.join(root, "src", "groundstation", "renderer"),
  path.join(root, "vite.groundstation.config.mjs"),
  path.join(root, "package.json"),
  path.join(root, "package-lock.json")
];

// The newest modification time under a path. A folder's own time counts too,
// because deleting or renaming a file changes only the folder.
function newestModification(target, fileSystem = fs) {
  let stat;
  try { stat = fileSystem.statSync(target); } catch { return 0; }
  let newest = stat.mtimeMs;
  if (stat.isDirectory()) {
    for (const entry of fileSystem.readdirSync(target)) {
      if (entry === "node_modules") continue;
      newest = Math.max(newest, newestModification(path.join(target, entry), fileSystem));
    }
  }
  return newest;
}

function isBuildStale({ output = OUTPUT, inputs = INPUTS, fileSystem = fs } = {}) {
  let built;
  try { built = fileSystem.statSync(output).mtimeMs; } catch { return true; }
  return inputs.some(input => newestModification(input, fileSystem) > built);
}

function build() {
  const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
  if (!fs.existsSync(vite)) {
    console.error("Vite is not installed. Run npm install, then open OUTARCH again.");
    return 1;
  }
  const result = spawnSync(process.execPath, [vite, "build", "--config", "vite.groundstation.config.mjs"], { cwd: root, stdio: "inherit" });
  return result.status ?? 1;
}

if (require.main === module) {
  const force = process.argv.includes("--force");
  if (!force && !isBuildStale()) {
    console.log("OUTARCH renderer is up to date.");
    process.exit(0);
  }
  process.exit(build());
}

module.exports = { isBuildStale, newestModification };
