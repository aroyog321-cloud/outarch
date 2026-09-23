"use strict";

// How this copy of OUTARCH was installed, and what that changes.
//
// OUTARCH reaches people two ways: as a folder (a ZIP the operator extracted,
// or a git checkout) that runs on the Electron in node_modules, and as a
// Microsoft Store package (MSIX). The Store package is built by
// scripts/msix/build-msix.mjs, which writes
// "outarchDistribution": "microsoft-store" into the package.json it ships.
// Windows also marks every process started from an installed package, which
// Electron reports as process.windowsStore.
//
// Inside the package Windows owns three things the folder build does itself:
//   - updates: the Store installs new versions, so the built-in updater must
//     not download or unpack anything (the install folder is read-only anyway);
//   - the app's identity: the taskbar, Start and toasts know the app by its
//     package, so the process must not claim a different AppUserModelID;
//   - the outarch:// link: the package manifest registers it, so nothing is
//     written to HKCU pointing at a versioned install folder.

const path = require("node:path");

const STORE_DISTRIBUTION = "microsoft-store";
const FOLDER_DISTRIBUTION = "folder";

function resolveDistribution({ packageJson = {}, windowsStore = process.windowsStore, env = process.env } = {}) {
  const declared = typeof packageJson?.outarchDistribution === "string" ? packageJson.outarchDistribution : "";
  // A development override, so the Store behaviour can be exercised from a checkout.
  const override = typeof env?.OUTARCH_DISTRIBUTION === "string" ? env.OUTARCH_DISTRIBUTION.trim() : "";
  const store = windowsStore === true || declared === STORE_DISTRIBUTION || override === STORE_DISTRIBUTION;
  return Object.freeze({
    kind: store ? STORE_DISTRIBUTION : FOLDER_DISTRIBUTION,
    store,
    packaged: windowsStore === true
  });
}

function isInside(child, parent) {
  if (!child || !parent) return false;
  const relative = path.win32.relative(parent.toLowerCase(), child.toLowerCase());
  return relative === "" || (!relative.startsWith("..") && !path.win32.isAbsolute(relative));
}

/**
 * The folder a Store launch should start in. Windows starts a packaged app
 * from Start or a protocol link in System32 or in its own read-only install
 * folder; a terminal opened there is useless, so such a launch starts in the
 * operator's home folder instead. A launch from a real folder is left alone.
 */
function storeLaunchDirectory({ cwd, home, executable, env = process.env } = {}) {
  if (!cwd || !home) return null;
  const systemRoot = env?.SystemRoot || env?.windir || "C:\\Windows";
  const installFolder = executable ? path.win32.dirname(executable) : "";
  const unhelpful = isInside(cwd, systemRoot)
    || (installFolder && isInside(cwd, installFolder))
    || /\\WindowsApps(\\|$)/i.test(cwd);
  return unhelpful ? home : null;
}

module.exports = {
  FOLDER_DISTRIBUTION,
  STORE_DISTRIBUTION,
  resolveDistribution,
  storeLaunchDirectory
};
