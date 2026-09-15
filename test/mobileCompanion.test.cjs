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
  const engine = { getWorkspace: () => ({ persistent: true, path: projectPath, name: "Test" }), getSnapshot: id => id === "api" ? { id, name: "API", status: "idle" } : null, listRecipes: () => [{ id: "stack", name: "Stack" }], start: async id => { actions.push(["start", id]); return { ok: true }; }, restart: async id => { actions.push(["restart", id]); return { ok: true }; }, kill: id => { actions.push(["kill", id]); return { ok: true }; }, acknowledge: id => { actions.push(["acknowledge", id]); return { ok: true }; }, runRecipe: (id, options) => { actions.push(["runRecipe", id, options]); return { ok: true }; }, cancelRecipe: id => { actions.push(["cancelRecipe", id]); return { ok: true }; } };
  const gateway = new MobileCompanionGateway({ store, missionContext: { snapshot: options => ({ contextVersion: 1, generatedAt: now, project: { name: "Test" }, overall: { status: "healthy" }, workers: [{ id: "api", recentOutput: options.includeOutput ? ["bounded"] : undefined }], attention: [], missions: [], recipes: [], projectMemory: { chapters: [] }, visibility: { terminalOutput: options.includeOutput ? "sanitized-bounded" : "omitted" }, privacy: { policy: "bounded" }, sources: { lifecycle: "EngineAPI" } }) }, getEngineApi: () => engine, now: () => now, networkInterfaces: () => ({ Ethernet: [{ family: "IPv4", internal: false, address: "192.168.1.50" }] }) });
  gateway.server = { listening: true };
  gateway.address = { port: 37422 };
  return { actions, gateway, store, setNow: value => { now = value; }, setProject: value => { projectPath = value; } };
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

test("Mobile action requests execute only after local approval and revocation is immediate", async t => {
  const { actions, gateway } = fixture(t);
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
