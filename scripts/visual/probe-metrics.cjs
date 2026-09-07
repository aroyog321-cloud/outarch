// Measurement harness. Renders the BUILT renderer offscreen against the fixture
// router and reports numbers a screenshot cannot prove: fold occupancy, nested
// scrolling, measured contrast, keyboard reach, announcement order, and the real
// spread of radius / control-height / icon-size / gap values.
//
//   npx electron scripts/visual/probe-metrics.cjs \
//     [--out FILE] [--width N] [--height N] [--themes orbital,solar,contrast]
//     [--routes groundstation,agents,...] [--sections fold,scroll,contrast,focus,announce,scale]
//
// The in-page half lives in ./probes/metrics.js and is injected verbatim, so no
// template literal is ever nested inside an executeJavaScript() string.
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

const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));
const themes = flag("themes", "orbital").split(",").filter(Boolean);
const routes = flag("routes", "groundstation,workspace,needs,agents,recipes,history,settings,integrations").split(",").filter(Boolean);
const sections = new Set(flag("sections", "fold,scroll,focus,announce").split(",").filter(Boolean));
const outFile = flag("out", "");
const probeSource = fs.readFileSync(path.join(__dirname, "probes", "metrics.js"), "utf8");

const ROUTE_LABELS = {
  groundstation: "Groundstation",
  workspace: "Workspace",
  needs: "Needs You",
  agents: "Agents",
  recipes: "Recipes",
  history: "History",
  settings: "Settings",
  integrations: "Integrations"
};

// The regions whose vertical budget the fold section reports, per route.
const FOLD_TARGETS = {
  groundstation: [".mc-gs-statusbar", ".mc-gs-attention", ".mc-gs-register--operations", ".mc-ref-manifest", ".mc-ref-lower-grid", ".mc-gs-inspector"],
  agents: [".agents-view", ".agent-roster", ".agent-detail"],
  needs: [".needs-view", ".decision-list"],
  history: [".history-view", ".history-investigation", ".timeline"],
  settings: [".settings-hub"],
  recipes: [".recipes-page-layout"],
  integrations: [".integration-hub-body"],
  workspace: [".workspace-canvas"]
};

ipcMain.handle("mission-control:request", async (_event, message) => {
  try {
    return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function createPainter(window) {
  const state = { count: 0 };
  window.webContents.on("paint", () => { state.count += 1; });
  return state;
}

async function settle(window, painter, { quietMs = 500, timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let seen = painter.count;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await wait(100);
    if (painter.count !== seen) { seen = painter.count; quietSince = Date.now(); continue; }
    if (Date.now() - quietSince >= quietMs) return true;
  }
  return false;
}

async function run() {
  const report = { width, height, themes, routes, sections: [...sections], results: [] };

  for (const theme of themes) {
    const window = new BrowserWindow({
      width,
      height,
      show: false,
      frame: false,
      backgroundColor: "#000000",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        offscreen: true,
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    window.webContents.setFrameRate(30);
    const painter = createPainter(window);
    const consoleErrors = [];
    window.webContents.on("console-message", (...args) => {
      const details = args[0] && typeof args[0] === "object" && "level" in args[0] ? args[0] : { level: args[1], message: args[2] };
      if (String(details.level) === "error") consoleErrors.push(String(details.message).slice(0, 180));
    });

    await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
    await window.webContents.executeJavaScript(`
      window.localStorage.clear();
      window.localStorage.setItem("mission-control:interface-preferences:v1", JSON.stringify({
        theme: ${JSON.stringify(theme)}, typeScale: "comfortable", density: "comfortable", motion: "full",
        terminalFontSize: 13, terminalTheme: ${JSON.stringify(theme)}, terminalCursor: "bar",
        terminalScrollback: 5000, showCommandHints: true
      }));
      true;
    `);
    window.reload();
    await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
    await settle(window, painter, { quietMs: 700, timeoutMs: 10000 });

    for (const route of routes) {
      const target = ROUTE_LABELS[route] || route;
      const clicked = await window.webContents.executeJavaScript(`
        (() => {
          const button = document.querySelector('.top-navigation button[aria-label=' + JSON.stringify(${JSON.stringify(target)}) + ']');
          if (!button) return false;
          button.click();
          return true;
        })();
      `);
      if (!clicked) {
        report.results.push({ theme, route, error: "route unreachable" });
        continue;
      }
      await settle(window, painter, { quietMs: 500, timeoutMs: 9000 });
      await window.webContents.executeJavaScript(probeSource);

      const entry = { theme, route };
      const foldTargets = FOLD_TARGETS[route] || [];
      if (sections.has("fold")) {
        entry.fold = await window.webContents.executeJavaScript(`window.__mcProbe.fold(${JSON.stringify(foldTargets)})`);
      }
      if (sections.has("scroll")) {
        entry.scroll = await window.webContents.executeJavaScript(`window.__mcProbe.scrollNesting(".experience")`);
      }
      if (sections.has("contrast")) {
        entry.contrast = await window.webContents.executeJavaScript(`window.__mcProbe.contrast(".shell")`);
      }
      if (sections.has("focus")) {
        entry.focus = await window.webContents.executeJavaScript(`window.__mcProbe.focusOrder(".experience")`);
      }
      if (sections.has("announce")) {
        entry.announce = await window.webContents.executeJavaScript(`window.__mcProbe.announceOrder(".experience")`);
      }
      if (sections.has("horizontal")) {
        entry.horizontal = await window.webContents.executeJavaScript(`window.__mcProbe.horizontal(".experience")`);
      }
      if (sections.has("monospace")) {
        entry.monospace = await window.webContents.executeJavaScript(`window.__mcProbe.monospace(".experience")`);
      }
      if (sections.has("scale")) {
        entry.scale = await window.webContents.executeJavaScript(`window.__mcProbe.scale(".experience")`);
      }
      report.results.push(entry);
    }

    if (consoleErrors.length) report.results.push({ theme, consoleErrors: [...new Set(consoleErrors)] });
    window.destroy();
  }

  const text = JSON.stringify(report, null, 2);
  if (outFile) {
    const resolved = path.resolve(repoRoot, outFile);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, `${text}\n`, "utf8");
    console.log(`Wrote ${path.relative(repoRoot, resolved)}`);
  } else {
    console.log(text);
  }
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try {
    await run();
  } catch (error) {
    console.error("HARNESS FAILED:", (error && error.stack) || error);
    process.exitCode = 1;
  }
  app.quit();
});
