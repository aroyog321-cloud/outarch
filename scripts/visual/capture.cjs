// Offscreen visual verification harness.
//
//   npx electron scripts/visual/capture.cjs [--out DIR] [--width N] [--height N]
//                                           [--themes orbital,solar,contrast]
//                                           [--routes groundstation,workspace,...]
//                                           [--label NAME]
//
// Renders the BUILT renderer (dist/groundstation/renderer) against the fixture
// router in ./fixtures.cjs and writes one PNG per route/theme/width.
//
// Uses Electron's real offscreen rendering: a hidden window is never composited
// on a schedule, so capturePage() hands back the frame from before the route
// changed. With `offscreen: true` the `paint` event fires for every produced
// frame, so the harness can wait for painting to go quiet and then write the
// frame it actually received.
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

const outDir = path.resolve(repoRoot, flag("out", "dist/visual"));
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));
const themes = flag("themes", "orbital").split(",").filter(Boolean);
const routes = flag("routes", "groundstation,workspace,needs,agents,recipes,history,settings,integrations").split(",").filter(Boolean);
const label = flag("label", "");

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

ipcMain.handle("mission-control:request", async (_event, message) => {
  try {
    return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function createPainter(window) {
  const state = { image: null, count: 0 };
  window.webContents.on("paint", (_event, _dirty, image) => {
    state.image = image;
    state.count += 1;
  });
  return state;
}

// Wait until the renderer stops producing frames (route transitions, terminal
// mounts and status polls all paint), then return the last frame received.
async function settle(window, painter, { quietMs = 500, timeoutMs = 8000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let seen = painter.count;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    await wait(100);
    if (painter.count !== seen) {
      seen = painter.count;
      quietSince = Date.now();
      continue;
    }
    if (Date.now() - quietSince >= quietMs && painter.image) return painter.image;
  }
  return painter.image;
}

async function run() {
  fs.mkdirSync(outDir, { recursive: true });
  const written = [];
  const problems = [];

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

    window.webContents.on("console-message", (...args) => {
      // Electron 40 passes an event object; older signatures pass positionals.
      const details = args[0] && typeof args[0] === "object" && "level" in args[0] ? args[0] : { level: args[1], message: args[2] };
      const level = String(details.level);
      if (level === "error" || level === "warning" || Number(details.level) >= 2) {
        problems.push(`[${theme}] console ${level}: ${String(details.message).slice(0, 200)}`);
      }
    });

    await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));

    // Preferences persist per-origin, so a previous run's theme would leak in.
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
        problems.push(`[${theme}] could not reach route ${route}`);
        continue;
      }

      const image = await settle(window, painter, { quietMs: 600, timeoutMs: 9000 });
      const suffix = label ? `.${label}` : "";
      const file = path.join(outDir, `${route}.${theme}.${width}x${height}${suffix}.png`);
      if (image && !image.isEmpty()) {
        fs.writeFileSync(file, image.toPNG());
        written.push(path.relative(repoRoot, file));
      } else {
        problems.push(`[${theme}/${route}] no frame produced`);
      }

      // Report layout defects a screenshot alone would not prove, and prove
      // which route the DOM is on so a stale frame cannot pass for a capture.
      const audit = await window.webContents.executeJavaScript(`
        (() => {
          const doc = document.documentElement;
          const horizontal = doc.scrollWidth - doc.clientWidth;
          const overflow = [...document.querySelectorAll('.experience *')]
            .filter(el => el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflowX === 'visible')
            .slice(0, 6)
            .map(el => {
              // A bare SPAN names nothing; the parent chain names the container
              // whose track is actually too narrow.
              const name = node => {
                const cls = node.className && node.className.baseVal !== undefined ? node.className.baseVal : node.className;
                return node.tagName.toLowerCase() + (cls ? "." + String(cls).split(" ").filter(Boolean).slice(0, 2).join(".") : "");
              };
              const chain = [];
              for (let n = el.parentElement, i = 0; n && i < 3; n = n.parentElement, i += 1) chain.push(name(n));
              return name(el) + "[" + el.scrollWidth + ">" + el.clientWidth + "]<-" + chain.join("<-");
            });
          const shell = document.querySelector('.shell');
          const shellClass = shell ? shell.className : null;
          const shellBg = shell ? getComputedStyle(shell).backgroundColor : null;
          const current = document.querySelector('.top-navigation button[aria-current="page"]');
          const heading = document.querySelector('.experience h1, .experience h2');
          return {
            horizontal,
            overflow,
            shellClass,
            shellBg,
            active: current ? current.getAttribute('aria-label') : null,
            heading: heading ? heading.textContent : null
          };
        })();
      `);
      // Print the theme the frame was actually painted with: a capture that
      // silently keeps the previous run's palette is the harness's known
      // failure mode, and only the DOM can disprove it.
      console.log(`  ${route.padEnd(14)} active=${JSON.stringify(audit.active)} bg=${audit.shellBg} theme=${String(audit.shellClass || "").split(" ").find(c => c.startsWith("theme-"))}`);
      if (audit.active !== target) problems.push(`[${theme}/${route}] DOM is on "${audit.active}" not "${target}"`);
      if (audit.horizontal > 0) problems.push(`[${theme}/${route}] page scrolls horizontally by ${audit.horizontal}px`);
      if (audit.overflow.length) problems.push(`[${theme}/${route}] clipped: ${audit.overflow.join(" | ")}`);
    }

    window.destroy();
  }

  console.log("\nWROTE:\n" + written.map(file => "  " + file).join("\n"));
  const unique = [...new Set(problems)];
  console.log("\nPROBLEMS:" + (unique.length ? "\n" + unique.map(p => "  " + p).join("\n") : " none"));
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
