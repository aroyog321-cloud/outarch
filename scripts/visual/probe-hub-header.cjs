// Why the Integrations header's access card still shows its mark and wraps.
//   npx electron scripts/visual/probe-hub-header.cjs
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
  await wait(2600);
  const js = source => window.webContents.executeJavaScript(source);
  await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="Integrations"]');if(b)b.click();return !!b;})();`);
  await wait(2000);
  console.log(JSON.stringify(await js(`(function(){
    function info(sel){ var e=document.querySelector(sel); if(!e) return {sel:sel,missing:true}; var cs=getComputedStyle(e); var r=e.getBoundingClientRect(); return {sel:sel, cls:e.className, display:cs.display, flexDirection:cs.flexDirection, gridTemplateColumns:cs.gridTemplateColumns, w:Math.round(r.width), h:Math.round(r.height)}; }
    return [info('.hub__trust'), info('.hub__trust .trust-boundary__summary'), info('.hub__trust .trust-boundary__mark'), info('.hub__trust details'), info('.hub__trust summary')];
  })();`), null, 1));
  // Which rules set display on the mark, by walking every stylesheet.
  console.log(JSON.stringify(await js(`(function(){
    var mark=document.querySelector('.hub__trust .trust-boundary__mark'); if(!mark) return null; var out=[];
    for (var sheet of document.styleSheets) { var rules; try { rules = sheet.cssRules; } catch(e) { continue; }
      (function walk(list){ for (var rule of list) { if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue; } if (!rule.selectorText) continue; try { if (mark.matches(rule.selectorText) && rule.style.display) out.push(rule.selectorText.slice(0,120)+' => '+rule.style.getPropertyValue('display')+' '+rule.style.getPropertyPriority('display')); } catch(e){} } })(rules); }
    return out;
  })();`), null, 1));
  window.destroy(); app.quit();
});
