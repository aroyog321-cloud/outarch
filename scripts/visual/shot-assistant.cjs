// Screenshots of every assistant surface: the Mission AI page, its model
// switcher, the Keys & models sheet, the Workspace pane on the canvas and in
// focus mode, and the Mission AI section of Integrations.
//
//   npx electron scripts/visual/shot-assistant.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const OUT = path.join(repoRoot, "artifacts", "visual", "2026-09-12-pass");

ipcMain.handle("mission-control:request", async (_event, message) => {
  try {
    return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  const errors = [];
  window.webContents.on("console-message", (_e, level, message) => { if (level >= 3) errors.push(message.slice(0, 240)); });

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
  const shoot = async name => {
    window.webContents.invalidate();
    await wait(700);
    if (!latest) return console.log("no frame for", name);
    fs.writeFileSync(path.join(OUT, `${name}.png`), latest.toPNG());
    console.log("wrote", `${name}.png`);
  };
  const press = selector => js(`(function(){
    var b = document.querySelector(${JSON.stringify(selector)});
    if (!b) return false;
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
    b.click();
    return true;
  })();`);
  const escape = () => js(`(function(){ document.activeElement && document.activeElement.blur && document.activeElement.blur(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })();`);

  // 1 · Mission AI page with an answer and a pending approval.
  console.log("mission ai button:", await press(".top-ai"));
  await wait(1800);
  await shoot("10-mission-ai");
  console.log(JSON.stringify(await js(`(function(){
    var s = document.querySelector('.ai-screen');
    var t = document.querySelector('.ai-thread');
    var c = document.querySelector('.ai-composer');
    var box = e => { if (!e) return null; var r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      screen: box(s), thread: box(t), composer: box(c),
      h1: (function(){ var h = document.querySelector('.ai-screen__title h1'); return h ? getComputedStyle(h).fontSize : null; })(),
      approval: !!document.querySelector('.ai-approval'),
      evidenceChips: document.querySelectorAll('.mai-evidence').length,
      pageOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  })();`)));

  // 2 · The model switcher.
  console.log("switcher:", await press(".ai-screen .ai-switcher"));
  await wait(900);
  await shoot("11-model-switcher");
  await escape();
  await wait(500);

  // 3 · Keys & models.
  console.log("keys:", await js(`(function(){ var b=[].slice.call(document.querySelectorAll('.ai-screen__button')).find(x => /Keys/.test(x.textContent)); if(!b) return false; b.click(); return true; })();`));
  await wait(1000);
  await shoot("12-keys-sheet");
  await escape();
  await wait(600);

  // 4 · Workspace with the assistant pane.
  await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Workspace"]');if(b)b.click();return !!b;})();`);
  await wait(1500);
  console.log("assistant toggle:", await press(".workspace-assistant-toggle"));
  await wait(1500);
  await shoot("13-workspace-assistant");
  console.log(JSON.stringify(await js(`(function(){
    var p = document.querySelector('.ai-pane');
    var panes = document.querySelectorAll('.terminal-pane');
    var box = e => { if (!e) return null; var r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return { pane: box(p), firstTerminal: box(panes[0]), terminals: panes.length, grid: document.querySelector('.terminal-grid') && document.querySelector('.terminal-grid').className };
  })();`)));

  // 5 · Focus mode with the pane as a tile.
  await js(`(function(){ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', keyCode: 70, which: 70, altKey: true, bubbles: true, cancelable: true })); return true; })();`);
  await wait(1500);
  await shoot("14-focus-assistant");

  // 6 · Integrations → Mission AI.
  await js(`(function(){ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', keyCode: 70, which: 70, altKey: true, bubbles: true, cancelable: true })); return true; })();`);
  await wait(800);
  await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Integrations"]');if(b)b.click();return !!b;})();`);
  await wait(1400);
  console.log("integrations tab:", await js(`(function(){ var b=[].slice.call(document.querySelectorAll('[role="tab"], button')).find(x => (x.textContent||'').trim() === 'Mission AI'); if(!b) return false; b.click(); return true; })();`));
  await wait(1400);
  await shoot("15-integrations-mission-ai");

  if (errors.length) console.log("console errors:", JSON.stringify(errors.slice(0, 8), null, 1));
  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(error => { console.error("SHOT FAILED", error); app.quit(); }));
