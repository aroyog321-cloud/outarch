// The phone companion's Ask tab at phone width, with a scripted thread.
//   npx electron scripts/visual/shot-mobile-ask.cjs
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getMobileWebCompanionHtml } = require("../../src/service/mobileWebCompanion.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const OUT = path.join(repoRoot, "artifacts", "visual", "2026-09-12-pass");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const page = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mc-mobile-")), "mobile.html");
  fs.writeFileSync(page, getMobileWebCompanionHtml());
  const window = new BrowserWindow({ width: 390, height: 844, show: false, webPreferences: { offscreen: true } });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  await window.loadFile(page);
  await window.webContents.executeJavaScript(`localStorage.setItem("mission_control_mobile_v1", JSON.stringify({ deviceId: "mobile-1", secret: "${"A".repeat(43)}", scopes: ["summary.read", "workers.read", "assistant.ask"], endpoint: "http://127.0.0.1:9", deviceName: "Pixel" })); true;`);
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await wait(1200);
  const shoot = async name => { window.webContents.invalidate(); await wait(600); fs.writeFileSync(path.join(OUT, name), latest.toPNG()); console.log("wrote", name); };

  await window.webContents.executeJavaScript(`(function(){ if (appState.pollTimer) clearInterval(appState.pollTimer); document.getElementById("bottomNav").style.display = ""; switchTab("ask"); return true; })();`);
  await wait(500);
  await shoot("phone-ask-empty.png");

  const tick = "`";
  const answer = `The **API gateway** is down: port ${tick}8080${tick} is already taken.\n\n- ${tick}Web dev server${tick} is running on ${tick}localhost:5173${tick}\n- Nothing else needs you\n\nFree the port, then ask for a restart from Workers:\n\n${tick.repeat(3)}sh\nnpx kill-port 8080\n${tick.repeat(3)}`;
  await window.webContents.executeJavaScript(`(function(){
    appState.ask.messages = [
      { role: "user", text: "What's failing right now?" },
      { role: "assistant", text: ${JSON.stringify(answer)}, looked: ["Checked the workers", "Read API gateway output"], model: "Gemini 3 Flash" },
      { role: "user", text: "Is the dev server up?" }
    ];
    appState.ask.busy = true;
    renderActiveTab();
    return true;
  })();`);
  await wait(500);
  await shoot("phone-ask-thread.png");
  window.destroy();
  app.quit();
});
