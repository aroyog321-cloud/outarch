"use strict";

// The 2026-09-22 companion pass: the phone page was redesigned and moved into
// its own HTML file, and the gateway and the desktop panel were hardened. What
// these lock: the unauthenticated event stream no longer carries the pairing
// code, a code dies after a few wrong guesses and when it is replaced, a phone
// polling every few seconds no longer floods the audit trail or rewrites the
// store, a phone can unpair itself, and the phone keeps its pairing through a
// drifted clock or a project switch on the desktop.

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");
const { MobileCompanionStore } = require("../src/service/mobileCompanionStore.cjs");
const { MOBILE_API_VERSION, MOBILE_PAIRING_ATTEMPTS, MOBILE_READ_AUDIT_WINDOW_MS, MOBILE_REQUEST_PATH, MobileCompanionGateway, encryptEnvelope, envelopeKey, decryptEnvelope, derivePairingKey, pairingProof } = require("../src/service/mobileCompanion.cjs");
const { getMobileWebCompanionHtml } = require("../src/service/mobileWebCompanion.cjs");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-mobile-0922-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = 5_000_000;
  const safeStorage = { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "dpapi", encryptString: value => Buffer.from(`protected:${value}`), decryptString: value => value.toString().replace(/^protected:/, "") };
  const store = new MobileCompanionStore(path.join(directory, "mobile.json"), { safeStorage, now: () => now });
  store.configure({ scopes: ["summary.read", "workers.read", "needs.read", "memory.read", "actions.request"] });
  const engine = { getWorkspace: () => ({ persistent: true, path: "/project/termctl.config.json", name: "Test" }), getSnapshot: () => null, listRecipes: () => [] };
  const missionContext = { snapshot: () => ({ contextVersion: 1, generatedAt: now, project: { name: "Test" }, overall: { status: "healthy" }, workers: [{ id: "api", name: "API" }], attention: [], missions: [], recipes: [], projectMemory: { chapters: [] }, visibility: {}, privacy: {}, sources: {} }) };
  const gateway = new MobileCompanionGateway({ store, missionContext, getEngineApi: () => engine, now: () => now, askAssistant: async () => ({ text: "ok" }), networkInterfaces: () => ({}) });
  gateway.server = { listening: true };
  gateway.address = { port: 37422 };
  return { gateway, store, advance: ms => { now += ms; }, now: () => now };
}

function keysFor(invitation, deviceName = "Nove phone") {
  const keys = crypto.generateKeyPairSync("x25519");
  const clientPublicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  return { keys, clientPublicKey, deviceName, proofFor: code => pairingProof(code, { pairingId: invitation.pairingId, nonce: invitation.nonce, deviceName, clientPublicKey }) };
}

function pair(gateway) {
  const invitation = gateway.createInvitation();
  const phone = keysFor(invitation);
  const paired = gateway.pair({ pairingId: invitation.pairingId, deviceName: phone.deviceName, clientPublicKey: phone.clientPublicKey, proof: phone.proofFor(invitation.code) });
  const serverKey = crypto.createPublicKey({ key: Buffer.from(invitation.serverPublicKey, "base64url"), format: "der", type: "spki" });
  return decryptEnvelope(derivePairingKey(phone.keys.privateKey, serverKey, invitation.nonce), paired.envelope, invitation.pairingId);
}

let nonceCounter = 0;
function request(gateway, credential, payload, timestamp) {
  const nonce = `n-${(nonceCounter += 1)}`;
  const aad = [MOBILE_API_VERSION, MOBILE_REQUEST_PATH, credential.deviceId, timestamp, nonce].join("|");
  const opened = gateway.openRequest({ deviceId: credential.deviceId, timestamp, nonce }, encryptEnvelope(envelopeKey(credential.secret), payload, aad));
  return gateway.dispatch(opened.device, opened.payload);
}

// ---- gateway ----------------------------------------------------------------------

test("the event stream says only that something changed: the pairing code never goes out on it", t => {
  const { gateway } = fixture(t);
  const chunks = [];
  gateway.sseClients.add({ write: chunk => chunks.push(chunk), end() {} });
  const invitation = gateway.createInvitation();
  assert.ok(chunks.length > 0, "a phone is still nudged");
  const sent = chunks.join("");
  assert.equal(sent.includes(invitation.code), false);
  assert.equal(sent.includes(invitation.pairingId), false);
  for (const chunk of chunks) {
    const data = JSON.parse(chunk.split("data: ")[1]);
    assert.deepEqual(Object.keys(data), ["at"]);
  }
  // The desktop's own status, over IPC, still carries the code for the panel.
  assert.equal(gateway.status().activeInvitation.code, invitation.code);
});

test("a pairing code stops working after a few wrong guesses", t => {
  const { gateway, store } = fixture(t);
  const invitation = gateway.createInvitation();
  const phone = keysFor(invitation);
  const wrong = String((Number(invitation.code) + 1) % 1_000_000).padStart(6, "0");
  const attempt = code => gateway.pair({ pairingId: invitation.pairingId, deviceName: phone.deviceName, clientPublicKey: phone.clientPublicKey, proof: phone.proofFor(code) });
  for (let index = 1; index < MOBILE_PAIRING_ATTEMPTS; index += 1) assert.throws(() => attempt(wrong), /pairing proof is invalid/);
  assert.throws(() => attempt(wrong), /Too many wrong pairing codes/);
  assert.throws(() => attempt(invitation.code), /missing or expired/, "even the right code is refused afterwards");
  assert.equal(store.devices().length, 0);
  assert.ok(gateway.listAudit().some(record => record.outcome === "invitation-locked"));
});

test("making a new code retires the one it replaces", t => {
  const { gateway } = fixture(t);
  const first = gateway.createInvitation();
  const second = gateway.createInvitation();
  const phone = keysFor(first);
  assert.throws(() => gateway.pair({ pairingId: first.pairingId, deviceName: phone.deviceName, clientPublicKey: phone.clientPublicKey, proof: phone.proofFor(first.code) }), /missing or expired/);
  assert.equal(gateway.currentInvitation().pairingId, second.pairingId);
  assert.equal(gateway.status().activeInvitationCount, 1);
});

test("a polling phone is audited once per window and its last-seen time is saved at most every 30 seconds", t => {
  const { gateway, store, advance, now } = fixture(t);
  const credential = pair(gateway);
  const auditBefore = gateway.listAudit(100).length;
  let writes = 0;
  const touch = store.touchDevice.bind(store);
  store.touchDevice = id => { writes += 1; return touch(id); };
  for (let poll = 0; poll < 15; poll += 1) {
    request(gateway, credential, { operation: "snapshot" }, now());
    advance(4000);
  }
  const reads = gateway.listAudit(100).slice(0, gateway.listAudit(100).length - auditBefore).filter(record => record.kind === "read");
  assert.equal(reads.length, 1, "one minute of polling is one audit record");
  assert.ok(writes <= 3, `last-seen was written ${writes} times in a minute`);
  advance(MOBILE_READ_AUDIT_WINDOW_MS);
  request(gateway, credential, { operation: "snapshot" }, now());
  assert.equal(gateway.listAudit(100).filter(record => record.kind === "read" && record.capability === "snapshot").length, 2);
});

test("a question to Mission AI is always audited, however often it comes", async t => {
  const { gateway, store, now } = fixture(t);
  store.configure({ scopes: ["summary.read", "workers.read", "assistant.ask"] });
  const credential = pair(gateway);
  await request(gateway, credential, { operation: "ask", text: "status?" }, now());
  await request(gateway, credential, { operation: "ask", text: "again?" }, now());
  assert.equal(gateway.listAudit(100).filter(record => record.capability === "assistant.ask").length, 2);
});

test("a phone can unpair itself, and is then forgotten by the desktop", t => {
  const { gateway, store, now } = fixture(t);
  const credential = pair(gateway);
  assert.equal(store.devices().length, 1);
  assert.deepEqual(request(gateway, credential, { operation: "unpair" }, now()), { revoked: true });
  assert.equal(store.devices().length, 0);
  assert.throws(() => request(gateway, credential, { operation: "snapshot" }, now()), /unknown or revoked/);
  assert.ok(gateway.listAudit().some(record => record.kind === "device" && record.outcome === "revoked"));
});

// ---- the phone page ---------------------------------------------------------------

function fakeElement() {
  return {
    style: {}, dataset: {}, innerHTML: "", innerText: "", textContent: "", value: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    append() {}, appendChild() {}, remove() {}, focus() {}, setSelectionRange() {},
    addEventListener() {}, setAttribute() {}, removeAttribute() {}, getAttribute() { return null; }, querySelector() { return null; }
  };
}

function loadPage() {
  const scripts = [...getMobileWebCompanionHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const elements = new Map();
  const storage = new Map();
  const toasts = [];
  const context = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams, TextEncoder, TextDecoder, Date,
    Uint8Array, Uint32Array, BigInt, atob, btoa,
    navigator: { userAgent: "node-test" },
    localStorage: { getItem: key => (storage.has(key) ? storage.get(key) : null), setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    document: { getElementById: id => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); }, querySelector: () => null, querySelectorAll: () => [], createElement: () => fakeElement(), addEventListener() {} },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    confirm: () => false,
    alert: () => {}
  };
  context.window = { location: { origin: "http://127.0.0.1:1", hash: "", search: "", pathname: "/mobile" }, history: { replaceState() {} }, addEventListener() {}, scrollTo() {}, crypto: { getRandomValues: buffer => crypto.randomFillSync(buffer) } };
  vm.createContext(context);
  vm.runInContext(scripts.at(-1)[1], context);
  context.showToast = (text, type) => { toasts.push([text, type]); };
  return { context, elements, storage, toasts, run: code => vm.runInContext(code, context) };
}
const KEY = "mission_control_mobile_v1";
function signIn(page) {
  page.storage.set(KEY, JSON.stringify({ deviceId: "mobile-1", secret: "A".repeat(43), endpoint: "http://127.0.0.1:1", deviceName: "Nove phone", scopes: ["summary.read", "workers.read"] }));
}
const answer = (status, error) => async () => ({ ok: false, status, json: async () => ({ error }) });

test("the phone keeps its pairing through a drifted clock or a project switch, and forgets it only when removed", async () => {
  const page = loadPage();
  signIn(page);
  page.context.fetch = answer(401, "Mobile request timestamp is outside the allowed window");
  await page.context.refreshDashboard();
  assert.ok(page.storage.has(KEY), "a clock problem is not an unpairing");
  assert.match(page.run("errorInfo(appState.error).title"), /clock is off/);

  page.context.fetch = answer(400, "Mobile device is paired to a different project");
  await page.context.refreshDashboard();
  assert.ok(page.storage.has(KEY));
  assert.match(page.run("errorInfo(appState.error).title"), /different project/);

  page.context.fetch = async () => { throw new TypeError("Failed to fetch"); };
  await page.context.refreshDashboard();
  assert.ok(page.storage.has(KEY));
  assert.match(page.run("errorInfo(appState.error).title"), /Can't reach your computer/);

  page.context.fetch = answer(400, "Mobile device is unknown or revoked");
  await page.context.refreshDashboard();
  assert.equal(page.storage.has(KEY), false, "a phone the desktop removed pairs again");
  assert.match(page.run("appState.pairNotice"), /removed on your computer/);
});

test("unpairing from the phone asks the desktop to forget it, and forgets locally even when the desktop is away", async () => {
  const page = loadPage();
  signIn(page);
  const sent = [];
  page.context.sendEncryptedRequest = async (cred, payload) => { sent.push(payload.operation); return { revoked: true }; };
  await page.context.unpairThisPhone();
  assert.deepEqual(sent, ["unpair"]);
  assert.equal(page.storage.has(KEY), false);
  assert.match(page.toasts.at(-1)[0], /unpaired/);

  signIn(page);
  page.context.sendEncryptedRequest = async () => { throw new Error("offline"); };
  await page.context.unpairThisPhone();
  assert.equal(page.storage.has(KEY), false);
  assert.match(page.toasts.at(-1)[0], /remove this phone there too/);
});

test("pairing failures are said in words a person can act on", () => {
  const { context } = loadPage();
  assert.match(context.pairingErrorText("Mobile pairing proof is invalid"), /doesn't match/);
  assert.match(context.pairingErrorText("Too many wrong pairing codes were tried. Create a new code on the desktop."), /new code/);
  assert.match(context.pairingErrorText("Mobile pairing invitation is missing or expired"), /expired/);
  assert.match(context.pairingErrorText("Mobile device limit is 8"), /Remove one/);
});

test("a poll that lands while one is running is answered by a fresh read, not dropped", async () => {
  const page = loadPage();
  signIn(page);
  let version = 1;
  let calls = 0;
  let release;
  page.context.sendEncryptedRequest = async () => {
    calls += 1;
    const value = version;
    if (calls === 1) await new Promise(resolve => { release = resolve; });
    return { project: { name: "P" }, workers: [], recipes: [], attention: [], companion: { autoRun: value === 2 } };
  };
  const first = page.context.refreshDashboard();
  version = 2;
  const second = page.context.refreshDashboard();
  release();
  await second;
  await first;
  assert.equal(calls, 2);
  assert.equal(page.run("appState.caps.autoRun"), true, "the caller saw data read after its own request");
});

test("Explain with Mission AI asks through the page's own request, and the page stands on its own", () => {
  const html = getMobileWebCompanionHtml();
  // The old button called a function that did not exist.
  assert.doesNotMatch(html, /sendAskQuery/);
  assert.match(html, /function explainWorker\(name\) \{[\s\S]{0,300}submitAsk\(\);/);
  // Nothing is fetched from the internet, and pinch-zoom is not taken away.
  assert.doesNotMatch(html, /fonts\.googleapis|fonts\.gstatic|https:\/\//);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale/);
  // Every rendered list keeps its taps: a repaint patches in place.
  assert.match(html, /function patchHtml\(el, html\)/);
  // A pairing code in a link waits for a tap; typing the sixth digit pairs at once.
  assert.match(html, /if \(typed && digits\.length === 6\) setTimeout\(\(\) => handlePair\(\), 180\);/);
  assert.match(html, /OUTARCH → Integrations → Mobile Companion/);
});

test("the page lives in its own HTML file and is served from it", () => {
  const module = read("src/service/mobileWebCompanion.cjs");
  assert.match(module, /const PAGE_FILE = path\.join\(__dirname, "mobileWebCompanion\.html"\);/);
  assert.equal(getMobileWebCompanionHtml(), read("src/service/mobileWebCompanion.html"));
  assert.doesNotMatch(read("src/service/mobileWebCompanion.html"), /\r/);
});

// ---- the desktop panel ------------------------------------------------------------

test("the desktop panel says why the service is not listening and never loops on codes", () => {
  const panel = read("src/groundstation/renderer/MobileCompanion.jsx");
  assert.doesNotMatch(panel, /<select/, "the network choice is buttons, not a native dropdown");
  assert.match(panel, /"Could not start"/);
  assert.match(panel, /"Not in your plan"/);
  assert.match(panel, /function startProblem\(error, port\)/);
  assert.match(panel, /Try again/);
  // The service is the source of truth for the code; a used one disappears.
  assert.match(panel, /setInvitation\(nextStatus\?\.activeInvitation \|\| null\);/);
  // One automatic code per visit, never one per expiry.
  assert.match(panel, /autoInviteRef\.current = true;/);
  assert.doesNotMatch(panel, /autoInviteAttemptedRef/);
  assert.match(panel, /The phone can't open the link\?/);
  assert.match(panel, /Other project/);
  const view = read("src/groundstation/renderer/IntegrationsView.jsx");
  assert.doesNotMatch(view, /Encrypted Android supervision/);
});
