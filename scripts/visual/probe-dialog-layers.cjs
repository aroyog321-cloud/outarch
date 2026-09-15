// Every portalled dialog is a Radix Overlay + Content pair rendered as sibling
// children of <body>. The content has to paint above its own backdrop, or the
// backdrop blurs it and takes every click. This mounts each real class pair the
// way Radix does and asks the browser what is on top at the content's centre.
//   npx electron scripts/visual/probe-dialog-layers.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const repoRoot = path.resolve(__dirname, "..", "..");

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const PAIRS = [
  ["palette-backdrop", "command-palette"],
  ["palette-backdrop worker-focus-backdrop", "worker-focus-dialog"],
  ["palette-backdrop confirmation-backdrop", "confirmation-dialog"],
  ["recipes-backdrop dialog-backdrop", "recipes-dialog recipes-dialog-v2 pm-dialog"],
  ["agent-picker-backdrop", "mission-editor"],
  ["palette-backdrop help-backdrop", "help-dialog"],
  ["mission-graph-backdrop", "mission-graph-dialog dag-dialog"]
];

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, frame: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(3000);
  const result = await window.webContents.executeJavaScript(`(function(){
    var pairs = ${JSON.stringify(PAIRS)};
    return JSON.stringify(pairs.map(function(pair){
      var overlay = document.createElement('div'); overlay.className = pair[0]; overlay.setAttribute('data-state','open');
      var content = document.createElement('div'); content.className = pair[1]; content.setAttribute('role','dialog'); content.setAttribute('data-state','open');
      content.style.minWidth = '200px'; content.style.minHeight = '120px';
      document.body.appendChild(overlay); document.body.appendChild(content);
      content.getAnimations().forEach(function(a){ try { a.finish(); } catch (e) {} }); var r = content.getBoundingClientRect(); var top = document.elementFromPoint(r.left + r.width/2, r.top + r.height/2);
      var oc = getComputedStyle(overlay), cc = getComputedStyle(content);
      var out = { pair: pair[1].split(' ')[0], overlayZ: oc.zIndex, overlayPos: oc.position, overlayPE: oc.pointerEvents, contentZ: cc.zIndex, contentPos: cc.position, onTop: top === content || content.contains(top), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] };
      overlay.remove(); content.remove();
      return out;
    }));
  })()`);
  for (const row of JSON.parse(result)) console.log(JSON.stringify(row));
  window.destroy(); app.quit();
});
