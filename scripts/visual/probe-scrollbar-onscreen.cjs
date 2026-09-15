// Same measurement as probe-scrollbar.cjs but in a real, composited on-screen
// window: native scrollbars are painted by the platform and an offscreen
// surface does not reproduce them.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/scrollbar"));
const theme = flag("theme", "orbital");
const terminalTheme = flag("terminal-theme", theme);

ipcMain.handle("mission-control:request", async (_event, message) => ({
  version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params)
}));
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const window = new BrowserWindow({
    width: 1440, height: 900, show: true, backgroundColor: "#000000",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0a0b0d", symbolColor: "#cbd0dc", height: 42 },
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  const prefs = JSON.stringify({
    theme, typeScale: "comfortable", density: "comfortable", motion: "full",
    terminalFontSize: 13, terminalTheme: terminalTheme, terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true
  });
  await window.webContents.executeJavaScript(
    "window.localStorage.clear();\nwindow.localStorage.setItem('mission-control:interface-preferences:v1', " + JSON.stringify(prefs) + ");\ntrue;"
  );
  window.reload();
  await new Promise(r => window.webContents.once("did-finish-load", r));
  await wait(2500);

  // What the window-controls overlay actually reserves, and who is under it.
  const wco = await window.webContents.executeJavaScript(
    "(() => { const probe = document.createElement('div'); probe.style.cssText = 'position:fixed;left:env(titlebar-area-x,0px);top:env(titlebar-area-y,0px);width:env(titlebar-area-width,100vw);height:env(titlebar-area-height,0px);';" +
    " document.body.appendChild(probe); const r = probe.getBoundingClientRect(); probe.remove();" +
    " const bar = document.querySelector('.mission-status-bar'); const br = bar.getBoundingClientRect();" +
    " const kids = Array.from(bar.querySelectorAll('.status-bar-premium__right > *')).map(el => { const k = el.getBoundingClientRect();" +
    "   return { cls: String(el.className).split(' ').pop(), left: Math.round(k.left), right: Math.round(k.right), text: (el.textContent||'').trim().slice(0,24) }; });" +
    " return JSON.stringify({ titlebarArea: { x: r.left, y: r.top, w: r.width, h: r.height }, innerWidth: innerWidth," +
    "   overlayGeometry: navigator.windowControlsOverlay ? navigator.windowControlsOverlay.getTitlebarAreaRect() : null," +
    "   visible: navigator.windowControlsOverlay ? navigator.windowControlsOverlay.visible : null," +
    "   statusBar: { left: Math.round(br.left), right: Math.round(br.right), h: Math.round(br.height) }, kids: kids }); })()"
  );
  console.log("WCO:", wco);

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"workspace\"]'); if (b) b.click(); return true; })()");
  await wait(2500);
  fs.mkdirSync(outDir, { recursive: true });
  const shot = await window.webContents.capturePage();
  fs.writeFileSync(path.join(outDir, "workspace-onscreen.png"), shot.toPNG());

  const vp = await window.webContents.executeJavaScript(
    "(() => { const x = document.querySelector('.xterm'); if (!x) return JSON.stringify({ none: true });" +
    " const v = x.querySelector('.xterm-viewport'); const cs = getComputedStyle(v); const r = v.getBoundingClientRect();" +
    " return JSON.stringify({ gutter: v.offsetWidth - v.clientWidth, overflowY: cs.overflowY, sbWidth: cs.scrollbarWidth, sbColor: cs.scrollbarColor," +
    "   scrollHeight: v.scrollHeight, clientHeight: v.clientHeight, rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) }," +
    "   colorScheme: cs.colorScheme, rootScheme: getComputedStyle(document.documentElement).colorScheme, dpr: devicePixelRatio }); })()"
  );
  console.log("VIEWPORT:", vp);
  const tree = await window.webContents.executeJavaScript(
    "(() => { const x = document.querySelector('.xterm'); if (!x) return JSON.stringify({ none: true });" +
    " const walk = (el, depth) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect();" +
    "   const row = { d: depth, tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 46), bg: cs.backgroundColor," +
    "     inlineBg: el.style.backgroundColor || '', w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right), op: cs.opacity };" +
    "   const kids = depth < 3 ? Array.from(el.children).flatMap(c => walk(c, depth + 1)) : []; return [row].concat(kids); };" +
    " return JSON.stringify(walk(x, 0), null, 0); })()"
  );
  console.log("XTERM TREE:", tree);
  window.destroy();
  app.quit();
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
