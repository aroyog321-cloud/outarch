// Renders the post-crash recovery review against the built renderer, offscreen.
// The route capture never reaches it because it only appears after an unclean
// shutdown, so this is the pass that actually inspects it.
//
//   npx electron scripts/visual/probe-recovery.cjs --out artifacts/visual/recovery
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/recovery"));
const theme = flag("theme", "orbital");
const width = Number(flag("width", 1280));
const height = Number(flag("height", 900));

// A representative reconciliation: one worker still alive, two interrupted, one
// that finished on its own before the crash.
const REPORT = {
  projectId: "proj-1",
  cleanShutdown: false,
  recoveryRequired: true,
  launchesDeferred: true,
  uncleanWorkerCount: 2,
  workers: [
    { workerId: "storefront", recoveryState: "interrupted", pid: 4242, previousStatus: "running" },
    { workerId: "api-gateway", recoveryState: "interrupted", pid: 4390, previousStatus: "running" },
    { workerId: "postgres-tunnel", recoveryState: "running-reconnectable", pid: 4001, previousStatus: "running" },
    { workerId: "unit-tests", recoveryState: "exited", pid: null, previousStatus: "exited" }
  ]
};

ipcMain.handle("mission-control:request", (_event, message) => {
  const result = message.method === "recovery.inspect"
    ? REPORT
    : message.method === "recovery.resume"
      ? { started: ["storefront", "api-gateway"] }
      : fixtures.handle(message.method, message.params);
  return { version: 1, id: message.id, ok: true, result };
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const problems = [];

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  const window = new BrowserWindow({
    width, height, show: false, frame: false, backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  window.webContents.setFrameRate(30);
  let image = null;
  window.webContents.on("paint", (_event, _dirty, next) => { image = next; });
  window.webContents.on("console-message", (...args) => {
    const details = args[0] && typeof args[0] === "object" && "level" in args[0] ? args[0] : { level: args[1], message: args[2] };
    if (String(details.level) === "error" || Number(details.level) >= 3) {
      problems.push(`console error: ${String(details.message).slice(0, 300)}`);
    }
  });

  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript(`
    window.localStorage.setItem("mission-control:interface-preferences:v1", JSON.stringify({
      theme: ${JSON.stringify(theme)}, typeScale: "comfortable", density: "comfortable", motion: "full",
      terminalFontSize: 13, terminalTheme: ${JSON.stringify(theme)}, terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true
    }));
    true;
  `);
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await wait(3000);

  const collapsed = await window.webContents.executeJavaScript(`
    (() => {
      const panel = document.querySelector(".recovery-review");
      if (!panel) return { mounted: false };
      const rect = panel.getBoundingClientRect();
      return {
        mounted: true,
        heading: panel.querySelector("[id] strong, .recovery-review__lead strong")?.textContent || null,
        lead: panel.querySelector(".recovery-review__lead p")?.textContent || null,
        primary: panel.querySelector(".btn-primary")?.textContent || null,
        secondary: panel.querySelector(".btn-ghost")?.textContent || null,
        height: Math.round(rect.height),
        overflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    })()
  `);
  if (image && !image.isEmpty()) {
    fs.writeFileSync(path.join(outDir, `recovery-collapsed.${theme}.png`), image.toPNG());
  }

  // Expand the reconciliation list, which is where the per-worker states read.
  await window.webContents.executeJavaScript(`
    (() => { document.querySelector(".recovery-review__toggle")?.click(); return true; })()
  `);
  await wait(900);

  const expanded = await window.webContents.executeJavaScript(`
    (() => {
      const rows = [...document.querySelectorAll(".recovery-review__row")];
      return {
        rows: rows.length,
        tones: rows.map(row => row.dataset.tone),
        states: rows.map(row => row.querySelector(".recovery-review__state")?.textContent),
        overflowsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
      };
    })()
  `);
  if (image && !image.isEmpty()) {
    fs.writeFileSync(path.join(outDir, `recovery-expanded.${theme}.png`), image.toPNG());
  }

  console.log(JSON.stringify({ collapsed, expanded, problems }, null, 2));
}

app.disableHardwareAcceleration();
app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); process.exitCode = 1; app.quit(); });
