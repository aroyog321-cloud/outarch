#!/usr/bin/env node
// Build OUTARCH as an MSIX package (and an .msixbundle) for the Microsoft Store.
//
//   npm run package:store                 Store upload: .msixbundle (+ .msix per architecture)
//   npm run package:msix:test             local test build (install: npm run package:msix:install-test)
//   node scripts/msix/build-msix.mjs --help
//
// Steps:
//   1. build the renderer (vite)
//   2. stage only what the desktop app runs: src/ (without the renderer
//      sources), dist/groundstation/renderer, and node-pty's runtime files for
//      the target architecture; package.json is rewritten with
//      "outarchDistribution": "microsoft-store" so the app lets the Store own
//      updates (src/groundstation/main/distribution.cjs)
//   3. @electron/packager wraps it with the pinned Electron as OUTARCH.exe
//   4. Electron fuses: Node's --inspect flags and NODE_OPTIONS are turned off;
//      RunAsNode stays on because node-pty forks a helper with it
//   5. AppxManifest.xml + Store logos + resources.pri (makepri)
//   6. makeappx pack per architecture, makeappx bundle across them
//
// The Store signs what it distributes, so a Store build is left unsigned.
// --sign <pfx> signs the result with signtool for sideloading tests.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { packager } = await import("@electron/packager");
const { flipFuses, FuseVersion, FuseV1Options } = require("@electron/fuses");
const {
  ARCHITECTURES,
  TEST_PUBLISHER,
  buildAppxManifest,
  msixVersion,
  validateStoreConfig
} = require("./manifest.cjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGING = path.join(ROOT, "packaging", "msix");
const DEFAULT_OUT = path.join(ROOT, "out", "msix");

function usage() {
  console.log(`Usage: node scripts/msix/build-msix.mjs [options]

  --mode store|test     store (default): Partner Center identity from
                        packaging/msix/store.config.json, placeholders refused.
                        test: publisher "CN=OUTARCH Local Test", for
                        npm run package:msix:install-test (Developer Mode) or
                        --sign with a matching self-signed certificate.
  --arch x64[,arm64]    architectures (default: store.config.json "architectures")
  --out <dir>           output folder (default: out/msix)
  --config <file>       identity config (default: packaging/msix/store.config.json)
  --sign <pfx>          sign each package with signtool (sideloading only);
                        password from OUTARCH_MSIX_CERT_PASSWORD
  --publisher <CN=...>  override the publisher (must equal the signing cert subject)
  --skip-renderer-build reuse dist/groundstation/renderer as it is
  --no-bundle           skip the .msixbundle
`);
}

function parseArgs(argv) {
  const options = { mode: "store", config: path.join(PACKAGING, "store.config.json"), arch: null, out: DEFAULT_OUT, sign: null, publisher: null, rendererBuild: true, bundle: true };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      const next = argv[++index];
      if (!next || next.startsWith("--")) throw new Error(`${argument} needs a value`);
      return next;
    };
    switch (argument) {
      case "--mode": options.mode = value(); break;
      case "--arch": options.arch = value().split(",").map(item => item.trim()).filter(Boolean); break;
      case "--out": options.out = path.resolve(value()); break;
      case "--config": options.config = path.resolve(value()); break;
      case "--sign": options.sign = path.resolve(value()); break;
      case "--publisher": options.publisher = value(); break;
      case "--skip-renderer-build": options.rendererBuild = false; break;
      case "--no-bundle": options.bundle = false; break;
      case "--help": case "-h": usage(); process.exit(0); break;
      default: throw new Error(`unknown option ${argument}`);
    }
  }
  if (!["store", "test"].includes(options.mode)) throw new Error("--mode is store or test");
  return options;
}

function step(message) {
  console.log(`\n== ${message}`);
}

function run(file, args, { cwd = ROOT, quiet = false } = {}) {
  const result = spawnSync(file, args, { cwd, encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw new Error(`${path.basename(file)} could not start: ${result.error.message}`);
  if (result.status !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
    throw new Error(`${path.basename(file)} ${args[0] || ""} failed (exit ${result.status})\n${output.split(/\r?\n/).slice(-40).join("\n")}`);
  }
  if (!quiet && result.stdout?.trim()) console.log(result.stdout.trim().split(/\r?\n/).slice(-6).join("\n"));
  return result.stdout || "";
}

// makeappx, makepri and signtool ship with the Windows 10/11 SDK.
function windowsSdkTool(name) {
  const hostArch = process.arch === "arm64" ? "arm64" : "x64";
  const roots = [
    process.env.OUTARCH_WINDOWS_SDK_BIN,
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "Windows Kits", "10", "bin"),
    path.join(process.env.ProgramFiles || "C:\\Program Files", "Windows Kits", "10", "bin")
  ].filter(Boolean);
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const direct = path.join(root, hostArch, name);
    const versions = fs.readdirSync(root)
      .filter(entry => /^10\.\d+\.\d+\.\d+$/.test(entry))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const version of versions) {
      const candidate = path.join(root, version, hostArch, name);
      if (fs.existsSync(candidate)) return candidate;
    }
    if (fs.existsSync(direct)) return direct;
  }
  throw new Error(`${name} was not found. Install the Windows 11 SDK (https://developer.microsoft.com/windows/downloads/windows-sdk/) or set OUTARCH_WINDOWS_SDK_BIN.`);
}

function copyTree(from, to, filter = () => true) {
  fs.cpSync(from, to, { recursive: true, filter: source => filter(source) });
}

function stageApp({ stage, arch, pkg }) {
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });

  // The desktop app's own code. The renderer sources are already bundled into
  // dist/groundstation/renderer; nothing in the main process reads them.
  const rendererSources = path.join(ROOT, "src", "groundstation", "renderer");
  copyTree(path.join(ROOT, "src"), path.join(stage, "src"), source => source !== rendererSources);
  copyTree(path.join(ROOT, "dist", "groundstation", "renderer"), path.join(stage, "dist", "groundstation", "renderer"));
  for (const file of ["THIRD_PARTY_LICENSES.md", "SECURITY.md"]) {
    if (fs.existsSync(path.join(ROOT, file))) fs.copyFileSync(path.join(ROOT, file), path.join(stage, file));
  }

  // node-pty is the only runtime dependency of the main process. Only its
  // JavaScript and the prebuilt binaries for this architecture ship; tests,
  // source maps, debug symbols and other platforms are left out.
  const ptySource = path.join(ROOT, "node_modules", "node-pty");
  const ptyTarget = path.join(stage, "node_modules", "node-pty");
  const ptyPackage = JSON.parse(fs.readFileSync(path.join(ptySource, "package.json"), "utf8"));
  const prebuilds = path.join(ptySource, "prebuilds", `win32-${arch}`);
  if (!fs.existsSync(path.join(prebuilds, "pty.node")) || !fs.existsSync(path.join(prebuilds, "conpty.node"))) {
    throw new Error(`node-pty ${ptyPackage.version} has no prebuilt Windows ${arch} binaries in ${path.relative(ROOT, prebuilds)}`);
  }
  fs.mkdirSync(ptyTarget, { recursive: true });
  for (const file of ["package.json", "LICENSE", "README.md"]) {
    if (fs.existsSync(path.join(ptySource, file))) fs.copyFileSync(path.join(ptySource, file), path.join(ptyTarget, file));
  }
  copyTree(path.join(ptySource, "lib"), path.join(ptyTarget, "lib"), source => {
    if (fs.statSync(source).isDirectory()) return true;
    return source.endsWith(".js") && !source.endsWith(".test.js");
  });
  copyTree(prebuilds, path.join(ptyTarget, "prebuilds", `win32-${arch}`), source => !source.endsWith(".pdb"));

  // The package.json the app reads at runtime (its version, and that the
  // Store owns its updates).
  const shipped = {
    name: pkg.name,
    productName: "OUTARCH",
    version: pkg.version,
    description: pkg.description,
    type: pkg.type,
    main: "src/groundstation/main/index.cjs",
    outarchDistribution: "microsoft-store",
    license: pkg.license || "SEE LICENSE IN THIRD_PARTY_LICENSES.md",
    dependencies: { "node-pty": ptyPackage.version }
  };
  fs.writeFileSync(path.join(stage, "package.json"), `${JSON.stringify(shipped, null, 2)}\n`);
}

async function packageElectron({ stage, arch, pkg, config, outDir }) {
  const electronVersion = require("electron/package.json").version;
  const year = new Date().getFullYear();
  const [appPath] = await packager({
    dir: stage,
    out: outDir,
    name: config.executableName,
    executableName: config.executableName,
    platform: "win32",
    arch,
    electronVersion,
    appVersion: pkg.version,
    buildVersion: msixVersion(pkg.version),
    appCopyright: `Copyright (c) ${year} ${config.publisherDisplayName}`,
    icon: path.join(ROOT, "src", "brand", "outarch.ico"),
    // Every file stays a real file: node-pty forks a helper script and starts
    // a worker by path, and both are simplest to trust outside an archive.
    asar: false,
    prune: false,
    overwrite: true,
    quiet: true,
    win32metadata: {
      CompanyName: config.publisherDisplayName,
      FileDescription: config.displayName,
      ProductName: config.displayName,
      InternalName: config.executableName,
      OriginalFilename: `${config.executableName}.exe`
    }
  });
  return appPath;
}

async function hardenExecutable(executable) {
  await flipFuses(executable, {
    version: FuseVersion.V1,
    // node-pty's Windows backend forks a helper with ELECTRON_RUN_AS_NODE.
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false
  });
}

function writeLayoutExtras({ layout, config, pkg, arch, publisher, makepri, workDir }) {
  const manifest = buildAppxManifest({ config, version: pkg.version, architecture: arch, publisher });
  fs.writeFileSync(path.join(layout, "AppxManifest.xml"), manifest, "utf8");
  copyTree(path.join(PACKAGING, "Assets"), path.join(layout, "Assets"));

  // resources.pri maps Assets\Square44x44Logo.png to the scale / target-size
  // variants. It is indexed from the logos and manifest only, not the whole
  // Electron folder.
  const priRoot = path.join(workDir, `pri-${arch}`);
  fs.rmSync(priRoot, { recursive: true, force: true });
  fs.mkdirSync(priRoot, { recursive: true });
  copyTree(path.join(PACKAGING, "Assets"), path.join(priRoot, "Assets"));
  fs.writeFileSync(path.join(priRoot, "AppxManifest.xml"), manifest, "utf8");
  const priConfig = path.join(workDir, `priconfig-${arch}.xml`);
  run(makepri, ["createconfig", "/cf", priConfig, "/dq", "en-US", "/pv", "10.0.0", "/o"], { quiet: true });
  // The default config splits scales and languages into resources.scale-*.pri
  // for separate resource packages. OUTARCH ships one package, so every
  // variant goes into the one resources.pri.
  const priXml = fs.readFileSync(priConfig, "utf8");
  fs.writeFileSync(priConfig, priXml.replace(/<packaging>[\s\S]*?<\/packaging>/, ""), "utf8");
  run(makepri, ["new", "/pr", priRoot, "/cf", priConfig, "/mn", path.join(priRoot, "AppxManifest.xml"), "/of", path.join(layout, "resources.pri"), "/o"], { quiet: true });
}

function sign({ signtool, file, pfx }) {
  const args = ["sign", "/fd", "SHA256", "/f", pfx];
  if (process.env.OUTARCH_MSIX_CERT_PASSWORD) args.push("/p", process.env.OUTARCH_MSIX_CERT_PASSWORD);
  args.push(file);
  run(signtool, args, { quiet: true });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (process.platform !== "win32") throw new Error("MSIX packages are built on Windows (makeappx and makepri come with the Windows SDK).");

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const config = JSON.parse(fs.readFileSync(options.config, "utf8"));
  const version = msixVersion(pkg.version);
  const archs = options.arch || config.architectures || ["x64"];
  for (const arch of archs) if (!ARCHITECTURES.includes(arch)) throw new Error(`unsupported architecture ${arch} (use ${ARCHITECTURES.join(", ")})`);

  let publisher = options.publisher || (options.mode === "test" ? TEST_PUBLISHER : config.publisher);
  const problems = validateStoreConfig({ ...config, publisher }, { strict: options.mode === "store" });
  if (problems.length) {
    throw new Error(`${path.relative(ROOT, options.config)} is not ready for a ${options.mode} build:\n  - ${problems.join("\n  - ")}\nSee MICROSOFT_STORE.md, "Reserve the app in Partner Center".`);
  }
  if (!fs.existsSync(path.join(PACKAGING, "Assets", "Square44x44Logo.scale-100.png"))) {
    throw new Error("packaging/msix/Assets is missing. Run: python scripts/brand/build-store-assets.py");
  }

  const makeappx = windowsSdkTool("makeappx.exe");
  const makepri = windowsSdkTool("makepri.exe");
  const signtool = options.sign ? windowsSdkTool("signtool.exe") : null;
  if (options.sign && !fs.existsSync(options.sign)) throw new Error(`certificate ${options.sign} does not exist`);

  const outDir = path.join(options.out, options.mode);
  const workDir = path.join(options.out, ".work", options.mode);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  console.log(`OUTARCH ${pkg.version} -> MSIX ${version} (${options.mode}) for ${archs.join(", ")}`);
  console.log(`Identity ${config.identityName}  Publisher ${publisher}`);

  if (options.rendererBuild) {
    step("Building the renderer");
    run(process.execPath, [path.join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--config", "vite.groundstation.config.mjs", "--logLevel", "warn"]);
  }
  if (!fs.existsSync(path.join(ROOT, "dist", "groundstation", "renderer", "index.html"))) {
    throw new Error("dist/groundstation/renderer/index.html is missing; run npm run groundstation:build");
  }

  const packages = [];
  for (const arch of archs) {
    step(`Staging the app for ${arch}`);
    const stage = path.join(workDir, `stage-${arch}`, "app");
    stageApp({ stage, arch, pkg });

    step(`Packaging Electron for ${arch}`);
    const packagerOut = path.join(workDir, `electron-${arch}`);
    fs.rmSync(packagerOut, { recursive: true, force: true });
    const appPath = await packageElectron({ stage, arch, pkg, config, outDir: packagerOut });
    const executable = path.join(appPath, `${config.executableName}.exe`);
    if (!fs.existsSync(executable)) throw new Error(`the packaged app has no ${config.executableName}.exe`);
    await hardenExecutable(executable);

    step(`Writing the package layout for ${arch}`);
    writeLayoutExtras({ layout: appPath, config, pkg, arch, publisher, makepri, workDir });
    if (signtool) sign({ signtool, file: executable, pfx: options.sign });

    step(`makeappx pack (${arch})`);
    const msix = path.join(outDir, `OUTARCH_${version}_${arch}.msix`);
    run(makeappx, ["pack", "/d", appPath, "/p", msix, "/o"]);
    if (signtool) sign({ signtool, file: msix, pfx: options.sign });
    packages.push(msix);
  }

  let bundle = null;
  if (options.bundle) {
    step("makeappx bundle");
    const bundleSource = path.join(workDir, "bundle");
    fs.rmSync(bundleSource, { recursive: true, force: true });
    fs.mkdirSync(bundleSource, { recursive: true });
    for (const file of packages) fs.copyFileSync(file, path.join(bundleSource, path.basename(file)));
    bundle = path.join(outDir, `OUTARCH_${version}.msixbundle`);
    run(makeappx, ["bundle", "/d", bundleSource, "/p", bundle, "/bv", version, "/o"]);
    if (signtool) sign({ signtool, file: bundle, pfx: options.sign });
  }

  const report = {
    product: "OUTARCH",
    mode: options.mode,
    version: pkg.version,
    msixVersion: version,
    identityName: config.identityName,
    publisher,
    architectures: archs,
    signed: Boolean(signtool),
    builtAt: new Date().toISOString(),
    host: `${os.type()} ${os.release()}`,
    files: [...packages, ...(bundle ? [bundle] : [])].map(file => ({
      file: path.relative(ROOT, file),
      bytes: fs.statSync(file).size
    }))
  };
  fs.writeFileSync(path.join(outDir, "build-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  step("Done");
  for (const entry of report.files) console.log(`  ${entry.file}  ${(entry.bytes / 1024 / 1024).toFixed(1)} MB`);
  if (options.mode === "store") {
    console.log("\nUpload the .msixbundle in Partner Center > your app > Packages. The Store signs it.");
  } else {
    console.log("\nInstall it for testing: npm run package:msix:install-test");
  }
}

main().catch(error => {
  console.error(`\nMSIX build failed: ${error.message}`);
  process.exit(1);
});
