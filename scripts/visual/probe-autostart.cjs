// Renders the auto-start surfaces and measures them:
//   1. the Groundstation inspector's Restore row
//   2. the auto-start dialog, opened the way a person opens it (Ctrl K)
//   3. the terminal pane's ⋯ menu, and what its auto-start item dispatches
//   4. Settings > Project defaults, which links to the dialog
//   electron scripts/visual/probe-autostart.cjs --out artifacts/visual/autostart-after
// Frames come from real offscreen rendering (the `paint` event): capturePage on
// a parked window returns the frame from before a portal opened.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/autostart"));
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));
const wait = ms => new Promise(r => setTimeout(r, ms));

const dispatched = [];
ipcMain.handle("mission-control:request", async (_event, message) => {
  if (message.method === "action.dispatch") {
    dispatched.push(message.params);
    const action = message.params?.action || {};
    // Route the one action this probe exercises into the real engine so the
    // refreshed UI shows the new policy rather than the old one.
    if (action.type === "setAutoStart") {
      try { return { version: 1, id: message.id, ok: true, result: await fixtures.engine.setAutoStart(message.params.sessionId, action.enabled) }; }
      catch (error) { return { version: 1, id: message.id, ok: true, result: { ok: false, error: error.message } }; }
    }
  }
  return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) };
});

const BOX = `const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
  return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), bg: cs.backgroundColor, color: cs.color,
    pos: cs.position, z: cs.zIndex, pad: cs.padding, font: cs.fontSize, overflowX: el.scrollWidth > el.clientWidth + 1 }; };`;

async function run() {
  const window = new BrowserWindow({
    width, height, show: false, backgroundColor: "#000000",
    webPreferences: { offscreen: true, preload: path.join(__dirname, "preload.cjs"), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  const wc = window.webContents;
  let frame = null;
  let lastPaint = 0;
  wc.setFrameRate(30);
  wc.on("paint", (_event, _dirty, image) => { frame = image; lastPaint = Date.now(); });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wc.executeJavaScript("window.localStorage.clear(); true;");
  window.reload();
  await new Promise(r => wc.once("did-finish-load", r));
  await wait(2600);
  fs.mkdirSync(outDir, { recursive: true });
  const js = source => wc.executeJavaScript(source);
  const shot = async (name, rect) => {
    wc.invalidate();
    await wait(300);
    const started = Date.now();
    while (Date.now() - lastPaint < 200 && Date.now() - started < 2000) await wait(50);
    if (!frame) return;
    // The frame is rendered at the display's scale factor; rects are CSS px.
    const scale = frame.getSize().width / width;
    const image = rect ? frame.crop({ x: Math.round(rect.x * scale), y: Math.round(rect.y * scale), width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) }) : frame;
    fs.writeFileSync(path.join(outDir, `${name}.png`), image.toPNG());
  };
  const key = (keyCode, modifiers = []) => { wc.sendInputEvent({ type: "keyDown", keyCode, modifiers }); wc.sendInputEvent({ type: "keyUp", keyCode, modifiers }); };
  const type = text => { for (const ch of text) wc.sendInputEvent({ type: "char", keyCode: ch }); };
  const rectOf = async (selector, pad = 0) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.floor(r.left) - ${pad}), y = Math.max(0, Math.floor(r.top) - ${pad});
    return { x, y, width: Math.min(innerWidth - x, Math.ceil(r.width) + ${pad * 2}), height: Math.min(innerHeight - y, Math.ceil(r.height) + ${pad * 2}) }; })()`);
  wc.focus();

  // 1. Groundstation inspector
  await js(`(() => { const row = document.querySelector('.mc-ref-manifest-row[data-worker-id="web"]'); if (row) row.click(); return Boolean(row); })()`);
  await wait(900);
  console.log("GS INSPECTOR:", await js(`(() => { ${BOX}
    const t = document.querySelector('.mc-gs-inspector .inspector-autostart-toggle');
    return JSON.stringify({ toggle: box(t), cell: box(t && t.closest('dd') && t.closest('dd').parentElement),
      status: box(t && t.querySelector('.inspector-autostart-status')), track: box(t && t.querySelector('.pm-toggle')), text: t ? t.textContent.trim() : null }); })()`));
  const inspector = await rectOf(".mc-gs-inspector");
  if (inspector) await shot("gs-inspector", inspector);

  // 2. Auto-start dialog through the command palette
  key("K", ["control"]);
  await wait(500);
  type("start with");
  await wait(600);
  console.log("PALETTE MATCHES:", await js(`JSON.stringify(Array.from(document.querySelectorAll('[cmdk-item]')).slice(0, 3).map(i => i.textContent.trim().slice(0, 70)))`));
  key("Return");
  await wait(900);
  console.log("AUTOSTART DIALOG:", await js(`(() => { ${BOX}
    const d = document.querySelector('.autostart-manager-dialog');
    const row = d && d.querySelector('.autostart-worker-row');
    return JSON.stringify({ open: Boolean(d), dialog: box(d), overlay: box(document.querySelector('.dialog-backdrop')),
      header: box(d && d.querySelector('.dialog-header')), toolbar: box(d && d.querySelector('.autostart-toolbar')), listHead: box(d && d.querySelector('.autostart-list-head')),
      firstRow: box(row), footer: box(d && d.querySelector('.dialog-footer')),
      rowTag: row ? row.tagName : null, rowRole: row ? row.getAttribute('role') : null,
      tabStopsInRow: row ? row.querySelectorAll('input, button, [tabindex="0"]').length : null,
      leftEdges: d ? ['.dialog-header > div', '.autostart-search-box', '.autostart-list-head p', '.autostart-worker-row', '.dialog-footer > :first-child'].map(s => { const e = d.querySelector(s); return e ? Math.round(e.getBoundingClientRect().left) : null; }) : null,
      rows: d ? d.querySelectorAll('.autostart-worker-row').length : 0 }, null, 1); })()`));
  await shot("autostart-dialog");
  const dialogRect = await rectOf(".autostart-manager-dialog", 12);
  if (dialogRect) await shot("autostart-dialog-crop", dialogRect);

  // Toggle the first row by clicking its label text, then filter.
  const beforeToggle = dispatched.length;
  await js(`(() => { const s = document.querySelector('.autostart-worker-row .autostart-worker-name-line strong'); if (s) s.click(); return Boolean(s); })()`);
  await wait(900);
  console.log("ROW CLICK DISPATCH:", JSON.stringify(dispatched.slice(beforeToggle)));
  await js(`(() => { const b = Array.from(document.querySelectorAll('.autostart-chip')).find(x => x.textContent.startsWith('Manual')); if (b) b.click(); return true; })()`);
  await wait(500);
  console.log("AFTER MANUAL FILTER:", await js(`JSON.stringify({ rows: document.querySelectorAll('.autostart-worker-row').length, batch: Array.from(document.querySelectorAll('.autostart-batch')).map(b => b.textContent + (b.disabled ? ' (disabled)' : '')), summary: (document.querySelector('.autostart-list-head p') || {}).textContent })`));
  const dialogRect2 = await rectOf(".autostart-manager-dialog", 12);
  if (dialogRect2) await shot("autostart-dialog-manual-filter", dialogRect2);
  key("Escape");
  await wait(600);

  // 3. Terminal pane ⋯ menu
  await js(`(() => { const b = document.querySelector('[data-nav-id="workspace"]'); if (b) b.click(); return true; })()`);
  await wait(1800);
  await js(`(() => { const b = document.querySelector('.terminal-more'); if (b) b.focus(); return Boolean(b); })()`);
  key("Return");
  await wait(700);
  console.log("PANE MENU:", await js(`JSON.stringify(Array.from(document.querySelectorAll('.terminal-action-menu [role^="menuitem"]')).map(i => ({ role: i.getAttribute('role'), checked: i.getAttribute('aria-checked'), text: i.textContent.trim().slice(0, 80) })).filter(i => /start|Restart/i.test(i.text)))`));
  const menuRect = await rectOf(".terminal-action-menu", 8);
  if (menuRect) await shot("pane-menu-crop", menuRect);
  const before = dispatched.length;
  await js(`(() => { const item = Array.from(document.querySelectorAll('.terminal-action-menu [role^="menuitem"]')).find(i => /start with workspace/i.test(i.textContent)); if (item) item.click(); return Boolean(item); })()`);
  await wait(900);
  console.log("PANE MENU DISPATCH:", JSON.stringify(dispatched.slice(before)));

  // 4. Settings > Project defaults
  await js(`(() => { const b = document.querySelector('[data-nav-id="settings"]'); if (b) b.click(); return true; })()`);
  await wait(1200);
  await js(`(() => { const b = Array.from(document.querySelectorAll('.view-settings button, .settings-hub button')).find(x => /project defaults/i.test(x.textContent)); if (b) b.click(); return Boolean(b); })()`);
  await wait(900);
  console.log("SETTINGS LINK:", await js(`JSON.stringify(Array.from(document.querySelectorAll('.settings-inline-link')).map(b => b.textContent.trim()))`));
  const note = await rectOf(".settings-panel-wide", 8);
  if (note) await shot("settings-project-defaults", note);

  console.log("ALL DISPATCHES:", JSON.stringify(dispatched));
  window.destroy();
  app.quit();
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
