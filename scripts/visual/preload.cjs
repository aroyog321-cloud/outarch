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

contextBridge.exposeInMainWorld("missionControl", Object.freeze({
  version: 1,
  request: (method, params = {}) => ipcRenderer.invoke("mission-control:request", { version: 1, id: `h-${Date.now()}-${Math.random()}`, method, params }),
  openExternal: () => Promise.resolve({ ok: true }),
  // The harness has no main-process clipboard; copying is a no-op that succeeds.
  copyText: () => Promise.resolve(true),
  setWindowChrome: mode => ipcRenderer.invoke("mission-control:set-window-chrome", mode).catch(() => false),
  subscribe: callback => { subscribers.add(callback); return () => subscribers.delete(callback); }
}));
