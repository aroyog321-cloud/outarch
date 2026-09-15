// Measures the two screens reported as dense / broken:
//   * the Needs You decision card - height, region rects, action block
//   * the recipe builder - footer overlap, clipped eyebrows, empty right column
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/decision"));
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));

ipcMain.handle("mission-control:request", async (_event, message) => ({
  version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params)
}));
const wait = ms => new Promise(r => setTimeout(r, ms));

const NEEDS_PROBE = `(() => {
  const card = document.querySelector('.decision-item');
  if (!card) return JSON.stringify({ none: true });
  const r = card.getBoundingClientRect();
  const q = sel => {
    const el = card.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), left: Math.round(b.left), font: cs.fontSize, weight: cs.fontWeight, lh: cs.lineHeight, color: cs.color };
  };
  const buttons = Array.from(card.querySelectorAll('.decision-item__actions button')).map(b => {
    const bb = b.getBoundingClientRect();
    return { label: b.textContent.trim().slice(0, 20), w: Math.round(bb.width), h: Math.round(bb.height), top: Math.round(bb.top), left: Math.round(bb.left) };
  });
  const facts = card.querySelector('.decision-item__facts');
  const overlapAbove = Array.from(document.querySelectorAll('.experience *')).filter(el => {
    const b = el.getBoundingClientRect();
    return b.height > 6 && b.bottom > r.top + 2 && b.top < r.top - 2 && b.left < r.right && b.right > r.left && !card.contains(el) && el.children.length === 0;
  }).map(el => ({ cls: String(el.className).slice(0, 40), text: (el.textContent || '').trim().slice(0, 26), bottom: Math.round(el.getBoundingClientRect().bottom) }));
  return JSON.stringify({
    card: { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) },
    factCols: getComputedStyle(facts).gridTemplateColumns,
    index: q('.decision-item__index'), meta: q('.decision-item__meta'), h3: q('h3'),
    facts: q('.decision-item__facts'), dt: q('.decision-item__facts dt'), dd: q('.decision-item__facts dd'),
    actions: q('.decision-item__actions'), buttons, overlapAbove
  }, null, 1);
})()`;

const RECIPE_PROBE = `(() => {
  const d = document.querySelector('.recipes-dialog');
  if (!d) return JSON.stringify({ none: true });
  const dr = d.getBoundingClientRect();
  const q = sel => {
    const el = d.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return { w: Math.round(b.width), h: Math.round(b.height), top: Math.round(b.top), left: Math.round(b.left), bottom: Math.round(b.bottom), pos: cs.position, z: cs.zIndex, bg: cs.backgroundColor };
  };
  const actions = d.querySelector('.recipe-builder__actions');
  const ar = actions.getBoundingClientRect();
  const footerOverlaps = Array.from(d.querySelectorAll('.recipe-simple-workers article, .recipe-advanced-toggle, .recipe-dag-summary, .recipe-plan-summary')).map(el => {
    const b = el.getBoundingClientRect();
    return (b.top < ar.bottom && b.bottom > ar.top) ? { cls: String(el.className).slice(0, 28), text: (el.textContent || '').trim().slice(0, 24), top: Math.round(b.top), bottom: Math.round(b.bottom) } : null;
  }).filter(Boolean);
  const templates = Array.from(d.querySelectorAll('.recipe-template-strip button')).map(b => {
    const bb = b.getBoundingClientRect();
    return { label: (b.querySelector('strong') || {}).textContent, w: Math.round(bb.width), h: Math.round(bb.height), top: Math.round(bb.top) };
  });
  const eyebrows = Array.from(d.querySelectorAll('.recipe-template-strip > span, .recipe-simple-workers header span, .recipe-builder__intro span')).map(el => {
    const b = el.getBoundingClientRect();
    return { text: (el.textContent || '').trim().slice(0, 26), top: Math.round(b.top), h: Math.round(b.height), font: getComputedStyle(el).fontSize, clipped: b.top < d.getBoundingClientRect().top };
  });
  const content = d.querySelector('.recipes-content');
  const cr = content.getBoundingClientRect();
  const header = d.querySelector('header');
  const hr = header.getBoundingClientRect();
  const ha = d.querySelector('.recipe-header-actions').getBoundingClientRect();
  return JSON.stringify({
    dialog: { w: Math.round(dr.width), h: Math.round(dr.height), top: Math.round(dr.top), bottom: Math.round(dr.bottom) },
    header: { w: Math.round(hr.width), h: Math.round(hr.height), cols: getComputedStyle(header).gridTemplateColumns, display: getComputedStyle(header).display },
    headerActionsW: Math.round(ha.width),
    intro: q('.recipe-builder__intro'), introBtn: q('.recipe-ai-design'),
    content: { w: Math.round(cr.width), h: Math.round(cr.height), scrollH: content.scrollHeight, clientH: content.clientHeight, overflow: getComputedStyle(content).overflowY },
    footer: { top: Math.round(ar.top), bottom: Math.round(ar.bottom), pos: getComputedStyle(actions).position, bg: getComputedStyle(actions).backgroundColor, z: getComputedStyle(actions).zIndex },
    footerOverlaps, templates, eyebrows,
    bar: { display: getComputedStyle(actions).display, justify: getComputedStyle(actions).justifyContent, marginInline: getComputedStyle(actions).marginLeft, padBottom: getComputedStyle(actions).paddingBottom },
    barButtons: Array.from(actions.querySelectorAll('button')).map(b => { const bb = b.getBoundingClientRect(); const cs = getComputedStyle(b);
      return { text: b.textContent.trim().slice(0,14), w: Math.round(bb.width), left: Math.round(bb.left), right: Math.round(bb.right), flex: cs.flex, display: cs.display, width: cs.width }; }),
    contentBottom: Math.round(cr.bottom), contentPadBottom: getComputedStyle(content).paddingBottom,
    visibleBelowBar: Array.from(d.querySelectorAll('.recipe-simple-workers article')).map(el => { const b = el.getBoundingClientRect();
      return b.bottom > ar.bottom + 1 && b.top < cr.bottom ? { text: (el.textContent||'').trim().slice(0,18), top: Math.round(b.top), bottom: Math.round(b.bottom) } : null; }).filter(Boolean)
  }, null, 1);
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
  await wait(2500);
  fs.mkdirSync(outDir, { recursive: true });

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"needs\"]'); if (b) b.click(); return true; })()");
  await wait(1800);
  console.log("DECISION:", await window.webContents.executeJavaScript(NEEDS_PROBE));
  fs.writeFileSync(path.join(outDir, "needs.png"), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"recipes\"]'); if (b) b.click(); return true; })()");
  await wait(1500);
  const opened = await window.webContents.executeJavaScript("(() => { const b = Array.from(document.querySelectorAll('button')).find(x => x.textContent.trim() === 'New recipe'); if (!b) return 'no button'; b.click(); return 'ok'; })()");
  console.log("OPEN BUILDER:", opened);
  await wait(2000);
  console.log("RECIPE DIALOG:", await window.webContents.executeJavaScript(RECIPE_PROBE));
  fs.writeFileSync(path.join(outDir, "recipe-builder.png"), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("(() => { const c = document.querySelector('.recipes-content'); c.scrollTop = c.scrollHeight; const b = document.querySelector('.recipe-advanced-toggle'); if (b) b.click(); return true; })()");
  await wait(900);
  await window.webContents.executeJavaScript("(() => { const t = document.querySelector('.recipe-policy-grid'); if (t) t.scrollIntoView({ block: 'center' }); return true; })()");
  await wait(600);
  fs.writeFileSync(path.join(outDir, "recipe-policy.png"), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript("(() => { const c = document.querySelector('.recipes-content'); c.scrollTop = c.scrollHeight; return true; })()");
  await wait(1200);
  fs.writeFileSync(path.join(outDir, "recipe-advanced.png"), (await window.webContents.capturePage()).toPNG());

  window.destroy();
  app.quit();
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
