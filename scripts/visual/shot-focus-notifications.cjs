// Focus mode notifications: the service-ready toast with all its actions, a
// port-conflict toast, and the bell on the focus deck with its list open.
//
//   npx electron scripts/visual/shot-focus-notifications.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const OUT = path.join(repoRoot, "artifacts", "visual", "2026-09-14-notify");

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const event = value => ({ type: "workspace:event", event: { id: `e-${Math.random()}`, severity: "info", projectId: "default", timestamp: Date.now(), ...value } });

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, frame: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  const errors = [];
  window.webContents.on("console-message", item => { if (item.level === "error") errors.push(String(item.message).slice(0, 300)); });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2600);
  const js = source => window.webContents.executeJavaScript(source);
  const shoot = async name => { window.webContents.invalidate(); await wait(700); if (latest) { fs.writeFileSync(path.join(OUT, `${name}.png`), latest.toPNG()); console.log("wrote", name); } };

  for (let i = 0; i < 15 && !(await js("!!document.querySelector('.terminal-grid')")); i++) {
    await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Workspace"]');if(b)b.click();return !!b;})();`);
    await wait(700);
  }
  await js(`(function(){ var b=document.querySelector('.workspace-focus-mode'); if(b && !b.classList.contains('is-current')) b.click(); return true; })();`);
  await wait(1500);
  await shoot("01-focus-quiet");

  window.webContents.send("mission-control:event", event({ type: "service.ready", workerId: "web", workerName: "Web dev server", runId: "r1", title: "Web dev server is ready", description: "http://localhost:5173 is accepting connections.", data: { serviceId: "svc_default_web_5173_", url: "http://localhost:5173", port: 5173, generation: 1, kind: "frontend" } }));
  await wait(400);
  window.webContents.send("mission-control:event", event({ type: "port.conflict", severity: "error", workerId: "api", workerName: "API gateway", runId: "r2", title: "Port 3000 is already in use", description: "Error: listen EADDRINUSE: address already in use :::3000", data: { port: 3000, movedOn: false } }));
  await wait(1200);
  await shoot("02-focus-toasts");
  console.log("toasts:", JSON.stringify(await js(`(function(){ return [].slice.call(document.querySelectorAll('.mc-toast')).map(function(t){ var r=t.getBoundingClientRect(); return { text: t.querySelector('.mc-toast__message').textContent, buttons: [].slice.call(t.querySelectorAll('.mc-toast__actions button')).map(function(b){return b.textContent;}), box: [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)] }; }); })();`)));
  console.log("bell:", JSON.stringify(await js(`(function(){ var b=document.querySelector('.workspace-notifications'); if(!b) return null; var r=b.getBoundingClientRect(); var deck=document.querySelector('.workspace-toolbar-v2'); return { label: b.getAttribute('aria-label'), box:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], deckOpacity: getComputedStyle(deck).opacity }; })();`)));

  // Dismiss the toasts, then find them again from the bell.
  await js(`(function(){ [].slice.call(document.querySelectorAll('.mc-toast__dismiss')).forEach(function(b){ b.click(); }); return true; })();`);
  await wait(600);
  await js(`(function(){ var b=document.querySelector('.workspace-notifications'); if(!b) return false; b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); b.click(); return true; })();`);
  await wait(900);
  await shoot("03-focus-bell-open");
  console.log("tray:", JSON.stringify(await js(`(function(){ var t=document.querySelector('.notification-tray'); if(!t) return null; var r=t.getBoundingClientRect(); return { items: t.querySelectorAll('.notification-tray__item').length, needs: !!t.querySelector('.notification-tray__needs'), box:[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth }; })();`)));
  console.log("errors:", JSON.stringify(errors.slice(0, 5)));
  window.destroy();
  app.quit();
});
