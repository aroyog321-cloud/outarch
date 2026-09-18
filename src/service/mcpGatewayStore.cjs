"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MCP_GATEWAY_STORE_VERSION = 1;
const MAX_MCP_STORE_BYTES = 256 * 1024;
const MAX_MCP_AUDIT_RECORDS = 200;
const DEFAULT_MCP_PORT = 37421;
const MCP_SCOPES = Object.freeze([
  "context.read",
  "memory.read",
  "attention.read",
  "terminal.read",
  "worker.lifecycle.request",
  "recipe.run.request",
  "supervisor.plan.request",
  "worker.create.request",
  "terminal.input.request"
]);
const DEFAULT_MCP_SCOPES = Object.freeze([
  "context.read",
  "memory.read",
  "attention.read"
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizePort(value) {
  if (value === undefined || value === null || value === "") return DEFAULT_MCP_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new TypeError("MCP gateway port must be an integer from 1024 to 65535");
  }
  return port;
}

function normalizeScopes(value) {
  if (value === undefined) return [...DEFAULT_MCP_SCOPES];
  if (!Array.isArray(value) || value.some(scope => typeof scope !== "string")) {
    throw new TypeError("MCP gateway scopes must be an array of strings");
  }
  const unknown = value.find(scope => !MCP_SCOPES.includes(scope));
  if (unknown) throw new TypeError(`Unsupported MCP gateway scope: ${unknown}`);
  return MCP_SCOPES.filter(scope => value.includes(scope));
}

function normalizePreferences(value = {}) {
  if (!isPlainObject(value)) throw new TypeError("MCP gateway preferences must be an object");
  return {
    enabled: value.enabled === true,
    port: normalizePort(value.port),
    scopes: normalizeScopes(value.scopes)
  };
}

function validToken(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{40,128}$/.test(value);
}

function publicStoreError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("MCP gateway credential ")
    ? message
    : "MCP gateway credential store could not be read";
}

class McpGatewayStore {
  constructor(filePath, options = {}) {
    if (typeof filePath !== "string" || !filePath) throw new TypeError("MCP gateway credential path is required");
    if (!options.safeStorage) throw new TypeError("MCP gateway credential store requires Electron safeStorage");
    this.filePath = path.resolve(filePath);
    this.safeStorage = options.safeStorage;
    this.fs = options.fs || fs;
    this.now = options.now || Date.now;
    this.randomBytes = options.randomBytes || crypto.randomBytes;
  }

  protectionStatus() {
    let available = false;
    try { available = this.safeStorage.isEncryptionAvailable() === true; } catch { available = false; }
    let backend = null;
    try { backend = this.safeStorage.getSelectedStorageBackend?.() || null; } catch { backend = null; }
    if (backend === "basic_text") available = false;
    return {
      available,
      backend: backend || (process.platform === "win32" ? "os-protected" : "unknown"),
      protection: available ? "os-encrypted" : "unavailable"
    };
  }

  status() {
    const protection = this.protectionStatus();
    try {
      const document = this.#readDocument();
      return {
        configured: Boolean(document.credential),
        ...document.preferences,
        auditCount: document.audit.length,
        updatedAt: document.updatedAt,
        ...protection,
        error: null
      };
    } catch (error) {
      return {
        configured: false,
        ...normalizePreferences(),
        auditCount: 0,
        updatedAt: null,
        ...protection,
        error: publicStoreError(error)
      };
    }
  }

  configure(value = {}) {
    if (!isPlainObject(value)) throw new TypeError("MCP gateway configuration must be an object");
    const unsupported = Object.keys(value).find(key => !["enabled", "port", "scopes"].includes(key));
    if (unsupported) throw new TypeError(`Unsupported MCP gateway configuration field: ${unsupported}`);
    const current = this.#readDocument();
    const preferences = normalizePreferences({ ...current.preferences, ...value });
    const credential = current.credential;
    if (preferences.enabled && !this.protectionStatus().available) {
      throw new Error("OS credential encryption is unavailable; OUTARCH will not store a plaintext MCP access token");
    }
    if (preferences.enabled && !credential) {
      throw new Error("Create and copy an MCP access token before enabling the gateway");
    }
    this.#writeDocument({
      version: MCP_GATEWAY_STORE_VERSION,
      credential,
      preferences,
      audit: current.audit,
      updatedAt: this.now()
    });
    return this.status();
  }

  rotateToken() {
    const protection = this.protectionStatus();
    if (!protection.available) throw new Error("OS credential encryption is unavailable; OUTARCH will not store a plaintext MCP access token");
    const current = this.#readDocument();
    const token = this.#newToken();
    this.#writeDocument({
      ...current,
      credential: this.#encrypt(token),
      updatedAt: this.now()
    });
    return token;
  }

  token() {
    const protection = this.protectionStatus();
    if (!protection.available) throw new Error("OS credential encryption is unavailable");
    const document = this.#readDocument();
    if (!document.credential) throw new Error("MCP gateway access token is not configured");
    let encrypted;
    try { encrypted = Buffer.from(document.credential, "base64"); }
    catch { throw new Error("MCP gateway credential data is invalid"); }
    try {
      const value = this.safeStorage.decryptString(encrypted);
      if (!validToken(value)) throw new Error("decrypted credential is invalid");
      return value;
    } catch {
      throw new Error("MCP gateway credential could not be decrypted on this device");
    }
  }

  appendAudit(record) {
    if (!isPlainObject(record)) throw new TypeError("MCP audit record must be an object");
    const current = this.#readDocument();
    const clean = {
      id: String(record.id || `mcp-audit-${this.now()}`).slice(0, 160),
      at: Number.isInteger(record.at) ? record.at : this.now(),
      kind: String(record.kind || "request").slice(0, 80),
      outcome: String(record.outcome || "recorded").slice(0, 80),
      client: String(record.client || "unknown-client").slice(0, 120),
      capability: record.capability ? String(record.capability).slice(0, 160) : null,
      target: record.target ? String(record.target).slice(0, 160) : null
    };
    const audit = [...current.audit, clean].slice(-MAX_MCP_AUDIT_RECORDS);
    this.#writeDocument({ ...current, audit, updatedAt: this.now() });
    return { ...clean };
  }

  listAudit(limit = 50) {
    const maximum = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50;
    return this.#readDocument().audit.slice(-maximum).reverse().map(record => ({ ...record }));
  }

  #newToken() {
    return this.randomBytes(32).toString("base64url");
  }

  #encrypt(value) {
    const protection = this.protectionStatus();
    if (!protection.available) throw new Error("OS credential encryption is unavailable; OUTARCH will not store a plaintext MCP access token");
    const encrypted = this.safeStorage.encryptString(value);
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("OS credential encryption returned no data");
    return encrypted.toString("base64");
  }

  #readDocument() {
    let raw;
    try { raw = this.fs.readFileSync(this.filePath); }
    catch (error) {
      if (error?.code === "ENOENT") {
        return { version: MCP_GATEWAY_STORE_VERSION, credential: null, preferences: normalizePreferences(), audit: [], updatedAt: null };
      }
      throw error;
    }
    if (!Buffer.isBuffer(raw)) raw = Buffer.from(raw);
    if (raw.length > MAX_MCP_STORE_BYTES) throw new Error("MCP gateway credential file exceeds its safety limit");
    let value;
    try { value = JSON.parse(raw.toString("utf8")); }
    catch { throw new Error("MCP gateway credential file is invalid"); }
    if (!isPlainObject(value) || value.version !== MCP_GATEWAY_STORE_VERSION) throw new Error("MCP gateway credential version is unsupported");
    if (value.credential !== null && value.credential !== undefined && (typeof value.credential !== "string" || value.credential.length > 4096)) {
      throw new Error("MCP gateway credential data is invalid");
    }
    return {
      version: MCP_GATEWAY_STORE_VERSION,
      credential: value.credential || null,
      preferences: normalizePreferences(value.preferences),
      audit: Array.isArray(value.audit) ? value.audit.filter(isPlainObject).slice(-MAX_MCP_AUDIT_RECORDS).map(record => ({ ...record })) : [],
      updatedAt: Number.isInteger(value.updatedAt) ? value.updatedAt : null
    };
  }

  #writeDocument(value) {
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${this.now()}.tmp`;
    const encoded = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(encoded, "utf8") > MAX_MCP_STORE_BYTES) throw new Error("MCP gateway credential file exceeds its safety limit");
    try {
      this.fs.writeFileSync(temporary, encoded, { encoding: "utf8", mode: 0o600, flag: "wx" });
      this.fs.renameSync(temporary, this.filePath);
      try { this.fs.chmodSync(this.filePath, 0o600); } catch { /* Windows ACLs remain authoritative. */ }
    } catch (error) {
      try { this.fs.unlinkSync(temporary); } catch { /* Best-effort temporary cleanup. */ }
      throw error;
    }
  }
}

module.exports = {
  DEFAULT_MCP_PORT,
  DEFAULT_MCP_SCOPES,
  MAX_MCP_AUDIT_RECORDS,
  MAX_MCP_STORE_BYTES,
  MCP_GATEWAY_STORE_VERSION,
  MCP_SCOPES,
  McpGatewayStore,
  normalizePort,
  normalizePreferences,
  normalizeScopes,
  publicStoreError,
  validToken
};
