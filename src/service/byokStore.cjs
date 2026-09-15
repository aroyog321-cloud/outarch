"use strict";

// Bring-your-own-key storage.
//
// Every key is encrypted with the operating system's credential protection
// (Electron safeStorage) before it touches disk, and the store refuses to run
// on a backend that would fall back to plaintext. Nothing readable by the
// renderer ever contains a key: `list()` returns labels, providers and the
// models a key was found to reach, and `apiKey()` is called only by the main
// process at the moment a request is made.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const BYOK_STORE_VERSION = 1;
const MAX_BYOK_KEYS = 12;
const MAX_STORE_BYTES = 512 * 1024;
// Every model a key's listing returns is kept; OpenRouter lists several hundred.
const MAX_MODELS_PER_KEY = 400;

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validKey(value) {
  return typeof value === "string" && value.trim().length >= 16 && value.trim().length <= 512 && !/\s/.test(value.trim());
}

function validModelId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:/@-]{1,160}$/.test(value);
}

function cleanLabel(value, fallback) {
  const text = String(value || "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 60);
  return text || fallback;
}

function cleanModels(models) {
  if (!Array.isArray(models)) return [];
  const out = [];
  for (const model of models.slice(0, MAX_MODELS_PER_KEY)) {
    if (!model || typeof model.id !== "string" || !/^[A-Za-z0-9._:/@-]{1,160}$/.test(model.id)) continue;
    out.push({
      id: model.id,
      label: cleanLabel(model.label, model.id),
      family: typeof model.family === "string" ? model.family.slice(0, 20) : "other",
      tier: ["fast", "balanced", "capable"].includes(model.tier) ? model.tier : "balanced",
      contextWindow: Number.isFinite(Number(model.contextWindow)) && Number(model.contextWindow) > 0 ? Number(model.contextWindow) : null,
      // Seen to answer when the key was checked; a listing is not proof a model chats.
      ...(model.verified === true ? { verified: true } : null),
      ...(typeof model.tools === "boolean" ? { tools: model.tools } : null)
    });
  }
  return out;
}

function publicKey(entry) {
  return {
    id: entry.id,
    label: entry.label,
    provider: entry.provider,
    baseUrl: entry.baseUrl || null,
    // The last four characters let an operator tell two keys for the same
    // provider apart without the store ever showing the key.
    hint: entry.hint || null,
    models: entry.models.map(model => ({ ...model })),
    defaultModel: entry.defaultModel || null,
    modelsCheckedAt: entry.modelsCheckedAt || null,
    lastError: entry.lastError || null,
    createdAt: entry.createdAt
  };
}

class ByokStore {
  #filePath;
  #safeStorage;
  #fs;
  #now;

  constructor(filePath, options = {}) {
    if (typeof filePath !== "string" || !filePath) throw new TypeError("BYOK store path is required");
    if (!options.safeStorage) throw new TypeError("BYOK store requires Electron safeStorage");
    this.#filePath = path.resolve(filePath);
    this.#safeStorage = options.safeStorage;
    this.#fs = options.fs || fs;
    this.#now = typeof options.now === "function" ? options.now : Date.now;
  }

  protectionStatus() {
    let available = false;
    try { available = this.#safeStorage.isEncryptionAvailable() === true; } catch { available = false; }
    let backend = null;
    try { backend = this.#safeStorage.getSelectedStorageBackend?.() || null; } catch { backend = null; }
    if (backend === "basic_text") available = false;
    return { available, backend: backend || (process.platform === "win32" ? "os-protected" : "unknown") };
  }

  list() {
    return this.#read().keys.map(publicKey);
  }

  get(id) {
    const entry = this.#read().keys.find(item => item.id === String(id));
    return entry ? publicKey(entry) : null;
  }

  add({ label, provider, baseUrl = null, apiKey, models = [], defaultModel = null, lastError = null } = {}) {
    if (!this.protectionStatus().available) throw new Error("OS credential encryption is unavailable, so Mission Control will not store an API key on this device");
    if (!validKey(apiKey)) throw new TypeError("That does not look like an API key — it should be 16 to 512 characters with no spaces");
    if (typeof provider !== "string" || !provider) throw new TypeError("A provider is required");
    const current = this.#read();
    if (current.keys.length >= MAX_BYOK_KEYS) throw new Error(`You can keep up to ${MAX_BYOK_KEYS} keys. Remove one first.`);
    const trimmed = apiKey.trim();
    const encrypted = this.#safeStorage.encryptString(trimmed);
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("OS credential encryption returned no data");
    const fingerprint = crypto.createHash("sha256").update(trimmed).digest("hex");
    if (current.keys.some(item => item.fingerprint === fingerprint)) throw new Error("That key is already saved");
    const entry = {
      id: `key-${crypto.randomUUID().slice(0, 12)}`,
      label: cleanLabel(label, provider),
      provider,
      baseUrl: baseUrl || null,
      hint: trimmed.slice(-4),
      fingerprint,
      cipher: encrypted.toString("base64"),
      models: cleanModels(models),
      defaultModel: validModelId(defaultModel) ? defaultModel : null,
      modelsCheckedAt: this.#now(),
      lastError: lastError ? String(lastError).slice(0, 300) : null,
      createdAt: this.#now()
    };
    this.#write({ ...current, keys: [...current.keys, entry] });
    return publicKey(entry);
  }

  remove(id) {
    const current = this.#read();
    const next = current.keys.filter(item => item.id !== String(id));
    if (next.length === current.keys.length) return false;
    this.#write({ ...current, keys: next });
    return true;
  }

  setModels(id, models, error = null, defaultModel = undefined) {
    const current = this.#read();
    const entry = current.keys.find(item => item.id === String(id));
    if (!entry) throw new Error("That key is no longer saved");
    if (!error) {
      // A refreshed listing keeps what was learned about the default model.
      const verified = new Set([
        ...entry.models.filter(model => model.verified).map(model => model.id),
        ...(models || []).filter(model => model.verified).map(model => model.id)
      ]);
      entry.models = cleanModels((models || []).map(model => verified.has(model.id) ? { ...model, verified: true } : model));
      if (defaultModel !== undefined) {
        entry.defaultModel = validModelId(defaultModel) ? defaultModel : null;
      } else if (!entry.defaultModel) {
        const verifiedMod = entry.models.find(model => model.verified);
        if (verifiedMod) entry.defaultModel = verifiedMod.id;
      }
      if (entry.defaultModel && !entry.models.some(model => model.id === entry.defaultModel)) entry.defaultModel = null;
      entry.modelsCheckedAt = this.#now();
    }
    entry.lastError = error ? String(error).slice(0, 300) : null;
    this.#write(current);
    return publicKey(entry);
  }

  removeModel(id, modelId) {
    const current = this.#read();
    const entry = current.keys.find(item => item.id === String(id));
    if (!entry) return false;
    const cleanId = String(modelId || "").trim();
    if (!cleanId) return false;
    const prevLength = entry.models.length;
    entry.models = entry.models.filter(m => m.id !== cleanId);
    if (entry.models.length === prevLength) return false;
    if (entry.defaultModel === cleanId) {
      const verified = entry.models.find(m => m.verified);
      entry.defaultModel = verified ? verified.id : (entry.models[0]?.id || null);
    }
    this.#write(current);
    return true;
  }

  apiKey(id) {
    if (!this.protectionStatus().available) throw new Error("OS credential encryption is unavailable");
    const entry = this.#read().keys.find(item => item.id === String(id));
    if (!entry) throw new Error("That key is no longer saved");
    try {
      const value = this.#safeStorage.decryptString(Buffer.from(entry.cipher, "base64"));
      if (!validKey(value)) throw new Error("invalid");
      return value;
    } catch {
      throw new Error("This key could not be decrypted on this device. Remove it and add it again.");
    }
  }

  #empty() {
    return { version: BYOK_STORE_VERSION, keys: [] };
  }

  #read() {
    let raw;
    try { raw = this.#fs.readFileSync(this.#filePath); }
    catch (error) { if (error?.code === "ENOENT") return this.#empty(); throw error; }
    if (!Buffer.isBuffer(raw)) raw = Buffer.from(raw);
    if (raw.length > MAX_STORE_BYTES) throw new Error("The key store exceeds its size limit");
    let value;
    try { value = JSON.parse(raw.toString("utf8")); } catch { throw new Error("The key store is unreadable"); }
    if (!isPlainObject(value) || value.version !== BYOK_STORE_VERSION || !Array.isArray(value.keys)) throw new Error("The key store is unreadable");
    const keys = value.keys.filter(entry => isPlainObject(entry) && typeof entry.id === "string" && typeof entry.cipher === "string" && entry.cipher.length <= 4096)
      .slice(0, MAX_BYOK_KEYS)
      .map(entry => ({
        id: entry.id,
        label: cleanLabel(entry.label, entry.provider || "Key"),
        provider: String(entry.provider || "custom"),
        baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl : null,
        hint: typeof entry.hint === "string" ? entry.hint.slice(0, 4) : null,
        fingerprint: typeof entry.fingerprint === "string" ? entry.fingerprint : null,
        cipher: entry.cipher,
        // A build that tested models kept the ones that failed in a separate
        // list; every model is offered again, so they rejoin the key's models.
        models: cleanModels([...(Array.isArray(entry.models) ? entry.models : []), ...(Array.isArray(entry.unavailable) ? entry.unavailable : [])]
          .filter((model, index, all) => model && all.findIndex(other => other?.id === model.id) === index)),
        defaultModel: validModelId(entry.defaultModel) ? entry.defaultModel : null,
        modelsCheckedAt: Number.isInteger(entry.modelsCheckedAt) ? entry.modelsCheckedAt : null,
        lastError: typeof entry.lastError === "string" ? entry.lastError : null,
        createdAt: Number.isInteger(entry.createdAt) ? entry.createdAt : null
      }));
    return { version: BYOK_STORE_VERSION, keys };
  }

  #write(document) {
    const directory = path.dirname(this.#filePath);
    this.#fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const encoded = `${JSON.stringify({ ...document, version: BYOK_STORE_VERSION, updatedAt: this.#now() }, null, 2)}\n`;
    if (Buffer.byteLength(encoded, "utf8") > MAX_STORE_BYTES) throw new Error("The key store exceeds its size limit");
    const temporary = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      this.#fs.writeFileSync(temporary, encoded, { encoding: "utf8", mode: 0o600, flag: "wx" });
      this.#fs.renameSync(temporary, this.#filePath);
      try { this.#fs.chmodSync(this.#filePath, 0o600); } catch { /* Windows ACLs remain authoritative. */ }
    } catch (error) {
      try { this.#fs.unlinkSync(temporary); } catch { /* best effort */ }
      throw error;
    }
  }
}

module.exports = { ByokStore, MAX_BYOK_KEYS, cleanModels };
