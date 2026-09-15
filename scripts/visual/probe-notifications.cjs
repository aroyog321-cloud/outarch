// Operational events as in-app notifications, on the canvas and in focus mode.
//
//   npx electron scripts/visual/probe-notifications.cjs
//
// The main process broadcasts every semantic event to the renderers, so the
// probe can raise a real one by sending the same message the real host sends.
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

const SERVICE_READY = {
  type: "workspace:event",
  event: {
    id: "e1", type: "service.ready", severity: "info",
    workerId: "web", workerName: "Web dev server", projectId: "default", runId: "r1",
    title: "Web dev server is ready",
    description: "http://localhost:5173 is accepting connections.",
    data: { serviceId: "svc_default_web_5173_", url: "http://localhost:5173", port: 5173, generation: 1, kind: "frontend" },
    timestamp: Date.now()
  }
};

const BUILD_FAILED = {
  type: "workspace:event",
  event: {
    id: "e2", type: "build.failed", severity: "error",
    workerId: "api", workerName: "API gateway", projectId: "default", runId: "r2",
    title: "API gateway build failed",
    description: "TypeError: cannot read properties of undefined",
    data: {},
    timestamp: Date.now()
  }
};

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
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
    if (!latest) return console.log("no frame for", name);
    fs.writeFileSync(path.join(OUT, `${name}.png`), latest.toPNG());
    console.log("wrote", `${name}.png`);
  };
  const geometry = `(function(){
    var c = document.querySelector('.mc-toast-container');
    if (!c) return { container: false };
    var r = c.getBoundingClientRect();
    var toasts = [].slice.call(c.querySelectorAll('.mc-toast')).map(function(t){
      var tr = t.getBoundingClientRect();
      var msg = t.querySelector('.mc-toast__message');
      var act = t.querySelector('.mc-toast__action');
      return {
        cls: t.className,
        y: Math.round(tr.y), h: Math.round(tr.height), w: Math.round(tr.width),
        message: msg ? msg.textContent : null,
        messageClipped: msg ? msg.scrollHeight > msg.clientHeight + 1 : null,
        action: act ? act.textContent.trim() : null,
        role: t.getAttribute('role')
      };
    });
    var deck = document.querySelector('.workspace-actions');
    var deckRect = deck ? deck.getBoundingClientRect() : null;
    var overlap = null;
    if (deckRect && toasts.length) {
      var t0 = c.querySelector('.mc-toast').getBoundingClientRect();
      overlap = !(t0.right < deckRect.left || t0.left > deckRect.right || t0.bottom < deckRect.top || t0.top > deckRect.bottom);
    }
    return {
      container: true,
      x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width),
      viewport: { w: window.innerWidth, h: window.innerHeight },
      focusMode: document.documentElement.dataset.workspaceFocus || null,
      overlapsFocusDeck: overlap,
      toasts: toasts
    };
  })();`;

  await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Workspace"]');if(b)b.click();return !!b;})();`);
  await wait(1800);

  window.webContents.send("mission-control:event", SERVICE_READY);
  window.webContents.send("mission-control:event", BUILD_FAILED);
  await wait(1200);
  console.log("--- workspace, normal ---");
  console.log(JSON.stringify(await js(geometry), null, 1));
  await shoot("05-notifications");

  // Focus mode: the report was that notifications could not be seen there at all.
  console.log("focus mode:", JSON.stringify(await js(`(function(){
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', code: 'KeyF', keyCode: 70, which: 70, altKey: true, bubbles: true, cancelable: true }));
    return true;
  })();`)));
  await wait(1400);
  window.webContents.send("mission-control:event", { ...SERVICE_READY, event: { ...SERVICE_READY.event, id: "e3", workerName: "Storefront" } });
  await wait(1200);
  console.log("--- workspace, focus mode ---");
  console.log(JSON.stringify(await js(geometry), null, 1));
  await shoot("06-notifications-focus");

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(error => { console.error("PROBE FAILED", error); app.quit(); }));
