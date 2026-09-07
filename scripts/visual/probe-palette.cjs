// Finds the rules that did not follow the palette change.
//
//   npx electron scripts/visual/probe-palette.cjs [--routes a,b] [--theme orbital]
//
// Editing the token layer moves every surface that reads a token. What is left
// on screen afterwards is exactly the set of rules that named a colour
// literally — this reports those, grouped by value and named by the elements
// that carry them, so the sweep is a list rather than a hunt.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const theme = flag("theme", "orbital");
const routes = flag("routes", "groundstation,workspace,needs,agents,recipes,history,settings,integrations").split(",").filter(Boolean);
const probe = fs.readFileSync(path.join(__dirname, "probes", "palette.js"), "utf8");

const ROUTE_LABELS = {
  groundstation: "Groundstation", workspace: "Workspace", needs: "Needs You",
  agents: "Agents", recipes: "Recipes", history: "History",
  settings: "Settings", integrations: "Integrations"
};

ipcMain.handle("mission-control:request", async (_event, message) => {
  try {
    return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript(
    'window.localStorage.clear();window.localStorage.setItem("mission-control:interface-preferences:v1", JSON.stringify({' +
    'theme: "' + theme + '", typeScale: "comfortable", density: "comfortable", motion: "full",' +
    'terminalFontSize: 13, terminalTheme: "' + theme + '", terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true' +
    '}));true;'
  );
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await wait(2500);

  const merged = new Map();
  for (const route of routes) {
    const target = ROUTE_LABELS[route] || route;
    const clicked = await window.webContents.executeJavaScript(
      '(function(){var b=document.querySelector(\'.top-navigation button[aria-label=\'+JSON.stringify(' +
      JSON.stringify(target) + ')+\']\');if(!b)return false;b.click();return true;})();'
    );
    if (!clicked) { console.log("  !! could not reach " + route); continue; }
    await wait(1400);
    const strays = await window.webContents.executeJavaScript(probe);
    for (const s of strays) {
      const key = s.property + " " + s.value;
      if (!merged.has(key)) merged.set(key, { ...s, routes: new Set(), where: new Set(s.where) });
      const m = merged.get(key);
      m.count += s.count;
      m.routes.add(route);
      for (const w of s.where) m.where.add(w);
    }
  }

  const rows = [...merged.values()].sort((a, b) => b.count - a.count);
  console.log("\nOFF-PALETTE PAINTS (theme=" + theme + ")\n");
  for (const r of rows.slice(0, 45)) {
    console.log(
      String(r.count).padStart(4) + "  " + r.property.padEnd(16) + r.value.padEnd(30) +
      "  " + [...r.routes].join(",")
    );
    console.log("      " + [...r.where].slice(0, 6).join("  "));
  }
  console.log("\ndistinct stray values: " + rows.length);
  window.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try { await run(); } catch (error) {
    console.error("PROBE FAILED:", (error && error.stack) || error);
    process.exitCode = 1;
  }
  app.quit();
});
