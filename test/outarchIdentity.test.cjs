"use strict";

// OUTARCH's desktop identity: its own data folder (with the pre-OUTARCH data
// carried across, never moved), one running instance, the window icon, and
// the name Windows shows on a toast.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const {
  HOME_MARKER,
  registerWindowsAppIdentity,
  resolveUserDataHome
} = require("../src/groundstation/main/appIdentity.cjs");
const brand = require("../src/brand/index.cjs");

const root = path.resolve(__dirname, "..");
const main = fs.readFileSync(path.join(root, "src/groundstation/main/index.cjs"), "utf8");

function appData(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-appdata-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function seedLegacy(base) {
  const legacy = path.join(base, "Electron");
  fs.mkdirSync(path.join(legacy, "Local Storage", "leveldb"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "projects.json"), "{\"projects\":[1]}\n");
  fs.writeFileSync(path.join(legacy, "ai-keys.json"), "{\"keys\":\"sealed\"}\n");
  fs.writeFileSync(path.join(legacy, "Local State"), "{\"os_crypt\":{}}\n");
  fs.writeFileSync(path.join(legacy, "Local Storage", "leveldb", "000001.log"), "layout");
  fs.writeFileSync(path.join(legacy, "Local Storage", "leveldb", "LOCK"), "");
  // Chromium's own cache is rebuilt, never carried.
  fs.mkdirSync(path.join(legacy, "Cache"), { recursive: true });
  fs.writeFileSync(path.join(legacy, "Cache", "data_0"), "cache");
  return legacy;
}

test("a first launch with no earlier data makes OUTARCH's own folder", t => {
  const base = appData(t);
  const home = resolveUserDataHome({ appData: base, env: {} });
  assert.equal(home.source, "new");
  assert.equal(home.directory, path.join(base, "OUTARCH"));
  assert.deepEqual(home.carried, []);
  assert.ok(fs.existsSync(path.join(home.directory, HOME_MARKER)));
  assert.equal(resolveUserDataHome({ appData: base, env: {} }).source, "home");
});

test("the pre-OUTARCH data is copied across once and the old folder is left intact", t => {
  const base = appData(t);
  const legacy = seedLegacy(base);
  const home = resolveUserDataHome({ appData: base, env: {} });
  assert.equal(home.source, "carried");
  assert.deepEqual(home.carried.sort(), ["Local State", "Local Storage", "ai-keys.json", "projects.json"]);
  assert.equal(fs.readFileSync(path.join(home.directory, "projects.json"), "utf8"), "{\"projects\":[1]}\n");
  assert.equal(fs.readFileSync(path.join(home.directory, "Local State"), "utf8"), "{\"os_crypt\":{}}\n", "the encryption key travels with the sealed keys");
  assert.equal(fs.readFileSync(path.join(home.directory, "Local Storage", "leveldb", "000001.log"), "utf8"), "layout");
  assert.equal(fs.existsSync(path.join(home.directory, "Local Storage", "leveldb", "LOCK")), false, "a held lock file is not copied");
  assert.equal(fs.existsSync(path.join(home.directory, "Cache")), false, "caches are rebuilt, not carried");
  // Copy, never move.
  assert.ok(fs.existsSync(path.join(legacy, "projects.json")));
  assert.ok(fs.existsSync(path.join(legacy, "ai-keys.json")));
  const marker = JSON.parse(fs.readFileSync(path.join(home.directory, HOME_MARKER), "utf8"));
  assert.equal(marker.product, "OUTARCH");
  assert.equal(marker.carriedFrom, legacy);
  // A later change in the old folder is not copied again.
  fs.writeFileSync(path.join(legacy, "projects.json"), "{\"projects\":[2]}\n");
  assert.equal(resolveUserDataHome({ appData: base, env: {} }).source, "home");
  assert.equal(fs.readFileSync(path.join(home.directory, "projects.json"), "utf8"), "{\"projects\":[1]}\n");
  assert.equal(fs.readdirSync(base).some(name => name.includes(".incoming-")), false, "no staging folder is left behind");
});

test("another Electron program's folder is never read", t => {
  const base = appData(t);
  const legacy = path.join(base, "Electron");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "Local State"), "{}");
  fs.writeFileSync(path.join(legacy, "Preferences"), "{}");
  const home = resolveUserDataHome({ appData: base, env: {} });
  assert.equal(home.source, "new");
  assert.equal(fs.existsSync(path.join(home.directory, "Local State")), false);
});

test("a copy that cannot finish keeps the old folder in use and leaves no half-made folder", t => {
  const base = appData(t);
  const legacy = seedLegacy(base);
  const failing = { ...fs, copyFileSync(source, target) { if (source.endsWith("ai-keys.json")) throw new Error("disk full"); return fs.copyFileSync(source, target); } };
  const home = resolveUserDataHome({ appData: base, env: {}, fileSystem: failing });
  assert.equal(home.source, "legacy");
  assert.equal(home.directory, legacy);
  assert.match(home.error, /disk full/);
  assert.equal(fs.existsSync(path.join(base, "OUTARCH")), false);
  assert.equal(fs.readdirSync(base).some(name => name.includes(".incoming-")), false);
  // The next launch tries again and succeeds.
  assert.equal(resolveUserDataHome({ appData: base, env: {} }).source, "carried");
});

test("a folder that already exists is adopted without overwriting what it holds", t => {
  const base = appData(t);
  seedLegacy(base);
  const directory = path.join(base, "OUTARCH");
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "projects.json"), "{\"projects\":[\"newer\"]}\n");
  const home = resolveUserDataHome({ appData: base, env: {} });
  assert.equal(home.directory, directory);
  assert.ok(!home.carried.includes("projects.json"));
  assert.ok(home.carried.includes("ai-keys.json"));
  assert.equal(fs.readFileSync(path.join(directory, "projects.json"), "utf8"), "{\"projects\":[\"newer\"]}\n");
});

test("a second launch that finished first is accepted, and an explicit folder wins", t => {
  const base = appData(t);
  seedLegacy(base);
  const racing = {
    ...fs,
    renameSync(from, to) {
      fs.mkdirSync(to, { recursive: true });
      fs.writeFileSync(path.join(to, HOME_MARKER), "{}");
      throw Object.assign(new Error("exists"), { code: "EPERM" });
    }
  };
  const home = resolveUserDataHome({ appData: base, env: {}, fileSystem: racing });
  assert.equal(home.source, "home");
  assert.equal(fs.readdirSync(base).some(name => name.includes(".incoming-")), false);

  const portable = path.join(base, "portable-data");
  assert.deepEqual(resolveUserDataHome({ appData: base, env: { OUTARCH_USER_DATA_DIR: portable } }), { directory: portable, source: "override", carried: [] });
  assert.equal(resolveUserDataHome({ appData: base, env: { OUTARCH_USER_DATA_DIR: "relative/path" } }).source, "home");
});

test("Windows learns the toast name and logo; other platforms are left alone", async () => {
  const calls = [];
  const execFile = (file, args, options, callback) => { calls.push({ file, args, options }); callback(null); };
  assert.equal(await registerWindowsAppIdentity({ execFile, iconPath: "C:\\app\\outarch.png", platform: "linux" }), false);
  assert.equal(calls.length, 0);
  assert.equal(await registerWindowsAppIdentity({ execFile, iconPath: "C:\\app\\outarch.png", platform: "win32" }), true);
  assert.deepEqual(calls.map(call => call.args), [
    ["add", "HKCU\\Software\\Classes\\AppUserModelId\\OUTARCH.Desktop", "/v", "DisplayName", "/t", "REG_SZ", "/d", "OUTARCH", "/f"],
    ["add", "HKCU\\Software\\Classes\\AppUserModelId\\OUTARCH.Desktop", "/v", "IconUri", "/t", "REG_SZ", "/d", "C:\\app\\outarch.png", "/f"]
  ]);
  assert.ok(calls.every(call => call.file === "reg.exe" && call.options.windowsHide === true));
  const failing = (file, args, options, callback) => callback(new Error("denied"));
  assert.equal(await registerWindowsAppIdentity({ execFile: failing, iconPath: "x", platform: "win32" }), false);
});

test("the brand files the desktop app points at exist", () => {
  assert.equal(brand.PRODUCT_NAME, "OUTARCH");
  for (const file of Object.values(brand.ASSETS)) assert.ok(fs.existsSync(file), `${path.relative(root, file)} is missing`);
  assert.ok(fs.existsSync(path.join(root, "src/brand/outarch.ico")));
  assert.equal(fs.readFileSync(path.join(root, "src/brand/outarch.ico")).readUInt16LE(4), 10, "the icon carries ten sizes, 16 to 256");
});

test("the main process settles its folder before the lock, wears the icon and hands a second launch to the open window", () => {
  const setPath = main.indexOf('app.setPath("userData", userDataHome.directory);');
  const lock = main.indexOf("app.requestSingleInstanceLock()");
  assert.ok(setPath > 0 && lock > setPath, "the lock is keyed on the data folder, so the folder comes first");
  assert.ok(main.indexOf("app.setPath(") === setPath, "no earlier path decision");
  assert.match(main, /if \(process\.platform === "win32"\) app\.setAppUserModelId\(APP_USER_MODEL_ID\);/);
  assert.match(main, /async function start\(\) \{\n  if \(!holdsInstanceLock\) return;/);
  assert.match(main, /app\.on\("second-instance", \([^)]*\) => \{[\s\S]{0,480}mainWindow\.restore\(\);[\s\S]{0,60}mainWindow\.focus\(\);/);
  // The website's sign-in link arrives as a second launch and is handed on.
  assert.match(main, /app\.on\("second-instance", \(_event, argv = \[\]\) => \{[\s\S]{0,240}accountService\?\.handleDeepLink\(link\)/);
  assert.equal((main.match(/icon: BRAND_ASSETS\.windowIcon,/g) || []).length, 2, "the main window and every pop-out carry the icon");
  assert.match(main, /title: PRODUCT_NAME,/);
  assert.match(main, /title: `\$\{spec\.workerName\} — \$\{PRODUCT_NAME\}`/);
  assert.doesNotMatch(main, /Mission Control/);
});
