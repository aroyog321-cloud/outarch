// Renders a detached terminal window (the pop-out route) offscreen and reports
// its chrome geometry, so the 32px title strip, the identity badge and the
// status footer are checked against the real build rather than assumed.
//
//   npx electron scripts/visual/probe-popout.cjs --out artifacts/visual/popout --slot 1
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
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/popout"));
const theme = flag("theme", "orbital");
const slot = flag("slot", "1");
const worker = flag("worker", "web");
const workerName = flag("name", "Web dev server");
// The accepted floor for a pop-out, which is where its chrome has to still work.
const width = Number(flag("width", 480));
const height = Number(flag("height", 320));

ipcMain.handle("mission-control:request", (_event, message) => {
  const result = (() => {
    if (message.method === "usage.query") {
      return { available: true, totals: { callCount: 6, totalTokens: 41_200, totalCost: 0.0219, byModel: {}, unknownTokenRequests: 0, unpricedRequests: 0, failedRequests: 0, coverage: "complete" }, records: [] };
    }
    if (message.method === "terminal.window.list") return { detached: [], max: 3, available: true };
    return fixtures.handle(message.method, message.params);
  })();
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
    const level = String(details.level);
    if (level === "error" || Number(details.level) >= 3) problems.push(`console ${level}: ${String(details.message).slice(0, 300)}`);
  });

  const indexPath = path.join(repoRoot, "dist", "groundstation", "renderer", "index.html");
  await window.loadFile(indexPath, { query: { popout: "1", worker, slot, name: workerName } });
  await window.webContents.executeJavaScript(`
    window.localStorage.setItem("mission-control:interface-preferences:v1", JSON.stringify({
      theme: ${JSON.stringify(theme)}, typeScale: "comfortable", density: "comfortable", motion: "full",
      terminalFontSize: 13, terminalTheme: ${JSON.stringify(theme)}, terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true
    }));
    true;
  `);
  await window.loadFile(indexPath, { query: { popout: "1", worker, slot, name: workerName } });
  await wait(3500);

  const report = await window.webContents.executeJavaScript(`
    (() => {
      const root = document.querySelector('.popout-window');
      if (!root) return { mounted: false };
      const bar = document.querySelector('.popout-titlebar');
      const foot = document.querySelector('.popout-footer');
      const body = document.querySelector('.popout-body');
      const badge = document.querySelector('.detached-badge');
      const recall = document.querySelector('.popout-recall');
      const cs = getComputedStyle(root);
      return {
        mounted: true,
        accent: cs.getPropertyValue('--slot-accent').trim(),
        titleBarHeight: bar ? Math.round(bar.getBoundingClientRect().height) : null,
        footerHeight: foot ? Math.round(foot.getBoundingClientRect().height) : null,
        bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : null,
        terminalShare: body ? Math.round(body.getBoundingClientRect().height / window.innerHeight * 100) : null,
        badgeText: badge ? badge.textContent.trim() : null,
        recallLabel: recall ? recall.textContent.trim() : null,
        title: document.title,
        footerText: foot ? foot.textContent.replace(/\\s+/g, ' ').trim() : null,
        boundary: (() => { const out=[]; for (const sel of [".popout-titlebar",".popout-body",".terminal-pane",".terminal-pane__header",".terminal-pane__viewport"]) { const el=document.querySelector(sel); if(!el) continue; const c=getComputedStyle(el); out.push({ sel, borderTop: c.borderTopWidth+" "+c.borderTopColor, borderBottom: c.borderBottomWidth+" "+c.borderBottomColor, boxShadow: c.boxShadow.slice(0,90), bg: c.backgroundColor }); } return out; })(),
        pageScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        pageScrollsY: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1
      };
    })()
  `);

  if (image && !image.isEmpty()) {
    fs.writeFileSync(path.join(outDir, `popout-slot${slot}.${theme}.${width}x${height}.png`), image.toPNG());
  }
  console.log(JSON.stringify({ ...report, problems }, null, 2));
}

app.disableHardwareAcceleration();
app.whenReady().then(run).then(() => app.quit()).catch(error => { console.error(error); process.exitCode = 1; app.quit(); });
