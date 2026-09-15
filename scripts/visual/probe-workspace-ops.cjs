// Renders the workspace operations drawer (Services + Usage) and the detached
// terminal placeholder against the built renderer, offscreen, with populated
// fixtures. The default visual matrix only captures the closed rail, so this is
// the pass that actually inspects the panels people will read.
//
//   npx electron scripts/visual/probe-workspace-ops.cjs --out artifacts/visual/ops --theme orbital
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
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/ops"));
const theme = flag("theme", "orbital");
const width = Number(flag("width", 1280));
const height = Number(flag("height", 900));

// Representative discovery: a ready frontend, an API advertising a health path,
// a database listener, and a record whose worker restarted and stopped
// reporting — the four rows that have to read differently from each other.
const SERVICES = [
  { id: "svc-1", workerId: "storefront", workerName: "Storefront", url: "http://localhost:5173", port: 5173, state: "ready", generation: 1, updatedAt: Date.now() - 2000 },
  { id: "svc-2", workerId: "api", workerName: "API", url: "http://localhost:4000/health", port: 4000, state: "ready", generation: 1, updatedAt: Date.now() - 9000 },
  { id: "svc-3", workerId: "db", workerName: "PostgreSQL", url: "http://localhost:5432", port: 5432, state: "detected", generation: 1, updatedAt: Date.now() - 45000 },
  { id: "svc-4", workerId: "docs", workerName: "Documentation site with a long worker name", url: "http://localhost:8080/docs/getting-started", port: 8080, state: "stale", generation: 1, updatedAt: Date.now() - 400000 }
];

const USAGE = {
  callCount: 14,
  totalTokens: 128_400,
  totalCost: 0.0842,
  currency: "USD",
  unknownTokenRequests: 2,
  unpricedRequests: 1,
  failedRequests: 2,
  coverage: "partial",
  byModel: {
    "gemini-2.5-flash": { requests: 11, tokens: 112_000, cost: 0.0612, unpriced: 0 },
    "gemini-2.5-pro": { requests: 3, tokens: 16_400, cost: 0.023, unpriced: 1 }
  }
};

const DETACHED = [
  { workerId: "shell", workerName: "Project shell", slotId: "slot-0", detachedSlot: 1, identity: { slot: 1, color: "#60A5FA", name: "Window 1" }, leaseVersion: 1 }
];

ipcMain.handle("mission-control:request", (_event, message) => {
  const result = (() => {
    if (message.method === "services.list") return { services: SERVICES, available: true };
    if (message.method === "usage.query") return { available: true, totals: USAGE, records: [] };
    if (message.method === "terminal.window.list") return { detached: DETACHED, max: 3, available: true };
    return fixtures.handle(message.method, message.params);
  })();
  return { version: 1, id: message.id, ok: true, result };
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const problems = [];

function createPainter(window) {
  const state = { image: null, count: 0 };
  window.webContents.on("paint", (_event, _dirty, image) => { state.image = image; state.count += 1; });
  return state;
}

async function settle(window, painter, { quietMs = 600, timeoutMs = 9000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let seen = painter.count;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await wait(100);
    if (painter.count !== seen) { seen = painter.count; quietSince = Date.now(); continue; }
    if (Date.now() - quietSince >= quietMs && painter.image) return painter.image;
  }
  return painter.image;
}

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  const window = new BrowserWindow({
    width, height, show: false, frame: false, backgroundColor: "#000000",
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  window.webContents.setFrameRate(30);
  const painter = createPainter(window);
  window.webContents.on("console-message", (...args) => {
    const details = args[0] && typeof args[0] === "object" && "level" in args[0] ? args[0] : { level: args[1], message: args[2] };
    const level = String(details.level);
    if (level === "error" || Number(details.level) >= 3) problems.push(`console ${level}: ${String(details.message).slice(0, 300)}`);
  });

  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript(`
    window.localStorage.clear();
    window.localStorage.setItem("mission-control:interface-preferences:v1", JSON.stringify({
      theme: ${JSON.stringify(theme)}, typeScale: "comfortable", density: "comfortable", motion: "full",
      terminalFontSize: 13, terminalTheme: ${JSON.stringify(theme)}, terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true
    }));
    true;
  `);
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await settle(window, painter, { quietMs: 700, timeoutMs: 10000 });

  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const shot = (image, name) => {
    if (image && !image.isEmpty()) fs.writeFileSync(path.join(outDir, `${name}.${theme}.png`), image.toPNG());
  };

  const wentToWorkspace = await evaluate(`(() => { const b = document.querySelector('[data-nav-id="workspace"]'); if (!b) return false; b.click(); return true; })()`);
  if (!wentToWorkspace) throw new Error("workspace route unavailable");
  await settle(window, painter);

  // The drawer starts closed, and that is the state the terminal-dominance
  // requirement is actually written against.
  const measureStage = () => evaluate(`
    (() => {
      const stage = document.querySelector('.workspace-stage');
      const grid = document.querySelector('.terminal-grid');
      if (!stage || !grid) return null;
      const s = stage.getBoundingClientRect(), g = grid.getBoundingClientRect();
      return {
        stage: Math.round(s.height),
        grid: Math.round(g.height),
        share: Math.round((g.height / s.height) * 100),
        stageOverflows: stage.scrollHeight > stage.clientHeight + 1
      };
    })()
  `);
  const closedGeometry = await measureStage();
  const clickTab = tab => evaluate(`(() => { const b = document.querySelector('[data-ops-tab="${tab}"]'); if (!b) return false; b.click(); return true; })()`);

  if (!(await clickTab("services"))) throw new Error("services tab not rendered");
  shot(await settle(window, painter), "ops-services");

  const services = await evaluate(`
    (() => {
      const rows = [...document.querySelectorAll('.ops-service')];
      const panel = document.querySelector('.workspace-ops-panel');
      return {
        rows: rows.length,
        states: rows.map(r => r.dataset.state),
        overflowsX: panel ? panel.scrollWidth > panel.clientWidth + 1 : null,
        staleOpenDisabled: rows.length ? rows[rows.length - 1].querySelector('.btn-secondary').disabled : null,
        firstRowHeight: rows.length ? Math.round(rows[0].getBoundingClientRect().height) : null,
        addressFont: rows.length ? getComputedStyle(rows[0].querySelector('code')).fontFamily.split(',')[0] : null
      };
    })()
  `);

  if (!(await clickTab("usage"))) throw new Error("usage tab not rendered");
  shot(await settle(window, painter), "ops-usage");

  const usage = await evaluate(`
    (() => {
      const tiles = [...document.querySelectorAll('.ops-usage-tile')];
      const note = document.querySelector('.ops-note');
      const panel = document.querySelector('.workspace-ops-panel');
      return {
        tiles: tiles.map(t => ({ label: t.querySelector('dt').textContent, value: t.querySelector('dd').textContent })),
        modelRows: document.querySelectorAll('.ops-usage-models tbody tr').length,
        note: note ? note.textContent.replace(/\\s+/g, ' ').trim() : null,
        numerals: tiles.length ? getComputedStyle(tiles[0].querySelector('dd')).fontVariantNumeric : null,
        panelScrollsY: panel ? panel.scrollHeight > panel.clientHeight + 1 : null
      };
    })()
  `);

  // Terminal share of the stage with the drawer open, which is the number that
  // decides whether this drawer is affordable at all.
  const geometry = await evaluate(`
    (() => {
      const stage = document.querySelector('.workspace-stage');
      const grid = document.querySelector('.terminal-grid');
      const ops = document.querySelector('.workspace-ops');
      if (!stage || !grid || !ops) return null;
      const s = stage.getBoundingClientRect(), g = grid.getBoundingClientRect(), o = ops.getBoundingClientRect();
      return {
        stageHeight: Math.round(s.height),
        gridHeight: Math.round(g.height),
        opsHeight: Math.round(o.height),
        terminalShare: Math.round((g.height / s.height) * 100),
        opsBelowGrid: o.top >= g.bottom - 1,
        pageScrollsX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        gridMinHeight: getComputedStyle(grid).minHeight,
        opsIsDirectChild: ops.parentElement === stage,
        gridIsChildOfStage: grid.parentElement === stage,
        stageChildren: [...stage.children].map(c => ({
          cls: c.className.split(' ')[0],
          h: Math.round(c.getBoundingClientRect().height)
        }))
      };
    })()
  `);

  // Contrast of the smallest text in the drawer, which is where a token swap is
  // most likely to fall below the floor.
  const contrast = await evaluate(`
    (() => {
      const parse = c => { const m = c.match(/[\\d.]+/g).map(Number); return [m[0], m[1], m[2]]; };
      const lum = ([r,g,b]) => { const f = v => { v/=255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(r)+0.7152*f(g)+0.0722*f(b); };
      const ratio = (a,b) => { const [x,y] = [lum(a), lum(b)].sort((p,q)=>q-p); return (x+0.05)/(y+0.05); };
      const bgOf = el => { let n = el; while (n) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return parse(c); n = n.parentElement; } return [0,0,0]; };
      const probe = sel => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { sel, size: cs.fontSize, ratio: Number(ratio(parse(cs.color), bgOf(el)).toFixed(2)) }; };
      return [probe('.ops-usage-tile small'), probe('.ops-note'), probe('.workspace-ops-tab'), probe('.ops-service-state span')].filter(Boolean);
    })()
  `);

  fs.writeFileSync(
    path.join(outDir, `report.${theme}.json`),
    `${JSON.stringify({ theme, closedGeometry, services, usage, geometry, contrast, problems }, null, 2)}\n`
  );
  console.log(JSON.stringify({ theme, closedGeometry, services, usage, geometry, contrast, problems }, null, 2));
}

app.disableHardwareAcceleration();
app.whenReady().then(run).then(() => app.quit()).catch(error => {
  console.error(error);
  process.exitCode = 1;
  app.quit();
});
