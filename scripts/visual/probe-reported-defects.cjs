// Measures the four defects reported on 2026-09-12, on the real rendered app.
//
//   npx electron scripts/visual/probe-reported-defects.cjs
//
// 1. The ⋯ menu on a bottom-row terminal pane overflows the viewport.
// 2. The project switcher rows have no layout rule at all.
// 3. Ctrl K / the sidebar search control does not open the command palette.
// 4. Toasts in focus mode land under the floating focus deck.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const WIDTH = 1440;
const HEIGHT = 900;

ipcMain.handle("mission-control:request", async (_event, message) => {
  try {
    return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  const window = new BrowserWindow({
    width: WIDTH, height: HEIGHT, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });

  const errors = [];
  window.webContents.on("console-message", (_e, level, message) => {
    if (level >= 2) errors.push(message.slice(0, 300));
  });

  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript(
    'window.localStorage.clear();window.localStorage.setItem("mission-control:interface-preferences:v1", JSON.stringify({' +
    'theme: "orbital", typeScale: "comfortable", density: "comfortable", motion: "full",' +
    'terminalFontSize: 13, terminalTheme: "orbital", terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true' +
    '}));true;'
  );
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await wait(2600);

  const js = source => window.webContents.executeJavaScript(source);

  console.log("=".repeat(78));
  console.log("1 · TERMINAL PANE OVERFLOW MENU");
  console.log("=".repeat(78));

  await js('(function(){var b=document.querySelector(".top-navigation button[aria-label=\'Workspace\']");if(b)b.click();return !!b;})();');
  await wait(1800);

  const panes = await js('(function(){return [].slice.call(document.querySelectorAll(".terminal-pane")).map(function(p,i){var r=p.getBoundingClientRect();return {i:i,top:Math.round(r.top),bottom:Math.round(r.bottom),name:(p.querySelector("strong")||{}).textContent};});})();');
  console.log("panes on canvas:", JSON.stringify(panes, null, 1));

  const lastIndex = panes.length - 1;
  await js('(function(){var ps=document.querySelectorAll(".terminal-pane");var p=ps[' + lastIndex + '];if(!p)return false;var b=p.querySelector(".terminal-more");if(!b)return false;b.dispatchEvent(new PointerEvent("pointerdown",{bubbles:true,button:0,ctrlKey:false,pointerType:"mouse"}));b.dispatchEvent(new PointerEvent("pointerup",{bubbles:true,button:0,pointerType:"mouse"}));b.click();return true;})();');
  await wait(900);

  const menu = await js('(function(){var m=document.querySelector(".terminal-action-menu");if(!m)return null;var r=m.getBoundingClientRect();var cs=getComputedStyle(m);var items=m.querySelectorAll(".terminal-action-item").length;return {top:Math.round(r.top),bottom:Math.round(r.bottom),height:Math.round(r.height),width:Math.round(r.width),items:items,maxHeight:cs.maxHeight,overflowY:cs.overflowY,viewportH:window.innerHeight,availableVar:cs.getPropertyValue("--radix-dropdown-menu-content-available-height"),side:m.getAttribute("data-side")};})();');
  console.log("⋯ menu opened on the LAST pane:", JSON.stringify(menu, null, 1));
  if (menu) {
    const clippedTop = menu.top < 0;
    const clippedBottom = menu.bottom > menu.viewportH;
    console.log("  clipped above viewport:", clippedTop, " clipped below viewport:", clippedBottom);
    console.log("  VERDICT:", clippedTop || clippedBottom ? "UNREACHABLE ITEMS" : "fits");
  }
  await js('document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));true;');
  await wait(500);

  console.log("");
  console.log("=".repeat(78));
  console.log("2 · PROJECT SWITCHER ROW LAYOUT");
  console.log("=".repeat(78));

  await js('(function(){var b=document.querySelector(".top-project");if(b)b.click();return !!b;})();');
  await wait(1600);

  const rows = await js('(function(){var row=document.querySelector(".project-row");if(!row)return {found:false,html:(document.querySelector(".projects-view")||{}).className};var cs=getComputedStyle(row);var kids=[].slice.call(row.children).map(function(c){var r=c.getBoundingClientRect();return {cls:c.className,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};});var rr=row.getBoundingClientRect();return {found:true,display:cs.display,gridTemplateColumns:cs.gridTemplateColumns,alignItems:cs.alignItems,gap:cs.gap,padding:cs.padding,background:cs.backgroundColor,border:cs.borderTopWidth+" "+cs.borderTopStyle,rowHeight:Math.round(rr.height),children:kids};})();');
  console.log(JSON.stringify(rows, null, 1));

  const runTogether = await js('(function(){var body=document.querySelector(".project-row__body");var state=document.querySelector(".project-state");if(!body)return null;var strong=body.querySelector("strong"),code=body.querySelector("code");function box(e){if(!e)return null;var r=e.getBoundingClientRect();return {t:Math.round(r.top),l:Math.round(r.left),w:Math.round(r.width),d:getComputedStyle(e).display,txt:(e.textContent||"").slice(0,28)};}return {name:box(strong),path:box(code),state:box(state),stateSmall:box(state&&state.querySelector("small"))};})();');
  console.log("name / path / state boxes:", JSON.stringify(runTogether, null, 1));
  if (runTogether && runTogether.name && runTogether.path) {
    console.log("  name and path share a baseline (run together):", runTogether.name.t === runTogether.path.t);
  }

  console.log("");
  console.log("=".repeat(78));
  console.log("3 · COMMAND PALETTE");
  console.log("=".repeat(78));

  await js('(function(){var b=document.querySelector(".top-navigation button[aria-label=\'Groundstation\']");if(b)b.click();return !!b;})();');
  await wait(1200);
  errors.length = 0;

  const sidebarButton = await js('(function(){var b=[].slice.call(document.querySelectorAll("button")).find(function(x){return /Search\\s*commands/i.test(x.textContent||"");});return b?{found:true,label:b.textContent.trim().slice(0,40),cls:b.className}:{found:false};})();');
  console.log("sidebar search control:", JSON.stringify(sidebarButton));

  await js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true,bubbles:true}));true;');
  await wait(1000);
  const afterCtrlK = await js('(function(){var p=document.querySelector(".command-palette");return {palette:!!p,items:document.querySelectorAll("[cmdk-item]").length,groups:document.querySelectorAll("[cmdk-group]").length,input:!!document.querySelector("[cmdk-input]"),listHeight:p?Math.round(p.getBoundingClientRect().height):0,rootHtml:p?p.innerHTML.length:0};})();');
  console.log("after Ctrl K:", JSON.stringify(afterCtrlK));
  if (errors.length) console.log("  console errors:", JSON.stringify(errors.slice(0, 6), null, 1));

  if (afterCtrlK.palette) {
    await js('(function(){var i=document.querySelector("[cmdk-input]");if(!i)return false;var setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set;setter.call(i,"work");i.dispatchEvent(new Event("input",{bubbles:true}));return true;})();');
    await wait(800);
    const typed = await js('(function(){var i=document.querySelector("[cmdk-input]");return {value:i?i.value:null,items:document.querySelectorAll("[cmdk-item]").length,empty:!!document.querySelector("[cmdk-empty]")&&getComputedStyle(document.querySelector("[cmdk-empty]")).display!=="none"};})();');
    console.log("after typing 'work':", JSON.stringify(typed));
    console.log("  VERDICT:", typed.value === "work" ? (typed.items > 0 ? "search works" : "TYPED BUT FILTERS TO NOTHING") : "INPUT DOES NOT ACCEPT TEXT");
  } else {
    console.log("  VERDICT: PALETTE DOES NOT OPEN");
  }

  console.log("");
  console.log("=".repeat(78));
  console.log("4 · FOCUS MODE + NOTIFICATIONS");
  console.log("=".repeat(78));
  await js('(function(){var b=document.querySelector(".top-navigation button[aria-label=\'Workspace\']");if(b)b.click();return !!b;})();');
  await wait(1500);
  await js('window.dispatchEvent(new KeyboardEvent("keydown",{key:"f",altKey:true,bubbles:true}));true;');
  await wait(1200);
  const focusGeom = await js('(function(){function box(s){var e=document.querySelector(s);if(!e)return null;var r=e.getBoundingClientRect();var cs=getComputedStyle(e);return {sel:s,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height),z:cs.zIndex,pos:cs.position};}return {focusOn:document.documentElement.dataset.workspaceFocus||null,deck:box(".workspace-actions"),toolbar:box(".workspace-toolbar"),container:box(".mc-toast-container"),grid:box(".terminal-grid")};})();');
  console.log(JSON.stringify(focusGeom, null, 1));
  console.log("note: .mc-toast-container is only in the DOM while a toast is live; its CSS anchor is bottom 24 / right 24 — the same corner as the focus deck.");

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(error => { console.error("PROBE FAILED", error); app.quit(); }));
