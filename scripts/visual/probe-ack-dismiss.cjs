// Acknowledging a worker's alert takes its problem toasts down with it.
//   npx electron scripts/visual/probe-ack-dismiss.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const repoRoot = path.resolve(__dirname, "..", "..");

const requests = [];
ipcMain.handle("mission-control:request", async (_event, message) => {
  requests.push(message.method);
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error") errors.push(String(event.message).slice(0, 200)); });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2800);
  const js = source => window.webContents.executeJavaScript(source);
  const notice = (id, workerId, workerName, kind, tone, title) => window.webContents.send("mission-control:event", { type: "notification:new", notification: { id, kind, tone, rank: 2, title, body: "TypeError: Cannot read properties of undefined", workerId, workerName, actions: [{ id: "focus-worker", label: "Open terminal" }], data: {}, delivery: {} } });
  notice("n-tests", "tests", "Unit tests (watch)", "worker.error", "warning", "Unit tests (watch) reported an error");
  notice("n-api", "api", "API gateway", "worker.error", "warning", "API gateway reported an error");
  await wait(300);
  console.log("at 300ms:", JSON.stringify(await js("[].slice.call(document.querySelectorAll('.mc-toast .mc-toast__title')).map(function(t){ return t.textContent; })")));
  await wait(1500);
  const titles = () => js(`[].slice.call(document.querySelectorAll('.mc-toast .mc-toast__title')).map(function(t){ return t.textContent; })`);
  console.log("before:", JSON.stringify(await titles()));
  console.log("clicked:", await js(`(function(){
    var buttons=[].slice.call(document.querySelectorAll('button')).filter(function(b){ return b.textContent.trim()==='Acknowledge'; });
    var row=buttons.find(function(b){ var r=b.closest('article,li,section,div'); for(var el=b; el; el=el.parentElement){ if(/Unit tests \\(watch\\)/.test(el.textContent) && el.textContent.length < 600) return true; } return false; });
    if(!row) return 'no button (' + buttons.length + ')';
    row.click(); return 'ok';
  })()`));
  await wait(1500);
  console.log("after:", JSON.stringify(await titles()));
  console.log("dispatched:", requests.filter(m => m === "action.dispatch").length, "errors:", JSON.stringify(errors.slice(0, 4)));
  window.destroy();
  app.quit();
});
