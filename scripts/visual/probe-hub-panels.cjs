// Geometry of the panel headers inside the Integrations and Settings hubs.
//   npx electron scripts/visual/probe-hub-panels.cjs
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
  const errors = [];
  window.webContents.on("console-message", (_e, level, message) => { if (level >= 2) errors.push(message.slice(0, 300)); });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2600);
  const js = source => window.webContents.executeJavaScript(source);
  const nav = label => js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="${label}"]');if(b)b.click();return !!b;})();`);
  await nav("Integrations");
  await wait(1800);
  await js(`(function(){ var b=[].slice.call(document.querySelectorAll('.hub__rail-item')).find(function(x){return /Secure MCP/.test(x.textContent);}); if(b) b.click(); return !!b; })();`);
  await wait(1500);
  console.log(JSON.stringify(await js(`(function(){
    function info(sel){ var e=document.querySelector(sel); if(!e) return {sel:sel,missing:true}; var cs=getComputedStyle(e); var r=e.getBoundingClientRect(); return {sel:sel, display:cs.display, gtc:cs.gridTemplateColumns, gta:cs.gridTemplateAreas, flexDir:cs.flexDirection, pos:cs.position, x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height), pad:cs.padding, margin:cs.margin, lh:cs.lineHeight, fs:cs.fontSize, minH:cs.minHeight, maxW:cs.maxWidth, ws:cs.whiteSpace, border:cs.borderColor}; }
    return ['.mcp-gateway-settings','.mcp-gateway-settings > header','.mcp-gateway-settings .settings-panel__head','.mcp-gateway-settings .settings-panel__head > div','.mcp-state','.mcp-mark','.mcp-gateway-settings .settings-panel__head h3','.mcp-gateway-settings .settings-panel__head p'].map(info);
  })();`), null, 1));
  console.log("RULES", JSON.stringify(await js(`(function(){
    var el = document.querySelector('.mcp-gateway-settings .settings-panel__head p'); var out = [];
    var props = ['height','min-height','block-size','min-block-size','padding','padding-bottom','margin-bottom','line-height','display','contain-intrinsic-size','aspect-ratio','flex','flex-grow','flex-basis'];
    for (var sheet of document.styleSheets) { var rules; try { rules = sheet.cssRules; } catch (e) { continue; }
      (function walk(list){ for (var rule of list) { if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue; } if (!rule.selectorText) continue; try { if (el.matches(rule.selectorText)) { var set = props.filter(function(p){ return rule.style.getPropertyValue(p); }).map(function(p){ return p + ':' + rule.style.getPropertyValue(p) + rule.style.getPropertyPriority(p); }); if (set.length) out.push(rule.selectorText.slice(0,140) + ' => ' + set.join('; ')); } } catch (e) {} } })(rules); }
    var range = document.createRange(); range.selectNodeContents(el); var b = range.getBoundingClientRect();
    return { rules: out, text: [Math.round(b.width), Math.round(b.height), range.getClientRects().length], flex: getComputedStyle(el).flex };
  })();`), null, 1));
  await nav("Settings");
  await wait(1800);
  console.log("settings:", JSON.stringify(await js(`(function(){ var e=document.querySelector('.experience'); return { cls: e && e.className.slice(0,120), rail: document.querySelectorAll('.hub__rail-item').length, hub: !!document.querySelector('.settings-hub'), text: (e && e.textContent || '').slice(0, 200) }; })();`)));
  console.log("errors:", JSON.stringify(errors.slice(0, 8), null, 1));
  window.destroy(); app.quit();
});
