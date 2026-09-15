// Which rules decide chosen properties on chosen elements, on any hub tab.
//
//   VIEW=Settings TAB=Terminal SEL='[".settings-panel"]' PROPS='["background-color","padding"]' \
//     npx electron scripts/visual/probe-cascade.cjs
//
// Prints each element's computed values and every matching rule that sets one
// of the properties, with its !important flag, so the winner can be read off.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const repoRoot = path.resolve(__dirname, "..", "..");

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = (promise, ms) => Promise.race([promise, wait(ms).then(() => "TIMEOUT")]);

const VIEW = process.env.VIEW || "Settings";
const TAB = process.env.TAB || "";
const SELECTORS = JSON.parse(process.env.SEL || "[\".settings-panel\"]");
const PROPS = JSON.parse(process.env.PROPS || "[\"background-color\"]");
const RULES = process.env.RULES !== "0";

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1440, height: 900, show: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2600);
  const js = source => withTimeout(window.webContents.executeJavaScript(source), 8000);
  for (let i = 0; i < 20; i++) {
    const n = await js("document.querySelectorAll('.hub__rail-item').length");
    const onView = await js(`!!document.querySelector('.experience.view-${VIEW.toLowerCase()}')`);
    if (n > 0 && onView) break;
    await js(`(function(){var b=document.querySelector('.top-navigation button[aria-label="${VIEW}"]');if(b)b.click();return !!b;})();`);
    await wait(700);
  }
  if (TAB) {
    await js(`(function(){ var b=[].slice.call(document.querySelectorAll('.hub__rail-item')).find(function(x){ return ((x.querySelector('strong')||x).textContent||'').trim() === ${JSON.stringify(TAB)}; }); if(b) b.click(); return !!b; })();`);
    await wait(1500);
  }
  const result = await js(`(function(){
    var props = ${JSON.stringify(PROPS)};
    return ${JSON.stringify(SELECTORS)}.map(function(sel){
      var el = document.querySelector(sel);
      if (!el) return { sel: sel, missing: true };
      var cs = getComputedStyle(el); var r = el.getBoundingClientRect();
      var computed = {}; props.forEach(function(p){ computed[p] = cs.getPropertyValue(p); });
      var rules = [];
      if (${RULES}) for (var sheet of document.styleSheets) { var list; try { list = sheet.cssRules; } catch (e) { continue; }
        (function walk(items){ for (var rule of items) { if (rule.cssRules && !rule.selectorText) { walk(rule.cssRules); continue; } if (!rule.selectorText) continue; try { if (el.matches(rule.selectorText)) { var set = props.filter(function(p){ return rule.style.getPropertyValue(p); }).map(function(p){ return p + ':' + rule.style.getPropertyValue(p) + (rule.style.getPropertyPriority(p) ? ' !' : ''); }); if (set.length) rules.push(rule.selectorText.slice(0, 150) + ' => ' + set.join('; ')); } } catch (e) {} } })(list); }
      return { sel: sel, cls: String(el.className).slice(0, 90), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], computed: computed, rules: rules };
    });
  })();`);
  console.log(JSON.stringify(result, null, 1));
  window.destroy(); app.quit();
});
