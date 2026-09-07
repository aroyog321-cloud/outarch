const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");

function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:cjs|js)$/.test(entry.name) ? [absolute] : [];
  });
}

const runtimeFiles = [path.join(root, "bin", "termctl.js"), ...sourceFiles(path.join(root, "src"))];
const electronContextFiles = new Set([
  path.join(root, "src", "groundstation", "main", "index.cjs"),
  path.join(root, "src", "groundstation", "preload", "index.cjs")
]);

test("every runtime JavaScript file passes Node syntax checking", () => {
  for (const file of runtimeFiles) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    assert.equal(result.status, 0, `${path.relative(root, file)}\n${result.stderr}`);
  }
});

test("every import-safe runtime module loads with its declared module system", async () => {
  for (const file of runtimeFiles) {
    if (file.endsWith(path.join("bin", "termctl.js"))) continue;
    // These modules intentionally require Electron globals that do not exist
    // in a plain Node process. They are still covered by syntax checks and
    // their transport/lifecycle collaborators are imported and tested below.
    if (electronContextFiles.has(file)) continue;
    if (file.endsWith(".cjs")) require(file);
    else await import(pathToFileURL(file).href);
  }
});

test("runtime clients stay behind the public EngineAPI boundary", () => {
  const engineApiSource = fs.readFileSync(path.join(root, "src", "engine", "index.cjs"), "utf8");
  const routerSource = fs.readFileSync(path.join(root, "src", "engine", "commandRouter.cjs"), "utf8");
  const tuiSource = sourceFiles(path.join(root, "src", "tui"))
    .map(file => fs.readFileSync(file, "utf8"))
    .join("\n");
  const groundstationSource = sourceFiles(path.join(root, "src", "groundstation"))
    .map(file => fs.readFileSync(file, "utf8"))
    .join("\n");
  const protocolSource = sourceFiles(path.join(root, "src", "protocol"))
    .map(file => fs.readFileSync(file, "utf8"))
    .join("\n");

  assert.doesNotMatch(engineApiSource, /this\.sessionEngine/);
  assert.doesNotMatch(routerSource, /this\.engine\.get\(/);
  assert.match(routerSource, /this\.engine\.getSnapshot\(/);
  assert.doesNotMatch(tuiSource, /SessionEngine|\.sessionEngine/);
  assert.doesNotMatch(groundstationSource, /SessionEngine|\.sessionEngine/);
  assert.doesNotMatch(protocolSource, /SessionEngine|\.sessionEngine/);
});

// T196 — the published package must not promise documents the repository does
// not contain. `npm pack` silently drops a missing entry, so nothing else
// catches a stale reference; this does.
test("every packaged path in package.json exists", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const missing = pkg.files.filter(entry => !fs.existsSync(path.join(root, entry)));
  assert.deepEqual(missing, [], `package.json "files" references paths that do not exist: ${missing.join(", ")}`);

  for (const [field, value] of [["main", pkg.main], ...Object.entries(pkg.bin || {})]) {
    assert.ok(fs.existsSync(path.join(root, value)), `package.json ${field} points at a missing file: ${value}`);
  }
});

// T193 — a runtime dependency ships to every user. One with no caller is
// install weight and supply-chain surface for nothing. Declared dependencies
// must be reachable from the runtime tree.
test("every runtime dependency has a caller in the shipped source", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const shipped = [
    ...runtimeFiles,
    ...sourceFiles(path.join(root, "integrations")),
    ...fs.readdirSync(path.join(root, "src", "groundstation", "renderer"))
      .filter(name => name.endsWith(".jsx"))
      .map(name => path.join(root, "src", "groundstation", "renderer", name))
  ];
  const source = shipped.map(file => fs.readFileSync(file, "utf8")).join("\n");
  // Fonts are imported by the renderer entry as side-effecting CSS packages.
  const styleOnly = new Set(["@fontsource-variable/inter", "@fontsource-variable/jetbrains-mono"]);

  const orphans = Object.keys(pkg.dependencies).filter(name => {
    if (styleOnly.has(name)) return false;
    return !source.includes(`"${name}`) && !source.includes(`'${name}`);
  });
  assert.deepEqual(orphans, [], `runtime dependencies with no caller: ${orphans.join(", ")}`);
});

// T156 — renderer components consume the authoritative `--mc-*` token family.
// The legacy `*-semantic` aliases exist only so the two `premium*` stylesheets
// keep resolving; new component code must not reach through them, because they
// are defined twice with different sources and drift under theme switches.
test("renderer components do not reach for the legacy *-semantic token aliases", () => {
  const rendererDir = path.join(root, "src", "groundstation", "renderer");
  const components = fs.readdirSync(rendererDir).filter(name => /\.(?:jsx|js)$/.test(name));
  for (const name of components) {
    const source = fs.readFileSync(path.join(rendererDir, name), "utf8");
    assert.doesNotMatch(
      source,
      /var\(--(?:text|surface|radius)-[a-z-]*semantic\)/,
      `${name} uses a legacy *-semantic alias; use the authoritative --mc-* token instead`
    );
  }
});
