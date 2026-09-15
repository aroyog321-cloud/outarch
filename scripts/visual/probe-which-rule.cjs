// Given a selector, lists every stylesheet rule that matches the element and
// declares the named property, in document order, so the winner is provable
// rather than deduced from specificity by hand.
//
//   npx electron scripts/visual/probe-which-rule.cjs --nav needs --sel ".decision-item h3" --prop font-size
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const nav = flag("nav", "needs");
const sel = flag("sel", ".decision-item h3");
const prop = flag("prop", "font-size");

ipcMain.handle("mission-control:request", async (_event, message) => ({
  version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params)
}));
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const window = new BrowserWindow({
    width: 1440, height: 900, show: true, backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript("window.localStorage.clear(); true;");
  window.reload();
  await new Promise(r => window.webContents.once("did-finish-load", r));
  await wait(3000);
  await window.webContents.executeJavaScript(`(() => { const b = document.querySelector('[data-nav-id="${nav}"]'); if (b) b.click(); return true; })()`);
  await wait(2500);

  const report = await window.webContents.executeJavaScript(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)});
    if (!el) return JSON.stringify({ missing: true });
    const hits = [];
    const walk = rules => {
      for (const rule of rules) {
        if (rule.cssRules) { walk(rule.cssRules); continue; }
        if (!rule.selectorText || !rule.style) continue;
        const value = rule.style.getPropertyValue(${JSON.stringify(prop)});
        if (!value) continue;
        for (const one of rule.selectorText.split(',')) {
          let matches = false;
          try { matches = el.matches(one.trim()); } catch { matches = false; }
          if (matches) { hits.push({ selector: one.trim(), value, priority: rule.style.getPropertyPriority(${JSON.stringify(prop)}) }); break; }
        }
      }
    };
    for (const sheet of document.styleSheets) { try { walk(sheet.cssRules); } catch {} }
    return JSON.stringify({ computed: getComputedStyle(el)[${JSON.stringify(prop)}], hits }, null, 1);
  })()`);
  console.log("RULES for", sel, prop, "\n" + report);
  window.destroy();
  app.quit();
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
