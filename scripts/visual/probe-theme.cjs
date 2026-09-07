// Measures computed colours on the workspace and agents surfaces in a chosen
// theme, so a "this looks dark in Solar" observation becomes a number instead
// of a guess about which stylesheet won.
//
//   npx electron scripts/visual/probe-theme.cjs --theme solar
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
const theme = flag("theme", "solar");
const outFile = path.resolve(repoRoot, flag("out", "dist/visual/theme-probe.json"));

ipcMain.handle("mission-control:request", (_event, message) => {
  try {
    return { version: 1, id: message.id, ok: true, result: fixtures.handle(message.method, message.params) };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const window = new BrowserWindow({
    width: 1280, height: 900, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript(
    'window.localStorage.setItem("mission-control:interface-preferences:v1", JSON.stringify({' +
    'theme: "' + theme + '", typeScale: "comfortable", density: "comfortable", motion: "full",' +
    'terminalFontSize: 13, terminalTheme: "' + theme + '", terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true' +
    '})); true;'
  );
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await wait(2500);

  const measure = async (route, selectors) => {
    await window.webContents.executeJavaScript(
      '(() => { const b = document.querySelector(\'[data-nav-id="' + route + '"]\'); if (b) b.click(); return true; })()'
    );
    await wait(1500);
    return window.webContents.executeJavaScript(
      '(' + function (list) {
        const seen = {};
        for (const sel of list) {
          const el = document.querySelector(sel);
          if (!el) { seen[sel] = "ABSENT"; continue; }
          const cs = getComputedStyle(el);
          const box = el.getBoundingClientRect();
          seen[sel] = {
            background: cs.backgroundColor,
            backgroundImage: cs.backgroundImage === "none" ? null : cs.backgroundImage.slice(0, 60),
            color: cs.color,
            rect: [Math.round(box.x), Math.round(box.y), Math.round(box.width), Math.round(box.height)]
          };
        }
        return seen;
      }.toString() + ')(' + JSON.stringify(selectors) + ')'
    );
  };

  const report = {
    theme,
    root: await window.webContents.executeJavaScript('document.documentElement.className'),
    workspace: await measure("workspace", [
      ".workspace-experience", ".workspace-stage", ".worker-folders", ".worker-folder-list",
      ".worker-folder-list > button", ".terminal-grid", ".view-workspace"
    ]),
    agents: await measure("agents", [".agent-detail-tabs", ".agent-current-action", ".agents-view"])
  };
  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(run).catch(error => { console.error(error); process.exitCode = 1; app.quit(); });
