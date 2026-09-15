// The 2026-09-15 report, measured before anything is changed:
//   1. the corner resize "little box"
//   2. the native window controls not matching the strip behind them
//   3. "Search commands" in the sidebar not opening anything
//   4. the VS Code Bridge folder pushing the toolbar below its deck
//   MC_FIXTURE_VSCODE=connected npx electron scripts/visual/probe-see-this-0915.cjs --out <dir>
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const OUT = path.resolve(flag("out", path.join(repoRoot, "artifacts", "visual", "see-this-0915")));
const ONLY = flag("only", "all");
fs.mkdirSync(OUT, { recursive: true });

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const chrome = [];
ipcMain.handle("mission-control:set-window-chrome", async (_event, value) => { chrome.push(value); return true; });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, frame: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error" || event.level === "warning") errors.push(`[${event.level}] ` + String(event.message).slice(0, 300)); });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(3000);
  const js = source => Promise.race([window.webContents.executeJavaScript(source), wait(8000).then(() => "TIMEOUT")]);
  const shoot = async (name, rect) => {
    window.webContents.invalidate(); await wait(900);
    if (!latest) return;
    let image = latest;
    if (rect) { const scale = image.getSize().width / 1440; image = image.crop({ x: Math.round(rect.x * scale), y: Math.round(rect.y * scale), width: Math.round(rect.width * scale), height: Math.round(rect.height * scale) }); }
    fs.writeFileSync(path.join(OUT, name), image.toPNG()); console.log("wrote", name);
  };
  const click = async (x, y) => {
    window.webContents.sendInputEvent({ type: "mouseMove", x, y });
    window.webContents.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    await wait(60);
    window.webContents.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  };

  if (ONLY === "all" || ONLY === "search") {
    console.log("=== 3. Search commands (Groundstation, real pointer input) ===");
    for (let i = 0; i < 30; i++) { if (await js(`!!document.querySelector(".top-search")`)) break; await wait(500); }
    console.log("dom:", await js(`JSON.stringify({ shell: !!document.querySelector(".shell"), sidebar: !!document.querySelector(".app-sidebar"), body: document.body.innerText.slice(0, 160) })`));
    const target = JSON.parse(await js(`(function(){
      var b=document.querySelector('.top-search'); if(!b) return JSON.stringify({found:false});
      var r=b.getBoundingClientRect(); var cx=r.left+r.width/2, cy=r.top+r.height/2; var top=document.elementFromPoint(cx,cy);
      var cs=getComputedStyle(b);
      return JSON.stringify({found:true, x:Math.round(cx), y:Math.round(cy), rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)],
        topmost: top ? (top.className||top.tagName)+'' : null, inside: !!(top && b.contains(top)), pointerEvents: cs.pointerEvents, region: cs.webkitAppRegion,
        view: (document.querySelector('.experience')||{}).className });
    })()`));
    console.log(JSON.stringify(target));
    if (target.found) {
      await click(target.x, target.y);
      await wait(1200);
      console.log("after pointer click:", await js(`JSON.stringify({ palette: !!document.querySelector('.command-palette'), dialogs: document.querySelectorAll('[role=dialog]').length, items: document.querySelectorAll('[cmdk-item]').length, active: (document.activeElement||{}).className })`));
      await shoot("3-search-after-click.png");
      console.log("stacking:", await js(`(function(){ var p=document.querySelector(".command-palette"); var o=document.querySelector(".palette-backdrop"); var d=function(el){ if(!el) return null; var cs=getComputedStyle(el); var r=el.getBoundingClientRect(); return { cls: String(el.className).slice(0,60), pos: cs.position, z: cs.zIndex, opacity: cs.opacity, filter: cs.filter, backdrop: cs.backdropFilter, bg: cs.backgroundColor, transform: cs.transform, anim: cs.animationName, vis: cs.visibility, rect: [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)], parent: el.parentElement && String(el.parentElement.tagName + "." + el.parentElement.className).slice(0,60), state: el.getAttribute("data-state") }; }; var r=p.getBoundingClientRect(); var top=document.elementFromPoint(r.left+r.width/2, r.top+40); var chain=[]; for (var e=p; e && e!==document.documentElement; e=e.parentElement){ var c=getComputedStyle(e); if (c.filter!=="none"||c.opacity!=="1"||c.zIndex!=="auto"||c.backdropFilter!=="none") chain.push(String(e.tagName+"."+e.className).slice(0,50)+" z="+c.zIndex+" op="+c.opacity+" f="+c.filter+" bf="+c.backdropFilter); } return JSON.stringify({ palette: d(p), backdrop: d(o), topAtPalette: top && String(top.className||top.tagName).slice(0,60), paletteContainsTop: !!(top && p.contains(top)), order: o && p ? (o.compareDocumentPosition(p) & 4 ? "backdrop-before-palette" : "palette-before-backdrop") : null, chain: chain }); })()`));
      const item = JSON.parse(await js(`(function(){ var el=[].slice.call(document.querySelectorAll("[cmdk-item]")).find(function(x){ return /Workspace/.test(x.textContent); }); if(!el) return "null"; var r=el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left+r.width/2), y: Math.round(r.top+r.height/2) }); })()`));
      if (item) { await click(item.x, item.y); await wait(1200); }
      console.log("after clicking the Workspace command:", await js(`JSON.stringify({ palette: !!document.querySelector(".command-palette"), view: (document.querySelector(".experience")||{}).className })`));
      await js(`(function(){ var b=document.querySelector(".top-search"); b.click(); return true; })()`);
      await wait(900);
      await click(120, 400);
      await wait(900);
      console.log("after clicking outside the palette:", await js(`JSON.stringify({ palette: !!document.querySelector(".command-palette") })`));

      await wait(600);
      await js(`(function(){var b=document.querySelector('.top-search'); b.click(); return true;})()`);
      await wait(1000);
      console.log("after element.click():", await js(`JSON.stringify({ palette: !!document.querySelector('.command-palette') })`));
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
      await wait(700);
    }
  }

  if (ONLY === "all" || ONLY === "help") {
    console.log("=== 5. Help (F1) dialog ===");
    for (let i = 0; i < 30; i++) { if (await js(`!!document.querySelector(".status-bar-premium__help")`)) break; await wait(500); }
    await js(`(function(){ var b=document.querySelector(".status-bar-premium__help"); if(b) b.click(); return !!b; })()`);
    await wait(1200);
    console.log(await js(`(function(){ var d=document.querySelector(".help-dialog"); if(!d) return JSON.stringify({help:false}); var r=d.getBoundingClientRect(); var cs=getComputedStyle(d); var top=document.elementFromPoint(Math.min(innerWidth-1,Math.max(0,r.left+r.width/2)), Math.min(innerHeight-1,Math.max(0,r.top+Math.min(r.height/2,200)))); return JSON.stringify({help:true, rect:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)], pos:cs.position, z:cs.zIndex, bg:cs.backgroundColor, onTop: !!(top && d.contains(top)), scrollH: d.scrollHeight, overflow: cs.overflowY }); })()`));
    await shoot("5-help.png");
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
    await wait(700);
  }

  if (ONLY === "all" || ONLY === "titlebar") {
    console.log("=== 2. strip colours the native overlay must match ===");
    console.log(await js(`(function(){
      var bar=document.querySelector('.mission-status-bar'); var shell=document.querySelector('.shell'); var main=document.querySelector('.main-area');
      var root=getComputedStyle(document.documentElement);
      return JSON.stringify({ bar: bar && getComputedStyle(bar).backgroundColor, barBackdrop: bar && getComputedStyle(bar).backdropFilter,
        main: main && getComputedStyle(main).backgroundColor, shell: shell && getComputedStyle(shell).backgroundColor, body: getComputedStyle(document.body).backgroundColor,
        surface: getComputedStyle(shell).getPropertyValue('--mc-surface').trim(), text: getComputedStyle(shell).getPropertyValue('--mc-text-muted').trim() });
    })()`));
    await shoot("2-tape-right.png", { x: 1040, y: 0, width: 400, height: 60 });
  }

  if (ONLY === "all" || ONLY === "vscode") {
    console.log("=== 4. VS Code Bridge folder ===");
    for (let i = 0; i < 15; i++) {
      if (await js(`!!document.querySelector('.worker-folders')`)) break;
      await js(`(function(){var b=document.querySelector('[data-nav-id="workspace"]'); if(b) b.click(); return true;})()`);
      await wait(700);
    }
    await wait(1500);
    const stage = `(function(){
      var s=document.querySelector('.workspace-stage'); if(!s) return JSON.stringify({stage:false});
      var sr=s.getBoundingClientRect();
      return JSON.stringify({ stage:[Math.round(sr.top),Math.round(sr.height)], scroll:[s.scrollHeight,s.clientHeight], children:[].slice.call(s.children).map(function(el){ var r=el.getBoundingClientRect(); var cs=getComputedStyle(el); return (el.className||el.tagName).toString().split(' ')[0]+' order='+cs.order+' flex='+cs.flex+' top='+Math.round(r.top)+' h='+Math.round(r.height)+' overflow='+cs.overflowY; }) });
    })()`;
    console.log("all terminals:", await js(stage));
    const opened = await js(`(function(){ var b=document.querySelector('.is-vscode-folder'); if(!b) return 'no vscode folder (set MC_FIXTURE_VSCODE=connected)'; b.click(); return 'clicked'; })()`);
    console.log(opened);
    await wait(1500);
    console.log("vscode folder:", await js(stage));
    await shoot("4-vscode-folder.png");
    await js(`(function(){ var b=[].slice.call(document.querySelectorAll('.worker-folder-list button')).find(function(x){return /All terminals/.test(x.textContent)}); if(b) b.click(); return !!b; })()`);
    await wait(1200);
  }

  if (ONLY === "all" || ONLY === "grip") {
    console.log("=== 1. corner grip ===");
    console.log(await js(`(function(){
      var g=document.querySelector('.terminal-grid'); if(!g) return 'no grid';
      var pane=g.querySelector('.terminal-pane'); var r=pane.getBoundingClientRect();
      pane.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2,pointerType:'mouse'}));
      return 'hovered';
    })()`));
    await wait(700);
    const corner = await js(`(function(){ var c=document.querySelector('.tile-resize-grip.is-corner'); if(!c) return JSON.stringify(null); var r=c.getBoundingClientRect(); var b=getComputedStyle(c,'::before'); return JSON.stringify({grip:c.dataset.tileGrip, x:r.left, y:r.top, w:r.width, h:r.height, before:{w:b.width,h:b.height,bg:b.backgroundColor,shadow:b.boxShadow,op:b.opacity}}); })()`);
    console.log("corner:", corner);
    const c = JSON.parse(corner);
    if (c) {
      window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(c.x + c.w / 2), y: Math.round(c.y + c.h / 2) });
      await wait(500);
      await shoot("1-corner-grip.png", { x: Math.max(0, c.x - 110), y: Math.max(0, c.y - 90), width: 220, height: 180 });
    }
  }

  console.log("chrome calls:", JSON.stringify(chrome));
  console.log("console:", JSON.stringify(errors.slice(0, 8)));
  window.destroy(); app.quit();
});
