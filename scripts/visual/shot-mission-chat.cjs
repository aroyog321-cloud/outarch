// The Mission AI chat, its model menu and the Keys & models sheet, at a laptop
// size and a desktop size, with geometry printed for each.
//
//   AI_SCENARIO=empty|error npx electron scripts/visual/shot-mission-chat.cjs --prefix before [--size 1280x720]
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const fixtures = require("./fixtures.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const OUT = path.join(repoRoot, "artifacts", "visual", "2026-09-14-ai");
const argv = process.argv.slice(2);
const prefix = argv.includes("--prefix") ? argv[argv.indexOf("--prefix") + 1] : "chat";
const [width, height] = (argv.includes("--size") ? argv[argv.indexOf("--size") + 1] : "1440x900").split("x").map(Number);
const scenario = process.env.AI_SCENARIO || "thread";

ipcMain.handle("mission-control:request", async (_event, message) => {
  try { return { version: 1, id: message.id, ok: true, result: await fixtures.handle(message.method, message.params) }; }
  catch (error) { return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } }; }
});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const window = new BrowserWindow({ width, height, show: false, frame: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error") errors.push(String(event.message).slice(0, 240)); });
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await wait(2600);
  const js = source => window.webContents.executeJavaScript(source);
  const name = step => `${prefix}-${scenario}-${width}-${step}`;
  const shoot = async step => { window.webContents.invalidate(); await wait(700); if (latest) { fs.writeFileSync(path.join(OUT, `${name(step)}.png`), latest.toPNG()); console.log("wrote", `${name(step)}.png`); } };
  const box = `var box = function(e){ if(!e) return null; var r=e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };`;

  for (let i = 0; i < 15 && !(await js("!!document.querySelector('.ai-screen')")); i++) {
    await js(`(function(){ var b=document.querySelector('.top-ai'); if(b) b.click(); return !!b; })();`);
    await wait(700);
  }
  await wait(1200);
  await shoot("screen");
  console.log("geometry:", JSON.stringify(await js(`(function(){ ${box}
    var q = function(s){ return document.querySelector(s); };
    return { head: box(q('.ai-screen__head')), actions: box(q('.ai-screen__actions')), actionsWrap: q('.ai-screen__actions') ? getComputedStyle(q('.ai-screen__actions')).flexWrap : null,
      body: box(q('.ai-screen__body')), thread: box(q('.ai-thread')), welcome: box(q('.ai-welcome')), composer: box(q('.ai-composer')), field: box(q('.ai-composer__field')), hint: box(q('.ai-composer__hint')),
      firstMsg: box(q('.ai-msg')), error: box(q('.ai-msg__error')), pageOverflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      threadScroll: q('.ai-thread') ? [q('.ai-thread').scrollHeight, q('.ai-thread').clientHeight] : null };
  })();`)));

  await js(`(function(){ var b=document.querySelector('.ai-screen .ai-switcher'); if(!b) return false; b.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,button:0,pointerType:'mouse'})); b.click(); return true; })();`);
  await wait(900);
  await shoot("models");
  await js(`(function(){ document.body.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); return true; })();`);
  await wait(500);

  await js(`(function(){ var b=[].slice.call(document.querySelectorAll('.ai-screen__button')).find(function(x){ return /Keys/.test(x.textContent); }); if(b) b.click(); return !!b; })();`);
  await wait(1000);
  await shoot("keys");
  // Type an NVIDIA key into the form to see detection.
  await js(`(function(){ var i=document.querySelector('.ai-keys__add input[type=password]'); if(!i) return false; var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'nvapi-Ab12Cd34Ef56Gh78Ij90Kl12Mn34Op56Qr78'); i.dispatchEvent(new Event('input',{bubbles:true})); var body=document.querySelector('.ai-keys__body'); if(body) body.scrollTop=body.scrollHeight; return true; })();`);
  await wait(1200);
  await shoot("keys-typed");
  console.log("errors:", JSON.stringify(errors.slice(0, 6)));
  window.destroy();
  app.quit();
});
