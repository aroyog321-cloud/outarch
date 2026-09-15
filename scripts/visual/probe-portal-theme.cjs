// Do portalled surfaces follow the active theme?
//
// The theme is a class on `.shell`, but Radix portals render into <body> —
// outside it. This reports the resolved token values inside the shell and on a
// real portalled menu, in Solar Light, so "the popover is dark in the light
// theme" is a measurement rather than a suspicion.
//
//   npx electron scripts/visual/probe-portal-theme.cjs --theme solar
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const theme = flag("theme", "solar");
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
  await settle(window, painter, { quietMs: 800, timeoutMs: 11000 });
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"workspace\"]'); if (b) b.click(); return true; })()");
  await settle(window, painter);

  // Open the app's own long-standing portalled menu — the pane ⋯ menu.
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('.terminal-more'); if (b) b.click(); return true; })()");
  await settle(window, painter, { quietMs: 500 });

  const report = await window.webContents.executeJavaScript(
    "(() => { const read = (el, prop) => el ? getComputedStyle(el).getPropertyValue(prop).trim() : null;" +
    " const shell = document.querySelector('.shell');" +
    " const menu = document.querySelector('.terminal-action-menu');" +
    " const tray = document.querySelector('.terminal-pane-tray');" +
    " const paint = el => el ? { bg: getComputedStyle(el).backgroundColor, color: getComputedStyle(el).color } : null;" +
    " return JSON.stringify({" +
    "  htmlClass: document.documentElement.className, bodyClass: document.body.className," +
    "  shellClass: shell ? shell.className.split(' ').filter(c => c.startsWith('theme-')).join(',') : null," +
    "  shellSurface2: read(shell, '--mc-surface-2'), shellText: read(shell, '--mc-text')," +
    "  rootSurface2: read(document.documentElement, '--mc-surface-2'), rootText: read(document.documentElement, '--mc-text')," +
    "  menuInShell: menu ? Boolean(menu.closest('.shell')) : null," +
    "  menuTokens: menu ? { surface2: read(menu, '--mc-surface-2'), text: read(menu, '--mc-text') } : null," +
    "  menuPaint: paint(menu), trayPaint: paint(tray)," +
    "  bodyPaint: paint(document.body)" +
    " }); })()"
  );
  console.log("PORTAL THEME (" + theme + "):", report);

  const deck = await window.webContents.executeJavaScript(
    "(() => { const out = {}; for (const sel of ['.workspace-add-worker', '.workspace-browser-toggle', '.workspace-recipes', '.workspace-launch', '.workspace-focus-mode']) {" +
    "   const el = document.querySelector(sel); if (!el) { out[sel] = null; continue; }" +
    "   const cs = getComputedStyle(el); const label = el.querySelector('.workspace-action-label');" +
    "   out[sel] = { color: cs.color, bg: cs.backgroundColor, opacity: cs.opacity," +
    "     labelColor: label ? getComputedStyle(label).color : null, labelDisplay: label ? getComputedStyle(label).display : null }; }" +
    " return JSON.stringify(out); })()"
  );
  console.log("DECK BUTTONS (" + theme + "):", deck);

  // Which rule is colouring the wrapped label? Ask the engine directly rather
  // than guessing at the cascade.
  const matched = await window.webContents.executeJavaScript(
    "(() => { const el = document.querySelector('.workspace-add-worker .workspace-action-label'); if (!el) return 'no label';" +
    " const hits = [];" +
    " for (const sheet of document.styleSheets) {" +
    "   let rules; try { rules = sheet.cssRules; } catch { continue; }" +
    "   const walk = list => { for (const rule of list) {" +
    "     if (rule.cssRules) { walk(rule.cssRules); continue; }" +
    "     if (!rule.selectorText || !rule.style || !rule.style.color) continue;" +
    "     let m = false; try { m = el.matches(rule.selectorText); } catch { m = false; }" +
    "     if (m) hits.push({ sel: rule.selectorText.slice(0, 140), color: rule.style.color, priority: rule.style.getPropertyPriority('color') });" +
    "   } };" +
    "   walk(rules);" +
    " }" +
    " const parent = el.parentElement;" +
    " return JSON.stringify({ labelColor: getComputedStyle(el).color, parentColor: getComputedStyle(parent).color," +
    "   parentClass: parent.className, count: document.querySelectorAll('.workspace-action-label').length, hits: hits }); })()"
  );
  console.log("LABEL COLOUR RULES:", matched);

  // Decisive: put a bare span and a classed span inside the same button and
  // compare. If the bare one is grey too, a rule matches `span` in this
  // context; if only the classed one is, the class is the cause.
  const probe = await window.webContents.executeJavaScript(
    "(() => { const button = document.querySelector('.workspace-add-worker'); if (!button) return 'no button';" +
    " const bare = document.createElement('span'); bare.textContent = 'x'; button.appendChild(bare);" +
    " const classed = document.createElement('span'); classed.className = 'workspace-action-label'; classed.textContent = 'y'; button.appendChild(classed);" +
    " const read = el => { const cs = getComputedStyle(el); return { color: cs.color, display: cs.display, fontSize: cs.fontSize }; };" +
    " const result = { button: read(button), bare: read(bare), classed: read(classed)," +
    "   existing: read(button.querySelector('.workspace-action-label'))," +
    "   sheets: document.styleSheets.length," +
    "   unreadable: Array.from(document.styleSheets).filter(sheet => { try { void sheet.cssRules; return false; } catch { return true; } }).length };" +
    " bare.remove(); classed.remove(); return JSON.stringify(result); })()"
  );
  console.log("SPAN EXPERIMENT:", probe);

  const rules = await window.webContents.executeJavaScript(
    "(() => { const button = document.querySelector('.workspace-add-worker');" +
    " const bare = document.createElement('span'); bare.textContent = 'x'; button.appendChild(bare);" +
    " const hits = []; const failed = [];" +
    " for (const sheet of document.styleSheets) {" +
    "   let list; try { list = sheet.cssRules; } catch { continue; }" +
    "   const walk = rs => { for (const rule of rs) {" +
    "     if (rule.cssRules) { walk(rule.cssRules); continue; }" +
    "     if (!rule.selectorText) continue;" +
    "     try { if (bare.matches(rule.selectorText)) hits.push({ sel: rule.selectorText.slice(0, 150), css: rule.style.cssText.slice(0, 200) }); }" +
    "     catch (error) { failed.push(rule.selectorText.slice(0, 90)); }" +
    "   } }; walk(list);" +
    " }" +
    " bare.remove();" +
    " return JSON.stringify({ hits: hits, failedSelectors: failed.slice(0, 8) }, null, 1); })()"
  );
  console.log("BARE SPAN RULES:", rules);

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(e => { console.error("probe failed:", e); app.exit(1); }));
