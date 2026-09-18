// Generic measurement probe: load a route at a size, run JS files against it,
// optionally write a screenshot.
//   npx electron scripts/visual/probe-eval.cjs --route recipes --width 1024 --height 700
//        --js path/to/snippet.js [--shot out.png] [--pre path/to/pre.js]
// The snippet file must be a single expression that evaluates to a JSON-able
// value (wrap statements in an IIFE).
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
// The probe clears localStorage, so it must never share the app's profile.
app.setPath("userData", path.join(require("node:os").tmpdir(), "outarch-visual-harness"));
const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const width = Number(flag("width", 1440));
const height = Number(flag("height", 900));
const route = flag("route", "groundstation");
const jsFile = flag("js", "");
const preFile = flag("pre", "");
const shot = flag("shot", "");
const LABELS = { groundstation: "Groundstation", workspace: "Workspace", needs: "Needs You", recipes: "Recipes", history: "History", settings: "Settings", integrations: "Integrations" };

const logRequests = argv.includes("--log-requests");
ipcMain.handle("mission-control:request", async (_event, message) => {
  if (logRequests && !/^(state.get|terminal.(open|resize|write)|usage|ops|decisions.list|history|memory|vscode.status|mcp|mobile|plugin|integration|automation|agents|mission|recipe|projects|capabilities)/.test(message.method)) console.log("REQUEST:", message.method, JSON.stringify(message.params || {}));
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
ipcMain.handle("mission-control:set-window-chrome", async () => true);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width, height, show: false, frame: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error" || event.level === "warning") errors.push(`[${event.level}] ` + String(event.message).slice(0, 300)); });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  // --query "popout=1&worker=web&slot=1" loads a pop-out window the way main does.
  const queryText = flag("query", "");
  const query = Object.fromEntries(new URLSearchParams(queryText));
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"), queryText ? { query } : undefined);
  await window.webContents.executeJavaScript(`localStorage.clear(); true`);
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await wait(2500);
  const js = source => Promise.race([window.webContents.executeJavaScript(source), wait(10000).then(() => "TIMEOUT")]);
  if (route !== "none") {
    await js(`(function(){ var b=document.querySelector('.top-navigation button[aria-label=${JSON.stringify(LABELS[route] || route)}]'); if(b) b.click(); return !!b; })()`);
    await wait(2000);
  }
  if (preFile) { console.log("PRE:", JSON.stringify(await js(fs.readFileSync(preFile, "utf8")))); await wait(1500); }
  // --click-selector clicks the centre of an element with real (trusted) mouse
  // input, which is what makes a text field match :focus-visible.
  const clickSelector = flag("click-selector", "");
  if (clickSelector) {
    const point = await js(`(function(){ var el=document.querySelector(${JSON.stringify(clickSelector)}); if(!el) return null; var r=el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    console.log("CLICK:", JSON.stringify(point));
    if (point) {
      window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
      window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await wait(60);
      window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
      await wait(900);
    }
  }
  // --force-state "selector" forces :focus and :focus-visible on it through the
  // DevTools protocol; an offscreen window never has OS focus, so real input
  // cannot produce :focus-visible there.
  const forceSelector = flag("force-state", "");
  if (forceSelector) {
    const dbg = window.webContents.debugger;
    dbg.attach("1.3");
    await dbg.sendCommand("DOM.enable");
    await dbg.sendCommand("CSS.enable");
    const { root } = await dbg.sendCommand("DOM.getDocument", { depth: -1 });
    const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector: forceSelector });
    if (nodeId) await dbg.sendCommand("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["focus", "focus-visible", "focus-within"] });
    console.log("FORCED:", forceSelector, Boolean(nodeId));
    await wait(700);
  }
  if (jsFile) {
    const result = await js(fs.readFileSync(jsFile, "utf8"));
    console.log("RESULT:", typeof result === "string" ? result : JSON.stringify(result, null, 1));
  }
  if (shot) {
    window.webContents.invalidate(); await wait(900);
    if (latest) fs.writeFileSync(shot, latest.toPNG());
    console.log("wrote", shot);
  }
  console.log("CONSOLE:", JSON.stringify(errors.slice(0, 10), null, 1));
  window.destroy(); app.quit();
});
