"use strict";

const crypto = require("node:crypto");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const { ASSETS: BRAND_ASSETS } = require("../brand/index.cjs");
const { redactText } = require("./contextSanitizer.cjs");
const { getMobileManifestJson, getMobileServiceWorkerJs, getMobileWebCompanionHtml } = require("./mobileWebCompanion.cjs");

const MOBILE_API_VERSION = 1;
const MOBILE_PAIR_PATH = "/mobile/v1/pair";
const MOBILE_REQUEST_PATH = "/mobile/v1/request";
const MOBILE_INVITE_PATH = "/mobile/v1/invite";
const MOBILE_PING_PATH = "/mobile/v1/ping";
const MOBILE_EVENTS_PATH = "/mobile/v1/events";
const MOBILE_PAIRING_TTL_MS = 5 * 60 * 1000;
const MOBILE_APPROVAL_TTL_MS = 15 * 60 * 1000;
const MOBILE_CLOCK_SKEW_MS = 2 * 60 * 1000;
const MOBILE_NONCE_TTL_MS = 5 * 60 * 1000;
const MAX_MOBILE_REQUEST_BYTES = 256 * 1024;
const MAX_MOBILE_APPROVALS = 100;
const MOBILE_EXECUTION_TTL_MS = 5 * 60 * 1000;
// A pairing code is six digits. Guessing it online is only stopped by making
// each code good for a handful of wrong tries; after that it is thrown away
// and the operator makes a new one.
const MOBILE_PAIRING_ATTEMPTS = 5;
// A paired phone polls every few seconds. Recording each poll pushed pairings
// and revocations out of the capped audit trail within minutes, and rewrote the
// store twice per poll. A routine read is recorded once per window instead.
const MOBILE_READ_AUDIT_WINDOW_MS = 10 * 60 * 1000;
const MOBILE_SEEN_WRITE_MS = 30 * 1000;
// What a paired phone may do without asking, while the operator leaves
// "run phone requests without asking" on. These start or acknowledge work.
// Stop and cancel end it, so they keep waiting for the desktop.
const MOBILE_AUTO_ACTIONS = Object.freeze({ worker: Object.freeze(["start", "restart", "acknowledge"]), recipe: Object.freeze(["run", "recover"]) });
// The OUTARCH icon for the home screen, the tab and the page header.
const MOBILE_BRAND_ICONS = Object.freeze({
  "/mobile/icon-192.png": BRAND_ASSETS.pwaIcon192,
  "/mobile/icon-512.png": BRAND_ASSETS.pwaIcon512,
  "/mobile/apple-touch-icon.png": BRAND_ASSETS.touchIcon180
});
const brandIconCache = new Map();
function readBrandIcon(pathname) {
  if (!brandIconCache.has(pathname)) {
    let body = null;
    try { body = fs.readFileSync(MOBILE_BRAND_ICONS[pathname]); } catch { body = null; }
    brandIconCache.set(pathname, body);
  }
  return brandIconCache.get(pathname);
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function b64(value) { return Buffer.from(value).toString("base64url"); }
function fromB64(value) { return Buffer.from(String(value || ""), "base64url"); }
function safeName(value) { return String(value || "Mobile device").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "Mobile device"; }
function safeReason(value) { return redactText(value, { maxLength: 500 }).value.trim() || "No reason provided"; }
function timingSafe(left, right) { const a = Buffer.from(String(left || "")); const b = Buffer.from(String(right || "")); return a.length === b.length && crypto.timingSafeEqual(a, b); }

function pairingMessage(value) { return [value.pairingId, value.nonce, safeName(value.deviceName), value.clientPublicKey].join("|"); }
function pairingProof(code, value) { return crypto.createHmac("sha256", String(code)).update(pairingMessage(value)).digest("base64url"); }

function derivePairingKey(privateKey, publicKey, nonce) {
  const shared = crypto.diffieHellman({ privateKey, publicKey });
  return Buffer.from(crypto.hkdfSync("sha256", shared, fromB64(nonce), "mission-control-mobile-pairing-v1", 32));
}

function envelopeKey(secret) {
  const raw = fromB64(secret);
  if (raw.length !== 32) throw new Error("Mobile credential is invalid");
  return raw;
}

function encryptEnvelope(key, value, aad = "") {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(key), iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return { version: MOBILE_API_VERSION, iv: b64(iv), ciphertext: b64(ciphertext), tag: b64(cipher.getAuthTag()) };
}

function decryptEnvelope(key, envelope, aad = "") {
  if (!envelope || envelope.version !== MOBILE_API_VERSION) throw new Error("Mobile encrypted envelope version is invalid");
  const iv = fromB64(envelope.iv);
  const tag = fromB64(envelope.tag);
  const ciphertext = fromB64(envelope.ciphertext);
  if (iv.length !== 12 || tag.length !== 16 || ciphertext.length > MAX_MOBILE_REQUEST_BYTES) throw new Error("Mobile encrypted envelope is invalid");
  const decipher = crypto.createDecipheriv("aes-256-gcm", Buffer.from(key), iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"));
}

function importClientKey(value) {
  const bytes = fromB64(value);
  if (!bytes.length || bytes.length > 256) throw new Error("Mobile pairing public key is invalid");
  try { return crypto.createPublicKey({ key: bytes, format: "der", type: "spki" }); }
  catch { throw new Error("Mobile pairing public key is invalid"); }
}

class MobileCompanionGateway extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.store) throw new TypeError("MobileCompanionGateway requires a store");
    if (!options.missionContext || typeof options.missionContext.snapshot !== "function") throw new TypeError("MobileCompanionGateway requires Mission Context");
    if (typeof options.getEngineApi !== "function") throw new TypeError("MobileCompanionGateway requires getEngineApi");
    this.store = options.store;
    this.missionContext = options.missionContext;
    this.getEngineApi = options.getEngineApi;
    // Optional: how a phone's question reaches Mission AI. Without it the
    // operation is refused rather than pretending there is no model.
    this.askAssistant = typeof options.askAssistant === "function" ? options.askAssistant : null;
    this.http = options.http || http;
    this.networkInterfaces = options.networkInterfaces || os.networkInterfaces;
    this.now = options.now || Date.now;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
    this.server = null;
    this.address = null;
    this.invitations = new Map();
    this.seenNonces = new Map();
    this.sseClients = new Set();
    // Targets a phone is changing right now, so a double tap is one action.
    this.busyTargets = new Set();
    // When each phone's routine read was last written to the audit trail, and
    // when its "last seen" time was last saved.
    this.readAudits = new Map();
    this.seenWrites = new Map();
    this.lastError = null;
    this.disposed = false;
    // Whether the operator's plan includes the companion. When it does not,
    // the gateway does not listen, whatever its saved setting says.
    this.isAllowed = typeof options.isAllowed === "function" ? options.isAllowed : () => true;
  }

  #planAllows() {
    try { return this.isAllowed() === true; } catch { return false; }
  }

  status() {
    this.#expire();
    const stored = this.store.status();
    const port = this.address?.port || stored.port;
    const latestInvite = [...this.invitations.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
    const activeInvitation = latestInvite && latestInvite.expiresAt > this.now() ? {
      pairingId: latestInvite.pairingId,
      code: latestInvite.code,
      nonce: latestInvite.nonce,
      serverPublicKey: b64(latestInvite.publicKey.export({ format: "der", type: "spki" })),
      endpoints: this.#endpoints(port).map(endpoint => `${endpoint}${MOBILE_PAIR_PATH}`),
      expiresAt: latestInvite.expiresAt
    } : null;
    return { ...stored, running: Boolean(this.server?.listening), host: "0.0.0.0", port, endpoints: this.#endpoints(port), activeInvitation, activeInvitationCount: this.invitations.size, activeClientCount: this.sseClients.size, lastError: this.lastError, transport: "application-layer-aes-256-gcm", authority: "approval-gated-no-shell", planAllowed: this.#planAllows(), autoActions: MOBILE_AUTO_ACTIONS, recentActions: this.#recentActions() };
  }

  subscribe(callback) { if (typeof callback !== "function") throw new TypeError("Mobile companion subscribe requires a callback"); this.on("status", callback); return () => this.off("status", callback); }

  async configure(value = {}) {
    if (value.enabled === true && !this.getEngineApi()?.getWorkspace?.()?.persistent) throw new Error("Open a persistent project before enabling Mobile Companion");
    const previous = this.store.status();
    const next = this.store.configure(value);
    const restart = this.server?.listening && next.enabled && previous.port !== next.port;
    if (!next.enabled) await this.stop();
    else if (!this.server?.listening || restart) { if (restart) await this.stop(); await this.start(); }
    this.#audit({ kind: "configuration", outcome: next.enabled ? "enabled" : "disabled", capability: next.scopes.join(",") });
    this.#emitStatus();
    return this.status();
  }

  async start() {
    if (this.disposed) throw new Error("Mobile Companion is disposed");
    if (this.server?.listening) return this.status();
    const stored = this.store.status();
    if (!stored.enabled) return this.status();
    if (!this.#planAllows()) return this.status();
    if (!stored.available) throw new Error("OS credential encryption is unavailable; Mobile Companion remains disabled");
    await new Promise((resolve, reject) => {
      const server = this.http.createServer((request, response) => void this.#handleHttp(request, response));
      server.requestTimeout = 15_000; server.headersTimeout = 10_000; server.keepAliveTimeout = 5_000; server.maxHeadersCount = 48;
      server.once("error", error => { if (this.server === server) this.server = null; reject(new Error(`Mobile Companion could not bind to port ${stored.port}: ${error.message}`)); });
      server.listen(stored.port, "0.0.0.0", () => { this.server = server; this.address = server.address(); this.lastError = null; resolve(); });
    });
    this.#emitStatus();
    return this.status();
  }

  async stop() {
    const server = this.server; this.server = null; this.address = null; this.invitations.clear(); this.seenNonces.clear();
    for (const client of this.sseClients) { try { client.end(); } catch {} }
    this.sseClients.clear();
    if (server) await new Promise(resolve => server.close(resolve));
    this.#emitStatus();
    return this.status();
  }

  createInvitation() {
    if (!this.server?.listening) throw new Error("Enable Mobile Companion before pairing a device");
    if (!this.store.protectionStatus().available) throw new Error("OS credential encryption is unavailable");
    const { publicKey, privateKey } = crypto.generateKeyPairSync("x25519");
    const pairingId = `pair-${this.randomUUID()}`;
    const code = String(this.randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
    const nonce = b64(this.randomBytes(24));
    const record = { pairingId, code, nonce, privateKey, publicKey, createdAt: this.now(), expiresAt: this.now() + MOBILE_PAIRING_TTL_MS };
    // One code at a time: the one on the desktop's screen. An older code the
    // operator replaced stops working instead of lingering for five minutes.
    this.invitations.clear();
    this.invitations.set(pairingId, record);
    this.#audit({ kind: "pairing", outcome: "invitation-created" });
    this.#emitStatus();
    return { pairingId, code, nonce, serverPublicKey: b64(publicKey.export({ format: "der", type: "spki" })), endpoints: this.status().endpoints.map(endpoint => `${endpoint}${MOBILE_PAIR_PATH}`), expiresAt: record.expiresAt, proof: "HMAC-SHA256(code, pairingId|nonce|deviceName|clientPublicKey)", exchange: "X25519 + HKDF-SHA256 + AES-256-GCM" };
  }

  currentInvitation() {
    this.#expire();
    const record = [...this.invitations.values()].sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!record) throw new Error("Mobile pairing invitation is missing or expired");
    return { pairingId: record.pairingId, nonce: record.nonce, serverPublicKey: b64(record.publicKey.export({ format: "der", type: "spki" })), expiresAt: record.expiresAt, proof: "HMAC-SHA256(code, pairingId|nonce|deviceName|clientPublicKey)", exchange: "X25519 + HKDF-SHA256 + AES-256-GCM" };
  }

  pair(value = {}) {
    this.#expire();
    const invitation = this.invitations.get(String(value.pairingId || ""));
    if (!invitation) throw new Error("Mobile pairing invitation is missing or expired");
    const deviceName = safeName(value.deviceName);
    const clientPublicKey = String(value.clientPublicKey || "");
    const expected = pairingProof(invitation.code, { pairingId: invitation.pairingId, nonce: invitation.nonce, deviceName, clientPublicKey });
    if (!timingSafe(value.proof, expected)) {
      invitation.failures = (invitation.failures || 0) + 1;
      if (invitation.failures >= MOBILE_PAIRING_ATTEMPTS) {
        this.invitations.delete(invitation.pairingId);
        this.#audit({ kind: "pairing", outcome: "invitation-locked" });
        this.#emitStatus();
        throw new Error("Too many wrong pairing codes were tried. Create a new code on the desktop.");
      }
      throw new Error("Mobile pairing proof is invalid");
    }
    const clientKey = importClientKey(clientPublicKey);
    const pairingKey = derivePairingKey(invitation.privateKey, clientKey, invitation.nonce);
    const deviceId = `mobile-${this.randomUUID()}`;
    const secret = b64(this.randomBytes(32));
    const project = this.#projectIdentity();
    const device = this.store.addDevice({ id: deviceId, name: deviceName, publicKey: clientPublicKey, scopes: this.store.status().scopes, projectKey: project.key, projectName: project.name }, secret);
    this.invitations.delete(invitation.pairingId);
    this.#audit({ kind: "pairing", outcome: "paired", deviceId });
    this.#emitStatus();
    return { pairingId: invitation.pairingId, serverPublicKey: b64(invitation.publicKey.export({ format: "der", type: "spki" })), envelope: encryptEnvelope(pairingKey, { deviceId, secret, scopes: device.scopes, apiVersion: MOBILE_API_VERSION, requestPath: MOBILE_REQUEST_PATH }, invitation.pairingId) };
  }

  listDevices() { return this.store.devices(); }
  listApprovals() { this.#expire(); return this.store.approvals().sort((a, b) => b.createdAt - a.createdAt); }
  listAudit(limit) { return this.store.listAudit(limit); }

  revokeDevice(id) {
    if (!this.store.revokeDevice(id)) throw new Error("Mobile device was not found or is already revoked");
    const approvals = this.store.approvals().map(item => item.deviceId === id && item.state === "pending" ? { ...item, state: "revoked", resolvedAt: this.now() } : item);
    this.store.setApprovals(approvals);
    this.seenNonces.delete(String(id));
    this.seenWrites.delete(String(id));
    this.#audit({ kind: "device", outcome: "revoked", deviceId: id });
    this.#emitStatus();
    return { revoked: true, deviceId: String(id) };
  }

  openRequest(headers, envelope) {
    const deviceId = String(headers.deviceId || "");
    const timestamp = Number(headers.timestamp);
    const requestNonce = String(headers.nonce || "");
    if (!deviceId || !Number.isInteger(timestamp) || !requestNonce || requestNonce.length > 160) throw new Error("Mobile authentication headers are invalid");
    if (Math.abs(this.now() - timestamp) > MOBILE_CLOCK_SKEW_MS) throw new Error("Mobile request timestamp is outside the allowed window");
    this.#pruneNonces(deviceId);
    const nonces = this.seenNonces.get(deviceId) || new Map();
    if (nonces.has(requestNonce)) throw new Error("Mobile request replay was rejected");
    const credential = this.store.deviceCredential(deviceId);
    if (credential.device.projectKey !== this.#projectIdentity().key) throw new Error("Mobile device is paired to a different project");
    const aad = [MOBILE_API_VERSION, MOBILE_REQUEST_PATH, deviceId, timestamp, requestNonce].join("|");
    const payload = decryptEnvelope(envelopeKey(credential.secret), envelope, aad);
    nonces.set(requestNonce, this.now()); this.seenNonces.set(deviceId, nonces);
    if (this.now() - (this.seenWrites.get(deviceId) || 0) >= MOBILE_SEEN_WRITE_MS) { this.seenWrites.set(deviceId, this.now()); this.store.touchDevice(deviceId); }
    return { device: credential.device, secret: credential.secret, payload, aad };
  }

  sealResponse(opened, value) { return encryptEnvelope(envelopeKey(opened.secret), value, `${opened.aad}|response`); }

  dispatch(device, payload = {}) {
    const operation = String(payload.operation || "");
    const scopes = device.scopes || [];
    const requireScope = scope => { if (!this.store.status().scopes.includes(scope) || !scopes.includes(scope)) throw new Error(`Mobile permission required: ${scope}`); };
    if (operation === "ping") return { ok: true, apiVersion: MOBILE_API_VERSION, at: this.now() };
    if (["snapshot", "needs", "memory"].includes(operation)) {
      if (operation === "snapshot") requireScope("summary.read");
      if (operation === "needs") requireScope("needs.read");
      if (operation === "memory") requireScope("memory.read");
      const includeOutput = payload.includeTerminalEvidence === true;
      if (includeOutput) requireScope("terminal.read");
      const context = this.missionContext.snapshot({ afterSequence: Number.isInteger(payload.afterSequence) ? Math.max(0, payload.afterSequence) : 0, includeOutput, workerIds: Array.isArray(payload.workerIds) ? payload.workerIds.slice(0, 10) : [] });
      let result;
      if (operation === "needs") result = { generatedAt: context.generatedAt, attention: context.attention };
      else if (operation === "memory") result = context.projectMemory;
      else {
        result = { contextVersion: context.contextVersion, generatedAt: context.generatedAt, project: context.project, overall: context.overall, visibility: context.visibility, privacy: context.privacy, sources: context.sources };
        if (scopes.includes("workers.read") && this.store.status().scopes.includes("workers.read")) { result.workers = context.workers; result.missions = context.missions; result.recipes = context.recipes; }
        if (scopes.includes("needs.read") && this.store.status().scopes.includes("needs.read")) result.attention = context.attention;
        if (scopes.includes("memory.read") && this.store.status().scopes.includes("memory.read")) result.projectMemory = context.projectMemory;
        // What this phone can do right now, so its buttons say the truth: a
        // device keeps the permissions it was paired with, and the operator
        // can also switch a permission off for every phone at once.
        const allowed = this.store.status();
        result.companion = {
          autoRun: allowed.autoRun === true,
          autoActions: MOBILE_AUTO_ACTIONS,
          canControl: scopes.includes("actions.request") && allowed.scopes.includes("actions.request"),
          canReadOutput: scopes.includes("terminal.read") && allowed.scopes.includes("terminal.read")
        };
      }
      this.#auditRead({ kind: "read", outcome: "completed", deviceId: device.id, capability: operation });
      return result;
    }
    if (operation === "worker") {
      // One terminal's detail. Unlike a snapshot that asks for output, a phone
      // without the terminal permission is not refused: it gets the summary and
      // is told the output is off.
      requireScope("workers.read");
      const workerId = String(payload.workerId || "").slice(0, 64);
      if (!workerId) throw new Error("Choose a terminal first");
      const outputAllowed = scopes.includes("terminal.read") && this.store.status().scopes.includes("terminal.read");
      const context = this.missionContext.snapshot({ includeOutput: outputAllowed, workerIds: [workerId] });
      const worker = (context.workers || []).find(item => item.id === workerId);
      if (!worker) throw new Error("That terminal is no longer in this project");
      if (outputAllowed) this.#auditRead({ kind: "read", outcome: "completed", deviceId: device.id, capability: "worker", target: workerId });
      return { generatedAt: context.generatedAt, worker, outputAllowed };
    }
    if (operation === "unpair") {
      // A phone may always remove itself; it proved who it is to get here.
      this.revokeDevice(device.id);
      return { revoked: true };
    }
    if (operation === "ask") {
      requireScope("assistant.ask");
      if (!this.askAssistant) throw new Error("Mission AI is not available on the desktop");
      const question = typeof payload.text === "string" ? payload.text.trim().slice(0, 2000) : "";
      if (!question) throw new Error("Write a question first");
      const allowTerminal = scopes.includes("terminal.read") && this.store.status().scopes.includes("terminal.read");
      const history = Array.isArray(payload.history) ? payload.history.slice(-8) : [];
      this.#audit({ kind: "read", outcome: "asked", deviceId: device.id, capability: "assistant.ask" });
      return Promise.resolve(this.askAssistant({ text: question, history, allowTerminal }));
    }
    if (operation === "request-worker-action" || operation === "request-recipe-action") {
      requireScope("actions.request");
      return this.#createApproval(device, operation, payload);
    }
    throw new Error("Mobile operation is not supported");
  }

  async resolveApproval(id, decision) {
    this.#expire();
    const approvals = this.store.approvals();
    const approval = approvals.find(item => item.id === String(id));
    if (!approval) throw new Error("Mobile approval request was not found");
    if (approval.state !== "pending") throw new Error(`Mobile approval is already ${approval.state}`);
    if (!["approve", "deny"].includes(decision)) throw new Error("Mobile approval decision is invalid");
    if (decision === "deny") { approval.state = "denied"; approval.resolvedAt = this.now(); this.store.setApprovals(approvals); this.#audit({ kind: "approval", outcome: "denied", deviceId: approval.deviceId, capability: approval.action, target: approval.target }); this.#emitStatus(); return clone(approval); }
    const credential = this.store.deviceCredential(approval.deviceId);
    if (credential.device.projectKey !== this.#projectIdentity().key || approval.projectKey !== credential.device.projectKey) throw new Error("Mobile approval belongs to a different project");
    if (!credential.device.scopes.includes("actions.request") || !this.store.status().scopes.includes("actions.request")) throw new Error("Mobile action permission was revoked before approval");
    approval.state = "executing"; approval.resolvedAt = this.now(); approval.decidedBy = "operator"; this.store.setApprovals(approvals); this.#emitStatus();
    return this.#run(approval);
  }

  async dispose() { if (this.disposed) return false; this.disposed = true; await this.stop(); this.removeAllListeners(); return true; }

  #createApproval(device, operation, payload) {
    const engine = this.getEngineApi();
    let record;
    if (operation === "request-worker-action") {
      const target = String(payload.workerId || "").slice(0, 64); const action = String(payload.action || ""); const worker = engine.getSnapshot(target);
      if (!worker) throw new Error("Mobile worker target was not found");
      if (!["start", "restart", "stop", "acknowledge"].includes(action)) throw new Error("Mobile worker action is invalid");
      record = { type: "worker", target, targetName: worker.name, action };
    } else {
      const target = String(payload.recipeId || "").slice(0, 64); const action = String(payload.action || ""); const recipe = engine.listRecipes().find(item => item.id === target);
      if (!recipe) throw new Error("Mobile recipe target was not found");
      if (!["run", "recover", "cancel"].includes(action)) throw new Error("Mobile recipe action is invalid");
      record = { type: "recipe", target, targetName: recipe.name, action };
    }
    // The request was already checked for the project and the permission, so
    // an automatic one goes straight to execution and never sits in Needs You.
    const auto = this.store.status().autoRun === true && (MOBILE_AUTO_ACTIONS[record.type] || []).includes(record.action);
    const busyKey = `${record.type}:${record.target}`;
    if (auto && this.busyTargets.has(busyKey)) throw new Error(`${record.targetName} is already being changed from a phone`);
    const now = this.now();
    const approval = { id: `mobile-approval-${this.randomUUID()}`, state: auto ? "executing" : "pending", deviceId: device.id, deviceName: device.name, projectKey: this.#projectIdentity().key, reason: safeReason(payload.reason), createdAt: now, expiresAt: now + MOBILE_APPROVAL_TTL_MS, ...record, ...(auto ? { resolvedAt: now, decidedBy: "auto" } : null) };
    this.store.setApprovals(this.#compact([...this.store.approvals(), approval])); this.#audit({ kind: "approval", outcome: "requested", deviceId: device.id, capability: approval.action, target: approval.target }); this.#emitStatus();
    if (!auto) return clone(approval);
    this.busyTargets.add(busyKey);
    return this.#run(approval).then(done => this.#phoneView(done)).finally(() => this.busyTargets.delete(busyKey));
  }

  // Runs an approval that is already saved as "executing" and records how it
  // ended. The store is read again afterwards: another request may have written
  // while this one was running, and writing back the list held from before
  // would erase it.
  async #run(approval) {
    let state = "approved"; let result = null; let error = null;
    try { result = await this.#executeApproval(approval); }
    catch (failure) { state = "failed"; error = failure instanceof Error ? failure.message : String(failure); }
    const approvals = this.store.approvals();
    const current = approvals.find(item => item.id === approval.id);
    const finished = current || { ...approval };
    finished.state = state; finished.completedAt = this.now();
    if (state === "approved") finished.result = result; else finished.error = error;
    if (current) this.store.setApprovals(approvals);
    this.#audit({ kind: "approval", outcome: finished.decidedBy === "auto" ? `auto-${state}` : state, deviceId: finished.deviceId, capability: finished.action, target: finished.target });
    this.#emitStatus();
    return clone(finished);
  }

  // What a phone is told about its own request: the outcome, not the engine's
  // raw result or the desktop's internal identifiers.
  #phoneView(approval) {
    return { id: approval.id, state: approval.state, type: approval.type, action: approval.action, target: approval.target, targetName: approval.targetName, decidedBy: approval.decidedBy || null, error: approval.error ? redactText(approval.error, { maxLength: 300 }).value : null, createdAt: approval.createdAt, completedAt: approval.completedAt || null };
  }

  // Automatic requests are stored too, so they would crowd a request that is
  // still waiting out of the list. Finished ones are dropped first.
  #compact(approvals) {
    const list = [...approvals];
    while (list.length > MAX_MOBILE_APPROVALS) {
      const finished = list.findIndex(item => item.state !== "pending" && item.state !== "executing");
      list.splice(finished === -1 ? 0 : finished, 1);
    }
    return list;
  }

  // The last few things phones did on their own, for the desktop to show.
  #recentActions() {
    return this.store.approvals()
      .filter(item => item.decidedBy === "auto")
      .sort((left, right) => (right.completedAt || right.createdAt) - (left.completedAt || left.createdAt))
      .slice(0, 5)
      .map(item => ({ id: item.id, deviceName: item.deviceName, type: item.type, action: item.action, targetName: item.targetName, state: item.state, at: item.completedAt || item.createdAt, error: item.error ? redactText(item.error, { maxLength: 160 }).value : null }));
  }

  async #executeApproval(approval) {
    const engine = this.getEngineApi(); let result;
    if (approval.type === "worker") { const operation = approval.action === "stop" ? "kill" : approval.action; result = engine[operation](approval.target); if (result?.then) result = await result; }
    else if (approval.action === "cancel") result = engine.cancelRecipe(approval.target);
    else result = engine.runRecipe(approval.target, { recover: approval.action === "recover" });
    if (!result?.ok) throw new Error(result?.error || "EngineAPI rejected the approved mobile action");
    return clone(result);
  }

  #expire() {
    const now = this.now();
    for (const [id, invitation] of this.invitations) if (invitation.expiresAt <= now) this.invitations.delete(id);
    const approvals = this.store.approvals(); let changed = false;
    // A request the desktop was running when it stopped never reports back.
    for (const approval of approvals) if (approval.state === "executing" && (approval.resolvedAt || approval.createdAt) + MOBILE_EXECUTION_TTL_MS <= now) { approval.state = "failed"; approval.error = "The desktop stopped before this finished"; approval.completedAt = now; changed = true; this.#audit({ kind: "approval", outcome: "interrupted", deviceId: approval.deviceId, capability: approval.action, target: approval.target }); }
    for (const approval of approvals) if (approval.state === "pending" && approval.expiresAt <= now) { approval.state = "expired"; approval.resolvedAt = now; changed = true; this.#audit({ kind: "approval", outcome: "expired", deviceId: approval.deviceId, capability: approval.action, target: approval.target }); }
    if (changed) this.store.setApprovals(approvals);
  }

  #pruneNonces(deviceId) { const cutoff = this.now() - MOBILE_NONCE_TTL_MS; const values = this.seenNonces.get(deviceId); if (!values) return; for (const [nonce, at] of values) if (at < cutoff) values.delete(nonce); if (!values.size) this.seenNonces.delete(deviceId); }
  #projectIdentity() { const workspace = this.getEngineApi()?.getWorkspace?.(); if (!workspace?.persistent) throw new Error("Mobile Companion requires a persistent project"); const source = workspace.path || workspace.directory || workspace.name; return { key: crypto.createHash("sha256").update(String(source)).digest("base64url"), name: String(workspace.name || "Project").slice(0, 120) }; }
  #endpoints(port) {
    const scored = [];
    for (const [ifaceName, entries] of Object.entries(this.networkInterfaces() || {})) {
      for (const item of entries || []) {
        if (!item || item.family !== "IPv4" || item.internal) continue;
        const addr = item.address;
        if (addr.startsWith("127.") || addr.startsWith("169.254.")) continue;
        let score = 50;
        const lowerName = String(ifaceName).toLowerCase();
        if (/wi-?fi|wlan|wireless|en0|eth|ethernet/i.test(lowerName)) score += 30;
        if (addr.startsWith("192.168.")) score += 20;
        else if (addr.startsWith("10.")) score += 15;
        else if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(addr)) score += 10;
        if (/veth|wsl|docker|hyper-v|virtualbox|vmware/i.test(lowerName)) score -= 40;
        scored.push({ addr, score });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const values = [];
    for (const item of scored) {
      if (!seen.has(item.addr)) {
        seen.add(item.addr);
        values.push(item.addr);
      }
    }
    return values.slice(0, 8).map(address => `http://${address}:${port}`);
  }

  #audit(record) { try { this.store.appendAudit({ ...record, id: `mobile-audit-${this.randomUUID()}`, at: this.now() }); } catch {} }

  #auditRead(record) {
    const key = [record.deviceId, record.capability, record.target || ""].join("|");
    const last = this.readAudits.get(key) || 0;
    if (this.now() - last < MOBILE_READ_AUDIT_WINDOW_MS) return;
    this.readAudits.set(key, this.now());
    this.#audit(record);
  }

  #emitStatus() {
    const status = this.status();
    for (const listener of this.rawListeners("status")) try { listener(status); } catch {}
    // The event stream is not authenticated: anything on the network can open
    // it. It says only that something changed, and each phone then asks over
    // its own encrypted channel. It used to carry the whole status, pairing
    // code included.
    const nudge = `event: status\ndata: ${JSON.stringify({ at: this.now() })}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(nudge);
      } catch {}
    }
  }

  async #handleHttp(request, response) {
    // Add CORS headers for mobile web/WebView clients
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Mission-Control-Device, X-Mission-Control-Time, X-Mission-Control-Nonce, Authorization");

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const send = (status, value) => {
      if (response.writableEnded) return;
      const body = JSON.stringify(value);
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": Buffer.byteLength(body)
      });
      response.end(body);
    };

    const pathname = String(request.url || "").split("?")[0];

    // Serve Standalone Mobile Web Companion PWA
    if (request.method === "GET" && (pathname === "/mobile" || pathname === "/mobile/")) {
      const html = getMobileWebCompanionHtml();
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Content-Length": Buffer.byteLength(html)
      });
      response.end(html);
      return;
    }

    // Serve PWA Web App Manifest
    if (request.method === "GET" && (pathname === "/mobile/manifest.json" || pathname === "/mobile/manifest.webmanifest")) {
      const manifest = getMobileManifestJson();
      response.writeHead(200, {
        "Content-Type": "application/manifest+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Content-Length": Buffer.byteLength(manifest)
      });
      response.end(manifest);
      return;
    }

    if (request.method === "GET" && Object.hasOwn(MOBILE_BRAND_ICONS, pathname)) {
      const icon = readBrandIcon(pathname);
      if (!icon) return send(404, { ok: false, error: "Not found" });
      response.writeHead(200, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        "Content-Length": icon.length
      });
      response.end(icon);
      return;
    }

    // Serve PWA Service Worker
    if (request.method === "GET" && pathname === "/mobile/sw.js") {
      const sw = getMobileServiceWorkerJs();
      response.writeHead(200, {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-cache, no-store, must-revalidate",
        // The page is served at /mobile, one level above this script's
        // default scope, so the wider scope has to be granted explicitly.
        "Service-Worker-Allowed": "/mobile",
        "Content-Length": Buffer.byteLength(sw)
      });
      response.end(sw);
      return;
    }

    // Ping health check
    if (request.method === "GET" && pathname === MOBILE_PING_PATH) {
      return send(200, { ok: true, version: MOBILE_API_VERSION, name: "OUTARCH Mobile Gateway", running: Boolean(this.server?.listening) });
    }

    // Live Server-Sent Events (SSE)
    if (request.method === "GET" && pathname === MOBILE_EVENTS_PATH) {
      response.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive"
      });
      response.write(`event: connected\ndata: ${JSON.stringify({ at: this.now() })}\n\n`);
      this.sseClients.add(response);
      request.on("close", () => { this.sseClients.delete(response); });
      return;
    }

    // Public Invitation
    if (request.method === "GET" && pathname === MOBILE_INVITE_PATH) {
      try { return send(200, this.currentInvitation()); }
      catch (error) { return send(404, { error: error instanceof Error ? error.message : String(error) }); }
    }

    if (request.method !== "POST" || ![MOBILE_PAIR_PATH, MOBILE_REQUEST_PATH].includes(pathname)) {
      return send(404, { error: "Mobile endpoint not found" });
    }

    let bytes = 0; const chunks = [];
    try {
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > MAX_MOBILE_REQUEST_BYTES) throw new Error("Mobile request exceeds the 256 KiB limit");
        chunks.push(chunk);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (pathname === MOBILE_PAIR_PATH) return send(200, this.pair(body));
      const opened = this.openRequest({
        deviceId: request.headers["x-mission-control-device"],
        timestamp: Number(request.headers["x-mission-control-time"]),
        nonce: request.headers["x-mission-control-nonce"]
      }, body);
      const result = await this.dispatch(opened.device, opened.payload);
      return send(200, this.sealResponse(opened, { ok: true, result }));
    } catch (error) {
      return send(/authentication|credential|replay|timestamp|pairing proof/i.test(error.message) ? 401 : 400, { error: error instanceof Error ? error.message : String(error) });
    }
  }
}

module.exports = { MAX_MOBILE_REQUEST_BYTES, MOBILE_API_VERSION, MOBILE_APPROVAL_TTL_MS, MOBILE_AUTO_ACTIONS, MOBILE_PAIRING_ATTEMPTS, MOBILE_READ_AUDIT_WINDOW_MS, MOBILE_CLOCK_SKEW_MS, MOBILE_EVENTS_PATH, MOBILE_INVITE_PATH, MOBILE_NONCE_TTL_MS, MOBILE_PAIRING_TTL_MS, MOBILE_PAIR_PATH, MOBILE_PING_PATH, MOBILE_REQUEST_PATH, MobileCompanionGateway, decryptEnvelope, derivePairingKey, encryptEnvelope, envelopeKey, pairingMessage, pairingProof, timingSafe };
