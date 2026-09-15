// Why do a narrow terminal's header controls disappear?
//
// Reports, for every pane on the canvas: the header's content width (the box a
// `pane-head` container query actually measures), the action cluster's
// rectangle, and each control inside it with its computed display and whether
// it is clipped by the header's own right edge. Runs normal mode and focus
// mode, because focus mode is where the tiles get narrow enough to hurt.
//
//   npx electron scripts/visual/probe-pane-actions.cjs
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

const MEASURE = [
  "(() => {",
  "  const panes = Array.from(document.querySelectorAll('.terminal-pane')).map(pane => {",
  "    const head = pane.querySelector('.terminal-pane__header');",
  "    if (!head) return null;",
  "    const hs = getComputedStyle(head);",
  "    const contentW = Math.round(head.clientWidth - parseFloat(hs.paddingLeft) - parseFloat(hs.paddingRight));",
  "    const hr = head.getBoundingClientRect();",
  "    const actions = pane.querySelector('.terminal-pane__actions');",
  "    const ar = actions ? actions.getBoundingClientRect() : null;",
  "    const controls = actions ? Array.from(actions.children).map(el => {",
  "      const r = el.getBoundingClientRect();",
  "      const cs = getComputedStyle(el);",
  "      return {",
  "        cls: (String(el.className) || el.tagName).trim().split(/\\s+/).slice(0, 2).join('.'),",
  "        w: Math.round(r.width), right: Math.round(r.right),",
  "        display: cs.display, vis: cs.visibility,",
  "        clipped: r.width > 0 && (r.right > hr.right + 0.5 || r.left < hr.left - 0.5)",
  "      };",
  "    }) : [];",
  "    const identity = pane.querySelector('.terminal-pane__identity');",
  "    return {",
  "      name: (pane.querySelector('.terminal-session-trigger strong') || {}).textContent || '?',",
  "      paneW: Math.round(pane.getBoundingClientRect().width),",
  "      headContentW: contentW,",
  "      headScrollW: head.scrollWidth,",
  "      headClientW: head.clientWidth,",
  "      overflowing: head.scrollWidth > head.clientWidth + 1,",
  "      identityW: identity ? Math.round(identity.getBoundingClientRect().width) : null,",
  "      actionsW: ar ? Math.round(ar.width) : null,",
  "      actionsRight: ar ? Math.round(ar.right) : null,",
  "      headRight: Math.round(hr.right),",
  "      controls: controls",
  "    };",
  "  }).filter(Boolean);",
  "  return JSON.stringify(panes);",
  "})()"
].join("\n");

function report(label, rows) {
  console.log("\n===== " + label + " =====");
  for (const pane of rows) {
    console.log(
      `\n  ${pane.name}  pane=${pane.paneW}px  head content=${pane.headContentW}px` +
      `  scroll=${pane.headScrollW}/${pane.headClientW}${pane.overflowing ? "  << OVERFLOWING" : ""}`
    );
    console.log(`    identity=${pane.identityW}px  actions=${pane.actionsW}px  actionsRight=${pane.actionsRight} headRight=${pane.headRight}`);
    for (const control of pane.controls) {
      console.log(
        `      ${control.cls.padEnd(34)} w=${String(control.w).padStart(3)} display=${control.display.padEnd(11)}` +
        `${control.clipped ? "  << CLIPPED" : ""}${control.display === "none" ? "  (shed)" : ""}`
      );
    }
  }
}

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

  report("normal · 3x2", JSON.parse(await window.webContents.executeJavaScript(MEASURE)));

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('.workspace-focus-mode'); if (b) b.click(); return true; })()");
  await settle(window, painter);
  report("focus mode · mosaic", JSON.parse(await window.webContents.executeJavaScript(MEASURE)));

  const focusChrome = await window.webContents.executeJavaScript(
    "(() => { const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left), bottom: Math.round(r.bottom) }; };" +
    " const grid = document.querySelector('.terminal-grid'); const deck = document.querySelector('.workspace-toolbar-v2');" +
    " const gs = grid ? getComputedStyle(grid) : {}; const ds = deck ? getComputedStyle(deck) : {};" +
    " return JSON.stringify({ grid: box(grid), gridMarginBottom: gs.marginBottom, deck: box(deck), deckPosition: ds.position, stage: box(document.querySelector('.workspace-stage')) }); })()"
  );
  console.log("\nFOCUS CHROME:", focusChrome);

  // With the browser tile open, the focus deck must not end up over the native
  // view: a native child view cannot be stacked under DOM, so the way out of
  // focus mode would render behind the previewed page.
  await window.webContents.executeJavaScript(
    "(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', altKey: true, bubbles: true })); return true; })()"
  );
  await settle(window, painter);
  const withBrowser = await window.webContents.executeJavaScript(
    "(() => { const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { h: Math.round(r.height), top: Math.round(r.top), bottom: Math.round(r.bottom) }; };" +
    " const grid = document.querySelector('.terminal-grid'); const deck = document.querySelector('.workspace-toolbar-v2');" +
    " const viewport = document.querySelector('.workspace-browser__viewport');" +
    " const g = box(grid); const d = box(deck);" +
    " return JSON.stringify({ hasBrowser: Boolean(viewport), gridMarginBottom: getComputedStyle(grid).marginBottom," +
    "  grid: g, deck: d, deckClearsGrid: g && d ? d.top >= g.bottom : null, viewport: box(viewport) }); })()"
  );
  console.log("FOCUS + BROWSER:", withBrowser);

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(e => { console.error("probe failed:", e); app.exit(1); }));
