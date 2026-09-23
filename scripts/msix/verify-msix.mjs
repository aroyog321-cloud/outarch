#!/usr/bin/env node
// Check a built OUTARCH MSIX before it is installed or uploaded.
//
//   npm run package:msix:verify                       newest package in out/msix/store, else out/msix/test
//   node scripts/msix/verify-msix.mjs <file.msix|file.msixbundle> [--store]
//
// Unpacks the package with makeappx and checks what the Store and the app
// depend on: the manifest identity and declarations, every logo the manifest
// names, OUTARCH.exe and its fuses, the app's own files, node-pty's native
// binaries for the package's architecture, and that nothing private
// (keys, certificates, env files, debug symbols, tests) went in.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { getCurrentFuseWire, FuseV1Options, FuseState } = require("@electron/fuses");
const { PLACEHOLDER_IDENTITY_NAME, PLACEHOLDER_PUBLISHER, TEST_PUBLISHER, msixVersion } = require("./manifest.cjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function windowsSdkTool(name) {
  const root = process.env.OUTARCH_WINDOWS_SDK_BIN || path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Windows Kits", "10", "bin");
  const hostArch = process.arch === "arm64" ? "arm64" : "x64";
  const versions = fs.existsSync(root) ? fs.readdirSync(root).filter(entry => /^10\./.test(entry)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true })) : [];
  for (const version of versions) {
    const candidate = path.join(root, version, hostArch, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`${name} was not found (Windows SDK)`);
}

function makeappx(args) {
  const result = spawnSync(windowsSdkTool("makeappx.exe"), args, { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`makeappx ${args[0]} failed:\n${(result.stdout || "") + (result.stderr || "")}`.slice(-3000));
}

function newestPackage() {
  for (const mode of ["store", "test"]) {
    const dir = path.join(ROOT, "out", "msix", mode);
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir).filter(name => /\.msix(bundle)?$/.test(name)).map(name => path.join(dir, name));
    const bundle = files.find(file => file.endsWith(".msixbundle"));
    if (bundle || files.length) return { file: bundle || files[0], store: mode === "store" };
  }
  throw new Error("No package in out/msix. Run npm run package:store or npm run package:msix:test first.");
}

function attribute(xmlText, element, name) {
  const tag = new RegExp(`<${element}\\b[^>]*>`, "s").exec(xmlText)?.[0] || "";
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

function walk(dir, visit, base = dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, visit, base);
    else visit(path.relative(base, full).replace(/\\/g, "/"), full);
  }
}

async function verifyPackage(file, { store }) {
  const problems = [];
  const expect = (condition, message) => { if (!condition) problems.push(message); };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-msix-verify-"));
  try {
    makeappx(["unpack", "/p", file, "/d", dir, "/o"]);
    const manifest = fs.readFileSync(path.join(dir, "AppxManifest.xml"), "utf8");
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    const arch = attribute(manifest, "Identity", "ProcessorArchitecture");
    const publisher = attribute(manifest, "Identity", "Publisher");
    const name = attribute(manifest, "Identity", "Name");

    expect(attribute(manifest, "Identity", "Version") === msixVersion(pkg.version), `manifest version is not ${msixVersion(pkg.version)}`);
    expect(["x64", "arm64"].includes(arch), `unexpected architecture ${arch}`);
    expect(/EntryPoint="Windows\.FullTrustApplication"/.test(manifest), "the app is not declared full trust");
    expect(/rescap:Capability Name="runFullTrust"/.test(manifest), "runFullTrust is not declared");
    expect(/<desktop6:FileSystemWriteVirtualization>disabled</.test(manifest), "file-system write virtualization is not disabled");
    expect(/<uap3:Protocol Name="outarch"/.test(manifest), "the outarch:// link is not registered");
    if (store) {
      expect(name !== PLACEHOLDER_IDENTITY_NAME, "Identity Name is the placeholder");
      expect(publisher !== PLACEHOLDER_PUBLISHER && publisher !== TEST_PUBLISHER, "Publisher is a placeholder or the local test publisher");
    }

    // Every logo the manifest names resolves to at least one qualified file.
    const assets = fs.readdirSync(path.join(dir, "Assets"));
    for (const [, logo] of manifest.matchAll(/"Assets\\([A-Za-z0-9]+)\.png"/g)) {
      expect(assets.some(asset => asset.startsWith(`${logo}.`)), `no image for Assets\\${logo}.png`);
    }
    for (const [, logo] of manifest.matchAll(/<Logo>Assets\\([A-Za-z0-9]+)\.png<\/Logo>/g)) {
      expect(assets.some(asset => asset.startsWith(`${logo}.`)), `no image for Assets\\${logo}.png`);
    }
    expect(fs.existsSync(path.join(dir, "resources.pri")), "resources.pri is missing");
    expect(!fs.readdirSync(dir).some(entry => /^resources\..+\.pri$/.test(entry)), "split resources.*.pri files belong to resource packages, not this one");

    const exe = path.join(dir, `${attribute(manifest, "Application", "Executable")}`);
    expect(fs.existsSync(exe), `the entry executable ${path.basename(exe)} is missing`);
    if (fs.existsSync(exe)) {
      const wire = await getCurrentFuseWire(exe);
      expect(wire[FuseV1Options.RunAsNode] === FuseState.ENABLE, "RunAsNode must stay on (node-pty forks a helper with it)");
      expect(wire[FuseV1Options.EnableNodeCliInspectArguments] === FuseState.DISABLE, "--inspect is not disabled");
      expect(wire[FuseV1Options.EnableNodeOptionsEnvironmentVariable] === FuseState.DISABLE, "NODE_OPTIONS is not disabled");
    }

    const app = path.join(dir, "resources", "app");
    const shipped = JSON.parse(fs.readFileSync(path.join(app, "package.json"), "utf8"));
    expect(shipped.outarchDistribution === "microsoft-store", "the shipped package.json does not hand updates to the Store");
    expect(shipped.version === pkg.version, `the shipped version ${shipped.version} is not ${pkg.version}`);
    for (const required of [
      "src/groundstation/main/index.cjs",
      "src/groundstation/main/distribution.cjs",
      "src/groundstation/preload/index.cjs",
      "src/engine/index.cjs",
      "src/service/mobileWebCompanion.html",
      "src/brand/outarch.ico",
      "dist/groundstation/renderer/index.html",
      "node_modules/node-pty/lib/index.js",
      "node_modules/node-pty/lib/conpty_console_list_agent.js",
      "node_modules/node-pty/lib/worker/conoutSocketWorker.js",
      `node_modules/node-pty/prebuilds/win32-${arch}/pty.node`,
      `node_modules/node-pty/prebuilds/win32-${arch}/conpty.node`,
      `node_modules/node-pty/prebuilds/win32-${arch}/conpty_console_list.node`,
      `node_modules/node-pty/prebuilds/win32-${arch}/winpty-agent.exe`,
      `node_modules/node-pty/prebuilds/win32-${arch}/winpty.dll`,
      `node_modules/node-pty/prebuilds/win32-${arch}/conpty/conpty.dll`,
      `node_modules/node-pty/prebuilds/win32-${arch}/conpty/OpenConsole.exe`
    ]) {
      expect(fs.existsSync(path.join(app, required)), `resources/app/${required} is missing`);
    }
    expect(!fs.existsSync(path.join(app, "src", "groundstation", "renderer")), "renderer sources shipped (only the built bundle belongs)");

    const forbidden = /(^|\/)(\.env(\..*)?|.*\.(pem|key|pfx|p12|jks|keystore|pdb)|\.git\/.*|.*\.test\.(c?js|mjs))$/i;
    walk(dir, relative => { if (forbidden.test(relative)) problems.push(`must not ship: ${relative}`); });

    return { file, arch, name, publisher, problems };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const args = process.argv.slice(2);
  let target = args.find(arg => !arg.startsWith("--"));
  let store = args.includes("--store");
  if (!target) ({ file: target, store } = newestPackage());
  target = path.resolve(target);
  console.log(`Verifying ${path.relative(ROOT, target)}${store ? " (Store rules)" : ""}`);

  const packages = [];
  let cleanup = null;
  if (target.endsWith(".msixbundle")) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-msixbundle-verify-"));
    cleanup = dir;
    makeappx(["unbundle", "/p", target, "/d", dir, "/o"]);
    for (const name of fs.readdirSync(dir)) if (name.endsWith(".msix")) packages.push(path.join(dir, name));
    if (!packages.length) throw new Error("the bundle holds no .msix");
  } else {
    packages.push(target);
  }
  let failed = 0;
  try {
    for (const file of packages) {
      const result = await verifyPackage(file, { store });
      const label = `${path.basename(file)} [${result.arch}] ${result.name}`;
      if (result.problems.length) {
        failed += 1;
        console.log(`FAIL ${label}`);
        for (const problem of result.problems) console.log(`  - ${problem}`);
      } else {
        console.log(`ok   ${label}`);
      }
    }
  } finally {
    if (cleanup) fs.rmSync(cleanup, { recursive: true, force: true });
  }
  if (failed) process.exit(1);
  console.log("The package is complete.");
}

main().catch(error => {
  console.error(`verify failed: ${error.message}`);
  process.exit(1);
});
