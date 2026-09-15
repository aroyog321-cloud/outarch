// The redesigned notifications: the toast stack, the list on the status tape,
// the one-toast feedback for starting a worker, and the Notifications settings.
//
//   npx electron scripts/visual/shot-notifications-v2.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const OUT = path.join(repoRoot, "artifacts", "visual", "2026-09-15-notifications");

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

let sequence = 0;
const notice = (over) => ({
  type: "notification:new",
  notification: {
    id: `notice-shot-${++sequence}`,
    rank: 0,
    projectId: "p",
    data: {},
    actions: [],
    at: Date.now(),
    delivery: { windows: false, windowsReason: "app-focused", sound: null, soundBy: null, focused: true, quiet: false, collapsed: false },
    ...over
  }
});

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, frame: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error") errors.push(String(event.message).slice(0, 300)); });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2800);
  const js = source => window.webContents.executeJavaScript(source);
  const shoot = async name => { window.webContents.invalidate(); await wait(700); if (latest) { fs.writeFileSync(path.join(OUT, `${name}.png`), latest.toPNG()); console.log("wrote", name); } };
  const send = message => window.webContents.send("mission-control:event", message);

  // 1 · A failure, a service coming up, and an error printed by a running worker.
  send(notice({ kind: "worker.error", tone: "warning", title: "Web dev server reported an error", body: "TypeError: Cannot read properties of undefined (reading 'map') at src/routes/orders.tsx:42", workerId: "web", workerName: "Web dev server", actions: [{ id: "focus-worker", label: "Open terminal" }, { id: "restart", label: "Restart" }] }));
  await wait(250);
  send(notice({ kind: "service.ready", tone: "success", title: "Storefront is ready", body: "http://localhost:5173 · Frontend on port 5173", workerId: "storefront", workerName: "Storefront", data: { serviceId: "svc-1", url: "http://localhost:5173", port: 5173, generation: 1 }, actions: [{ id: "open-service", label: "Open" }, { id: "copy-url", label: "Copy URL" }, { id: "restart", label: "Restart" }, { id: "stop", label: "Stop" }] }));
  await wait(250);
  send(notice({ kind: "port.conflict", tone: "critical", title: "Billing couldn't start", body: "Port 4000 is already in use by another process.", workerId: "billing", workerName: "Billing", data: { port: 4000 }, actions: [{ id: "inspect-port", label: "Who's using it" }, { id: "focus-worker", label: "Open terminal" }, { id: "restart", label: "Restart" }], delivery: { windows: false, sound: "alert", soundBy: "app", focused: true } }));
  await wait(1200);
  await shoot("01-stack");
  console.log("stack:", JSON.stringify(await js(`(function(){ return [].slice.call(document.querySelectorAll('.mc-toast')).map(function(t){ var r=t.getBoundingClientRect(); return { title: (t.querySelector('.mc-toast__title')||{}).textContent, source: (t.querySelector('.mc-toast__source')||{}).textContent, buttons: [].slice.call(t.querySelectorAll('.mc-toast__actions button')).map(function(b){ return b.textContent; }), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] }; }); })();`)));

  // 2 · Two more: the stack keeps three and offers the rest.
  send(notice({ kind: "tests.completed", tone: "info", title: "Unit tests finished", body: "85 passed, 1 failed", workerId: "tests", workerName: "Unit tests (watch)", actions: [{ id: "focus-worker", label: "Open terminal" }] }));
  send(notice({ kind: "agent.awaitingApproval", tone: "warning", title: "Claude is waiting for you", body: "Wants to write src/auth/session.ts", workerId: "agent-claude", workerName: "Claude", actions: [{ id: "review", label: "Review" }] }));
  await wait(900);
  await shoot("02-overflow");
  console.log("more:", await js(`(function(){ var m=document.querySelector('.mc-toast-more'); return m ? m.textContent : null; })();`));

  // 3 · The notification list on the status tape.
  await js(`(function(){ [].slice.call(document.querySelectorAll('.mc-toast__dismiss')).forEach(function(b){ b.click(); }); return true; })();`);
  await wait(500);
  await js(`(function(){ var b=document.querySelector('.status-bar-premium__bell'); if(!b) return false; b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); b.click(); return true; })();`);
  await wait(900);
  await shoot("03-tape-list");
  console.log("tape bell:", JSON.stringify(await js(`(function(){ var b=document.querySelector('.status-bar-premium__bell'); var t=document.querySelector('.notification-tray'); return { bell: b && b.getAttribute('aria-label'), items: t ? t.querySelectorAll('.notification-tray__item').length : 0 }; })();`)));
  await js(`(function(){ document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true; })();`);
  await wait(500);

  // 4 · Starting a worker yourself: one compact toast, not "Working…" and "Done".
  for (let i = 0; i < 15 && !(await js("!!document.querySelector('.terminal-grid')")); i++) {
    await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Workspace"]');if(b)b.click();return !!b;})();`);
    await wait(700);
  }
  await wait(800);
  console.log("start clicked:", await js(`(function(){ var b=document.querySelector('.terminal-pane__run--start'); if(!b) return false; b.click(); return true; })();`));
  await wait(900);
  await shoot("04-action-feedback");
  console.log("feedback:", JSON.stringify(await js(`(function(){ return [].slice.call(document.querySelectorAll('.mc-toast')).map(function(t){ return { cls: t.className, text: t.textContent.trim().slice(0, 80) }; }); })();`)));

  // 5 · Settings › Notifications.
  await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Settings"]');if(b)b.click();return !!b;})();`);
  await wait(1500);
  await js(`(function(){ var b=[].slice.call(document.querySelectorAll('.hub__rail-item')).find(function(x){ return /Notifications/.test(x.textContent); }); if(b) b.click(); return !!b; })();`);
  await wait(1200);
  await shoot("05-settings");
  console.log("errors:", JSON.stringify(errors.slice(0, 6)));
  window.destroy();
  app.quit();
});
