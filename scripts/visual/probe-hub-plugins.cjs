// What happens to the renderer when the Plugins integration tab opens.
//   npx electron scripts/visual/probe-hub-plugins.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const repoRoot = path.resolve(__dirname, "..", "..");

const calls = [];
ipcMain.handle("mission-control:request", async (_event, message) => {
  calls.push(message.method);
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = (promise, ms) => Promise.race([promise, wait(ms).then(() => "TIMEOUT")]);

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  const messages = [];
  window.webContents.on("console-message", (_e, level, message, line, source) => { if (level >= 2) messages.push(`[${level}] ${message.slice(0, 900)} @${source}:${line}`); });
  window.webContents.on("render-process-gone", (_e, details) => messages.push("GONE " + JSON.stringify(details)));
  window.webContents.on("unresponsive", () => messages.push("UNRESPONSIVE"));
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2600);
  const js = source => withTimeout(window.webContents.executeJavaScript(source), 6000);
  await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Integrations"]');if(b)b.click();return !!b;})();`);
  for (let i = 0; i < 20; i++) { const n = await js("document.querySelectorAll('.hub__rail-item').length"); if (n > 0) break; await js("(function(){var b=document.querySelector('.top-navigation button[aria-label=Integrations]');if(b)b.click();return !!b;})();"); await wait(700); }
  const before = calls.length;
  console.log("click:", await js(`(function(){ var b=[].slice.call(document.querySelectorAll('.hub__rail-item')).find(function(x){return /Plugins/.test(x.textContent);}); if(b) setTimeout(function(){ b.click(); }, 0); return !!b; })();`));
  await wait(2500);
  console.log("after:", await js(`(function(){ return { root: document.getElementById('root').innerHTML.length, text: document.body.textContent.slice(0, 300) }; })();`));
  console.log("calls after click:", JSON.stringify(calls.slice(before, before + 40)));
  console.log("messages:\n" + messages.slice(0, 12).join("\n"));
  window.destroy(); app.quit();
});
