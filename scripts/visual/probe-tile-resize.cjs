// Per-terminal resizing on the workspace canvas, in the slot layout and in
// focus mode: which grips a tile gets, and what a real pointer drag does to
// that tile and to its neighbours.
//   npx electron scripts/visual/probe-tile-resize.cjs --out <dir> [--mode slots|focus]
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const OUT = path.resolve(flag("out", path.join(repoRoot, "artifacts", "visual", "tile-resize")));
const MODE = flag("mode", "slots");
const WIDTH = Number(flag("width", 1600));
const HEIGHT = Number(flag("height", 960));
fs.mkdirSync(OUT, { recursive: true });

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const chromeCalls = [];
ipcMain.handle("mission-control:set-window-chrome", async (_event, mode) => { chromeCalls.push(mode); return true; });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = (promise, ms) => Promise.race([promise, wait(ms).then(() => "TIMEOUT")]);

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: WIDTH, height: HEIGHT, show: false, frame: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error") errors.push(String(event.message).slice(0, 400)); });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2600);
  const js = source => withTimeout(window.webContents.executeJavaScript(source), 8000);
  const shoot = async name => { await js(`(function(){ if(!document.getElementById("probe-hover")){ var st=document.createElement("style"); st.id="probe-hover"; st.textContent=".tile-resize-grip::before{opacity:1 !important}"; document.head.appendChild(st);} return true; })()`); window.webContents.invalidate(); await wait(800); if (latest) { fs.writeFileSync(path.join(OUT, name), latest.toPNG()); console.log("wrote", name); } };

  await js(`Object.keys(localStorage).filter(function(k){return k.indexOf("canvas-tiles")>=0;}).forEach(function(k){localStorage.removeItem(k);}); true;`);
  for (let i = 0; i < 20; i++) {
    const on = await js(`!!document.querySelector('.terminal-grid')`);
    if (on) break;
    await js(`(function(){var b=document.querySelector('[data-nav-id="workspace"]')||document.querySelector('.top-navigation button[aria-label="Workspace"]');if(b)b.click();return !!b;})();`);
    await wait(700);
  }
  if (MODE === "focus") {
    await js(`(function(){ var b=document.querySelector('.workspace-focus-mode'); if(b && !b.classList.contains('is-current')) b.click(); return !!b; })();`);
  }
  await wait(2400);

  const read = () => js(`(function(){
    var g=document.querySelector('.terminal-grid'); if(!g) return null; var cs=getComputedStyle(g); var gb=g.getBoundingClientRect();
    var tiles=[].slice.call(g.children).filter(function(el){ return el.matches('.terminal-pane, .workspace-browser, .ai-pane'); });
    var frame=g.querySelector('.tile-resize-frame');
    return {
      cls: g.className.replace(/\\s+/g,' ').slice(0,120), stacked: cs.getPropertyValue('--mc-canvas-stacked').trim(),
      cols: cs.gridTemplateColumns, rows: cs.gridTemplateRows,
      tiles: tiles.map(function(el){ var r=el.getBoundingClientRect(); var n=el.querySelector('strong'); return (n?n.textContent.trim().slice(0,14):'?')+' @'+Math.round(r.left-gb.left)+','+Math.round(r.top-gb.top)+' '+Math.round(r.width)+'x'+Math.round(r.height)+' ['+el.style.gridColumn+' / row '+el.style.gridRow+']'; }),
      frame: frame ? (function(){ var r=frame.getBoundingClientRect(); return Math.round(r.left-gb.left)+','+Math.round(r.top-gb.top)+' '+Math.round(r.width)+'x'+Math.round(r.height); })() : null,
      grips: frame ? [].slice.call(frame.querySelectorAll('[data-tile-grip]')).map(function(el){ var r=el.getBoundingClientRect(); return el.dataset.tileGrip+'@'+Math.round(r.left-gb.left)+','+Math.round(r.top-gb.top)+' '+Math.round(r.width)+'x'+Math.round(r.height)+' '+getComputedStyle(el).cursor; }) : [],
      readout: (g.querySelector('.tile-resize-readout')||{}).textContent || null,
      mainRows: getComputedStyle(document.querySelector('.main-area')).gridTemplateRows,
      focus: document.documentElement.dataset.workspaceFocus || null
    };
  })();`);
  const hover = index => js(`(function(){
    var g=document.querySelector('.terminal-grid');
    var tiles=[].slice.call(g.children).filter(function(el){ return el.matches('.terminal-pane, .workspace-browser, .ai-pane'); });
    var el=tiles[${index}]; if(!el) return 'no tile';
    var r=el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointermove', { bubbles:true, clientX:r.left+r.width/2, clientY:r.top+r.height/2, pointerType:'mouse' }));
    return 'hovered';
  })();`);
  const drag = (grip, dx, dy, finish = "up") => js(`(async function(){
    var h=document.querySelector('.tile-resize-frame [data-tile-grip="${grip}"]'); if(!h) return "no grip ${grip}";
    var r=h.getBoundingClientRect(); var x=r.left+r.width/2, y=r.top+r.height/2;
    var opts=function(cx, cy){ return { bubbles:true, cancelable:true, clientX:cx, clientY:cy, pointerId:1, button:0, buttons:1, pointerType:'mouse' }; };
    h.dispatchEvent(new PointerEvent('pointerdown', opts(x, y)));
    for (var i=1;i<=10;i++){ window.dispatchEvent(new PointerEvent('pointermove', opts(x+i*${dx}/10, y+i*${dy}/10))); await new Promise(function(res){ setTimeout(res, 40); }); }
    var mid = document.querySelector('.tile-resize-readout'); var during = mid ? mid.textContent : null;
    if ("${finish}" === "escape") window.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true, cancelable:true }));
    else window.dispatchEvent(new PointerEvent('pointerup', opts(x+${dx}, y+${dy})));
    return "dragged ${grip} readout=" + during;
  })();`);

  console.log("MODE", MODE);
  console.log("before:", JSON.stringify(await read(), null, 1));
  const target = Number(flag("tile", MODE === "focus" ? 1 : 0));
  const grip = flag("grip", "se");
  console.log(await hover(target));
  await wait(600);
  console.log("hovered:", JSON.stringify(await read(), null, 1));
  await shoot(`${MODE}-1-hover.png`);
  console.log(await drag(grip, Number(flag("dx", 220)), Number(flag("dy", 110))));
  await wait(900);
  console.log("after drag:", JSON.stringify(await read(), null, 1));
  console.log("stored:", await js(`JSON.stringify(Object.keys(localStorage).filter(function(k){return k.indexOf("canvas-tiles")>=0;}).map(function(k){return [k, localStorage.getItem(k)];}))`));
  await hover(target);
  await wait(400);
  await shoot(`${MODE}-2-after-drag.png`);

  console.log(await drag(grip, -120, -60, "escape"));
  await wait(700);
  console.log("after escape:", JSON.stringify((await read()).tiles));

  await js(`(function(){ var h=document.querySelector('.tile-resize-frame [data-tile-grip="${grip}"]'); if(h) h.dispatchEvent(new MouseEvent('dblclick', { bubbles:true })); return !!h; })();`);
  await wait(900);
  console.log("after dblclick:", JSON.stringify((await read()).tiles));
  console.log("chrome calls:", JSON.stringify(chromeCalls));
  console.log("errors:", JSON.stringify(errors.slice(0, 5)));
  window.destroy(); app.quit();
});
