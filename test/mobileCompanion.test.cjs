const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { MobileCompanionStore } = require("../src/service/mobileCompanionStore.cjs");
const { MOBILE_API_VERSION, MOBILE_REQUEST_PATH, MobileCompanionGateway, decryptEnvelope, derivePairingKey, encryptEnvelope, envelopeKey, pairingProof } = require("../src/service/mobileCompanion.cjs");

function safeStorage() { return { isEncryptionAvailable: () => true, getSelectedStorageBackend: () => "dpapi", encryptString: value => Buffer.from(`protected:${value}`), decryptString: value => value.toString().replace(/^protected:/, "") }; }

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "mission-control-mobile-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let now = 1_000_000;
  let projectPath = "/project/termctl.config.json";
  const actions = [];
  const store = new MobileCompanionStore(path.join(directory, "mobile.json"), { safeStorage: safeStorage(), now: () => now });
  store.configure({ scopes: ["summary.read", "workers.read", "needs.read", "memory.read", "actions.request"] });
  const engine = { getWorkspace: () => ({ persistent: true, path: projectPath, name: "Test" }), getSnapshot: id => id === "api" || id === "web" ? { id, name: id === "api" ? "API" : "Web", status: "idle" } : null, listRecipes: () => [{ id: "stack", name: "Stack" }], start: async id => { actions.push(["start", id]); return { ok: true }; }, restart: async id => { actions.push(["restart", id]); return { ok: true }; }, kill: id => { actions.push(["kill", id]); return { ok: true }; }, acknowledge: id => { actions.push(["acknowledge", id]); return { ok: true }; }, runRecipe: (id, options) => { actions.push(["runRecipe", id, options]); return { ok: true }; }, cancelRecipe: id => { actions.push(["cancelRecipe", id]); return { ok: true }; } };
  const gateway = new MobileCompanionGateway({ store, missionContext: { snapshot: options => ({ contextVersion: 1, generatedAt: now, project: { name: "Test" }, overall: { status: "healthy" }, workers: [{ id: "api", recentOutput: options.includeOutput ? ["bounded"] : undefined }], attention: [], missions: [], recipes: [], projectMemory: { chapters: [] }, visibility: { terminalOutput: options.includeOutput ? "sanitized-bounded" : "omitted" }, privacy: { policy: "bounded" }, sources: { lifecycle: "EngineAPI" } }) }, getEngineApi: () => engine, now: () => now, networkInterfaces: () => ({ Ethernet: [{ family: "IPv4", internal: false, address: "192.168.1.50" }] }) });
  gateway.server = { listening: true };
  gateway.address = { port: 37422 };
  return { actions, engine, gateway, store, setNow: value => { now = value; }, setProject: value => { projectPath = value; } };
}

function pair(gateway) {
  const invitation = gateway.createInvitation();
  const keys = crypto.generateKeyPairSync("x25519");
  const clientPublicKey = keys.publicKey.export({ format: "der", type: "spki" }).toString("base64url");
  const deviceName = "Nove phone";
  const proof = pairingProof(invitation.code, { pairingId: invitation.pairingId, nonce: invitation.nonce, deviceName, clientPublicKey });
  const paired = gateway.pair({ pairingId: invitation.pairingId, deviceName, clientPublicKey, proof });
  const serverKey = crypto.createPublicKey({ key: Buffer.from(invitation.serverPublicKey, "base64url"), format: "der", type: "spki" });
  const pairingKey = derivePairingKey(keys.privateKey, serverKey, invitation.nonce);
  return decryptEnvelope(pairingKey, paired.envelope, invitation.pairingId);
}

test("Mobile pairing proves the code without transmitting it and seals device credentials", t => {
  const { gateway, store } = fixture(t);
  const invitation = gateway.createInvitation();
  const publicInvitation = gateway.currentInvitation();
  assert.equal(publicInvitation.pairingId, invitation.pairingId);
  assert.equal(Object.hasOwn(publicInvitation, "code"), false);
  const credential = pair(gateway);
  assert.equal(credential.apiVersion, MOBILE_API_VERSION);
  assert.equal(credential.secret.length, 43);
  assert.equal(store.devices()[0].name, "Nove phone");
  assert.equal(gateway.status().endpoints[0], "http://192.168.1.50:37422");
  assert.equal(JSON.stringify(gateway.listAudit()).includes(credential.secret), false);
});

test("Mobile encrypted requests reject replays and expose only scoped Mission Context", t => {
  const { gateway } = fixture(t);
  const credential = pair(gateway);
  const timestamp = 1_000_000;
  const nonce = "request-nonce-1";
  const aad = [MOBILE_API_VERSION, MOBILE_REQUEST_PATH, credential.deviceId, timestamp, nonce].join("|");
  const envelope = encryptEnvelope(envelopeKey(credential.secret), { operation: "snapshot" }, aad);
  const opened = gateway.openRequest({ deviceId: credential.deviceId, timestamp, nonce }, envelope);
  const snapshot = gateway.dispatch(opened.device, opened.payload);
  assert.equal(snapshot.project.name, "Test");
  assert.equal(snapshot.workers[0].recentOutput, undefined);
  const sealed = gateway.sealResponse(opened, snapshot);
  assert.equal(decryptEnvelope(envelopeKey(credential.secret), sealed, `${aad}|response`).project.name, "Test");
  assert.throws(() => gateway.openRequest({ deviceId: credential.deviceId, timestamp, nonce }, envelope), /replay/);
});

test("with automatic running off, mobile action requests execute only after local approval and revocation is immediate", async t => {
  const { actions, gateway, store } = fixture(t);
  store.configure({ autoRun: false });
  const credential = pair(gateway);
  const device = gateway.listDevices().find(item => item.id === credential.deviceId);
  const approval = gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "start", reason: "Start API" });
  assert.equal(approval.state, "pending");
  assert.deepEqual(actions, []);
  const resolved = await gateway.resolveApproval(approval.id, "approve");
  assert.equal(resolved.state, "approved");
  assert.deepEqual(actions, [["start", "api"]]);
  gateway.revokeDevice(device.id);
  assert.throws(() => gateway.store.deviceCredential(device.id), /revoked/);
});

test("paired devices cannot cross a Mission Control project switch", t => {
  const { gateway, setProject } = fixture(t);
  const credential = pair(gateway);
  setProject("/another/termctl.config.json");
  const timestamp = 1_000_000;
  const nonce = "project-switch-nonce";
  const aad = [MOBILE_API_VERSION, MOBILE_REQUEST_PATH, credential.deviceId, timestamp, nonce].join("|");
  const envelope = encryptEnvelope(envelopeKey(credential.secret), { operation: "snapshot" }, aad);
  assert.throws(() => gateway.openRequest({ deviceId: credential.deviceId, timestamp, nonce }, envelope), /different project/);
});

test("asking Mission AI from a phone needs its own permission and never offers terminal output by default", async t => {
  const { gateway, store } = fixture(t);
  const asked = [];
  gateway.askAssistant = request => { asked.push(request); return Promise.resolve({ text: "All good", looked: [], model: { label: "Gemini" } }); };
  const credential = pair(gateway);
  const device = store.devices().find(item => item.id === credential.deviceId);
  assert.throws(() => gateway.dispatch(device, { operation: "ask", text: "status?" }), /assistant\.ask/);

  // Allowed after the fact is not enough: the phone keeps the permissions it was paired with.
  store.configure({ scopes: ["summary.read", "assistant.ask"] });
  assert.throws(() => gateway.dispatch(device, { operation: "ask", text: "status?" }), /assistant\.ask/);

  const repaired = pair(gateway);
  const allowed = store.devices().find(item => item.id === repaired.deviceId);
  const answer = await gateway.dispatch(allowed, { operation: "ask", text: "  status?  ", history: [{ role: "user", text: "hi" }] });
  assert.equal(answer.text, "All good");
  assert.deepEqual(asked, [{ text: "status?", history: [{ role: "user", text: "hi" }], allowTerminal: false }]);
  assert.ok(gateway.listAudit().some(record => record.capability === "assistant.ask" && record.outcome === "asked"));
});

// ---- 2026-09-20: a phone's start and restart run without asking -----------------------

function deviceFor(gateway, store) {
  const credential = pair(gateway);
  return store.devices().find(item => item.id === credential.deviceId);
}

test("a phone's start and restart run at once, are never queued in Needs You, and report how they ended", async t => {
  const { actions, gateway, store } = fixture(t);
  const device = deviceFor(gateway, store);
  assert.equal(gateway.status().autoRun, true, "on unless the operator turns it off");

  const started = await gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "start", reason: "Start API" });
  assert.equal(started.state, "approved");
  assert.equal(started.decidedBy, "auto");
  const restarted = await gateway.dispatch(device, { operation: "request-worker-action", workerId: "web", action: "restart" });
  assert.equal(restarted.state, "approved");
  assert.deepEqual(actions, [["start", "api"], ["restart", "web"]]);

  // Nothing waits, so nothing shows up as a decision on the desktop.
  assert.equal(gateway.listApprovals().filter(item => item.state === "pending").length, 0);
  // The phone is told the outcome, not the engine's raw result or internal keys.
  for (const key of ["result", "projectKey", "deviceId", "reason"]) assert.equal(Object.hasOwn(started, key), false, `${key} stays on the desktop`);
  // The desktop can still see what the phone did, and the audit trail says it was automatic.
  assert.deepEqual(gateway.status().recentActions.map(item => [item.action, item.targetName, item.state]).sort(), [["restart", "Web", "approved"], ["start", "API", "approved"]]);
  assert.ok(gateway.listAudit().some(record => record.outcome === "auto-approved" && record.capability === "start" && record.target === "api"));
});

test("a phone's recipe run is automatic, but stop and cancel still wait for the desktop", async t => {
  const { actions, gateway, store } = fixture(t);
  const device = deviceFor(gateway, store);

  const ran = await gateway.dispatch(device, { operation: "request-recipe-action", recipeId: "stack", action: "run" });
  assert.equal(ran.state, "approved");
  assert.deepEqual(actions, [["runRecipe", "stack", { recover: false }]]);

  const stop = gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "stop" });
  const cancel = gateway.dispatch(device, { operation: "request-recipe-action", recipeId: "stack", action: "cancel" });
  assert.equal(stop.state, "pending", "stopping ends work, so the desktop decides");
  assert.equal(cancel.state, "pending");
  assert.deepEqual(actions, [["runRecipe", "stack", { recover: false }]], "neither ran");
  assert.equal(gateway.listApprovals().filter(item => item.state === "pending").length, 2);
});

test("turning automatic running off puts every phone request back in front of the operator", t => {
  const { actions, gateway, store } = fixture(t);
  const device = deviceFor(gateway, store);
  store.configure({ autoRun: false });
  const approval = gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "restart" });
  assert.equal(approval.state, "pending");
  assert.deepEqual(actions, []);
  assert.throws(() => store.configure({ autoRun: "yes" }), /true or false/);
});

test("automatic running still needs the phone to hold the action permission", t => {
  const { gateway, store } = fixture(t);
  store.configure({ scopes: ["summary.read", "workers.read"] });
  const device = deviceFor(gateway, store);
  assert.throws(() => gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "start" }), /actions\.request/);
});

test("a failed automatic action reaches the phone as an outcome, and a double tap is one action", async t => {
  const { engine, gateway, store } = fixture(t);
  const device = deviceFor(gateway, store);
  engine.start = async () => ({ ok: false, error: "already running" });
  const failed = await gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "start" });
  assert.equal(failed.state, "failed");
  assert.equal(failed.error, "already running");

  let release;
  engine.restart = () => new Promise(resolve => { release = () => resolve({ ok: true }); });
  const first = gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "restart" });
  assert.throws(() => gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "restart" }), /already being changed/);
  release();
  assert.equal((await first).state, "approved");
  // Once it has finished the target is free again.
  engine.restart = async () => ({ ok: true });
  assert.equal((await gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "restart" })).state, "approved");
});

test("two phone actions running at once both stay on record", async t => {
  const { engine, gateway, store } = fixture(t);
  const device = deviceFor(gateway, store);
  const releases = [];
  engine.start = () => new Promise(resolve => { releases.push(() => resolve({ ok: true })); });
  const one = gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "start" });
  const two = gateway.dispatch(device, { operation: "request-worker-action", workerId: "web", action: "start" });
  releases.forEach(release => release());
  await Promise.all([one, two]);
  const done = gateway.listApprovals().filter(item => item.state === "approved").map(item => item.target).sort();
  assert.deepEqual(done, ["api", "web"], "the second write did not erase the first");
});

test("a request that is still waiting is not pushed out by automatic ones", async t => {
  const { gateway, store } = fixture(t);
  const device = deviceFor(gateway, store);
  const waiting = gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "stop" });
  for (let index = 0; index < 110; index += 1) await gateway.dispatch(device, { operation: "request-worker-action", workerId: "web", action: "start" });
  const kept = gateway.listApprovals();
  assert.ok(kept.length <= 100);
  assert.equal(kept.find(item => item.id === waiting.id)?.state, "pending");
});

test("a phone can read one terminal, and without the terminal permission it is told the output is off", t => {
  const { gateway, store } = fixture(t);
  const withoutOutput = deviceFor(gateway, store);
  const summary = gateway.dispatch(withoutOutput, { operation: "worker", workerId: "api" });
  assert.equal(summary.worker.id, "api");
  assert.equal(summary.outputAllowed, false);
  assert.equal(summary.worker.recentOutput, undefined);
  assert.throws(() => gateway.dispatch(withoutOutput, { operation: "worker", workerId: "missing" }), /no longer in this project/);
  assert.throws(() => gateway.dispatch(withoutOutput, { operation: "worker", workerId: "" }), /Choose a terminal/);

  store.configure({ scopes: ["summary.read", "workers.read", "actions.request", "terminal.read"] });
  const withOutput = deviceFor(gateway, store);
  const detail = gateway.dispatch(withOutput, { operation: "worker", workerId: "api" });
  assert.equal(detail.outputAllowed, true);
  assert.deepEqual(detail.worker.recentOutput, ["bounded"]);
  assert.ok(gateway.listAudit().some(record => record.capability === "worker" && record.target === "api"));

  store.configure({ scopes: ["summary.read", "workers.read", "actions.request"] });
  assert.equal(gateway.dispatch(withOutput, { operation: "worker", workerId: "api" }).outputAllowed, false, "switching it off applies to phones already paired");
});

test("the snapshot tells the phone what it can do right now", t => {
  const { gateway, store } = fixture(t);
  const device = deviceFor(gateway, store);
  const first = gateway.dispatch(device, { operation: "snapshot" });
  assert.deepEqual(first.companion, { autoRun: true, autoActions: { worker: ["start", "restart", "acknowledge"], recipe: ["run", "recover"] }, canControl: true, canReadOutput: false });
  store.configure({ autoRun: false, scopes: ["summary.read", "workers.read"] });
  const second = gateway.dispatch(device, { operation: "snapshot" });
  assert.equal(second.companion.autoRun, false);
  assert.equal(second.companion.canControl, false, "the operator switched the permission off for every phone");
});

test("an automatic action the desktop was running when it stopped does not stay running for ever", async t => {
  const { engine, gateway, store, setNow } = fixture(t);
  const device = deviceFor(gateway, store);
  engine.start = () => new Promise(() => {});
  void gateway.dispatch(device, { operation: "request-worker-action", workerId: "api", action: "start" });
  assert.equal(gateway.status().recentActions[0].state, "executing");
  setNow(1_000_000 + 6 * 60 * 1000);
  const after = gateway.status().recentActions[0];
  assert.equal(after.state, "failed");
  assert.match(after.error, /desktop stopped before this finished/);
  assert.ok(gateway.listAudit().some(record => record.outcome === "interrupted"));
});
