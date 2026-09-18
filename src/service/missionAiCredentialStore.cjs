"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MISSION_AI_CREDENTIAL_VERSION = 2;
const MAX_CREDENTIAL_FILE_BYTES = 64 * 1024;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_MODELS = Object.freeze([
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-3.1-pro-preview",
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "gemini-1.5-flash-8b"
]);

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validApiKey(value) {
  return typeof value === "string" && value.length >= 20 && value.length <= 512 && !/\s/.test(value);
}

function normalizePreferences(value = {}) {
  return {
    model: GEMINI_MODELS.includes(value.model) ? value.model : DEFAULT_GEMINI_MODEL,
    includeTerminalEvidence: value.includeTerminalEvidence === true
  };
}

function publicCredentialError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.startsWith("Mission AI credential ")
    ? message
    : "Mission AI credential store could not be read";
}

class MissionAiCredentialStore {
  constructor(filePath, options = {}) {
    if (typeof filePath !== "string" || !filePath) throw new TypeError("Mission AI credential path is required");
    if (!options.safeStorage) throw new TypeError("Mission AI credential store requires Electron safeStorage");
    this.filePath = path.resolve(filePath);
    this.safeStorage = options.safeStorage;
    this.fs = options.fs || fs;
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
      const primaryConfigured = Boolean(document?.credentials?.primary);
      const secondaryConfigured = Boolean(document?.credentials?.secondary);
      return {
        configured: primaryConfigured || secondaryConfigured,
        keyState: {
          primary: { configured: primaryConfigured },
          secondary: { configured: secondaryConfigured }
        },
        activeSlot: primaryConfigured ? "primary" : secondaryConfigured ? "secondary" : null,
        secondaryConfigured,
        model: document?.preferences.model || DEFAULT_GEMINI_MODEL,
        includeTerminalEvidence: document?.preferences.includeTerminalEvidence === true,
        ...protection,
        error: null
      };
    } catch (error) {
      return {
        configured: false,
        keyState: {
          primary: { configured: false },
          secondary: { configured: false }
        },
        activeSlot: null,
        secondaryConfigured: false,
        model: DEFAULT_GEMINI_MODEL,
        includeTerminalEvidence: false,
        ...protection,
        error: publicCredentialError(error)
      };
    }
  }

  configure(value = {}) {
    if (!isPlainObject(value)) throw new TypeError("Mission AI configuration must be an object");
    const protection = this.protectionStatus();
    if (!protection.available) throw new Error("OS credential encryption is unavailable; OUTARCH will not store a plaintext API key");
    if (Object.hasOwn(value, "model") && !GEMINI_MODELS.includes(value.model)) {
      throw new TypeError("Unsupported Gemini model");
    }
    const current = this.#readDocument();
    let primary = current.credentials?.primary || null;
    let secondary = current.credentials?.secondary || null;

    if (Object.hasOwn(value, "apiKey")) {
      if (!validApiKey(value.apiKey)) throw new TypeError("Gemini API key must be 20 to 512 non-whitespace characters");
      const encrypted = this.safeStorage.encryptString(value.apiKey);
      if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("OS credential encryption returned no data");
      primary = encrypted.toString("base64");
    }

    if (Object.hasOwn(value, "apiKeySecondary")) {
      if (value.apiKeySecondary === "" || value.apiKeySecondary === null) {
        secondary = null;
      } else {
        if (!validApiKey(value.apiKeySecondary)) throw new TypeError("Gemini fallback API key must be 20 to 512 non-whitespace characters");
        const encrypted = this.safeStorage.encryptString(value.apiKeySecondary);
        if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("OS credential encryption returned no data");
        secondary = encrypted.toString("base64");
      }
    } else if (value.clearSecondary === true) {
      secondary = null;
    }

    if (!primary && !secondary) throw new TypeError("Gemini API key is required for initial configuration");
    const preferences = normalizePreferences({
      ...current.preferences,
      ...(Object.hasOwn(value, "model") ? { model: value.model } : {}),
      ...(Object.hasOwn(value, "includeTerminalEvidence") ? { includeTerminalEvidence: value.includeTerminalEvidence } : {})
    });
    this.#writeDocument({
      version: MISSION_AI_CREDENTIAL_VERSION,
      credentials: {
        primary,
        secondary
      },
      preferences,
      updatedAt: Date.now()
    });
    return this.status();
  }

  apiKey(slot = "primary") {
    return this.getSlotApiKey(slot).apiKey;
  }

  getSlotApiKey(preferredSlot = "primary") {
    const protection = this.protectionStatus();
    if (!protection.available) throw new Error("OS credential encryption is unavailable");
    const document = this.#readDocument();
    const primaryCipher = document.credentials?.primary;
    const secondaryCipher = document.credentials?.secondary;

    let targetSlot = preferredSlot;
    if (preferredSlot === "primary" && !primaryCipher && secondaryCipher) {
      targetSlot = "secondary";
    } else if (preferredSlot === "secondary" && !secondaryCipher && primaryCipher) {
      targetSlot = "primary";
    }

    const rawCipher = document.credentials?.[targetSlot];
    if (!rawCipher) throw new Error(`Gemini ${targetSlot === "secondary" ? "fallback " : ""}API key is not configured`);
    let encrypted;
    try { encrypted = Buffer.from(rawCipher, "base64"); }
    catch { throw new Error("Mission AI credential data is invalid"); }
    try {
      const value = this.safeStorage.decryptString(encrypted);
      if (!validApiKey(value)) throw new Error("decrypted credential is invalid");
      return { slot: targetSlot, apiKey: value };
    } catch {
      throw new Error("Mission AI credential could not be decrypted on this device");
    }
  }

  preferences() {
    return { ...this.#readDocument().preferences };
  }

  clear() {
    try {
      this.fs.unlinkSync(this.filePath);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  #readDocument() {
    let raw;
    try { raw = this.fs.readFileSync(this.filePath); }
    catch (error) {
      if (error?.code === "ENOENT") return { version: MISSION_AI_CREDENTIAL_VERSION, credentials: { primary: null, secondary: null }, preferences: normalizePreferences() };
      throw error;
    }
    if (!Buffer.isBuffer(raw)) raw = Buffer.from(raw);
    if (raw.length > MAX_CREDENTIAL_FILE_BYTES) throw new Error("Mission AI credential file exceeds its safety limit");
    let value;
    try { value = JSON.parse(raw.toString("utf8")); }
    catch { throw new Error("Mission AI credential file is invalid"); }
    if (!isPlainObject(value)) throw new Error("Mission AI credential file is invalid");
    
    // Transparent v1 -> v2 migration
    if (value.version === 1) {
      const legacyCipher = value.credential || value.encryptedApiKey || null;
      if (legacyCipher !== null && (typeof legacyCipher !== "string" || legacyCipher.length > 4096)) throw new Error("Mission AI credential data is invalid");
      return {
        version: MISSION_AI_CREDENTIAL_VERSION,
        credentials: {
          primary: legacyCipher,
          secondary: null
        },
        preferences: normalizePreferences(value.preferences),
        updatedAt: Number.isInteger(value.updatedAt) ? value.updatedAt : null
      };
    }

    if (value.version !== MISSION_AI_CREDENTIAL_VERSION) throw new Error("Mission AI credential version is unsupported");
    const primary = value.credentials?.primary || null;
    const secondary = value.credentials?.secondary || null;
    if (primary !== null && (typeof primary !== "string" || primary.length > 4096)) throw new Error("Mission AI credential data is invalid");
    if (secondary !== null && (typeof secondary !== "string" || secondary.length > 4096)) throw new Error("Mission AI credential data is invalid");

    return {
      version: MISSION_AI_CREDENTIAL_VERSION,
      credentials: {
        primary,
        secondary
      },
      preferences: normalizePreferences(value.preferences),
      updatedAt: Number.isInteger(value.updatedAt) ? value.updatedAt : null
    };
  }

  #writeDocument(value) {
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    const encoded = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(encoded, "utf8") > MAX_CREDENTIAL_FILE_BYTES) throw new Error("Mission AI credential file exceeds its safety limit");
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
  DEFAULT_GEMINI_MODEL,
  GEMINI_MODELS,
  MAX_CREDENTIAL_FILE_BYTES,
  MISSION_AI_CREDENTIAL_VERSION,
  MissionAiCredentialStore,
  normalizePreferences,
  publicCredentialError,
  validApiKey
};

