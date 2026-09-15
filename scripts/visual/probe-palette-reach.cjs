// Why Ctrl K does not open the command palette "while working".
//
//   npx electron scripts/visual/probe-palette-reach.cjs
//
// The palette opens fine from a cold Groundstation route, so the report has to
// be about the state the operator is actually in. This parks focus inside an
// xterm terminal — the thing that holds focus in the Workspace — and checks
// whether the shortcut still reaches the window listener.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");

ipcMain.handle("mission-control:request", async (_event, message) => {
  try {
    return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const CLICK_NAV = name => `(function(){
  var b = document.querySelector('.top-navigation button[aria-label="' + ${JSON.stringify(JSON.stringify(name))} .slice(1,-1) + '"]');
  if (!b) return false; b.click(); return true;
})();`;

const PARK_FOCUS = `(function(){
  var ta = document.querySelector('.xterm-helper-textarea');
  if (!ta) return { textarea: false, active: document.activeElement && document.activeElement.tagName };
  ta.focus();
  return { textarea: true, active: document.activeElement && (document.activeElement.className || document.activeElement.tagName) };
})();`;

const FIRE_CTRL_K = `(function(){
  var reached = false;
  var spy = function(){ reached = true; };
  window.addEventListener('keydown', spy);
  var target = document.querySelector('.xterm-helper-textarea') || document.body;
  var ev = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', keyCode: 75, which: 75, ctrlKey: true, bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  window.removeEventListener('keydown', spy);
  return { reachedWindow: reached, defaultPrevented: ev.defaultPrevented, palette: !!document.querySelector('.command-palette') };
})();`;

const CLICK_SEARCH = `(function(){
  var b = document.querySelector('.top-search');
  if (!b) return { found: false };
  b.click();
  return { found: true };
})();`;

const PALETTE_STATE = `(function(){
  var p = document.querySelector('.command-palette');
  if (!p) return { palette: false };
  var r = p.getBoundingClientRect();
  return { palette: true, items: document.querySelectorAll('[cmdk-item]').length, h: Math.round(r.height), y: Math.round(r.y) };
})();`;

const ESCAPE = `(function(){ document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })();`;

async function run() {
  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
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

  await js(CLICK_NAV("Workspace"));
  await wait(1800);

  console.log("--- focus parked inside a terminal ---");
  console.log(JSON.stringify(await js(PARK_FOCUS)));

  console.log("--- Ctrl K fired from the terminal ---");
  console.log(JSON.stringify(await js(FIRE_CTRL_K)));
  await wait(700);
  console.log("palette state:", JSON.stringify(await js(PALETTE_STATE)));
  await js(ESCAPE);
  await wait(500);

  console.log("--- sidebar Search commands, clicked from the Workspace route ---");
  console.log(JSON.stringify(await js(CLICK_SEARCH)));
  await wait(900);
  console.log("palette state:", JSON.stringify(await js(PALETTE_STATE)));
  await js(ESCAPE);
  await wait(500);

  console.log("--- does xterm register a key handler that stops propagation? ---");
  console.log(JSON.stringify(await js(`(function(){
    var host = document.querySelector('.terminal-host');
    var ta = document.querySelector('.xterm-helper-textarea');
    return {
      host: !!host,
      textarea: !!ta,
      textareaParent: ta && ta.parentElement ? ta.parentElement.className : null,
      xtermAttached: !!document.querySelector('.xterm-screen')
    };
  })();`)));

  console.log("--- Workspace route Alt shortcuts that DO work, for comparison ---");
  await js(`(function(){ var ta=document.querySelector('.xterm-helper-textarea'); if(ta) ta.focus(); return true; })();`);
  console.log(JSON.stringify(await js(`(function(){
    var target = document.querySelector('.xterm-helper-textarea') || document.body;
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', keyCode: 70, which: 70, altKey: true, bubbles: true, cancelable: true }));
    return { focusMode: document.documentElement.dataset.workspaceFocus || null };
  })();`)));

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(error => { console.error("PROBE FAILED", error); app.quit(); }));
