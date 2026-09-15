// Measures two reported defects on a real render:
//   * the bright vertical bar down the right edge of every terminal pane
//   * the status tape's right cluster sliding under the window controls
//
//   npx electron scripts/visual/probe-scrollbar.cjs --out artifacts/visual/scrollbar
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/scrollbar"));
const theme = flag("theme", "orbital");
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));

ipcMain.handle("mission-control:request", async (_event, message) => ({
  version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params)
}));

const wait = ms => new Promise(r => setTimeout(r, ms));
function createPainter(w) { const s = { image: null, count: 0 }; w.webContents.on("paint", (_e, _d, image) => { s.image = image; s.count += 1; }); return s; }
async function settle(w, p, { quietMs = 600, timeoutMs = 9000 } = {}) {
  const deadline = Date.now() + timeoutMs; let seen = p.count; let quiet = Date.now();
  while (Date.now() < deadline) { await wait(100); if (p.count !== seen) { seen = p.count; quiet = Date.now(); continue; } if (Date.now() - quiet >= quietMs && p.image) return p.image; }
  return p.image;
}
function save(image, name) { if (!image) return; fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG()); }

async function run() {
  const window = new BrowserWindow({
    width, height, show: false, frame: false, backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  window.webContents.setFrameRate(30);
  const painter = createPainter(window);
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  const prefs = JSON.stringify({
    theme, typeScale: "comfortable", density: "comfortable", motion: "full",
    terminalFontSize: 13, terminalTheme: theme, terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true
  });
  await window.webContents.executeJavaScript(
    "window.localStorage.clear();\nwindow.localStorage.setItem('mission-control:interface-preferences:v1', " + JSON.stringify(prefs) + ");\ntrue;"
  );
  window.reload();
  await new Promise(r => window.webContents.once("did-finish-load", r));
  await settle(window, painter, { quietMs: 700, timeoutMs: 10000 });

  const bar = await window.webContents.executeJavaScript(
    "(() => { const b = document.querySelector('.mission-status-bar'); if (!b) return JSON.stringify({ missing: true });" +
    " const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);" +
    " const kids = Array.from(b.querySelectorAll('.status-bar-premium__right > *')).map(el => { const k = el.getBoundingClientRect();" +
    "   return { cls: String(el.className).split(' ').pop(), left: Math.round(k.left), right: Math.round(k.right), w: Math.round(k.width), text: (el.textContent||'').trim().slice(0,28) }; });" +
    " return JSON.stringify({ left: Math.round(r.left), right: Math.round(r.right), h: Math.round(r.height), padRight: cs.paddingRight, innerWidth: window.innerWidth," +
    "   wcoWidth: (window.innerWidth - (Number(getComputedStyle(document.documentElement).getPropertyValue('--probe-x')) || 0)), kids: kids }); })()"
  );
  console.log("STATUS BAR:", bar);

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"workspace\"]'); if (b) b.click(); return true; })()");
  await settle(window, painter, { quietMs: 800, timeoutMs: 12000 });
  save(await settle(window, painter), "workspace");

  const term = await window.webContents.executeJavaScript(
    "(() => { const out = []; const roots = Array.from(document.querySelectorAll('.xterm'));" +
    " for (const x of roots.slice(0, 3)) {" +
    "   const vp = x.querySelector('.xterm-viewport'); const se = x.querySelector('.xterm-scrollable-element');" +
    "   const sb = se && se.querySelector(':scope > .scrollbar.vertical'); const sl = sb && sb.querySelector('.slider');" +
    "   const vcs = vp && getComputedStyle(vp); const vr = vp && vp.getBoundingClientRect();" +
    "   out.push({" +
    "     xtermW: Math.round(x.getBoundingClientRect().width)," +
    "     viewport: vp ? { offsetW: vp.offsetWidth, clientW: vp.clientWidth, gutter: vp.offsetWidth - vp.clientWidth, overflowY: vcs.overflowY, sbWidth: vcs.scrollbarWidth, sbColor: vcs.scrollbarColor, bg: vcs.backgroundColor, right: Math.round(vr.right) } : null," +
    "     scrollbar: sb ? { cls: sb.className, w: Math.round(sb.getBoundingClientRect().width), h: Math.round(sb.getBoundingClientRect().height), left: Math.round(sb.getBoundingClientRect().left), bg: getComputedStyle(sb).backgroundColor, opacity: getComputedStyle(sb).opacity } : null," +
    "     slider: sl ? { w: Math.round(sl.getBoundingClientRect().width), h: Math.round(sl.getBoundingClientRect().height), bg: getComputedStyle(sl).backgroundColor, cls: sl.className } : null" +
    "   });" +
    " }" +
    " const injected = Array.from(document.querySelectorAll('style')).map(s => s.textContent).filter(t => t && t.indexOf('.slider') >= 0);" +
    " return JSON.stringify({ panes: out, colorScheme: getComputedStyle(document.documentElement).colorScheme, injected: injected }, null, 1); })()"
  );
  console.log("TERMINALS:", term);

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
