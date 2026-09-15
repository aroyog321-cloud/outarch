// Groundstation's agent registers, with the engine reporting a *detected*
// agent: a plain terminal worker observed running an agent CLI.
//
// Checks that there is now one register rather than two — no separate "AI
// ACTIVITY" panel — that the detected worker has moved into the crew, that its
// row carries the live state the old panel used to show, and that it is no
// longer double-counted in Project operations.
//
//   npx electron scripts/visual/probe-crew-register.cjs --out artifacts/visual/crew
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/crew"));
const theme = flag("theme", "orbital");
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));

const now = Date.now();
// `worker` is a plain terminal (`node worker.js`) the engine has observed
// running Claude — the exact case that used to spawn a second register.
const ACTIVITIES = [
  { workerId: "worker", isAgent: true, agentType: "claude", state: "executing", currentTool: "Edit(src/queue/retry.js)", lastTurnTokens: { totalTokens: 18432 }, updatedAt: now - 9000 },
  { workerId: "agent-claude", isAgent: true, agentType: "claude", state: "awaiting_approval", currentTool: null, lastTurnTokens: { totalTokens: 91260 }, updatedAt: now - 42000 },
  { workerId: "agent-codex", isAgent: true, agentType: "codex", state: "response_ready", currentTool: null, lastTurnTokens: { totalTokens: 4120 }, updatedAt: now - 120000 },
  { workerId: "tests", isAgent: false, agentType: null, state: "idle", currentTool: null, updatedAt: now - 5000 }
];

ipcMain.handle("mission-control:request", async (_event, message) => {
  const result = message.method === "agents.activity"
    ? { activities: ACTIVITIES }
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
  "  const rowsIn = selector => Array.from(document.querySelectorAll(selector + ' .mc-ref-manifest-row')).map(row => ({",
  "    id: row.dataset.workerId,",
  "    name: (row.querySelector('.mc-gs-name-line strong') || {}).textContent,",
  "    badges: Array.from(row.querySelectorAll('.mc-gs-name-line .mc-gs-evidence')).map(b => b.textContent),",
  "    role: (row.querySelector('.mc-ref-role') || {}).textContent,",
  "    roleInferred: row.querySelector('.mc-ref-role') ? row.querySelector('.mc-ref-role').classList.contains('is-inferred') : null,",
  "    state: (row.querySelector('.mc-ref-status') || {}).textContent,",
  "    activity: (row.querySelector('.mc-gs-activity') || {}).textContent,",
  "    resource: (row.querySelector('.mc-ref-resource') || {}).textContent,",
  "    action: (row.querySelector('.mc-gs-row-action') || {}).textContent",
  "  }));",
  "  const crew = document.querySelector('.mc-gs-register--crew');",
  "  return JSON.stringify({",
  "    legacyActivityPanel: Boolean(document.querySelector('.agent-register')),",
  "    crewHeading: crew ? crew.querySelector('h2').textContent : null,",
  "    crewCounts: crew ? crew.querySelector('.mc-ref-section-head span').textContent : null,",
  "    crew: rowsIn('.mc-gs-register--crew'),",
  "    operations: rowsIn('.mc-gs-register--operations').map(row => row.id),",
  "    statusBarCrew: (document.querySelector('.mc-gs-statusbar') || { textContent: '' }).textContent.replace(/\\s+/g, ' ').slice(0, 200)",
  "  });",
  "})()"
].join("\n");

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
  await settle(window, painter, { quietMs: 900, timeoutMs: 12000 });
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"groundstation\"]'); if (b) b.click(); return true; })()");
  await settle(window, painter, { quietMs: 900, timeoutMs: 12000 });

  const report = JSON.parse(await window.webContents.executeJavaScript(MEASURE));
  console.log("\nlegacy AI ACTIVITY panel present:", report.legacyActivityPanel);
  console.log("crew heading:", JSON.stringify(report.crewHeading), "·", JSON.stringify(report.crewCounts));
  console.log("\ncrew rows:");
  for (const row of report.crew) {
    console.log(`  ${String(row.id).padEnd(14)} ${String(row.name).padEnd(26)} badges=${JSON.stringify(row.badges)}`);
    console.log(`  ${" ".repeat(14)} role=${JSON.stringify(row.role)} inferred=${row.roleInferred}`);
    console.log(`  ${" ".repeat(14)} state=${JSON.stringify(row.state)} activity=${JSON.stringify(row.activity)} res=${JSON.stringify(row.resource)} action=${JSON.stringify(row.action)}`);
  }
  console.log("\noperations rows:", JSON.stringify(report.operations));
  console.log("status bar:", report.statusBarCrew);

  // Does any cell spill into its neighbour? The status chip is nowrap, so a
  // longer label than the column was sized for overlaps the activity text.
  const cells = await window.webContents.executeJavaScript(
    "(() => { const rows = Array.from(document.querySelectorAll('.mc-gs-register--crew .mc-ref-manifest-row'));" +
    " const grid = rows[0] ? getComputedStyle(rows[0]).gridTemplateColumns : null;" +
    " return JSON.stringify({ grid: grid, rows: rows.map(row => {" +
    "   const status = row.querySelector('.mc-ref-status'); const activity = row.querySelector('.mc-gs-activity');" +
    "   const sr = status.getBoundingClientRect(); const ar = activity.getBoundingClientRect();" +
    "   return { label: status.textContent, statusW: Math.round(sr.width), statusRight: Math.round(sr.right)," +
    "     activityLeft: Math.round(ar.left), overlap: Math.round(Math.max(0, sr.right - ar.left))," +
    "     scrollVsClient: status.scrollWidth + '/' + status.clientWidth }; }) }); })()"
  );
  console.log("\nCELLS:", cells);

  // The crew register lives below the attention inbox and the operations list,
  // so bring it into frame before capturing.
  await window.webContents.executeJavaScript(
    "(() => { const el = document.querySelector('.mc-gs-register--crew'); if (el) el.scrollIntoView({ block: 'center' }); return true; })()"
  );
  await settle(window, painter, { quietMs: 500 });

  const image = await settle(window, painter);
  if (image) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, `groundstation-crew-${theme}.png`), image.toPNG());
    console.log("\nsaved", path.join(outDir, `groundstation-crew-${theme}.png`));
  }

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(e => { console.error("probe failed:", e); app.exit(1); }));
