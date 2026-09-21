"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MOBILE_STORE_VERSION = 1;
const MAX_MOBILE_STORE_BYTES = 512 * 1024;
const MAX_MOBILE_DEVICES = 8;
const MAX_MOBILE_APPROVALS = 100;
const MAX_MOBILE_AUDIT = 200;
const DEFAULT_MOBILE_PORT = 37422;
// assistant.ask is never a default: a phone that can ask Mission AI spends the
// desktop's model quota, so the operator turns it on knowingly.
const MOBILE_SCOPES = Object.freeze(["summary.read", "workers.read", "needs.read", "memory.read", "terminal.read", "actions.request", "assistant.ask"]);
const DEFAULT_MOBILE_SCOPES = Object.freeze(["summary.read", "workers.read", "needs.read", "memory.read"]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function normalizePort(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_MOBILE_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new TypeError("Mobile companion port must be an integer from 1024 to 65535");
  return port;
}

function normalizeScopes(value) {
  if (value === undefined) return [...DEFAULT_MOBILE_SCOPES];
  if (!Array.isArray(value) || value.some(scope => typeof scope !== "string")) throw new TypeError("Mobile scopes must be an array of strings");
  const unsupported = value.find(scope => !MOBILE_SCOPES.includes(scope));
  if (unsupported) throw new TypeError(`Unsupported mobile scope: ${unsupported}`);
  return MOBILE_SCOPES.filter(scope => value.includes(scope));
}

// autoRun: whether a paired phone's start, restart and recipe requests run
// straight away. It is on unless the operator turns it off, and a store written
// before the setting existed reads as on, so it is never "unset".
function normalizePreferences(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("Mobile companion preferences must be an object");
  return { enabled: value.enabled === true, port: normalizePort(value.port), scopes: normalizeScopes(value.scopes), autoRun: value.autoRun !== false };
}

function publicDevice(device) {
  return {
    id: device.id,
    name: device.name,
    projectName: device.projectName || null,
    scopes: [...device.scopes],
    createdAt: device.createdAt,
    lastSeenAt: device.lastSeenAt || null,
    revokedAt: device.revokedAt || null,
    state: device.revokedAt ? "revoked" : "paired"
  };
}

class MobileCompanionStore {
  constructor(filePath, options = {}) {
    if (typeof filePath !== "string" || !filePath) throw new TypeError("Mobile companion store path is required");
    if (!options.safeStorage) throw new TypeError("Mobile companion store requires Electron safeStorage");
    this.filePath = path.resolve(filePath);
    this.safeStorage = options.safeStorage;
    this.fs = options.fs || fs;
    this.now = options.now || Date.now;
  }

  protectionStatus() {
    let available = false;
    try { available = this.safeStorage.isEncryptionAvailable() === true; } catch { available = false; }
    let backend = null;
    try { backend = this.safeStorage.getSelectedStorageBackend?.() || null; } catch { backend = null; }
    if (backend === "basic_text") available = false;
    return { available, backend: backend || (process.platform === "win32" ? "os-protected" : "unknown"), protection: available ? "os-encrypted" : "unavailable" };
  }

  status() {
    const document = this.#readDocument();
    const devices = document.devices.map(publicDevice);
    // A revoked device is no longer a device, so the count of them comes from
    // the audit trail rather than from a list it has been removed from. Bounded
    // by the audit cap, which is the honest limit: the header reports what is
    // still on record, not a running total since the beginning of time.
    const revokedDeviceCount = document.audit.filter(item => item.kind === "device" && item.outcome === "revoked").length;
    return { ...document.preferences, ...this.protectionStatus(), deviceCount: devices.filter(item => item.state === "paired").length, revokedDeviceCount, pendingApprovalCount: document.approvals.filter(item => item.state === "pending").length, auditCount: document.audit.length, updatedAt: document.updatedAt };
  }

  configure(value = {}) {
    if (!isPlainObject(value)) throw new TypeError("Mobile companion configuration must be an object");
    const unsupported = Object.keys(value).find(key => !["enabled", "port", "scopes", "autoRun"].includes(key));
    if (unsupported) throw new TypeError(`Unsupported mobile companion configuration field: ${unsupported}`);
    if (value.autoRun !== undefined && typeof value.autoRun !== "boolean") throw new TypeError("Mobile companion autoRun must be true or false");
    const current = this.#readDocument();
    const preferences = normalizePreferences({ ...current.preferences, ...value });
    if (preferences.enabled && !this.protectionStatus().available) throw new Error("OS credential encryption is unavailable; Mobile Companion remains disabled");
    this.#writeDocument({ ...current, preferences, updatedAt: this.now() });
    return this.status();
  }

  devices() { return this.#readDocument().devices.map(publicDevice); }

  addDevice(value, secret) {
    if (!this.protectionStatus().available) throw new Error("OS credential encryption is unavailable");
    const current = this.#readDocument();
    if (current.devices.filter(item => !item.revokedAt).length >= MAX_MOBILE_DEVICES) throw new Error(`Mobile device limit is ${MAX_MOBILE_DEVICES}`);
    const device = {
      id: String(value.id).slice(0, 100),
      name: String(value.name || "Mobile device").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 80) || "Mobile device",
      publicKey: String(value.publicKey || "").slice(0, 512),
      projectKey: String(value.projectKey || "").slice(0, 80),
      projectName: String(value.projectName || "Project").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || "Project",
      scopes: normalizeScopes(value.scopes),
      credential: this.safeStorage.encryptString(secret).toString("base64"),
      createdAt: this.now(),
      lastSeenAt: null,
      revokedAt: null
    };
    const devices = [...current.devices, device].slice(-MAX_MOBILE_DEVICES);
    this.#writeDocument({ ...current, devices, updatedAt: this.now() });
    return publicDevice(device);
  }

  deviceCredential(id) {
    const device = this.#readDocument().devices.find(item => item.id === String(id));
    if (!device || device.revokedAt) throw new Error("Mobile device is unknown or revoked");
    if (!this.protectionStatus().available) throw new Error("OS credential encryption is unavailable");
    try { return { device: { ...publicDevice(device), projectKey: device.projectKey }, secret: this.safeStorage.decryptString(Buffer.from(device.credential, "base64")) }; }
    catch { throw new Error("Mobile device credential could not be decrypted on this device"); }
  }

  touchDevice(id) {
    const current = this.#readDocument();
    const device = current.devices.find(item => item.id === String(id));
    if (!device || device.revokedAt) return false;
    device.lastSeenAt = this.now();
    this.#writeDocument({ ...current, updatedAt: this.now() });
    return true;
  }

  // Revoking forgets the device. It used to only stamp `revokedAt`, which left
  // the row in the list for good: the operator revoked a phone, the card stayed
  // on the screen wearing a "revoked" badge, and the only way to be rid of it
  // was to never look at that tab again. Nothing needs the record afterwards —
  // its credential is dead, its pending approvals are resolved by the caller,
  // and the revocation itself is kept in the audit trail, which is where a
  // security event belongs. The stored credential goes with it rather than
  // sitting encrypted on disk for a device that can no longer use it.
  revokeDevice(id) {
    const current = this.#readDocument();
    const device = current.devices.find(item => item.id === String(id));
    if (!device || device.revokedAt) return false;
    const devices = current.devices.filter(item => item.id !== String(id));
    this.#writeDocument({ ...current, devices, updatedAt: this.now() });
    return true;
  }

  approvals() { return this.#readDocument().approvals.map(clone); }
  setApprovals(approvals) { const current = this.#readDocument(); this.#writeDocument({ ...current, approvals: clone(approvals).slice(-MAX_MOBILE_APPROVALS), updatedAt: this.now() }); }

  appendAudit(record) {
    const current = this.#readDocument();
    const clean = { id: String(record.id || `mobile-audit-${this.now()}`).slice(0, 140), at: Number.isInteger(record.at) ? record.at : this.now(), kind: String(record.kind || "request").slice(0, 60), outcome: String(record.outcome || "recorded").slice(0, 60), deviceId: record.deviceId ? String(record.deviceId).slice(0, 100) : null, capability: record.capability ? String(record.capability).slice(0, 100) : null, target: record.target ? String(record.target).slice(0, 100) : null };
    const audit = [...current.audit, clean].slice(-MAX_MOBILE_AUDIT);
    this.#writeDocument({ ...current, audit, updatedAt: this.now() });
    return clean;
  }

  listAudit(limit = 50) { return this.#readDocument().audit.slice(-Math.min(100, Math.max(1, Number(limit) || 50))).reverse().map(clone); }

  #empty() { return { version: MOBILE_STORE_VERSION, preferences: normalizePreferences(), devices: [], approvals: [], audit: [], updatedAt: null }; }

  #readDocument() {
    let raw;
    try { raw = this.fs.readFileSync(this.filePath); }
    catch (error) { if (error?.code === "ENOENT") return this.#empty(); throw error; }
    if (!Buffer.isBuffer(raw)) raw = Buffer.from(raw);
    if (raw.length > MAX_MOBILE_STORE_BYTES) throw new Error("Mobile companion store exceeds its safety limit");
    let value;
    try { value = JSON.parse(raw.toString("utf8")); } catch { throw new Error("Mobile companion store is invalid"); }
    if (!isPlainObject(value) || value.version !== MOBILE_STORE_VERSION) throw new Error("Mobile companion store version is unsupported");
    return { version: MOBILE_STORE_VERSION, preferences: normalizePreferences(value.preferences), devices: Array.isArray(value.devices) ? value.devices.filter(isPlainObject).slice(-MAX_MOBILE_DEVICES).map(clone) : [], approvals: Array.isArray(value.approvals) ? value.approvals.filter(isPlainObject).slice(-MAX_MOBILE_APPROVALS).map(clone) : [], audit: Array.isArray(value.audit) ? value.audit.filter(isPlainObject).slice(-MAX_MOBILE_AUDIT).map(clone) : [], updatedAt: Number.isInteger(value.updatedAt) ? value.updatedAt : null };
  }

  #writeDocument(value) {
    const encoded = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(encoded) > MAX_MOBILE_STORE_BYTES) throw new Error("Mobile companion store exceeds its safety limit");
    this.fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${this.now()}.tmp`;
    try { this.fs.writeFileSync(temporary, encoded, { encoding: "utf8", mode: 0o600, flag: "wx" }); this.fs.renameSync(temporary, this.filePath); try { this.fs.chmodSync(this.filePath, 0o600); } catch {} }
    catch (error) { try { this.fs.unlinkSync(temporary); } catch {} throw error; }
  }
}

module.exports = { DEFAULT_MOBILE_PORT, DEFAULT_MOBILE_SCOPES, MAX_MOBILE_APPROVALS, MAX_MOBILE_AUDIT, MAX_MOBILE_DEVICES, MAX_MOBILE_STORE_BYTES, MOBILE_SCOPES, MOBILE_STORE_VERSION, MobileCompanionStore, normalizePort, normalizePreferences, normalizeScopes };
