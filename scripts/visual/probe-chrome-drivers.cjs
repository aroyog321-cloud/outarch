// For each band that refuses to shrink, reports the height of every descendant
// plus the computed box properties that set it, so the tall child is named
// rather than guessed at.
//
//   npx electron scripts/visual/probe-chrome-drivers.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
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

const TREE = [
  "(() => {",
  "  const out = [];",
  "  const walk = (el, depth, limit) => {",
  "    if (!el || depth > limit) return;",
  "    const r = el.getBoundingClientRect();",
  "    const cs = getComputedStyle(el);",
  "    out.push({",
  "      depth: depth,",
  "      sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : ''),",
  "      h: Math.round(r.height),",
  "      minH: cs.minHeight, lh: cs.lineHeight, fs: cs.fontSize,",
  "      pad: cs.paddingTop + '/' + cs.paddingBottom, disp: cs.display, gap: cs.rowGap",
  "    });",
  "    for (const child of el.children) walk(child, depth + 1, limit);",
  "  };",
  "  for (const spec of [['.workspace-toolbar-v2', 3], ['.workspace-background', 3], ['.terminal-pane__header', 3], ['.worker-folders', 2], ['.workspace-ops', 2], ['.workspace-browser__chrome', 3]]) {",
  "    const el = document.querySelector(spec[0]);",
  "    if (!el) { out.push({ depth: 0, sel: 'MISSING ' + spec[0], h: -1 }); continue; }",
  "    out.push({ depth: -1, sel: '--- ' + spec[0] + ' ---', h: -1 });",
  "    walk(el, 0, spec[1]);",
  "  }",
  "  return JSON.stringify(out);",
  "})()"
].join("\n");

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
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"workspace\"]'); if (b) b.click(); return true; })()");
  await settle(window, painter);
  await window.webContents.executeJavaScript("(() => { const l = Array.from(document.querySelectorAll('.layout-switcher button')); const b = l[l.length - 1]; if (b) b.click(); return true; })()");
  await settle(window, painter);
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('.workspace-browser-toggle'); if (b) b.click(); return true; })()");
  await settle(window, painter);

  const stage = await window.webContents.executeJavaScript(
    "(() => { const el = document.querySelector('.workspace-stage'); if (!el) return 'no stage'; const cs = getComputedStyle(el); " +
    "const find = document.querySelector('.workspace-toolbar-find'); " +
    "return JSON.stringify({ width: Math.round(el.getBoundingClientRect().width), containerType: cs.containerType, containerName: cs.containerName, " +
    "findDisplay: find ? getComputedStyle(find).display : null, deckWrap: getComputedStyle(document.querySelector('.workspace-toolbar-v2')).flexWrap }); })()"
  );
  console.log("STAGE:", stage);
  const title = await window.webContents.executeJavaScript(
    "(() => { const t = document.querySelector('.workspace-title'); const inner = t && t.firstElementChild && t.firstElementChild.nextElementSibling ? t.firstElementChild.nextElementSibling : (t ? t.firstElementChild : null); " +
    "const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.width)]; }; " +
    "const cs = t ? getComputedStyle(t) : {}; " +
    "return JSON.stringify({ title: box(t), inner: box(inner), scrollW: t ? t.scrollWidth : null, clientW: t ? t.clientWidth : null, " +
    "flex: cs.flex, minWidth: cs.minWidth, overflow: cs.overflow, deck: box(document.querySelector('.workspace-toolbar-v2')), " +
    "strong: box(document.querySelector('.workspace-title strong')), small: box(document.querySelector('.workspace-title small')) }); })()"
  );
  console.log("TITLE:", title);
  const rows = JSON.parse(await window.webContents.executeJavaScript(TREE));
  for (const row of rows) {
    if (row.depth === -1) { console.log("\n" + row.sel); continue; }
    console.log(
      "  " + "  ".repeat(row.depth) + String(row.h).padStart(4) + "px  " + row.sel.padEnd(46) +
      " min=" + row.minH + " lh=" + row.lh + " fs=" + row.fs + " pad=" + row.pad + " disp=" + row.disp + " rowGap=" + row.gap
    );
  }
  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(e => { console.error("probe failed:", e); app.exit(1); }));
