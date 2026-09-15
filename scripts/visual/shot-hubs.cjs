// Every Integrations tab and every Settings section, one screenshot each.
//
//   npx electron scripts/visual/shot-hubs.cjs [--prefix before]
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const OUT = path.join(repoRoot, "artifacts", "visual", "2026-09-12-pass");
const argv = process.argv.slice(2);
const prefix = argv.includes("--prefix") ? argv[argv.indexOf("--prefix") + 1] : "hub";

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
    fs.writeFileSync(path.join(OUT, `${prefix}-${name}.png`), latest.toPNG());
    console.log("wrote", `${prefix}-${name}.png`);
  };
  const nav = label => js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="${label}"]');if(b)b.click();return !!b;})();`);
  const tab = label => js(`(function(){
    var b = [].slice.call(document.querySelectorAll('.hub__rail-item')).find(function(x){ return ((x.querySelector('strong')||x).textContent || '').trim() === ${JSON.stringify(label)}; });
    if (!b) return [].slice.call(document.querySelectorAll('.hub__rail-item')).map(function(x){ return ((x.querySelector('strong')||x).textContent || '').trim(); });
    b.click(); return true;
  })();`);
  const scrollHeight = () => js(`(function(){ var e = document.querySelector('.experience'); return e ? { scroll: e.scrollHeight, client: e.clientHeight } : null; })();`);

  console.log("nav integrations:", await nav("Integrations"));
  await wait(3000);
  console.log("view:", JSON.stringify(await js("(function(){ var e=document.querySelector('.experience'); return { cls: e && e.className, tabs: document.querySelectorAll('[role=tab]').length, nav: [].slice.call(document.querySelectorAll('.top-navigation button')).map(function(b){return b.getAttribute('aria-label');}) }; })();")));
  for (const label of (process.env.ONLY_SETTINGS ? [] : process.env.ONLY_TABS ? process.env.ONLY_TABS.split(",") : ["Overview", "Mission AI", "VS Code Bridge", "Secure MCP", "Mobile Companion", "Plugins"])) {
    const result = await tab(label);
    if (result !== true) { console.log("tab missing:", label, JSON.stringify(result)); continue; }
    await wait(1300);
    if (process.env.SCROLL_BOTTOM) { await js("(function(){ var e=document.querySelector('.experience'); if(e) e.scrollTop=e.scrollHeight; return true; })();"); await wait(400); }
    await shoot(`integrations-${label.toLowerCase().replace(/\s+/g, "-")}`);
    console.log("  height", JSON.stringify(await scrollHeight()));
  }

  if (process.env.ONLY_TABS) { window.destroy(); app.quit(); return; }
  await nav("Settings");
  await wait(3000);
  const tabs = await js(`(function(){ return [].slice.call(document.querySelectorAll('.hub__rail-item')).map(function(x){ return ((x.querySelector('strong')||x).textContent || '').trim(); }); })();`);
  console.log("settings tabs:", JSON.stringify(tabs));
  for (const label of tabs.filter(label => label !== "Integrations")) {
    await tab(label);
    await wait(1100);
    await shoot(`settings-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`);
    console.log("  height", JSON.stringify(await scrollHeight()));
  }

  window.destroy();
  app.quit();
}

app.disableHardwareAcceleration();
app.whenReady().then(() => run().catch(error => { console.error("SHOT FAILED", error); app.quit(); }));
