// Verifies the three fixes on a real, composited window:
//   1. the status tape clears the native window-controls overlay
//   2. the tape is a drag region and its controls still take clicks
//   3. the terminal's scrollable wrapper no longer paints a strip, and the
//      vestigial viewport gutter is gone
//   4. Settings still reads correctly with the theme pickers retired
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/titlebar"));

ipcMain.handle("mission-control:request", async (_event, message) => ({
  version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params)
}));
const wait = ms => new Promise(r => setTimeout(r, ms));

async function run() {
  const window = new BrowserWindow({
    width: 1440, height: 900, show: true, backgroundColor: "#000000",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0a0b0d", symbolColor: "#cbd0dc", height: 42 },
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), sandbox: false, contextIsolation: true, nodeIntegration: false }
  });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  // Seed a stored preference naming a retired theme: the migration has to heal it.
  const stale = JSON.stringify({ theme: "solar", typeScale: "comfortable", density: "comfortable", motion: "full",
    terminalFontSize: 13, terminalTheme: "solar", terminalCursor: "bar", terminalScrollback: 5000, showCommandHints: true });
  await window.webContents.executeJavaScript(
    "window.localStorage.clear();\nwindow.localStorage.setItem('mission-control:interface-preferences:v1', " + JSON.stringify(stale) + ");\ntrue;"
  );
  window.reload();
  await new Promise(r => window.webContents.once("did-finish-load", r));
  await wait(2500);
  fs.mkdirSync(outDir, { recursive: true });

  const tape = await window.webContents.executeJavaScript(
    "(() => { const bar = document.querySelector('.mission-status-bar'); const br = bar.getBoundingClientRect();" +
    " const free = navigator.windowControlsOverlay ? navigator.windowControlsOverlay.getTitlebarAreaRect().right : innerWidth;" +
    " const kids = Array.from(bar.querySelectorAll('.status-bar-premium__right > *')).map(el => { const k = el.getBoundingClientRect();" +
    "   return { text: (el.textContent||'').trim().slice(0,22), right: Math.round(k.right), clear: k.right <= free, drag: getComputedStyle(el).webkitAppRegion }; });" +
    " return JSON.stringify({ freeUntil: free, padRight: getComputedStyle(bar).paddingRight, barRegion: getComputedStyle(bar).webkitAppRegion," +
    "   storedTheme: JSON.parse(localStorage.getItem('mission-control:interface-preferences:v1')).theme," +
    "   storedTerminalTheme: JSON.parse(localStorage.getItem('mission-control:interface-preferences:v1')).terminalTheme," +
    "   shellClass: document.querySelector('.shell').className.split(' ').filter(c => c.startsWith('theme-')).join(',')," +
    "   allClear: kids.every(k => k.clear), kids: kids }); })()"
  );
  console.log("TAPE:", tape);
  fs.writeFileSync(path.join(outDir, "status-tape.png"), (await window.webContents.capturePage({ x: 0, y: 0, width: 1440, height: 60 })).toPNG());

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"workspace\"]'); if (b) b.click(); return true; })()");

  await wait(2500);
  const term = await window.webContents.executeJavaScript(
    "(() => { const x = document.querySelector('.xterm'); if (!x) return JSON.stringify({ none: true });" +
    " const vp = x.querySelector('.xterm-viewport'); const se = x.querySelector('.xterm-scrollable-element');" +
    " const before = getComputedStyle(se).backgroundColor;" +
    // Force the exact inline paint the terminal writes for a light palette: the
    // stylesheet has to win over it, whatever the terminal decides to write.
    " se.style.backgroundColor = 'rgb(247, 245, 237)';" +
    " const after = getComputedStyle(se).backgroundColor;" +
    " const sl = se.querySelector('.scrollbar.vertical .slider');" +
    " return JSON.stringify({ wrapperBg: before, wrapperBgWithInlineLight: after, viewportGutter: vp.offsetWidth - vp.clientWidth," +
    "   screenW: Math.round(x.querySelector('.xterm-screen').getBoundingClientRect().width)," +
    "   wrapperW: Math.round(se.getBoundingClientRect().width)," +
    "   sliderBg: sl ? getComputedStyle(sl).backgroundColor : null }); })()"
  );
  console.log("TERMINAL:", term);
  fs.writeFileSync(path.join(outDir, "workspace.png"), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript("(() => { const b = document.querySelector('[data-nav-id=\"settings\"]'); if (b) b.click(); return true; })()");
  await wait(1200);
  await window.webContents.executeJavaScript("(() => { const tabs = Array.from(document.querySelectorAll('button, a')).filter(b => (b.textContent || '').trim() === 'Terminal'); if (tabs[0]) tabs[0].click(); return true; })()");
  await wait(2000);
  const settings = await window.webContents.executeJavaScript(
    "(() => { const labels = Array.from(document.querySelectorAll('.settings-view')).map(v => v.textContent.slice(0, 400));" +
    " const themeGone = !document.body.textContent.includes('Solar Light') && !document.body.textContent.includes('High contrast');" +
    " return JSON.stringify({ themeGone: themeGone, panels: labels.length, first: labels[0] || '' }); })()"
  );
  console.log("SETTINGS:", settings);
  fs.writeFileSync(path.join(outDir, "settings-terminal.png"), (await window.webContents.capturePage()).toPNG());

  window.destroy();
  app.quit();
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
