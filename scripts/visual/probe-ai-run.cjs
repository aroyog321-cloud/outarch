// Renders the assistant chat — the Mission AI screen or the Workspace pane —
// with a scripted conversation, and measures it.
//   npx electron scripts/visual/probe-ai-run.cjs --surface mission|workspace --width 1280 --height 860
//        [--conversation runs|user|empty] [--auto-approve] [--idle] [--draft "text"]
//        [--force-state "selector"] [--scroll-top|--scroll-bottom] [--js snippet.js] [--shot out.png]
// "runs" shows the private terminal's command steps; "user" reproduces the
// 2026-09-16 screenshot (a recipe prompt, a reply thinking); "empty" is the welcome.
const { app, BrowserWindow, ipcMain } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const fixtures = require("./fixtures.cjs");
const { AiAssistant } = require("../../src/service/aiAssistant.cjs");
const { BuiltinMissionAiCredentials } = require("../../src/service/missionAiBuiltinKeys.cjs");

const repoRoot = path.resolve(__dirname, "..", "..");
const argv = process.argv.slice(2);
const flag = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
const width = Number(flag("width", 1280));
const height = Number(flag("height", 860));
const surface = flag("surface", "mission");
const which = flag("conversation", "runs");
const shot = flag("shot", "");
const jsFile = flag("js", "");
const forceSelector = flag("force-state", "");
const draft = flag("draft", "");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

const assistant = new AiAssistant({
  builtin: new BuiltinMissionAiCredentials({ keys: { primary: "AIzaPROBEkey0000000000000000000000000", fallback: "" } }),
  getEngineApi: () => null,
  fetch: async () => { throw new Error("offline"); }
});
const nemotron = { source: "mission", keyId: null, keyLabel: "Mission AI", provider: "nvidia", model: "nvidia/nemotron-3-super-120b", label: "Nemotron 3 Super 120B", family: "nvidia", tier: "balanced" };
function status() {
  const value = assistant.status();
  if (which === "user") value.selections = { missionAi: nemotron, workspace: nemotron };
  return value;
}

const gemini = { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", family: "gemini", source: "mission", keyLabel: "Mission AI" };
const nemo = { id: nemotron.model, label: nemotron.label, family: "nvidia", source: "mission", keyLabel: "Mission AI" };
const testOutput = [
  "> acme-api@1.4.0 test", "> node --test", "", "▶ config", "  ✔ reads PORT from the environment (1.1ms)", "  ✔ falls back to 3000 (0.4ms)", "▶ server",
  "  ✖ starts and answers /health (14.8ms)", "    Error: listen EADDRINUSE: address already in use :::8080", "        at Server.setupListenHandle [as _listen2] (node:net:1908:16)",
  "        at listenInCluster (node:net:1965:12)", "        at Server.listen (node:net:2067:7)", "        at startServer (src/server.js:42:10)", "ℹ tests 3", "ℹ pass 2", "ℹ fail 1"
].join("\n");

const conversations = {
  runs: {
    busy: true,
    messages: [
      { id: "m1", role: "user", text: "Review this codebase and tell me what I should change." },
      {
        id: "m2", role: "assistant", model: gemini, error: null,
        text: "**Two changes matter most.**\n\n1. `src/server.js` hard-codes port `8080`, which is why the server test fails when your dev server is up. Read it from `PORT`.\n2. `src/config.js` swallows parse errors. Let them surface.",
        activity: [
          { id: "a1", tool: "list_files", label: "Looked through the project's files", state: "done" },
          { id: "a2", tool: "read_file", label: "Read src/server.js", state: "done" },
          { id: "a3", tool: "search_files", label: "Searched the code for \"8080\"", state: "done" },
          { id: "a4", tool: "run_command", label: "Ran npm test", state: "failed", detail: "Exited with code 1", command: "npm test", output: testOutput, exitCode: 1 },
          { id: "a5", tool: "run_command", label: "Ran git status --short", state: "done", detail: null, command: "git status --short", output: " M src/server.js\n?? notes.md", exitCode: 0 }
        ]
      },
      { id: "m3", role: "user", text: "Run the linter too" },
      {
        id: "m4", role: "assistant", model: gemini, error: null, text: "",
        activity: [{ id: "b1", tool: "run_command", label: "Running npx eslint src --max-warnings=0", state: "running", detail: null, command: "npx eslint src --max-warnings=0", output: "D:\\Projects\\acme-api\\src\\server.js\n  12:7   warning  'unusedHandler' is assigned a value but never used  no-unused-vars\n  48:15  warning  Unexpected console statement                         no-console", exitCode: null }]
      }
    ]
  },
  user: {
    busy: true,
    messages: [
      { id: "u1", role: "user", text: "hi" },
      { id: "u2", role: "assistant", model: nemo, error: null, text: "Hi! How can I help you with the project?", activity: [] },
      { id: "u3", role: "user", text: "Design a practical OUTARCH recipe (a repeatable workspace launch) for this project. Propose the backend, frontend, tests, Git, database, container, and agent terminals that are useful; define safe startup dependencies and readiness checks. Present the complete recipe design in Markdown and ask for my approval ('Does this recipe design look good?'). Do NOT build, start, or run any recipe or workers yet until I explicitly approve the design." },
      { id: "u4", role: "assistant", model: nemo, error: null, text: "", activity: [{ id: "c1", tool: "get_project_overview", label: "Looked at the project", state: "done" }] }
    ]
  },
  empty: { busy: false, messages: [] }
};
const chosen = conversations[which] || conversations.runs;
const conversation = {
  conversationId: "probe",
  surface: surface === "workspace" ? "workspace" : "missionAi",
  busy: argv.includes("--idle") ? false : chosen.busy,
  autoApprove: argv.includes("--auto-approve"),
  pending: null,
  messages: chosen.messages.map((message, index) => ({ at: Date.now() - (chosen.messages.length - index) * 10000, activity: [], ...message }))
};

ipcMain.handle("mission-control:request", async (_event, message) => {
  try {
    let result;
    if (message.method === "ai.status") result = status();
    else if (message.method === "ai.chat.history") result = { ...conversation, conversationId: message.params?.conversationId || "probe" };
    else result = await fixtures.handle(message.method, message.params);
    return { version: 1, id: message.id, ok: true, result };
  } catch (error) {
    return { version: 1, id: message.id, ok: false, error: { code: "HARNESS", message: String((error && error.message) || error) } };
  }
});
ipcMain.handle("mission-control:set-window-chrome", async () => true);

const measure = `(function(){
  var scrollers = [];
  document.querySelectorAll('*').forEach(function(el){
    var cs = getComputedStyle(el);
    var scrollable = /(auto|scroll)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    var gutter = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    if (el.getBoundingClientRect().width > 0 && (scrollable || cs.overflowY === 'scroll' || (gutter > 0 && /(auto|scroll)/.test(cs.overflowY)))) {
      var r = el.getBoundingClientRect();
      scrollers.push({ el: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : ''), overflowY: cs.overflowY, gutter: cs.scrollbarGutter, scroll: [el.scrollHeight, el.clientHeight], scrollbarWidth: Math.round(gutter), rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] });
    }
  });
  var area = document.querySelector('textarea');
  var field = document.querySelector('.ai-composer__field');
  var pick = function(el, props){ if (!el) return null; var cs = getComputedStyle(el); var r = el.getBoundingClientRect(); var out = { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] }; props.forEach(function(p){ out[p] = cs[p]; }); return out; };
  var props = ['backgroundColor', 'borderTopWidth', 'borderTopColor', 'borderRadius', 'boxShadow', 'outlineStyle', 'outlineWidth', 'outlineColor', 'paddingTop', 'paddingLeft', 'fontSize', 'minHeight'];
  return {
    scrollers: scrollers,
    textarea: pick(area, props),
    field: pick(field, props),
    composer: pick(document.querySelector('.ai-composer'), ['paddingLeft', 'paddingRight', 'paddingBottom']),
    bar: pick(document.querySelector('.ai-composer__bar'), []),
    toggle: pick(document.querySelector('.ai-screen__toggle'), ['color', 'backgroundColor', 'borderTopColor']),
    hint: pick(document.querySelector('.ai-composer__hint'), ['fontSize', 'color']),
    thread: pick(document.querySelector('.ai-thread'), ['paddingLeft', 'paddingRight']),
    screen: pick(document.querySelector('.ai-screen'), ['height', 'maxWidth'])
  };
})()`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width, height, show: false, frame: false, webPreferences: { preload: path.join(__dirname, "preload.cjs"), offscreen: true, sandbox: false, contextIsolation: true } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error" || event.level === "warning") errors.push(`[${event.level}] ${String(event.message).slice(0, 300)}`); });
  let latest = null;
  window.webContents.on("paint", (_e, _d, image) => { latest = image; });
  window.webContents.setFrameRate(30);
  await window.loadFile(path.join(repoRoot, "dist", "groundstation", "renderer", "index.html"));
  await window.webContents.executeJavaScript("localStorage.clear(); true");
  window.reload();
  await new Promise(resolve => window.webContents.once("did-finish-load", resolve));
  await wait(2500);
  const js = source => Promise.race([window.webContents.executeJavaScript(source), wait(10000).then(() => "TIMEOUT")]);
  if (surface === "workspace") {
    console.log("NAV:", await js("(function(){ var b=document.querySelector('.top-navigation button[aria-label=\"Workspace\"]'); if(b) b.click(); return !!b; })()"));
    await wait(2000);
    console.log("PANE:", await js("(function(){ var b=document.querySelector('button[aria-label=\"Assistant\"]'); if(b) b.click(); return !!b; })()"));
  } else {
    console.log("NAV:", await js("(function(){ var b=document.querySelector('button[aria-label=\"Open Mission AI\"]'); if(b) b.click(); return !!b; })()"));
  }
  await wait(2500);
  if (draft) {
    // React owns the field's value, so the text is set the way typing sets it.
    await js(`(function(){ var t=document.querySelector('.ai-composer textarea'); var set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; set.call(t, ${JSON.stringify(draft)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    await wait(500);
  }
  if (forceSelector) {
    const dbg = window.webContents.debugger;
    dbg.attach("1.3");
    await dbg.sendCommand("DOM.enable");
    await dbg.sendCommand("CSS.enable");
    const { root } = await dbg.sendCommand("DOM.getDocument", { depth: -1 });
    for (const selector of forceSelector.split("|")) {
      const { nodeId } = await dbg.sendCommand("DOM.querySelector", { nodeId: root.nodeId, selector });
      if (nodeId) await dbg.sendCommand("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["focus", "focus-visible", "focus-within"] });
      console.log("FORCED:", selector, Boolean(nodeId));
    }
    await wait(700);
  }
  if (argv.includes("--scroll-bottom")) await js("(function(){ var t=document.querySelector('.ai-thread'); if (t) t.scrollTop = t.scrollHeight; return true; })()");
  if (argv.includes("--scroll-top")) await js("(function(){ var t=document.querySelector('.ai-thread'); if (t) t.scrollTop = 0; return true; })()");
  await wait(600);
  console.log("RESULT:", JSON.stringify(await js(jsFile ? fs.readFileSync(jsFile, "utf8") : measure), null, 1));
  if (shot) {
    window.webContents.invalidate();
    await wait(900);
    if (latest) fs.writeFileSync(shot, latest.toPNG());
    console.log("wrote", shot);
  }
  console.log("CONSOLE:", JSON.stringify(errors.slice(0, 10), null, 1));
  window.destroy();
  app.quit();
});
