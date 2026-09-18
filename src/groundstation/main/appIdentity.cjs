"use strict";

// Where OUTARCH keeps what it saves, and how Windows knows the app by name.
//
// Before OUTARCH the desktop app never named itself, so Electron filed its
// settings, encrypted keys and window layouts under the generic "Electron"
// folder in AppData, a folder every other unpackaged Electron program shares.
// The app now has a folder of its own. The first launch copies what the app
// had saved there. It never moves or deletes the old copy, and if the copy
// cannot finish, the app keeps using the old folder so nothing is lost.

const fs = require("node:fs");
const path = require("node:path");
const { APP_USER_MODEL_ID, PRODUCT_NAME } = require("../../brand/index.cjs");

const USER_DATA_FOLDER = PRODUCT_NAME;
const LEGACY_USER_DATA_FOLDER = "Electron";
const HOME_MARKER = "outarch-home.json";

// Files the app writes into its data folder.
const CARRIED_FILES = Object.freeze([
  "projects.json",
  "ai-keys.json",
  "ai-preferences.json",
  "mcp-gateway-credentials.json",
  "mobile-companion-credentials.json",
  "mission-ai-credentials.json",
  "mission-ai-credentials.json.carried-over",
  "mission-ai-preferences.json",
  "plugin-platform.json",
  "recovery-diagnostics.json",
  // Chromium keeps the key that OS credential encryption wraps in this file.
  // The encrypted files above can only be read back alongside it.
  "Local State"
]);
// Window layouts, favourites and interface preferences (renderer storage).
const CARRIED_FOLDERS = Object.freeze(["Local Storage"]);
// A lock file belongs to whichever process has the store open; it is
// recreated on open and cannot be read while held.
const SKIPPED_NAMES = new Set(["LOCK"]);
// Only a folder holding one of these was written by this app. Any other
// Electron program's folder is left alone.
const OWNERSHIP_EVIDENCE = Object.freeze([
  "projects.json",
  "ai-keys.json",
  "mcp-gateway-credentials.json",
  "mobile-companion-credentials.json",
  "recovery-diagnostics.json",
  "plugin-platform.json"
]);

const describe = error => String(error?.message || error || "unknown error").slice(0, 240);

function copyEntries({ from, to, fileSystem }) {
  const carried = [];
  for (const name of CARRIED_FILES) {
    const source = path.join(from, name);
    const target = path.join(to, name);
    if (!fileSystem.existsSync(source) || fileSystem.existsSync(target)) continue;
    fileSystem.copyFileSync(source, target);
    carried.push(name);
  }
  for (const name of CARRIED_FOLDERS) {
    const source = path.join(from, name);
    const target = path.join(to, name);
    if (!fileSystem.existsSync(source) || fileSystem.existsSync(target)) continue;
    fileSystem.cpSync(source, target, {
      recursive: true,
      errorOnExist: false,
      filter: entry => !SKIPPED_NAMES.has(path.basename(entry))
    });
    carried.push(name);
  }
  return carried;
}

function writeMarker({ directory, legacy, carried, fileSystem, now }) {
  const record = { product: PRODUCT_NAME, createdAt: now().toISOString(), carriedFrom: carried.length ? legacy : null, carried };
  fileSystem.writeFileSync(path.join(directory, HOME_MARKER), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

/**
 * Decide the folder the app stores its data in, carrying the pre-OUTARCH
 * data across on first launch.
 *
 * Returns { directory, source, carried, error? } where source is one of
 * "override" (OUTARCH_USER_DATA_DIR), "home" (already set up), "carried"
 * (set up now, with the old data), "new" (set up now, nothing to carry) or
 * "legacy" (the copy failed; the old folder stays in use).
 */
function resolveUserDataHome({ appData, env = process.env, fileSystem = fs, now = () => new Date(), pid = process.pid }) {
  const override = typeof env.OUTARCH_USER_DATA_DIR === "string" ? env.OUTARCH_USER_DATA_DIR.trim() : "";
  if (override && path.isAbsolute(override)) return { directory: override, source: "override", carried: [] };

  const directory = path.join(appData, USER_DATA_FOLDER);
  const legacy = path.join(appData, LEGACY_USER_DATA_FOLDER);
  const marker = path.join(directory, HOME_MARKER);
  if (fileSystem.existsSync(marker)) return { directory, source: "home", carried: [] };

  const legacyOwned = OWNERSHIP_EVIDENCE.some(name => fileSystem.existsSync(path.join(legacy, name)));

  // A folder that exists without the marker was not made by this function
  // (nothing else should create it); fill in what it lacks and adopt it.
  if (fileSystem.existsSync(directory)) {
    try {
      const carried = legacyOwned ? copyEntries({ from: legacy, to: directory, fileSystem }) : [];
      writeMarker({ directory, legacy, carried, fileSystem, now });
      return { directory, source: carried.length ? "carried" : "new", carried };
    } catch (error) {
      return legacyOwned
        ? { directory: legacy, source: "legacy", carried: [], error: describe(error) }
        : { directory, source: "new", carried: [], error: describe(error) };
    }
  }

  // Otherwise the copy is made beside the final folder and renamed into place
  // only once it is complete, so a crash mid-copy never leaves a half-filled
  // folder that a later launch would mistake for the real one.
  const staging = `${directory}.incoming-${pid}`;
  try {
    fileSystem.rmSync(staging, { recursive: true, force: true });
    fileSystem.mkdirSync(staging, { recursive: true });
    const carried = legacyOwned ? copyEntries({ from: legacy, to: staging, fileSystem }) : [];
    writeMarker({ directory: staging, legacy, carried, fileSystem, now });
    try {
      fileSystem.renameSync(staging, directory);
    } catch (error) {
      // A second launch at the same moment may have finished first.
      if (!fileSystem.existsSync(marker)) throw error;
      fileSystem.rmSync(staging, { recursive: true, force: true });
      return { directory, source: "home", carried: [] };
    }
    return { directory, source: carried.length ? "carried" : "new", carried };
  } catch (error) {
    try { fileSystem.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    if (legacyOwned) return { directory: legacy, source: "legacy", carried: [], error: describe(error) };
    try {
      fileSystem.mkdirSync(directory, { recursive: true });
    } catch { /* Electron creates it on first write */ }
    return { directory, source: "new", carried: [], error: describe(error) };
  }
}

/**
 * Windows shows a toast under the name and icon registered for the app's
 * AppUserModelID. An unpackaged app registers them under HKCU itself; without
 * this a toast is headed with a raw id. Best effort and non-blocking.
 */
function registerWindowsAppIdentity({ execFile, iconPath, platform = process.platform }) {
  if (platform !== "win32" || typeof execFile !== "function") return Promise.resolve(false);
  const key = `HKCU\\Software\\Classes\\AppUserModelId\\${APP_USER_MODEL_ID}`;
  const values = [["DisplayName", PRODUCT_NAME], ["IconUri", iconPath]];
  const run = ([name, data]) => new Promise(resolve => {
    try {
      execFile("reg.exe", ["add", key, "/v", name, "/t", "REG_SZ", "/d", data, "/f"], { windowsHide: true, timeout: 5000 }, error => resolve(!error));
    } catch {
      resolve(false);
    }
  });
  return Promise.all(values.map(run)).then(results => results.every(Boolean));
}

module.exports = {
  CARRIED_FILES,
  CARRIED_FOLDERS,
  HOME_MARKER,
  LEGACY_USER_DATA_FOLDER,
  OWNERSHIP_EVIDENCE,
  USER_DATA_FOLDER,
  registerWindowsAppIdentity,
  resolveUserDataHome
};
