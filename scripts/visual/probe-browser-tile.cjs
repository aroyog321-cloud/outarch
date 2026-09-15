// Renders the Mission Control browser tile on the canvas, in the normal packed
// canvas and inside focus mode, and reports the rectangle the renderer reserves
// for the native view. The view itself belongs to the real main process, so
// what is verified here is the chrome, the packing, and the reported bounds.
//
//   npx electron scripts/visual/probe-browser-tile.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/browser"));
const theme = flag("theme", "orbital");
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));

// Stands in for the real WorkspaceBrowser so the renderer sees a live view.
const browser = { open: false, url: "", title: "", loading: false, error: null, canGoBack: false, canGoForward: false, available: true };
const boundsReports = [];
ipcMain.handle("mission-control:request", (_event, message) => {
  const method = message.method;
  let result;
  if (method === "workspace.browser.state") result = { ...browser };
  else if (method === "workspace.browser.open") { browser.open = true; browser.url = message.params?.url || browser.url; result = { ...browser }; }
  else if (method === "workspace.browser.bounds") { boundsReports.push(message.params?.bounds || null); result = { ...browser }; }
  else if (method === "workspace.browser.command") {
    if (message.params?.action === "close") { browser.open = false; browser.url = ""; }
    result = { ...browser };
  } else result = fixtures.handle(method, message.params);
  return { version: 1, id: message.id, ok: true, result };
});

const wait = ms => new Promise(r => setTimeout(r, ms));
function createPainter(w) { const s = { image: null, count: 0 }; w.webContents.on("paint", (_e, _d, image) => { s.image = image; s.count += 1; }); return s; }
async function settle(w, p, { quietMs = 600, timeoutMs = 9000 } = {}) {
  const deadline = Date.now() + timeoutMs; let seen = p.count; let quiet = Date.now();
  while (Date.now() < deadline) { await wait(100); if (p.count !== seen) { seen = p.count; quiet = Date.now(); continue; } if (Date.now() - quiet >= quietMs && p.image) return p.image; }
  return p.image;
}

const MEASURE = [
  "(() => {",
  "  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) }; };",
  "  const grid = document.querySelector('.terminal-grid');",
  "  const tile = document.querySelector('.workspace-browser');",
  "  return JSON.stringify({",
  "    mosaic: grid ? grid.classList.contains('is-mosaic') : null,",
  "    cols: grid ? grid.style.getPropertyValue('--mosaic-cols') : null,",
  "    tiles: grid ? grid.children.length : 0,",
  "    browserTile: box(tile),",
  "    chrome: box(document.querySelector('.workspace-browser__chrome')),",
  "    viewport: box(document.querySelector('.workspace-browser__viewport')),",
  "    addressPlaceholder: (document.querySelector('.workspace-browser__address input') || {}).placeholder || null,",
  "    panes: Array.from(document.querySelectorAll('.terminal-pane')).length",
  "  });",
  "})()"
].join("\n");

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  const window = new BrowserWindow({
    width, height, show: false, frame: false, backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  window.webContents.setFrameRate(30);
  const painter = createPainter(window);
  const problems = [];
  window.webContents.on("console-message", (...args) => {
    const d = args[0] && typeof args[0] === "object" && "level" in args[0] ? args[0] : { level: args[1], message: args[2] };
    if (String(d.level) === "error" || Number(d.level) >= 3) problems.push("console: " + String(d.message).slice(0, 300));
  });
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
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"workspace\"]'); if (b) b.click(); return true; })()");
  await settle(window, painter);

  const opened = await window.webContents.executeJavaScript(
    "(() => { const b = document.querySelector('.workspace-browser-toggle'); if (!b) return false; b.click(); return true; })()"
  );
  if (!opened) throw new Error("browser toggle not found in the workspace toolbar");
  await settle(window, painter);
  const normal = JSON.parse(await window.webContents.executeJavaScript(MEASURE));
  let img = painter.image;
  if (img && !img.isEmpty()) fs.writeFileSync(path.join(outDir, "browser-normal." + width + ".png"), img.toPNG());

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('.workspace-focus-mode'); if (b) b.click(); return true; })()");
  await settle(window, painter);
  const focus = JSON.parse(await window.webContents.executeJavaScript(MEASURE));
  img = painter.image;
  if (img && !img.isEmpty()) fs.writeFileSync(path.join(outDir, "browser-focus." + width + ".png"), img.toPNG());

  const report = { width, height, normal, focus, boundsReports: boundsReports.slice(-6), problems };
  fs.writeFileSync(path.join(outDir, "browser." + width + ".json"), JSON.stringify(report, null, 1));
  const show = (label, r) => console.log(
    "\n" + label + ": mosaic=" + r.mosaic + " cols=" + r.cols + " tiles=" + r.tiles + " panes=" + r.panes +
    "\n  tile " + JSON.stringify(r.browserTile) + "\n  chrome " + JSON.stringify(r.chrome) + "\n  reserved viewport " + JSON.stringify(r.viewport)
  );
  show("NORMAL", normal);
  show("FOCUS", focus);
  console.log("\nlast reported bounds:", JSON.stringify(boundsReports.slice(-3)));
  if (problems.length) console.log("\nPROBLEMS:\n" + problems.join("\n"));
  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(e => { console.error("probe failed:", e); app.exit(1); }));
