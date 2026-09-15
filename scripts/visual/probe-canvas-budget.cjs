// Measures how much of the Workspace window the terminals actually get.
// Reports every band above/below the canvas, per-pane chrome, and the number
// of terminal rows each pane can show — in normal mode and in focus mode.
//
//   npx electron scripts/visual/probe-canvas-budget.cjs --out artifacts/visual/budget
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/budget"));
const theme = flag("theme", "orbital");
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));

const SERVICES = [{ id: "svc-1", workerId: "web", workerName: "Web dev server", url: "http://localhost:5173", port: 5173, state: "ready", generation: 1, updatedAt: Date.now() - 2000 }];
// A fixture may answer asynchronously; a pending promise cannot cross the
// bridge, so the request fails and the probe measures a screen without data.
ipcMain.handle("mission-control:request", async (_event, message) => {
  const result = message.method === "services.list"
    ? { services: SERVICES, available: true }
    : await fixtures.handle(message.method, message.params);
  return { version: 1, id: message.id, ok: true, result };
});

const wait = ms => new Promise(r => setTimeout(r, ms));
function createPainter(w) { const s = { image: null, count: 0 }; w.webContents.on("paint", (_e, _d, image) => { s.image = image; s.count += 1; }); return s; }
async function settle(w, p, { quietMs = 600, timeoutMs = 9000 } = {}) {
  const deadline = Date.now() + timeoutMs; let seen = p.count; let quiet = Date.now();
  while (Date.now() < deadline) { await wait(100); if (p.count !== seen) { seen = p.count; quiet = Date.now(); continue; } if (Date.now() - quiet >= quietMs && p.image) return p.image; }
  return p.image;
}

const MEASURE = [
  "(() => {",
  "  const box = el => { if (!el) return null; const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top) }; };",
  "  const stage = document.querySelector('.workspace-stage');",
  "  const exp = document.querySelector('.workspace-experience');",
  "  const grid = document.querySelector('.terminal-grid');",
  "  const bands = stage ? Array.from(stage.children).map(child => Object.assign({",
  "    cls: String(child.className).split(' ').filter(Boolean).slice(0, 2).join('.'),",
  "    tag: child.tagName.toLowerCase()",
  "  }, box(child))) : [];",
  "  const panes = Array.from(document.querySelectorAll('.terminal-pane')).map(pane => {",
  "    const host = pane.querySelector('.terminal-host');",
  "    const rows = host ? host.querySelector('.xterm-rows') : null;",
  "    return {",
  "      name: (pane.querySelector('.terminal-session-trigger strong') || {}).textContent || '?',",
  "      pane: box(pane),",
  "      header: box(pane.querySelector('.terminal-pane__header')),",
  "      activity: box(pane.querySelector('.terminal-pane__activity')),",
  "      host: box(host),",
  "      metricStrip: box(pane.querySelector('.worker-metric-strip')),",
  "      telemetry: box(pane.querySelector('.terminal-pane__telemetry')),",
  "      roleTag: box(pane.querySelector('.terminal-role-tag')),",
  "      rowCount: rows ? rows.children.length : null,",
  "      crash: box(pane.querySelector('.crash-lens'))",
  "    };",
  "  });",
  "  const chrome = bands.filter(b => b.cls.indexOf('terminal-grid') !== 0).reduce((sum, b) => sum + b.h, 0);",
  "  return JSON.stringify({",
  "    viewport: { w: window.innerWidth, h: window.innerHeight },",
  "    experience: box(exp), stage: box(stage), grid: box(grid),",
  "    chromeAroundCanvas: chrome,",
  "    canvasShare: exp && grid ? Math.round((grid.h / exp.h) * 100) : null,",
  "    bands: bands, panes: panes,",
  "    statusBar: box(document.querySelector('.mission-status-bar')),",
  "    scrollOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight",
  "  }, null, 1);",
  "})()"
].join("\n");

const click = selectorExpression => selectorExpression;

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  const window = new BrowserWindow({
    width, height, show: false, frame: false, backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  window.webContents.setFrameRate(30);
  const painter = createPainter(window);
  const problems = [];
  window.webContents.on("console-message", (...args) => {
    const d = args[0] && typeof args[0] === "object" && "level" in args[0] ? args[0] : { level: args[1], message: args[2] };
    if (String(d.level) === "error" || Number(d.level) >= 3) problems.push("console: " + String(d.message).slice(0, 300));
  });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  const prefs = JSON.stringify({
    theme, typeScale: "comfortable", density: "comfortable", motion: "full",
    terminalFontSize: 13, terminalTheme: theme, terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true
  });
  await window.webContents.executeJavaScript(
    "window.localStorage.clear();\n" +
    "window.localStorage.setItem('mission-control:interface-preferences:v1', " + JSON.stringify(prefs) + ");\ntrue;"
  );
  window.reload();
  await new Promise(r => window.webContents.once("did-finish-load", r));
  await settle(window, painter, { quietMs: 700, timeoutMs: 10000 });

  const ok = await window.webContents.executeJavaScript(
    click("(() => { const b = document.querySelector('[data-nav-id=\"workspace\"]'); if (!b) return false; b.click(); return true; })()")
  );
  if (!ok) throw new Error("workspace nav unavailable");
  await settle(window, painter);
  // Six-pane layout is the density case the complaint is about.
  await window.webContents.executeJavaScript(
    "(() => { const list = Array.from(document.querySelectorAll('.layout-switcher button')); const b = list[list.length - 1]; if (b) b.click(); return true; })()"
  );
  await settle(window, painter);

  const report = { width, height, theme, problems };
  report.normal = JSON.parse(await window.webContents.executeJavaScript(MEASURE));
  let img = painter.image;
  if (img && !img.isEmpty()) fs.writeFileSync(path.join(outDir, "workspace-normal." + width + ".png"), img.toPNG());

  await window.webContents.executeJavaScript(
    "(() => { const b = document.querySelector('.workspace-focus-mode'); if (b) b.click(); return true; })()"
  );
  await settle(window, painter);
  report.focus = JSON.parse(await window.webContents.executeJavaScript(MEASURE));
  img = painter.image;
  if (img && !img.isEmpty()) fs.writeFileSync(path.join(outDir, "workspace-focus." + width + ".png"), img.toPNG());

  fs.writeFileSync(path.join(outDir, "budget." + width + ".json"), JSON.stringify(report, null, 1));
  const summarise = (label, r) => {
    console.log("\n=== " + label + " @ " + width + "x" + height + " ===");
    console.log("experience " + (r.experience && r.experience.h) + "px  canvas " + (r.grid && r.grid.h) + "px (" + r.canvasShare + "%)  chrome around canvas " + r.chromeAroundCanvas + "px  doc overflow " + r.scrollOverflow);
    for (const b of r.bands) console.log("  band " + String(b.h).padStart(4) + "px  " + b.tag + "." + b.cls);
    for (const p of r.panes.slice(0, 3)) {
      console.log("  pane \"" + p.name + "\" " + (p.pane && p.pane.h) + "px = header " + (p.header && p.header.h) + " + activity " + (p.activity && p.activity.h) + " + host " + (p.host && p.host.h) + " (rows " + p.rowCount + ") metricStrip " + (p.metricStrip ? p.metricStrip.h : "-") + " crash " + (p.crash ? p.crash.h : "-"));
    }
  };
  summarise("NORMAL", report.normal);
  summarise("FOCUS", report.focus);
  if (problems.length) console.log("\nPROBLEMS:\n" + problems.join("\n"));
  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(error => { console.error("probe failed:", error); app.exit(1); }));
