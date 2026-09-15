// Measures the Sound row's switch against a neighbouring switch in Settings › Notifications.
//   npx electron scripts/visual/probe-sound-toggle.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const repoRoot = path.resolve(__dirname, "..", "..");

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2800);
  const js = source => window.webContents.executeJavaScript(source);
  await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Settings"]');if(b)b.click();return !!b;})();`);
  await wait(1500);
  await js(`(function(){ var b=[].slice.call(document.querySelectorAll('.hub__rail-item')).find(function(x){ return /Notifications/.test(x.textContent); }); if(b) b.click(); return !!b; })();`);
  await wait(1200);
  console.log(JSON.stringify(await js(`(function(){
    function describe(el){ if(!el) return null; var s=getComputedStyle(el), r=el.getBoundingClientRect(); return { tag: el.tagName, cls: el.className, display: s.display, position: s.position, box: [Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)], bg: s.backgroundColor, radius: s.borderRadius, border: s.border, padding: s.padding, minHeight: s.minHeight, opacity: s.opacity, appearance: s.appearance }; }
    var cards=[].slice.call(document.querySelectorAll('.attention-policy .pm-toggle'));
    return cards.map(function(t){ return { row: (t.closest('.terminal-toggle-card')||{}).className, toggle: describe(t), input: describe(t.querySelector('input')), track: describe(t.querySelector('.pm-toggle-track')), thumb: describe(t.querySelector('.pm-toggle-thumb')) }; }).concat([{ play: describe(document.querySelector('.notification-sound__controls .btn-ghost')) }]);
  })();`), null, 1));
  window.destroy();
  app.quit();
});
