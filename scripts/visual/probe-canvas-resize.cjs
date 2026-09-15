// Focus mode's packed canvas: are there boundary handles, and does dragging one
// re-divide only the two tracks beside it?
//   npx electron scripts/visual/probe-canvas-resize.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const repoRoot = path.resolve(__dirname, "..", "..");
const OUT = path.join(repoRoot, "artifacts", "visual", "2026-09-12-pass");

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = (promise, ms) => Promise.race([promise, wait(ms).then(() => "TIMEOUT")]);

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1600, height: 960, show: false, frame: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error") errors.push(String(event.message).slice(0, 400)); });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2600);
  const js = source => withTimeout(window.webContents.executeJavaScript(source), 8000);
  const shoot = async name => { window.webContents.invalidate(); await wait(700); if (latest) { fs.writeFileSync(path.join(OUT, name), latest.toPNG()); console.log("wrote", name); } };

  await js(`localStorage.removeItem("mission-control:canvas-tracks:v1:default"); true;`);
  for (let i = 0; i < 20; i++) {
    const on = await js(`!!document.querySelector('.terminal-grid')`);
    if (on) break;
    await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Workspace"]');if(b)b.click();return !!b;})();`);
    await wait(700);
  }
  await js(`(function(){ var b=document.querySelector('.workspace-focus-mode'); if(b && !b.classList.contains('is-current')) b.click(); return !!b; })();`);
  await wait(2200);

  const read = () => js(`(function(){
    var g=document.querySelector('.terminal-grid'); if(!g) return null; var cs=getComputedStyle(g);
    var probe=g.querySelector('.canvas-track-probe');
    return { cls: g.className.slice(0,80), cols: cs.gridTemplateColumns, rows: cs.gridTemplateRows,
      probe: probe ? getComputedStyle(probe).gridTemplateColumns : null,
      handles: [].slice.call(g.querySelectorAll('.canvas-track-handle')).map(function(h){ var r=h.getBoundingClientRect(); return h.dataset.canvasTrack+'@'+Math.round(r.left)+','+Math.round(r.top)+' '+Math.round(r.width)+'x'+Math.round(r.height); }),
      tiles: g.querySelectorAll('.terminal-pane').length };
  })();`);
  console.log("before:", JSON.stringify(await read(), null, 1));
  await shoot("canvas-resize-before.png");

  // Drag the first column boundary 160px right, with real pointer events.
  console.log("drag:", await js(`(async function(){
    var h=document.querySelector('.canvas-track-handle[data-canvas-track="x1"]'); if(!h) return "no handle";
    var r=h.getBoundingClientRect(); var x=r.left+r.width/2, y=r.top+Math.min(200, r.height/2);
    var opts=function(cx){ return { bubbles:true, cancelable:true, clientX:cx, clientY:y, pointerId:1, button:0, buttons:1, pointerType:'mouse' }; };
    h.dispatchEvent(new PointerEvent('pointerdown', opts(x)));
    for (var i=1;i<=8;i++){ window.dispatchEvent(new PointerEvent('pointermove', opts(x+i*20))); await new Promise(function(r){ requestAnimationFrame(r); }); }
    window.dispatchEvent(new PointerEvent('pointerup', opts(x+160)));
    return "dragged";
  })();`));
  await wait(900);
  console.log("after:", JSON.stringify(await read(), null, 1));
  console.log("stored:", await js(`JSON.stringify(Object.keys(localStorage).filter(function(k){return k.indexOf("canvas-tracks")>=0;}).map(function(k){return [k, localStorage.getItem(k)];}))`));
  await shoot("canvas-resize-after.png");

  // Double-click evens it out again.
  await js(`(function(){ var h=document.querySelector('.canvas-track-handle[data-canvas-track="x1"]'); if(h) h.dispatchEvent(new MouseEvent('dblclick', { bubbles:true })); return !!h; })();`);
  await wait(900);
  console.log("reset:", JSON.stringify((await read())?.cols));
  console.log("errors:", JSON.stringify(errors.slice(0, 5)));
  window.destroy(); app.quit();
});
