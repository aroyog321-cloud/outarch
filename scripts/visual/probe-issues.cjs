// Reproduces four reported defects against the built renderer, offscreen:
//   1. Needs You shows no decisions while Groundstation shows them.
//   2. Workspace "All terminals" does not fit every terminal on the canvas.
//   3. VS Code Bridge panel in Integrations (UI/UX review shot).
//   4. "Search commands" opens a palette that reads as a black screen.
//
//   npx electron scripts/visual/probe-issues.cjs --out dist/visual/issues --label before
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
const outDir = path.resolve(repoRoot, flag("out", "dist/visual/issues"));
const label = flag("label", "run");
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));

ipcMain.handle("mission-control:request", (_event, message) => {
  try {
    return { version: 1, id: message.id, ok: true, result: fixtures.handle(message.method, message.params) };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const problems = [];

function createPainter(window) {
  const state = { image: null, count: 0 };
  window.webContents.on("paint", (_event, _dirty, image) => { state.image = image; state.count += 1; });
  return state;
}

async function settle(window, painter, { quietMs = 500, timeoutMs = 8000 } = {}) {
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
    if (level === "error" || Number(details.level) >= 3) problems.push("console " + level + ": " + String(details.message).slice(0, 300));
  });

  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript([
    'window.localStorage.clear();',
    'window.localStorage.setItem("mission-control:interface-preferences:v1", JSON.stringify({',
    '  theme: "orbital", typeScale: "comfortable", density: "comfortable", motion: "full",',
    '  terminalFontSize: 13, terminalTheme: "orbital", terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true',
    '}));',
    'true;'
  ].join("\n"));
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await settle(window, painter, { quietMs: 700, timeoutMs: 10000 });

  const evaluate = expression => window.webContents.executeJavaScript(expression);
  const go = async route => {
    const ok = await evaluate('(() => { const b = document.querySelector(\'[data-nav-id="' + route + '"]\'); if (!b) return false; b.click(); return true; })()');
    if (!ok) throw new Error("route unavailable: " + route);
    return settle(window, painter, { quietMs: 600, timeoutMs: 9000 });
  };
  const shot = (image, name) => { if (image && !image.isEmpty()) fs.writeFileSync(path.join(outDir, name + "." + label + ".png"), image.toPNG()); };
  const report = {};

  /* 1. Needs You */
  shot(await go("needs"), "needs");
  report.needs = await evaluate(`
    (() => {
      const badge = document.querySelector('[data-nav-id="needs"] b');
      return {
        sidebarBadge: badge ? badge.textContent : null,
        heroHeading: document.querySelector('.needs-hero h2') ? document.querySelector('.needs-hero h2').textContent : null,
        allFilterCount: document.querySelector('.decision-queue-controls button b') ? document.querySelector('.decision-queue-controls button b').textContent : null,
        renderedDecisions: document.querySelectorAll('.needs-list > *').length,
        clearState: Boolean(document.querySelector('.needs-clear-state'))
      };
    })()
  `);

  /* 2. Workspace — All terminals */
  shot(await go("workspace"), "workspace-initial");
  const workspaceState = `
    (() => {
      const grid = document.querySelector('.terminal-grid');
      const all = [...document.querySelectorAll('.worker-folder-list button')].find(b => b.textContent.indexOf('All terminals') === 0 || b.textContent.includes('All terminals'));
      return {
        gridClass: grid ? grid.className.trim() : null,
        panes: document.querySelectorAll('.terminal-grid > article').length,
        emptyPanes: document.querySelectorAll('.terminal-pane-empty').length,
        workerCount: all ? all.querySelector('b').textContent : null
      };
    })()
  `;
  report.workspaceBefore = await evaluate(workspaceState);
  await evaluate("(() => { const all = [...document.querySelectorAll('.worker-folder-list button')].find(b => b.textContent.includes('All terminals')); if (all) all.click(); return Boolean(all); })()");
  shot(await settle(window, painter, { quietMs: 600, timeoutMs: 8000 }), "workspace-all-terminals");
  report.workspaceAfterAll = await evaluate(workspaceState);

  /* 3. Integrations — VS Code Bridge */
  await go("integrations");
  await evaluate("(() => { const tab = [...document.querySelectorAll('.integration-hub-tabs button')].find(b => b.textContent.includes('VS Code')); if (tab) tab.click(); return Boolean(tab); })()");
  shot(await settle(window, painter, { quietMs: 600, timeoutMs: 8000 }), "integrations-vscode");
  report.vscode = await evaluate(`
    (() => {
      const panel = document.querySelector('.vscode-bridge-settings');
      if (!panel) return { present: false };
      const rect = panel.getBoundingClientRect();
      const style = getComputedStyle(panel);
      const summary = document.querySelector('.vscode-sync-summary');
      const steps = document.querySelector('.vscode-setup-steps');
      return {
        present: true,
        rect: { top: Math.round(rect.top), height: Math.round(rect.height), width: Math.round(rect.width) },
        display: style.display,
        gridTemplateColumns: style.gridTemplateColumns,
        setupStepsDisplay: steps ? getComputedStyle(steps).display : null,
        setupStepsColumns: steps ? getComputedStyle(steps).gridTemplateColumns : null,
        summaryColumns: summary ? getComputedStyle(summary).gridTemplateColumns : null,
        overflowing: [...panel.querySelectorAll('*')].filter(el => el.scrollWidth > el.clientWidth + 2).slice(0, 6).map(el => String(el.className || el.tagName) + '[' + el.scrollWidth + '>' + el.clientWidth + ']')
      };
    })()
  `);

  /* 4. Command palette */
  await go("groundstation");
  await evaluate("(() => { const b = document.querySelector('.top-search'); if (!b) return false; b.click(); return true; })()");
  await wait(700);
  shot(await settle(window, painter, { quietMs: 500, timeoutMs: 8000 }), "palette");
  report.palette = await evaluate(`
    (() => {
      const palette = document.querySelector('.command-palette');
      const backdrop = document.querySelector('.palette-backdrop');
      if (!palette) return { present: false, backdrop: Boolean(backdrop), bodyChildren: document.body.children.length };
      const rect = palette.getBoundingClientRect();
      const style = getComputedStyle(palette);
      const input = palette.querySelector('input');
      return {
        present: true,
        rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
        background: style.backgroundColor,
        color: style.color,
        position: style.position,
        zIndex: style.zIndex,
        opacity: style.opacity,
        visibility: style.visibility,
        transform: style.transform,
        backdrop: backdrop ? { background: getComputedStyle(backdrop).backgroundColor, zIndex: getComputedStyle(backdrop).zIndex } : null,
        items: palette.querySelectorAll('[cmdk-item]').length,
        listHeight: Math.round((palette.querySelector('.palette-results') || palette).getBoundingClientRect().height),
        inputHeight: input ? Math.round(input.getBoundingClientRect().height) : null
      };
    })()
  `);

  console.log(JSON.stringify({ label, report, problems }, null, 2));
  window.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(run).then(() => app.exit(0)).catch(error => { console.error("PROBE FAILED:", error.message, error.stack); app.exit(1); });
