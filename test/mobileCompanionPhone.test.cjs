"use strict";

// The phone page (2026-09-20): tapping a terminal opens a summary of it, start
// and restart go straight through without asking the desktop, and recipes are
// on the phone. These run the page's own script with a minimal DOM. The last
// group connects the page's own encryption to the real gateway, so what the
// page sends and what the gateway answers are checked against each other.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { getMobileWebCompanionHtml } = require("../src/service/mobileWebCompanion.cjs");
const { MobileCompanionStore } = require("../src/service/mobileCompanionStore.cjs");
const { MobileCompanionGateway, decryptEnvelope, derivePairingKey, pairingProof } = require("../src/service/mobileCompanion.cjs");

const HOSTILE = `<img src=x onerror="alert(1)">`;
const AUTO = { worker: ["start", "restart", "acknowledge"], recipe: ["run", "recover"] };

function fakeElement() {
  return {
    style: {}, dataset: {}, innerHTML: "", innerText: "", textContent: "", value: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    append() {}, appendChild() {}, remove() {}, focus() {}, setSelectionRange() {},
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; }
  };
}

function loadPage() {
  const scripts = [...getMobileWebCompanionHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const elements = new Map();
  const storage = new Map();
  const paints = { count: 0 };
  const toasts = [];
  const context = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams, TextEncoder, TextDecoder, Date,
    Uint8Array, Uint32Array, BigInt, atob, btoa,
    navigator: { userAgent: "node-test" },
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    document: {
      getElementById: id => {
        if (!elements.has(id)) {
          const element = fakeElement();
          if (id === "appContainer") {
            let html = "";
            Object.defineProperty(element, "innerHTML", { get: () => html, set: value => { html = value; paints.count += 1; } });
          }
          elements.set(id, element);
        }
        return elements.get(id);
      },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => fakeElement(),
      addEventListener() {}
    },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    confirm: () => false,
    alert: () => {}
  };
  context.window = {
    location: { origin: "http://127.0.0.1:1", hash: "", search: "", pathname: "/mobile" },
    history: { replaceState() {} },
    addEventListener() {},
    scrollTo() {},
    crypto: { getRandomValues: buffer => crypto.randomFillSync(buffer) }
  };
  vm.createContext(context);
  vm.runInContext(scripts.at(-1)[1], context);
  // Everything the page says out loud goes through showToast, so it can be read back.
  context.showToast = (text, type) => { toasts.push([text, type]); };
  const run = code => vm.runInContext(code, context);
  return { context, elements, paints, toasts, run, storage };
}

function signIn(page, scopes = ["summary.read", "workers.read", "needs.read", "actions.request"]) {
  page.storage.set("mission_control_mobile_v1", JSON.stringify({ deviceId: "mobile-1", secret: "A".repeat(43), endpoint: "http://127.0.0.1:1", deviceName: "Nove phone", scopes }));
}
function setData(page, data, caps = null) {
  page.context.__data = data;
  page.context.__caps = caps;
  page.run("appState.data = __data; appState.caps = __caps;");
}
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
// Values made inside the page's VM have their own prototypes; compare them as data.
const plain = value => JSON.parse(JSON.stringify(value));
// The page polls after every action, so a stub has to answer that poll as the desktop would.
function stubDesktop(page, data, caps, answer) {
  const sent = [];
  page.context.sendEncryptedRequest = async (cred, payload) => {
    if (payload.operation === "snapshot") return { project: { name: "P" }, projectMemory: { chapters: [] }, attention: [], recipes: [], ...data, companion: caps };
    sent.push(plain(payload));
    return answer ? answer(payload) : { state: "approved" };
  };
  return sent;
}

const worker = {
  id: "tests", name: "Unit tests", role: "tests", state: "needs-you", lifecycle: "running", isAlive: true, command: "npm run test:watch", cwd: "apps/web",
  runtimeMs: 12 * 60000, lastOutputAt: Date.now() - 20000, currentActivity: "Waiting for operator input",
  attention: { required: true, reason: "1 test failed" }, resources: { available: true, cpuPercent: 3.4, memoryMB: 412 },
  health: { tone: "attention", label: "Needs review", summary: "A test is failing." }, dependencyImpact: { recipeCount: 2, downstreamCount: 3 },
  evidence: { tests: { passed: 84, failed: 1 }, git: { branch: "main", clean: false, changedPaths: 3 }, service: { port: 5173, health: "confirmed" } }
};

test("a terminal's summary is built from what the desktop reported, and its output is text", () => {
  const { context } = loadPage();
  const esc = String.fromCharCode(27);
  const html = context.renderWorkerDetail({}, worker, { state: "ok", at: Date.now() - 5000, lines: [`${esc}[32mPASS${esc}[0m src/a.test.ts`, HOSTILE, "", "  "] });
  assert.match(html, /Needs you/);
  assert.match(html, /Waiting for you: 1 test failed/);
  assert.match(html, /<small>Tests<\/small>84 passed · 1 failed/);
  assert.match(html, /<small>Git<\/small>main · 3 changes/);
  assert.match(html, /port 5173 · confirmed/);
  assert.match(html, /412 MB/);
  assert.match(html, /3 other terminals depend|Others depend on it/);
  assert.match(html, /Needs review\.<\/strong> A test is failing\./);
  // Escape sequences are dropped, blank lines are not shown, and markup stays text.
  assert.match(html, /<pre class="term-out">PASS src\/a\.test\.ts\n&lt;img/);
  assert.doesNotMatch(html, /<img/i);
  assert.equal(html.includes(esc), false);
  // Acknowledge is offered because the desktop is waiting on a decision.
  assert.match(html, /data-action="acknowledge"/);
  assert.match(html, /data-action="restart"/);
  // The caption already says when it last printed, so the facts do not repeat it.
  assert.doesNotMatch(html, /<small>Last output<\/small>/);
});

test("a phone that may not read terminal output is told so instead of shown an error", () => {
  const { context } = loadPage();
  assert.match(context.renderWorkerDetail({}, worker, { state: "off", lines: [] }), /Terminal output is off for this phone/);
  assert.match(context.renderWorkerDetail({}, worker, { state: "loading", lines: [] }), /Reading the terminal/);
  assert.match(context.renderWorkerDetail({}, worker, { state: "error", message: "boom" }), /boom/);
  assert.match(context.renderWorkerDetail({}, worker, { state: "ok", lines: [] }), /has not printed anything yet/);
  assert.match(context.renderWorkerDetail({}, worker, { state: "off", lines: [] }), /<small>Last output<\/small>/, "without a caption time the fact stays");
});

test("a worker's state is read from what the desktop sends, and a failed one is not shown as idle", () => {
  const { context } = loadPage();
  const view = w => JSON.parse(JSON.stringify(context.workerView(w)));
  assert.deepEqual(view({ state: "running", isAlive: true }), { key: "running", label: "Running", tone: "running", alive: true });
  assert.equal(view({ state: "failed", isAlive: false }).tone, "critical");
  assert.equal(view({ state: "needs-you", isAlive: true }).alive, true);
  assert.equal(view({ state: "completed" }).label, "Finished");
  assert.equal(view({ status: "failed" }).key, "failed", "an older payload still reads");
  assert.equal(view({ status: "idle" }).key, "stopped");
  assert.equal(view({ state: "something-new", isAlive: true }).key, "running", "an unknown state falls back to what is known");
});

test("every terminal, recipe and summary renders desktop text as text", () => {
  const page = loadPage();
  const data = {
    project: { name: HOSTILE },
    workers: [{ id: "w1", name: `Bob's ${HOSTILE}`, role: HOSTILE, command: HOSTILE, args: [HOSTILE], state: "failed", isAlive: false, exitCode: 1, evidence: { service: { port: HOSTILE }, git: { branch: HOSTILE } }, health: { label: HOSTILE, summary: HOSTILE } }],
    recipes: [{ id: "r1", name: `Stack ${HOSTILE}`, steps: [{ workerId: "w1", dependsOn: [] }, { workerId: HOSTILE, dependsOn: ["w1"] }], run: { phase: "failed", failures: [{ workerId: "w1", reason: HOSTILE }], stepStates: { w1: { phase: "failed" } } } }],
    attention: [], projectMemory: { chapters: [] }
  };
  const { context } = page;
  const rendered = [
    context.renderWorkerDetail(data, data.workers[0], { state: "ok", lines: [HOSTILE] }),
    context.terminalCard(data.workers[0]),
    context.renderRecipesView(data),
    context.renderRecipeCard(data.recipes[0], { w1: HOSTILE })
  ];
  setData(page, data);
  page.run("appState.tab = 'workers'; appState.workersView = 'terminals'");
  rendered.push(context.renderWorkersTab(data), context.renderOverviewTab(data));
  page.run("appState.workersView = 'recipes'");
  rendered.push(context.renderWorkersTab(data));
  for (const html of rendered) {
    assert.doesNotMatch(html, /<img/i);
    assert.match(html, /&lt;img/);
    for (const [, handler] of html.matchAll(/on(?:click|keydown)="([^"]*)"/g)) assert.doesNotMatch(handler, /Bob|img/, `a handler carries no desktop text: ${handler}`);
  }
  assert.match(context.terminalCard(data.workers[0]), /data-name="Bob&#39;s /);
});

test("recipes show their steps and offer the action that fits where the run is", () => {
  const { context } = loadPage();
  const names = { db: "Postgres", api: "API" };
  const steps = [{ workerId: "db", dependsOn: [] }, { workerId: "api", dependsOn: ["db"] }];
  const ready = context.renderRecipeCard({ id: "stack", name: "Full stack", steps, run: null }, names);
  assert.match(ready, /Full stack/);
  assert.match(ready, /2 terminals/);
  assert.match(ready, /<b>Postgres<\/b>/);
  assert.match(ready, /after Postgres/);
  assert.match(ready, /data-action="run"[^>]*>Run recipe/);

  const failed = context.renderRecipeCard({ id: "stack", name: "Full stack", steps, run: { phase: "failed", finishedAt: Date.now() - 60000, failures: [{ workerId: "api", reason: "readiness timed out" }], stepStates: { db: { phase: "ready" }, api: { phase: "failed" } } } }, names);
  assert.match(failed, /Failed/);
  assert.match(failed, /API: readiness timed out/);
  assert.match(failed, /data-action="recover"/);
  assert.match(failed, /data-action="run"[^>]*>Run again/);
  assert.match(failed, /class="is-ok"|class="is-bad"/);

  const running = context.renderRecipeCard({ id: "stack", name: "Full stack", steps, run: { phase: "running", stepStates: { db: { phase: "ready" }, api: { phase: "starting" } } } }, names);
  assert.match(running, /Cancel run/);
  assert.doesNotMatch(running, /Run recipe/);

  assert.match(context.renderRecipesView({ recipes: [], workers: [] }), /No recipes in this project yet/);
});

test("the Workers tab holds terminals and recipes, and the Cockpit tile opens the recipes", () => {
  const page = loadPage();
  const data = { workers: [{ id: "a", name: "A", state: "running", isAlive: true }], recipes: [{ id: "r", name: "R", steps: [{ workerId: "a", dependsOn: [] }], run: null }], attention: [], projectMemory: { chapters: [] } };
  setData(page, data);
  const terminals = page.context.renderWorkersTab(data);
  assert.match(terminals, /Terminals<b>1<\/b>/);
  assert.match(terminals, /Recipes<b>1<\/b>/);
  assert.match(terminals, /TAP FOR SUMMARY/);
  assert.match(terminals, /onclick="openWorkerDetail\(this\.dataset\.id\)"/);
  assert.match(page.context.renderOverviewTab(data), /onclick="openRecipes\(\)"/);
  page.run("openRecipes()");
  assert.equal(page.run("appState.tab"), "workers");
  assert.equal(page.run("appState.workersView"), "recipes");
  assert.match(page.context.renderWorkersTab(data), /class="card recipe-card"/);
});

test("a phone that may not control anything shows disabled buttons and says why", () => {
  const page = loadPage();
  const data = { workers: [{ id: "a", name: "A", state: "stopped", isAlive: false }], recipes: [{ id: "r", name: "R", steps: [{ workerId: "a", dependsOn: [] }], run: null }], attention: [], projectMemory: { chapters: [] } };
  setData(page, data, { autoRun: true, autoActions: AUTO, canControl: false, canReadOutput: false });
  const workers = page.context.renderWorkersTab(data);
  assert.match(workers, /data-action="start"[^>]*disabled/);
  assert.match(workers, /can watch but not control/);
  page.run("appState.workersView = 'recipes'");
  assert.match(page.context.renderWorkersTab(data), /data-action="run"[^>]*disabled/);
  // With no answer from the desktop yet, nothing is disabled on a guess.
  setData(page, data, null);
  page.run("appState.workersView = 'terminals'");
  assert.doesNotMatch(page.context.renderWorkersTab(data), /data-action="start"[^>]*disabled/);
});

test("start goes straight through; restart and stop ask once on the phone; the words match what the desktop will do", async () => {
  const page = loadPage();
  signIn(page);
  const data = { workers: [{ id: "api", name: "API", state: "running", isAlive: true, dependencyImpact: { downstreamCount: 1 } }], recipes: [], attention: [] };
  const caps = { autoRun: true, autoActions: AUTO, canControl: true };
  const sent = stubDesktop(page, data, caps);
  setData(page, data, caps);

  page.context.promptWorkerAction("api", "start", "API");
  await tick();
  assert.deepEqual(sent.map(item => [item.operation, item.workerId, item.action]), [["request-worker-action", "api", "start"]], "one tap");

  page.context.promptWorkerAction("api", "restart", "API");
  assert.equal(sent.length, 1, "restart asks on the phone first");
  const restartSheet = page.elements.get("modalBody").innerHTML;
  assert.match(restartSheet, /restarts right away\. Your desktop is not asked\. 1 other terminal depends on it\./);
  assert.match(restartSheet, /Restart now/);
  assert.equal(page.elements.get("modalTitle").innerText, "Restart API?");

  page.context.promptWorkerAction("api", "stop", "API");
  const stopSheet = page.elements.get("modalBody").innerHTML;
  assert.match(stopSheet, /Your desktop will ask you to approve this/);
  assert.match(stopSheet, /Ask desktop/);
  assert.match(stopSheet, /id="actionReason"/, "the desktop sees why");

  setData(page, { workers: [{ id: "api", name: "API", state: "running", isAlive: true }], recipes: [], attention: [] }, { autoRun: false, autoActions: AUTO, canControl: true });
  page.context.promptWorkerAction("api", "restart", "API");
  assert.match(page.elements.get("modalBody").innerHTML, /Your desktop will ask you to approve this/, "with automatic running off, restart waits too");
});

test("the phone says how a request ended, and a double tap sends one request", async () => {
  const page = loadPage();
  signIn(page);
  const data = { workers: [{ id: "api", name: "API", state: "stopped", isAlive: false }], recipes: [], attention: [] };
  const caps = { autoRun: true, autoActions: AUTO, canControl: true };
  setData(page, data, caps);
  const answers = [{ state: "approved" }, { state: "pending" }, { state: "failed", error: "already running" }];
  stubDesktop(page, data, caps, () => answers.shift());
  await page.context.submitWorkerAction("api", "start", "API");
  await page.context.submitWorkerAction("api", "restart", "API");
  await page.context.submitWorkerAction("api", "start", "API");
  assert.deepEqual(page.toasts, [
    ["API started", "success"],
    ["Sent to your desktop. Approve “restart API” there.", "warning"],
    ["Could not start API: already running", "critical"]
  ]);

  page.toasts.length = 0;
  stubDesktop(page, data, caps, () => { throw new Error("Mobile permission required: actions.request"); });
  await page.context.submitWorkerAction("api", "start", "API");
  assert.match(page.toasts[0][0], /not allowed to do that/);
  assert.equal(page.run("Object.keys(appState.busy).length"), 0, "the buttons come back after a failure");

  let calls = 0;
  let release;
  stubDesktop(page, data, caps, () => { calls += 1; return new Promise(resolve => { release = () => resolve({ state: "approved" }); }); });
  const first = page.context.submitWorkerAction("api", "start", "API");
  const second = page.context.submitWorkerAction("api", "start", "API");
  assert.equal(calls, 1);
  assert.match(page.context.workerButtons({ id: "api", name: "API" }, { alive: false }), /Starting…/);
  release();
  await Promise.all([first, second]);
});

test("the poll asks for no terminal output, keeps what the desktop says the phone may do, and repaints only what changed", async () => {
  const page = loadPage();
  signIn(page);
  const payloads = [];
  const data = { project: { name: "P" }, workers: [{ id: "a", name: "A", state: "running", isAlive: true, runtimeMs: 60000 }], recipes: [], attention: [], projectMemory: { chapters: [] }, companion: { autoRun: true, autoActions: AUTO, canControl: true, canReadOutput: false } };
  page.context.sendEncryptedRequest = async (cred, payload) => { payloads.push(payload); return JSON.parse(JSON.stringify(data)); };
  await page.context.refreshDashboard();
  assert.deepEqual(plain(payloads), [{ operation: "snapshot" }], "a phone without the terminal permission is not refused");
  assert.equal(page.run("appState.caps.autoRun"), true);
  assert.equal(page.run("appState.caps.canControl"), true);
  const painted = page.paints.count;
  await page.context.refreshDashboard();
  await page.context.refreshDashboard();
  assert.equal(page.paints.count, painted, "an unchanged poll writes nothing, so a tap is never dropped mid-rebuild");
  data.workers[0].runtimeMs = 5 * 60000;
  await page.context.refreshDashboard();
  assert.equal(page.paints.count, painted + 1);
});

test("a terminal's sheet opens from the list, reads its output on its own, and closes cleanly", async () => {
  const page = loadPage();
  signIn(page);
  const requests = [];
  page.context.sendEncryptedRequest = async (cred, payload) => {
    requests.push(payload);
    return { generatedAt: 1, outputAllowed: true, worker: { ...worker, recentOutput: ["listening on 5173"], lastOutputAt: Date.now() - 3000 } };
  };
  setData(page, { workers: [worker], recipes: [], attention: [] }, { autoRun: true, autoActions: AUTO, canControl: true });
  page.context.openWorkerDetail("tests");
  assert.match(page.elements.get("modalBody").innerHTML, /Reading the terminal/, "the summary shows at once");
  assert.equal(page.elements.get("modalTitle").innerText, "Unit tests");
  await tick(); await tick();
  assert.deepEqual(plain(requests), [{ operation: "worker", workerId: "tests" }]);
  assert.match(page.elements.get("modalBody").innerHTML, /listening on 5173/);
  // A terminal that leaves the project closes its sheet instead of leaving a stale one.
  setData(page, { workers: [], recipes: [], attention: [] }, null);
  page.context.refreshOpenDetail();
  assert.equal(page.run("appState.detail"), null);
  // A confirmation opened from the sheet goes back to it, not to the list.
  setData(page, { workers: [worker], recipes: [], attention: [] }, { autoRun: true, autoActions: AUTO, canControl: true });
  page.context.openWorkerDetail("tests");
  await tick(); await tick();
  page.context.promptWorkerAction("tests", "restart", "Unit tests");
  assert.equal(page.run("appState.confirming"), true);
  page.context.backToDetail();
  assert.match(page.elements.get("modalBody").innerHTML, /class="detail"/);
});

// ---- the page against the real gateway ----------------------------------------------

function gatewayFixture(t, { scopes } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-phone-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const actions = [];
  const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "dpapi", encryptString: value => Buffer.from(`protected:${value}`), decryptString: value => value.toString().replace(/^protected:/, "") };
  const store = new MobileCompanionStore(path.join(directory, "mobile.json"), { safeStorage });
  store.configure({ scopes: scopes || ["summary.read", "workers.read", "needs.read", "memory.read", "actions.request"] });
  const engine = {
    getWorkspace: () => ({ persistent: true, path: "/project/termctl.config.json", name: "Test" }),
    getSnapshot: id => id === "api" ? { id, name: "API" } : null,
    listRecipes: () => [{ id: "stack", name: "Stack", steps: [{ workerId: "api", dependsOn: [] }] }],
    start: async id => { actions.push(["start", id]); return { ok: true }; },
    restart: async id => { actions.push(["restart", id]); return { ok: true }; },
    kill: id => { actions.push(["kill", id]); return { ok: true }; },
    acknowledge: id => { actions.push(["acknowledge", id]); return { ok: true }; },
    runRecipe: (id, options) => { actions.push(["runRecipe", id, options]); return { ok: true }; },
    cancelRecipe: id => { actions.push(["cancelRecipe", id]); return { ok: true }; }
  };
  const missionContext = { snapshot: options => ({ contextVersion: 1, generatedAt: Date.now(), project: { name: "Test" }, overall: { status: "healthy" }, workers: [{ id: "api", name: "API", role: "backend", state: "running", isAlive: true, command: "node api.js", recentOutput: options.includeOutput ? ["listening on 4000"] : undefined }], attention: [], missions: [], recipes: [{ id: "stack", name: "Stack", steps: [{ workerId: "api", dependsOn: [] }], run: null }], projectMemory: { chapters: [] }, visibility: {}, privacy: {}, sources: {} }) };
  const gateway = new MobileCompanionGateway({ store, missionContext, getEngineApi: () => engine, networkInterfaces: () => ({}) });
  gateway.server = { listening: true };
  gateway.address = { port: 37422 };
  return { actions, gateway, store };
}

function pairPhone(gateway) {
  const invitation = gateway.createInvitation();
  const keys = crypto.generateKeyPairSync("x25519");
  const clientPublicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const deviceName = "Nove phone";
  const proof = pairingProof(invitation.code, { pairingId: invitation.pairingId, nonce: invitation.nonce, deviceName, clientPublicKey });
  const paired = gateway.pair({ pairingId: invitation.pairingId, deviceName, clientPublicKey, proof });
  const serverKey = crypto.createPublicKey({ key: Buffer.from(invitation.serverPublicKey, "base64url"), format: "der", type: "spki" });
  return decryptEnvelope(derivePairingKey(keys.privateKey, serverKey, invitation.nonce), paired.envelope, invitation.pairingId);
}

// The page's own request layer, with the network replaced by a call straight into the gateway.
function connectPage(gateway, credential) {
  const page = loadPage();
  page.storage.set("mission_control_mobile_v1", JSON.stringify({ deviceId: credential.deviceId, secret: credential.secret, endpoint: "http://127.0.0.1:1", deviceName: "Nove phone", scopes: credential.scopes }));
  page.context.fetch = async (url, init) => {
    try {
      const opened = gateway.openRequest({ deviceId: init.headers["X-Mission-Control-Device"], timestamp: Number(init.headers["X-Mission-Control-Time"]), nonce: init.headers["X-Mission-Control-Nonce"] }, JSON.parse(init.body));
      const result = await gateway.dispatch(opened.device, opened.payload);
      return { ok: true, status: 200, json: async () => gateway.sealResponse(opened, { ok: true, result }) };
    } catch (error) {
      return { ok: false, status: 400, json: async () => ({ error: error.message }) };
    }
  };
  return page;
}

test("page and gateway together: start runs at once, stop waits for the desktop, and the phone is told which", async t => {
  const { actions, gateway } = gatewayFixture(t);
  const page = connectPage(gateway, pairPhone(gateway));
  await page.context.refreshDashboard();
  assert.equal(page.run("appState.data.project.name"), "Test");
  assert.deepEqual(JSON.parse(JSON.stringify(page.run("appState.caps"))), { autoRun: true, autoActions: AUTO, canControl: true, canReadOutput: false });

  await page.context.submitWorkerAction("api", "start", "API");
  await page.context.submitWorkerAction("api", "restart", "API");
  assert.deepEqual(actions, [["start", "api"], ["restart", "api"]]);
  assert.deepEqual(page.toasts.map(item => item[0]), ["API started", "API restarted"]);
  assert.equal(gateway.listApprovals().filter(item => item.state === "pending").length, 0, "nothing was queued for the desktop");

  page.toasts.length = 0;
  await page.context.submitWorkerAction("api", "stop", "API");
  assert.deepEqual(actions, [["start", "api"], ["restart", "api"]], "stop did not run");
  assert.equal(gateway.listApprovals().filter(item => item.state === "pending").length, 1);
  assert.match(page.toasts[0][0], /Sent to your desktop/);
});

test("page and gateway together: a recipe runs from the phone, and a desktop that asks first is reported as such", async t => {
  const { actions, gateway, store } = gatewayFixture(t);
  const page = connectPage(gateway, pairPhone(gateway));
  await page.context.refreshDashboard();
  assert.match(page.context.renderWorkersTab(page.run("appState.data")), /Recipes<b>1<\/b>/);
  await page.context.submitRecipeAction("stack", "run", "Stack");
  assert.deepEqual(actions, [["runRecipe", "stack", { recover: false }]]);
  assert.equal(page.toasts.at(-1)[0], "Stack is starting");

  store.configure({ autoRun: false });
  await page.context.refreshDashboard();
  assert.equal(page.run("appState.caps.autoRun"), false);
  await page.context.submitRecipeAction("stack", "run", "Stack");
  assert.equal(actions.length, 1, "with automatic running off it waits");
  assert.match(page.toasts.at(-1)[0], /Sent to your desktop/);
  page.context.promptRecipeAction("stack", "run", "Stack");
  assert.match(page.elements.get("modalBody").innerHTML, /Your desktop will ask you to approve this first/);
});

test("page and gateway together: the summary shows the output only to a phone allowed to read it", async t => {
  const without = gatewayFixture(t);
  const denied = connectPage(without.gateway, pairPhone(without.gateway));
  await denied.context.refreshDashboard();
  denied.context.openWorkerDetail("api");
  for (let index = 0; index < 6; index += 1) await tick();
  assert.equal(denied.run("appState.detail.output.state"), "off");
  assert.match(denied.elements.get("modalBody").innerHTML, /Terminal output is off for this phone/);
  assert.doesNotMatch(denied.elements.get("modalBody").innerHTML, /listening on 4000/);

  const withOutput = gatewayFixture(t, { scopes: ["summary.read", "workers.read", "terminal.read", "actions.request"] });
  const allowed = connectPage(withOutput.gateway, pairPhone(withOutput.gateway));
  await allowed.context.refreshDashboard();
  allowed.context.openWorkerDetail("api");
  for (let index = 0; index < 6; index += 1) await tick();
  assert.equal(allowed.run("appState.detail.output.state"), "ok");
  assert.match(allowed.elements.get("modalBody").innerHTML, /listening on 4000/);
});

test("page and gateway together: a phone paired without the action permission is told, not left guessing", async t => {
  const { actions, gateway } = gatewayFixture(t, { scopes: ["summary.read", "workers.read"] });
  const page = connectPage(gateway, pairPhone(gateway));
  await page.context.refreshDashboard();
  assert.equal(page.run("appState.caps.canControl"), false);
  assert.match(page.context.renderWorkersTab(page.run("appState.data")), /data-action="start"[^>]*disabled|data-action="restart"[^>]*disabled/);
  await page.context.submitWorkerAction("api", "start", "API");
  assert.deepEqual(actions, []);
  assert.match(page.toasts.at(-1)[0], /not allowed to do that/);
});

// ---- the desktop panel -----------------------------------------------------------------

test("the desktop panel says what a phone can do, lets the operator turn automatic running off, and lists what phones did", () => {
  const panel = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/renderer/MobileCompanion.jsx"), "utf8");
  // The old copy said every request waits for approval; it no longer does.
  assert.doesNotMatch(panel, /every request waits here for your approval|never executes remotely/);
  assert.match(panel, /not a remote shell or mobile IDE/i);
  assert.match(panel, /"actions\.request", "Control workers & recipes"/);
  assert.match(panel, /mobile\.configure", \{ configuration: \{ autoRun: value \} \}/);
  assert.match(panel, /const autoRun = status\?\.autoRun !== false;/);
  assert.match(panel, /aria-label="Recent phone actions"/);
  assert.match(panel, /Stop and cancel always wait here/);
  // Approving still goes through the decision queue, never from this panel.
  assert.doesNotMatch(panel, /mobile\.approval\.resolve|<DecisionItem/);
});

// ---- review follow-ups ------------------------------------------------------------------

test("a terminal card is a tap target with one real button for the summary, so the buttons on it stay reachable", () => {
  const { context } = loadPage();
  const card = context.terminalCard({ id: "api", name: "API", state: "running", isAlive: true });
  assert.doesNotMatch(card, /role="button"|tabindex/, "a button role would hide the Start and Restart buttons inside it from assistive technology");
  assert.match(card, /<button type="button" class="term-open" data-id="api" aria-label="Summary of API"/);
  assert.match(card, /data-action="restart"/);
  assert.equal(typeof context.cardKey, "undefined");
});

test("a dropped poll keeps the output already on the summary sheet", async () => {
  const page = loadPage();
  signIn(page);
  setData(page, { workers: [worker], recipes: [], attention: [] }, { autoRun: true, autoActions: AUTO, canControl: true });
  let fail = false;
  page.context.sendEncryptedRequest = async () => { if (fail) throw new Error("network down"); return { outputAllowed: true, worker: { ...worker, recentOutput: ["still here"] } }; };
  page.context.openWorkerDetail("tests");
  await tick(); await tick();
  assert.match(page.elements.get("modalBody").innerHTML, /still here/);
  fail = true;
  page.context.refreshOpenDetail();
  await tick(); await tick();
  assert.match(page.elements.get("modalBody").innerHTML, /still here/, "a blip does not wipe what is on screen");
  assert.equal(page.run("appState.detail.output.state"), "ok");
});
