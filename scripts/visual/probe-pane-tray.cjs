// Verifies the two focus-mode fixes on a real render:
//   * the narrow-pane control tray opens, fits inside its pane, and is legible
//   * the focus deck collapses to one control at rest and expands on hover
//   * a mosaic tile can be reordered without its terminal leaving the DOM
//
//   npx electron scripts/visual/probe-pane-tray.cjs --out artifacts/visual/tray
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/tray"));
const theme = flag("theme", "orbital");
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));

// Some fixtures answer asynchronously. Handing the renderer a pending promise
// is not an answer — it cannot be cloned across the bridge, so the request
// fails and the probe measures a screen that never got its data.
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
function save(image, name) {
  if (!image) return;
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
}

const js = source => source;

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
  await window.webContents.executeJavaScript(js("(() => { const b = document.querySelector('[data-nav-id=\"workspace\"]'); if (b) b.click(); return true; })()"));
  await settle(window, painter);
  await window.webContents.executeJavaScript(js("(() => { const b = document.querySelector('.workspace-focus-mode'); if (b) b.click(); return true; })()"));
  await settle(window, painter);

  const deckRest = await window.webContents.executeJavaScript(js(
    "(() => { const d = document.querySelector('.workspace-toolbar-v2'); const r = d.getBoundingClientRect(); const cs = getComputedStyle(d);" +
    " const shown = Array.from(d.querySelectorAll('button')).filter(b => getComputedStyle(b).display !== 'none').map(b => b.className.split(' ')[0]);" +
    " const grid = document.querySelector('.terminal-grid').getBoundingClientRect();" +
    " return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), opacity: cs.opacity, buttons: shown, gridH: Math.round(grid.height), overlapArea: Math.round(r.width * r.height) }); })()"
  ));
  console.log("FOCUS DECK at rest:", deckRest);
  save(await settle(window, painter), "focus-deck-rest");

  // Hover is what expands it, so drive a real pointer move over the deck.
  const deckBox = JSON.parse(await window.webContents.executeJavaScript(js(
    "(() => { const r = document.querySelector('.workspace-toolbar-v2').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()"
  )));
  window.webContents.sendInputEvent({ type: "mouseMove", x: deckBox.x, y: deckBox.y });
  await settle(window, painter, { quietMs: 400 });
  const deckHover = await window.webContents.executeJavaScript(js(
    "(() => { const d = document.querySelector('.workspace-toolbar-v2'); const r = d.getBoundingClientRect();" +
    " const shown = Array.from(d.querySelectorAll('button')).filter(b => getComputedStyle(b).display !== 'none').map(b => b.className.split(' ')[0]);" +
    " return JSON.stringify({ w: Math.round(r.width), h: Math.round(r.height), opacity: getComputedStyle(d).opacity, buttons: shown }); })()"
  ));
  console.log("FOCUS DECK hovered:", deckHover);
  save(await settle(window, painter), "focus-deck-hover");
  window.webContents.sendInputEvent({ type: "mouseMove", x: 20, y: 400 });
  await settle(window, painter, { quietMs: 300 });

  // The tray, opened on the first mosaic tile.
  const trayReport = await window.webContents.executeJavaScript(js(
    "(() => { const toggle = document.querySelector('.terminal-pane__tray-toggle'); if (!toggle) return JSON.stringify({ error: 'no toggle' }); toggle.click(); return 'ok'; })()"
  ));
  if (trayReport !== "ok") console.log("TRAY:", trayReport);
  await settle(window, painter, { quietMs: 400 });
  const tray = await window.webContents.executeJavaScript(js(
    "(() => { const t = document.querySelector('.terminal-pane-tray'); if (!t) return JSON.stringify({ open: false });" +
    " const tr = t.getBoundingClientRect(); const cs = getComputedStyle(t);" +
    " const rows = Array.from(t.children).map(el => { const r = el.getBoundingClientRect(); return { cls: String(el.className).split(' ')[0] || el.tagName, w: Math.round(r.width), h: Math.round(r.height), draggable: el.draggable === true, text: (el.textContent || '').trim().slice(0, 42) }; });" +
    " return JSON.stringify({ open: true, w: Math.round(tr.width), h: Math.round(tr.height), bg: cs.backgroundColor, border: cs.borderTopColor," +
    "  portalled: !t.closest('.shell'), onScreen: tr.left >= 0 && tr.top >= 0 && tr.right <= innerWidth && tr.bottom <= innerHeight, rows: rows }); })()"
  ));
  console.log("TRAY:", tray);
  save(await settle(window, painter), "pane-tray-open");

  // Reorder: does the terminal survive it, and does the tile actually move?
  const before = await window.webContents.executeJavaScript(js(
    "(() => { const panes = Array.from(document.querySelectorAll('.terminal-pane'));" +
    " return JSON.stringify(panes.map(p => ({ name: (p.querySelector('.terminal-session-trigger strong') || {}).textContent, order: getComputedStyle(p).order, screens: p.querySelectorAll('.xterm-screen').length }))); })()"
  ));
  console.log("TILES before:", before);
  window.webContents.sendInputEvent({ type: "mouseDown", x: 20, y: 400, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: 20, y: 400, button: "left", clickCount: 1 });
  await settle(window, painter, { quietMs: 300 });
  // Drag-and-drop cannot be synthesised offscreen, so exercise the same code
  // path the drop handler calls: the pane's own "move a terminal here" menu.
  await window.webContents.executeJavaScript(js(
    "(() => { const panes = Array.from(document.querySelectorAll('.terminal-pane'));" +
    " const target = panes[0]; const trigger = target.querySelector('.terminal-session-trigger'); trigger.click(); return true; })()"
  ));
  await settle(window, painter, { quietMs: 400 });
  const menuLabel = await window.webContents.executeJavaScript(js(
    "(() => { const m = document.querySelector('.terminal-session-menu'); if (!m) return 'no menu';" +
    " const label = m.querySelector('.terminal-session-menu__label').textContent;" +
    " const items = Array.from(m.querySelectorAll('button')).map(b => (b.querySelector('strong') || {}).textContent);" +
    " const last = items[items.length - 1]; const pick = m.querySelectorAll('button')[3]; if (pick) pick.click();" +
    " return JSON.stringify({ label: label, items: items, hasEmptyOption: items.includes('Empty pane') }); })()"
  ));
  console.log("CHOOSER:", menuLabel);
  await settle(window, painter, { quietMs: 500 });
  const after = await window.webContents.executeJavaScript(js(
    "(() => { const panes = Array.from(document.querySelectorAll('.terminal-pane'));" +
    " return JSON.stringify(panes.map(p => ({ name: (p.querySelector('.terminal-session-trigger strong') || {}).textContent, order: getComputedStyle(p).order, screens: p.querySelectorAll('.xterm-screen').length }))); })()"
  ));
  console.log("TILES after: ", after);
  save(await settle(window, painter), "mosaic-reordered");

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(e => { console.error("probe failed:", e); app.exit(1); }));
