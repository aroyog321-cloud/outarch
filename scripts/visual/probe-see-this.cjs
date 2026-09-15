// Measures the four areas flagged on the annotated screenshot:
//   1. the sidebar project switcher (.top-project)
//   2. the Groundstation status bar + counts cluster
//   3. the Needs You decision card actions (duplicate destinations)
//   4. the Recipes rows (grid placement when run history is present)
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/seethis"));
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));

ipcMain.handle("mission-control:request", async (_event, message) => ({
  version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params)
}));
const wait = ms => new Promise(r => setTimeout(r, ms));

const SIDEBAR = `(() => {
  const b = document.querySelector('.top-project');
  if (!b) return JSON.stringify({ none: true });
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom),
      display: cs.display, cols: cs.gridTemplateColumns, font: cs.fontSize, radius: cs.borderRadius, place: cs.placeItems }; };
  const nav = document.querySelector('.top-navigation button');
  const small = b.querySelector('small'), strong = b.querySelector('strong');
  return JSON.stringify({
    button: box(b),
    mark: box(b.querySelector('.top-project__mark')),
    label: box(b.querySelector('div')),
    small: box(small),
    strong: box(strong),
    chevron: box(b.querySelector('i')),
    firstNav: box(nav),
    labelAndNameOnOneLine: Math.abs(small.getBoundingClientRect().top - strong.getBoundingClientRect().top) < 3
  }, null, 1);
})()`;

const STATUSBAR = `(() => {
  const bar = document.querySelector('.mc-gs-statusbar');
  if (!bar) return JSON.stringify({ none: true });
  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right),
      display: cs.display, pad: cs.padding, radius: cs.borderRadius, borderColor: cs.borderTopColor, bg: cs.backgroundColor, minH: cs.minHeight }; };
  const counts = bar.querySelector('.mc-gs-counts');
  const buttons = Array.from(counts.querySelectorAll('button')).map(el => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    const num = el.querySelector('b'), s = el.querySelector('span');
    return { label: s ? s.textContent : null, w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left),
      pad: cs.padding, minW: cs.minWidth, borderColor: cs.borderTopColor, bg: cs.backgroundColor,
      numFont: num ? getComputedStyle(num).fontSize : null, labelFont: s ? getComputedStyle(s).fontSize : null }; });
  const actions = Array.from(bar.querySelectorAll('.mc-gs-statusbar-actions button')).map(el => { const r = el.getBoundingClientRect();
    return { text: el.textContent.trim().slice(0, 18), w: Math.round(r.width), h: Math.round(r.height), left: Math.round(r.left) }; });
  return JSON.stringify({
    bar: box(bar), identity: box(bar.querySelector('.mc-gs-identity')), health: box(bar.querySelector('.mc-gs-health')),
    name: box(bar.querySelector('.mc-gs-identity strong')), sub: box(bar.querySelector('.mc-gs-identity span')),
    counts: box(counts), buttons, actionsBox: box(bar.querySelector('.mc-gs-statusbar-actions')), actions,
    barCols: getComputedStyle(bar).gridTemplateColumns, gap: getComputedStyle(bar).gap
  }, null, 1);
})()`;

const DECISION = `(() => {
  const card = document.querySelector('.decision-item');
  if (!card) return JSON.stringify({ none: true });
  const r = card.getBoundingClientRect();
  const buttons = Array.from(card.querySelectorAll('.decision-item__actions button')).map(b => {
    const bb = b.getBoundingClientRect();
    return { label: b.textContent.trim().slice(0, 22), cls: String(b.className), w: Math.round(bb.width), h: Math.round(bb.height), top: Math.round(bb.top), left: Math.round(bb.left) };
  });
  return JSON.stringify({ card: { w: Math.round(r.width), h: Math.round(r.height) }, buttons,
    cardCount: document.querySelectorAll('.decision-item').length,
    allLabels: Array.from(document.querySelectorAll('.decision-item')).map(c => Array.from(c.querySelectorAll('.decision-item__actions button')).map(b => b.textContent.trim()))
  }, null, 1);
})()`;

const RECIPES = `(() => {
  const rows = Array.from(document.querySelectorAll('.recipe-row'));
  if (!rows.length) return JSON.stringify({ none: true });
  const info = rows.map(row => {
    const r = row.getBoundingClientRect();
    const cs = getComputedStyle(row);
    const kid = sel => { const el = row.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); const k = getComputedStyle(el);
      return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), left: Math.round(b.left), col: k.gridColumnStart + '/' + k.gridColumnEnd, gridRow: k.gridRowStart + '/' + k.gridRowEnd, display: k.display }; };
    const btns = Array.from(row.querySelectorAll('footer button')).map(b => { const bb = b.getBoundingClientRect();
      return { text: b.textContent.trim().slice(0, 18), w: Math.round(bb.width), h: Math.round(bb.height), top: Math.round(bb.top), left: Math.round(bb.left) }; });
    const h3 = row.querySelector('h3');
    return { name: h3 ? h3.textContent : null, h: Math.round(r.height), top: Math.round(r.top),
      cols: cs.gridTemplateColumns, rowsTpl: cs.gridTemplateRows, kids: row.children.length,
      main: kid('.recipe-row-main'), flow: kid('.recipe-flow'), history: kid('.recipe-run-history'), footer: kid('footer'),
      historyOpen: row.querySelector('details') ? row.querySelector('details').open : null, btns };
  });
  return JSON.stringify(info, null, 1);
})()`;

async function run() {
  const window = new BrowserWindow({
    width, height, show: true, backgroundColor: "#000000",
    titleBarStyle: "hidden", titleBarOverlay: { color: "#0a0b0d", symbolColor: "#cbd0dc", height: 42 },
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript("window.localStorage.clear(); true;");
  window.reload();
  await new Promise(r => window.webContents.once("did-finish-load", r));
  await wait(2600);
  fs.mkdirSync(outDir, { recursive: true });

  console.log("SIDEBAR:", await window.webContents.executeJavaScript(SIDEBAR));
  console.log("STATUSBAR:", await window.webContents.executeJavaScript(STATUSBAR));
  fs.writeFileSync(path.join(outDir, "groundstation.png"), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"needs\"]'); if (b) b.click(); return true; })()");
  await wait(1600);
  console.log("DECISION:", await window.webContents.executeJavaScript(DECISION));
  fs.writeFileSync(path.join(outDir, "needs.png"), (await window.webContents.capturePage()).toPNG());

  // Behaviour, not layout: the two controls must land in different places.
  const where = `(() => ({
    view: (document.querySelector('[data-nav-id][aria-current="page"]') || {}).dataset?.navId || null,
    dialog: Array.from(document.querySelectorAll('[role="dialog"]')).map(d => (d.getAttribute('aria-label') || d.textContent || '').trim().slice(0, 40))
  }))()`;
  const clickOnFirstCard = label => `(() => { const b = Array.from(document.querySelector('.decision-item').querySelectorAll('.decision-item__actions button')).find(x => x.textContent.trim().startsWith(${JSON.stringify(label)})); if (!b) return 'missing'; b.click(); return 'clicked'; })()`;
  console.log("CLICK Inspect evidence:", await window.webContents.executeJavaScript(clickOnFirstCard("Inspect evidence")));
  await wait(900);
  console.log("AFTER Inspect evidence:", JSON.stringify(await window.webContents.executeJavaScript(where)));
  fs.writeFileSync(path.join(outDir, "after-inspect.png"), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); true");
  await wait(700);
  console.log("AFTER Escape:", JSON.stringify(await window.webContents.executeJavaScript(where)));
  console.log("CLICK Open terminal:", await window.webContents.executeJavaScript(clickOnFirstCard("Open terminal")));
  await wait(1400);
  console.log("AFTER Open terminal:", JSON.stringify(await window.webContents.executeJavaScript(where)));
  fs.writeFileSync(path.join(outDir, "after-open-terminal.png"), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"recipes\"]'); if (b) b.click(); return true; })()");
  await wait(1600);
  console.log("RECIPES:", await window.webContents.executeJavaScript(RECIPES));
  fs.writeFileSync(path.join(outDir, "recipes.png"), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript("(() => { const d = document.querySelector('.recipe-run-history'); if (d) d.open = true; return true; })()");
  await wait(700);
  console.log("RECIPES OPEN:", await window.webContents.executeJavaScript(RECIPES));
  fs.writeFileSync(path.join(outDir, "recipes-open.png"), (await window.webContents.capturePage()).toPNG());

  window.destroy();
  app.quit();
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
