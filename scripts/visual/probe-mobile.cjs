// Renders the mobile companion page at phone size with a stubbed transport and
// hostile fixture text, then reports whether any of that text executed and
// whether each tab's actions still open their sheet.
//   electron scripts/visual/probe-mobile.cjs --out artifacts/visual/mobile-after
const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { getMobileWebCompanionHtml } = require("../../src/service/mobileWebCompanion.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const outDir = path.resolve(repoRoot, flag("out", "artifacts/visual/mobile"));
const wait = ms => new Promise(r => setTimeout(r, ms));

// Every string the desktop can put on this page is attacker-reachable: worker
// names and commands come from workspace.json, attention reasons and memory
// summaries are derived from terminal output.
const hostile = `<img src=x onerror="window.__xss=(window.__xss||0)+1">`;
const FIXTURE = {
  project: { name: "acme " + hostile },
  workers: [
    { id: "web", name: "Web dev server", command: "npm", args: ["run", "dev"], status: "running", isAlive: true },
    { id: "api", name: "Bob's API", command: "node", args: ["api.js"], status: "idle", isAlive: false },
    { id: "evil", name: "evil " + hostile, command: "echo " + hostile, args: [], status: "failed", isAlive: false }
  ],
  attention: [
    { id: "a1", sessionId: "evil", sessionName: "evil " + hostile, state: "new", reason: "exit 1 " + hostile },
    { id: "a2", sessionId: "api", sessionName: "Bob's API", state: "seen", reason: "Tests failed: can't connect" },
    { id: "a3", sessionId: "web", sessionName: "Web dev server", state: "recovered", reason: "recovered earlier" }
  ],
  recipes: [{ id: "r1", name: "Morning stack" }],
  projectMemory: { chapters: [{ id: "c1", title: "Chapter " + hostile, summary: "Output said " + hostile }] }
};

async function run() {
  const file = path.join(os.tmpdir(), `mc-mobile-probe-${process.pid}.html`);
  fs.writeFileSync(file, getMobileWebCompanionHtml());
  const window = new BrowserWindow({ width: 390, height: 844, show: false, backgroundColor: "#000000", webPreferences: { offscreen: true, sandbox: true, contextIsolation: true } });
  const wc = window.webContents;
  let frame = null;
  let lastPaint = 0;
  wc.setFrameRate(30);
  wc.on("paint", (_event, _dirty, image) => { frame = image; lastPaint = Date.now(); });
  await window.loadFile(file);
  await wait(600);
  fs.mkdirSync(outDir, { recursive: true });
  const shot = async name => {
    wc.invalidate();
    await wait(300);
    const started = Date.now();
    while (Date.now() - lastPaint < 200 && Date.now() - started < 2000) await wait(50);
    if (frame) fs.writeFileSync(path.join(outDir, `${name}.png`), frame.toPNG());
  };

  await wc.executeJavaScript(`(() => {
    localStorage.setItem("mission_control_mobile_v1", JSON.stringify({ deviceId: "d1", secret: "AAAA", endpoint: "http://127.0.0.1:9", deviceName: "Pixel", scopes: ["summary.read", "workers.read"] }));
    window.sendEncryptedRequest = async () => JSON.parse(${JSON.stringify(JSON.stringify(FIXTURE))});
    window.connectSSE = () => {};
    render();
    return true;
  })()`);
  await wait(900);

  const report = {};
  for (const tab of ["overview", "workers", "needs", "memory", "feed", "settings"]) {
    await wc.executeJavaScript(`switchTab(${JSON.stringify(tab)}); true`);
    await wait(500);
    await shot(tab);
    report[tab] = await wc.executeJavaScript(`(() => ({
      xss: window.__xss || 0,
      injectedImgs: document.querySelectorAll('#appContainer img').length,
      buttons: Array.from(document.querySelectorAll('#appContainer button')).map(b => b.textContent.trim()).slice(0, 12)
    }))()`);
  }

  // An apostrophe in a name must not break the action it sits on.
  await wc.executeJavaScript(`switchTab("workers"); true`);
  await wait(400);
  report.apostropheAction = await wc.executeJavaScript(`(() => {
    const errors = [];
    window.addEventListener('error', e => errors.push(String(e.message)));
    const row = Array.from(document.querySelectorAll('#appContainer .item-row')).find(r => r.textContent.includes("Bob"));
    const btn = row && row.querySelector('button');
    if (!btn) return { found: false };
    try { btn.click(); } catch (e) { errors.push(String(e.message)); }
    const modal = document.getElementById('actionModal');
    return { found: true, label: btn.textContent.trim(), opened: modal.classList.contains('is-open'), title: document.getElementById('modalTitle').textContent, errors };
  })()`);
  await wait(400);
  await shot("apostrophe-action");

  // Search keeps focus across the re-render that each keystroke causes.
  await wc.executeJavaScript(`closeActionModal(); switchTab("workers"); true`);
  await wait(300);
  await wc.executeJavaScript(`(() => { const i = document.querySelector('#appContainer .search-box input'); i.focus(); return true; })()`);
  for (const ch of "Bob") { wc.sendInputEvent({ type: "char", keyCode: ch }); await wait(120); }
  await wait(300);
  report.search = await wc.executeJavaScript(`(() => { const i = document.querySelector('#appContainer .search-box input'); return { value: i && i.value, focused: document.activeElement === i, rows: document.querySelectorAll('#appContainer .item-row').length }; })()`);
  report.finalXss = await wc.executeJavaScript("window.__xss || 0");
  console.log("MOBILE:", JSON.stringify(report, null, 1));

  fs.rmSync(file, { force: true });
  window.destroy();
  app.quit();
}
app.whenReady().then(run).catch(error => { console.error(error); app.exit(1); });
