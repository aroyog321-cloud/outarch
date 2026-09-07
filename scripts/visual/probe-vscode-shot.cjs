// Screenshots the VS Code Bridge panel in whichever state the fixture reports.
//   MC_FIXTURE_VSCODE=connected npx electron scripts/visual/probe-vscode-shot.cjs --label after
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf("--" + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "dist/visual/issues"));
const label = flag("label", "run");
const state = process.env.MC_FIXTURE_VSCODE === "connected" ? "connected" : "disconnected";

ipcMain.handle("mission-control:request", (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitFor = (window, selector) => window.webContents.executeJavaScript(
  "new Promise((resolve, reject) => { const s = Date.now(); const poll = () => {" +
  " if (document.querySelector(" + JSON.stringify(selector) + ")) return resolve(true);" +
  " if (Date.now() - s > 20000) return reject(new Error('never mounted: ' + " + JSON.stringify(selector) + "));" +
  " setTimeout(poll, 100); }; poll(); })");

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  window.webContents.setFrameRate(30);
  const frames = { image: null };
  window.webContents.on("paint", (_e, _d, image) => { frames.image = image; });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await waitFor(window, ".top-navigation");
  await wait(1200);
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"integrations\"]'); if (b) b.click(); return Boolean(b); })()");
  await waitFor(window, ".integration-hub-tabs");
  await wait(600);
  await window.webContents.executeJavaScript("(() => { const t = [...document.querySelectorAll('.integration-hub-tabs button')].find(b => b.textContent.includes('VS Code')); if (t) t.click(); return Boolean(t); })()");
  await waitFor(window, ".vscode-bridge-settings");
  await wait(1200);
  if (frames.image) fs.writeFileSync(path.join(outDir, "vscode-" + state + "." + label + ".png"), frames.image.toPNG());

  const metrics = await window.webContents.executeJavaScript(`
    (() => {
      const panel = document.querySelector('.vscode-bridge-settings');
      const rect = panel.getBoundingClientRect();
      const cells = [...document.querySelectorAll('.vscode-sync-summary > div')].map(n => Math.round(n.getBoundingClientRect().height));
      const steps = document.querySelector('.vscode-setup-steps');
      const trust = document.querySelector('.vscode-bridge-body .trust-boundary');
      return {
        panelHeight: Math.round(rect.height),
        summaryColumns: document.querySelector('.vscode-sync-summary') ? getComputedStyle(document.querySelector('.vscode-sync-summary')).gridTemplateColumns : null,
        summaryCellHeights: cells,
        stepsDisplay: steps ? getComputedStyle(steps).display : null,
        stepsListStyle: steps ? getComputedStyle(steps).listStyleType : null,
        stepsHeight: steps ? Math.round(steps.getBoundingClientRect().height) : null,
        trustWidth: trust ? Math.round(trust.getBoundingClientRect().width) : null,
        trustHeight: trust ? Math.round(trust.getBoundingClientRect().height) : null,
        terminalRows: document.querySelectorAll('.vscode-terminal-list article').length
      };
    })()
  `);
  console.log(JSON.stringify({ state, label, metrics }, null, 2));
  window.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(run).then(() => app.exit(0)).catch(error => { console.error("PROBE FAILED:", error.message); app.exit(1); });
