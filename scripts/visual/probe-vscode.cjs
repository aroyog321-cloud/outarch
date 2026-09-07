// Dumps the live geometry, computed styles and matching CSS rules for the
// VS Code Bridge panel so its layout defects can be traced to a rule.
//
//   npx electron scripts/visual/probe-vscode.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");

ipcMain.handle("mission-control:request", (_event, message) => {
  try {
    return { version: 1, id: message.id, ok: true, result: fixtures.handle(message.method, message.params) };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function waitFor(window, selector, timeout = 20000) {
  return window.webContents.executeJavaScript(
    "new Promise((resolve, reject) => { const started = Date.now(); const poll = () => {" +
    " if (document.querySelector(" + JSON.stringify(selector) + ")) return resolve(true);" +
    " if (Date.now() - started > " + timeout + ") return reject(new Error('never mounted: ' + " + JSON.stringify(selector) + "));" +
    " setTimeout(poll, 100); }; poll(); })"
  );
}

async function run() {
  const window = new BrowserWindow({
    width: 1440, height: 900, show: false, frame: false,
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  window.webContents.setFrameRate(30);
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await waitFor(window, ".top-navigation");
  await wait(1200);
  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"integrations\"]'); if (b) b.click(); return Boolean(b); })()");
  await waitFor(window, ".integration-hub-tabs");
  await wait(600);
  await window.webContents.executeJavaScript("(() => { const t = [...document.querySelectorAll('.integration-hub-tabs button')].find(b => b.textContent.includes('VS Code')); if (t) t.click(); return Boolean(t); })()");
  await waitFor(window, ".vscode-bridge-settings");
  await wait(900);

  const report = await window.webContents.executeJavaScript(`
    (() => {
      const describe = selector => {
        const node = document.querySelector(selector);
        if (!node) return { selector, missing: true };
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        const rules = [];
        for (const sheet of document.styleSheets) {
          let list = null;
          try { list = sheet.cssRules; } catch { continue; }
          for (const rule of list) {
            if (!rule.selectorText) continue;
            try { if (node.matches(rule.selectorText)) rules.push(rule.selectorText + ' {' + rule.style.cssText.slice(0, 150) + '}'); } catch { /* unsupported selector */ }
          }
        }
        return {
          selector,
          rect: { top: Math.round(rect.top), left: Math.round(rect.left), width: Math.round(rect.width), height: Math.round(rect.height) },
          display: style.display,
          gridTemplateColumns: style.gridTemplateColumns,
          fontSize: style.fontSize,
          listStyleType: style.listStyleType,
          color: style.color,
          background: style.backgroundColor,
          padding: style.padding,
          text: (node.innerText || '').slice(0, 110).replace(/\\s+/g, ' '),
          rules: rules.slice(-6)
        };
      };
      return {
        panel: describe('.vscode-bridge-settings'),
        steps: describe('.vscode-setup-steps'),
        stepItem: describe('.vscode-setup-steps li'),
        body: describe('.vscode-bridge-body'),
        summary: describe('.vscode-sync-summary'),
        summaryCell: describe('.vscode-sync-summary > div'),
        summaryLabel: describe('.vscode-sync-summary span'),
        trust: describe('.vscode-bridge-body .trust-boundary'),
        footer: describe('.vscode-bridge-settings > footer')
      };
    })()
  `);
  console.log(JSON.stringify(report, null, 2));
  window.destroy();
}

app.disableHardwareAcceleration();
app.whenReady().then(run).then(() => app.exit(0)).catch(error => { console.error("PROBE FAILED:", error.message); app.exit(1); });
