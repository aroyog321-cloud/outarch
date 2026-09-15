// Does a toast that plays a chime still become visible, and does the chime schedule?
//   npx electron scripts/visual/probe-toast-sound.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const repoRoot = path.resolve(__dirname, "..", "..");

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error" || event.level === "warning") errors.push(String(event.message).slice(0, 200)); });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2800);
  const js = source => window.webContents.executeJavaScript(source);
  const send = (id, sound) => window.webContents.send("mission-control:event", { type: "notification:new", notification: { id, kind: "port.conflict", tone: "critical", title: `Toast ${id}`, body: "Port 4000 is already in use.", workerId: "billing", workerName: "Billing", actions: [{ id: "focus-worker", label: "Open terminal" }], data: {}, delivery: { sound, soundBy: sound ? "app" : null } } });
  send("with-sound", "alert");
  await wait(1500);
  send("without-sound", null);
  await wait(1500);
  console.log(JSON.stringify(await js(`(function(){
    return { toasts: [].slice.call(document.querySelectorAll('.mc-toast')).map(function(t){ return { title: t.querySelector('.mc-toast__title').textContent, visible: t.classList.contains('is-visible'), opacity: getComputedStyle(t).opacity }; }),
      audio: typeof AudioContext };
  })();`), null, 1));
  console.log("console:", JSON.stringify(errors.slice(0, 5)));
  window.destroy();
  app.quit();
});
