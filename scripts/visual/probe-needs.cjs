// Confirms the worker/agent failures reach the Needs You queue and screenshots
// them in place.
//   npx electron scripts/visual/probe-needs.cjs --label after
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf("--" + name); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "dist/visual/issues"));
const label = flag("label", "run");

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
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"needs\"]'); if (b) b.click(); return Boolean(b); })()");
  await waitFor(window, ".needs-list");
  await wait(1200);

  const items = await window.webContents.executeJavaScript(`
    (() => {
      const list = document.querySelector('.needs-list');
      const entries = [...list.children].map(node => ({
        title: (node.querySelector('h3, strong') || node).textContent.slice(0, 80),
        classes: node.className
      }));
      const first = list.children[0];
      if (first) first.scrollIntoView({ block: 'center' });
      return { count: list.children.length, entries };
    })()
  `);
  await wait(900);
  if (frames.image) fs.writeFileSync(path.join(outDir, "needs-queue." + label + ".png"), frames.image.toPNG());
  console.log(JSON.stringify(items, null, 2));
  window.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(run).then(() => app.exit(0)).catch(error => { console.error("PROBE FAILED:", error.message); app.exit(1); });
