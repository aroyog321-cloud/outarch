// Focus mode on a real, composited window with the native controls overlay:
// does anything on the canvas still sit under minimise / maximise / close, and
// is there still somewhere to drag the window from?
//   npx electron scripts/visual/probe-focus-titlebar.cjs --out <dir>
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(flag("out", path.join(repoRoot, "artifacts", "visual", "focus-titlebar")));
const OVERLAY = { color: "#0a0b0d", symbolColor: "#cbd0dc", height: 42 };

let window = null;
ipcMain.handle("mission-control:request", async (_event, message) => ({
  version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params)
}));
let chrome = { mode: "standard", color: OVERLAY.color };
ipcMain.handle("mission-control:set-window-chrome", async (_event, request) => {
  const input = typeof request === "string" ? { mode: request } : request;
  chrome = { mode: input.mode || chrome.mode, color: input.color || chrome.color };
  console.log("OVERLAY <-", JSON.stringify(chrome));
  window.setTitleBarOverlay({ ...OVERLAY, color: chrome.color, height: chrome.mode === "focus" ? 32 : 42 });
  return true;
});
const wait = ms => new Promise(r => setTimeout(r, ms));

async function measure(label) {
  const result = await window.webContents.executeJavaScript(`(() => {
    const overlay = navigator.windowControlsOverlay;
    const free = overlay ? overlay.getTitlebarAreaRect() : null;
    const main = document.querySelector('.main-area');
    const grid = document.querySelector('.terminal-grid');
    const before = main ? getComputedStyle(main, '::before') : null;
    const controls = free ? { left: Math.round(free.right), bottom: Math.round(free.height) } : null;
    const under = [];
    if (controls) {
      for (const el of document.querySelectorAll('.terminal-pane button, .terminal-pane [role="button"], .terminal-pane__header strong')) {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.right > controls.left && r.top < controls.bottom) under.push((el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 30) + ' @' + Math.round(r.left) + ',' + Math.round(r.top));
      }
    }
    return JSON.stringify({
      focus: document.documentElement.dataset.workspaceFocus || null,
      titlebarArea: free ? { x: free.x, y: free.y, width: free.width, height: free.height } : null,
      mainRows: main ? getComputedStyle(main).gridTemplateRows : null,
      strip: before ? { content: before.content, region: before.webkitAppRegion, height: before.height, background: before.backgroundColor } : null,
      canvasTop: grid ? Math.round(grid.getBoundingClientRect().top) : null,
      underControls: under
    });
  })()`);
  console.log(label, result);
}

app.whenReady().then(async () => {
  window = new BrowserWindow({
    width: 1440, height: 900, show: true, backgroundColor: "#000000",
    titleBarStyle: "hidden", titleBarOverlay: { ...OVERLAY },
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2500);
  fs.mkdirSync(outDir, { recursive: true });
  for (let i = 0; i < 10; i++) {
    const on = await window.webContents.executeJavaScript("!!document.querySelector('.terminal-grid')");
    if (on) break;
    await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"workspace\"]'); if (b) b.click(); return true; })()");
    await wait(900);
  }
  await wait(1200);
  await measure("STANDARD");
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('.workspace-focus-mode'); if (b) b.click(); return !!b; })()");
  await wait(2500);
  await measure("FOCUS");
  window.focus(); window.webContents.invalidate(); await wait(1500);
  fs.writeFileSync(path.join(outDir, "focus-top.png"), (await window.webContents.capturePage({ x: 0, y: 0, width: 1440, height: 140 })).toPNG());
  fs.writeFileSync(path.join(outDir, "focus-full.png"), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('.workspace-focus-mode'); if (b) b.click(); return !!b; })()");
  await wait(1500);
  await measure("EXITED");
  window.destroy();
  app.quit();
});
