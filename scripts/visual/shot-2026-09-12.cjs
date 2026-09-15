// Screenshots of the surfaces changed on 2026-09-12, so they can be looked at
// rather than reasoned about.
//
//   npx electron scripts/visual/shot-2026-09-12.cjs
//
// Offscreen rendering with the frame taken from the paint event, per the
// harness rules: a hidden window parked off-screen returns the frame from
// before the interaction.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const OUT = path.join(repoRoot, "artifacts", "visual", "2026-09-12-pass");
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
  fs.mkdirSync(OUT, { recursive: true });
  const window = new BrowserWindow({
    width: WIDTH, height: HEIGHT, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });

  let latest = null;
  window.webContents.on("paint", (_event, _dirty, image) => { latest = image; });
  window.webContents.setFrameRate(30);

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
    if (!latest) { console.log("no frame for", name); return; }
    const file = path.join(OUT, `${name}.png`);
    fs.writeFileSync(file, latest.toPNG());
    console.log("wrote", path.relative(repoRoot, file), latest.getSize());
  };

  const nav = name => `(function(){var b=document.querySelector('.top-navigation button[aria-label="${name}"]');if(b)b.click();return !!b;})();`;
  const ESCAPE = `(function(){document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));return true;})();`;

  await js(nav("Workspace"));
  await wait(1800);
  await shoot("01-workspace");

  console.log("run controls:", JSON.stringify(await js(`(function(){
    return [].slice.call(document.querySelectorAll('.terminal-pane__run')).map(function(b){
      var cs = getComputedStyle(b);
      var r = b.getBoundingClientRect();
      return { cls: b.className.replace('icon-button ',''), color: cs.color, background: cs.backgroundColor, border: cs.borderTopColor, w: Math.round(r.width), h: Math.round(r.height), label: b.getAttribute('aria-label') };
    });
  })();`), null, 1));

  // The ⋯ menu on the bottom-right pane — the one that used to run off screen.
  await js(`(function(){
    var ps = document.querySelectorAll('.terminal-pane');
    var p = ps[ps.length - 1];
    if (!p) return false;
    var b = p.querySelector('.terminal-more');
    if (!b) return false;
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
    b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerType: 'mouse' }));
    b.click();
    return true;
  })();`);
  await wait(1000);
  await shoot("02-pane-menu-bottom-row");
  await js(ESCAPE);
  await wait(600);

  await js(nav("Groundstation"));
  await wait(1400);
  await shoot("03-groundstation");

  await js(`(function(){var b=document.querySelector('.top-project');if(b)b.click();return !!b;})();`);
  await wait(1600);
  await shoot("04-project-switcher");

  console.log(JSON.stringify(await js(`(function(){
    var rows = document.querySelectorAll('.project-row');
    var first = rows[0];
    return {
      rows: rows.length,
      rowHeight: first ? Math.round(first.getBoundingClientRect().height) : 0,
      overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth
    };
  })();`)));

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(error => { console.error("SHOT FAILED", error); app.quit(); }));
