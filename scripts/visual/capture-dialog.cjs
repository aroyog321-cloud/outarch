// Captures a dialog, which the route capture never reaches because a dialog
// only exists after a click.
//
//   npx electron scripts/visual/capture-dialog.cjs [--route workspace]
//                                                  [--open "Add terminal worker"]
//                                                  [--label add-terminal]
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const outDir = path.resolve(repoRoot, flag("out", "dist/visual"));
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));
const theme = flag("theme", "orbital");
const route = flag("route", "workspace");
const open = flag("open", "Add terminal worker");
const label = flag("label", "dialog");

const ROUTE_LABELS = {
  groundstation: "Groundstation", workspace: "Workspace", needs: "Needs You",
  agents: "Agents", recipes: "Recipes", history: "History",
  settings: "Settings", integrations: "Integrations"
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
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false
    }
  });
  window.webContents.setFrameRate(30);
  const painter = createPainter(window);

  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript(
    'window.localStorage.clear();window.localStorage.setItem("mission-control:interface-preferences:v1", JSON.stringify({' +
    'theme: "' + theme + '", typeScale: "comfortable", density: "comfortable", motion: "full",' +
    'terminalFontSize: 13, terminalTheme: "' + theme + '", terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true' +
    '}));true;'
  );
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await settle(window, painter, { quietMs: 800, timeoutMs: 10000 });

  const target = ROUTE_LABELS[route] || route;
  await window.webContents.executeJavaScript(
    '(function(){var b=document.querySelector(\'.top-navigation button[aria-label=\'+JSON.stringify(' +
    JSON.stringify(target) + ')+\']\');if(b)b.click();return Boolean(b);})();'
  );
  await settle(window, painter);

  // A route whose work column auto-scrolls to the selected row hides whatever
  // sits above it, so the top of the page is unreachable in a plain capture.
  if (argv.includes("--scroll-top")) {
    await window.webContents.executeJavaScript(
      '(function(){[].forEach.call(document.querySelectorAll("*"),function(el){' +
      'if(el.scrollTop)el.scrollTop=0;});window.scrollTo(0,0);return true;})();'
    );
    await settle(window, painter, { quietMs: 500, timeoutMs: 6000 });
    const image = painter.image;
    const file = path.join(outDir, `${label}.${theme}.${width}x${height}.png`);
    if (image && !image.isEmpty()) {
      fs.writeFileSync(file, image.toPNG());
      console.log("WROTE " + path.relative(repoRoot, file));
    }
    window.destroy();
    return;
  }

  // Match on visible text so the harness does not depend on a class name.
  const opened = await window.webContents.executeJavaScript(
    '(function(){var want=' + JSON.stringify(open) + ';' +
    'var all=[].slice.call(document.querySelectorAll("button,[role=button]"));' +
    'var hit=all.filter(function(b){return (b.textContent||"").trim().indexOf(want)>=0||b.getAttribute("aria-label")===want;})[0];' +
    'if(!hit)return false;hit.click();return true;})();'
  );
  if (!opened) { console.log("could not find a control matching " + JSON.stringify(open)); window.destroy(); return; }
  await settle(window, painter, { quietMs: 700, timeoutMs: 9000 });

  const image = painter.image;
  const file = path.join(outDir, `${label}.${theme}.${width}x${height}.png`);
  if (image && !image.isEmpty()) {
    fs.writeFileSync(file, image.toPNG());
    console.log("WROTE " + path.relative(repoRoot, file));
  } else {
    console.log("no frame produced");
  }

  const audit = await window.webContents.executeJavaScript(
    '(function(){var d=document.querySelector(\'[role="dialog"]\');if(!d)return{open:false};' +
    'var s=getComputedStyle(d);var r=d.getBoundingClientRect();' +
    'return{open:true,cls:d.className,bg:s.backgroundColor,border:s.borderColor,radius:s.borderRadius,' +
    'w:Math.round(r.width),h:Math.round(r.height),inShell:Boolean(d.closest(".shell"))};})();'
  );
  console.log(JSON.stringify(audit, null, 2));

  // Overlap is invisible to a screenshot description and obvious to geometry:
  // report each part's box so a collision is a number, not an impression.
  const parts = await window.webContents.executeJavaScript(
    '(function(){var sels=["' + [
      ".dialog-header", ".dialog-header > div", ".dialog-header h2", ".dialog-tabs",
      ".worker-dialog-guide", ".dialog-body", ".worker-template-card",
      ".worker-template-card code", ".dialog-footer"
    ].join('","') + '"];' +
    'var d=document.querySelector(\'[role="dialog"]\');if(!d)return[];' +
    'return sels.map(function(sel){var el=d.querySelector(sel);' +
    'if(!el)return sel+"  MISSING";' +
    'var s=getComputedStyle(el),r=el.getBoundingClientRect();' +
    'return sel.padEnd(30)+" top="+Math.round(r.top)+" h="+Math.round(r.height)+" w="+Math.round(r.width)+' +
    '"  disp="+s.display+" pos="+s.position+" minH="+s.minHeight;});})();'
  );
  for (const line of parts) console.log("  " + line);
  window.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  try { await run(); } catch (error) {
    console.error("HARNESS FAILED:", (error && error.stack) || error);
    process.exitCode = 1;
  }
  app.quit();
});
