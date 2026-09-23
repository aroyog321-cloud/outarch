// Harness-only preload. Mirrors the shape of src/groundstation/preload/index.cjs
// (version / request / subscribe / openExternal) so the renderer runs its real
// code path, but every request is answered by the harness fixture router.
const { contextBridge, ipcRenderer } = require("electron");

const subscribers = new Set();
ipcRenderer.on("mission-control:event", (_event, message) => {
  for (const callback of [...subscribers]) {
    try { callback(message); } catch { /* one observer must not starve another */ }
  }
});

// Account and update states for screenshots: see accountFixtures.cjs.
const accountKind = process.env.OUTARCH_HARNESS_ACCOUNT || "none";
const updateKind = process.env.OUTARCH_HARNESS_UPDATE || "";
const accountFixtures = require("./accountFixtures.cjs");
const accountBridge = accountKind === "none" ? undefined : Object.freeze({
  status: () => Promise.resolve(accountFixtures.status(accountKind)),
  signIn: () => Promise.resolve(accountFixtures.status("signing-in")),
  cancelSignIn: () => Promise.resolve(accountFixtures.status("signed-out")),
  signOut: () => Promise.resolve(accountFixtures.status("signed-out")),
  refresh: () => Promise.resolve(accountFixtures.status(accountKind)),
  openPortal: () => Promise.resolve(true),
  onChange: () => () => {}
});
const updatesBridge = accountKind === "none" ? undefined : Object.freeze({
  status: () => Promise.resolve(accountFixtures.updateStatus(updateKind)),
  check: () => Promise.resolve(accountFixtures.updateStatus(updateKind)),
  download: () => Promise.resolve(accountFixtures.updateStatus("ready")),
  install: () => Promise.resolve(accountFixtures.updateStatus("ready")),
  onChange: () => () => {}
});

// The first-launch agreement. By default the harness has agreed to the current
// policies so every other screen renders; OUTARCH_HARNESS_LEGAL=none shows the
// agreement, and =old shows it as "the terms have changed".
const legalKind = process.env.OUTARCH_HARNESS_LEGAL || "current";
const currentLegalVersion = (require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "..", "src", "groundstation", "renderer", "legal", "outarchPolicies.js"), "utf8").match(/LEGAL_VERSION = "([^"]+)"/) || [])[1] || "";
let legalRecord = legalKind === "none" ? null : { version: legalKind === "old" ? "2026-01-01" : currentLegalVersion, acceptedAt: "2026-09-23T09:30:00.000Z", documents: ["terms", "eula"], appVersion: "2.19.0" };
const legalBridge = Object.freeze({
  status: () => Promise.resolve({ acceptance: legalRecord }),
  accept: request => { legalRecord = { version: request.version, documents: request.documents, acceptedAt: new Date().toISOString(), appVersion: "2.19.0" }; return Promise.resolve({ acceptance: legalRecord }); }
});

contextBridge.exposeInMainWorld("missionControl", Object.freeze({
  version: 1,
  account: accountBridge,
  legal: legalBridge,
  updates: updatesBridge,
  request: (method, params = {}) => ipcRenderer.invoke("mission-control:request", { version: 1, id: `h-${Date.now()}-${Math.random()}`, method, params }),
  openExternal: () => Promise.resolve({ ok: true }),
  // The harness has no main-process clipboard; copying is a no-op that succeeds.
  copyText: () => Promise.resolve(true),
  setWindowChrome: mode => ipcRenderer.invoke("mission-control:set-window-chrome", mode).catch(() => false),
  subscribe: callback => { subscribers.add(callback); return () => subscribers.delete(callback); }
}));
