"use strict";

// The signed-in OUTARCH session, kept on this device.
//
// The access and refresh tokens and the last verified plan are encrypted with
// the operating system's credential protection (Electron safeStorage) before
// they touch disk. On a backend that would fall back to plaintext nothing is
// written: the session lives for this run only and the next launch asks the
// operator to sign in again.
//
// A sign-in that is in progress is also recorded — only a hash of its state
// value — so a browser that hands the session back after OUTARCH was closed
// and reopened can still be matched to the request it answers.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const STORE_VERSION = 1;
const MAX_STORE_BYTES = 256 * 1024;
const PENDING_TTL_MS = 15 * 60 * 1000;

function hashState(state) {
  return crypto.createHash("sha256").update(String(state || ""), "utf8").digest("hex");
}

class AccountSessionStore {
  #filePath;
  #safeStorage;
  #fs;
  #now;
  #memory;

  constructor(filePath, options = {}) {
    if (typeof filePath !== "string" || !filePath) throw new TypeError("account session path is required");
    this.#filePath = path.resolve(filePath);
    this.#safeStorage = options.safeStorage || null;
    this.#fs = options.fs || fs;
    this.#now = typeof options.now === "function" ? options.now : Date.now;
    this.#memory = null;
  }

  get filePath() { return this.#filePath; }

  protected() {
    try {
      if (!this.#safeStorage || this.#safeStorage.isEncryptionAvailable() !== true) return false;
      return this.#safeStorage.getSelectedStorageBackend?.() !== "basic_text";
    } catch {
      return false;
    }
  }

  #seal(value) {
    const encrypted = this.#safeStorage.encryptString(JSON.stringify(value));
    if (!Buffer.isBuffer(encrypted) || !encrypted.length) throw new Error("OS credential encryption returned no data");
    return encrypted.toString("base64");
  }

  #open(sealed) {
    if (typeof sealed !== "string" || !sealed) return null;
    try { return JSON.parse(this.#safeStorage.decryptString(Buffer.from(sealed, "base64"))); }
    catch { return null; }
  }

  #readFile() {
    try {
      const raw = this.#fs.readFileSync(this.#filePath);
      if (raw.length > MAX_STORE_BYTES) return null;
      const value = JSON.parse(raw.toString("utf8"));
      return value && typeof value === "object" && value.version === STORE_VERSION ? value : null;
    } catch {
      return null;
    }
  }

  #writeFile(value) {
    const directory = path.dirname(this.#filePath);
    this.#fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.#filePath}.${process.pid}.${Date.now()}.tmp`;
    this.#fs.writeFileSync(temporary, `${JSON.stringify({ ...value, version: STORE_VERSION }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    this.#fs.renameSync(temporary, this.#filePath);
  }

  /** { session, entitlements, verifiedAt } or null. */
  read() {
    if (!this.protected()) return this.#memory ? { ...this.#memory } : null;
    const file = this.#readFile();
    if (!file) return null;
    const session = this.#open(file.session);
    if (!session || typeof session.refreshToken !== "string" || !session.refreshToken) return null;
    return {
      session,
      entitlements: this.#open(file.entitlements),
      verifiedAt: Number.isFinite(file.verifiedAt) ? file.verifiedAt : null
    };
  }

  save({ session, entitlements = null, verifiedAt = null }) {
    if (!session || typeof session.refreshToken !== "string") throw new TypeError("a session with a refresh token is required");
    const record = { session, entitlements, verifiedAt: Number.isFinite(verifiedAt) ? verifiedAt : null };
    if (!this.protected()) {
      this.#memory = record;
      return false;
    }
    const file = this.#readFile() || {};
    this.#writeFile({
      pending: file.pending || null,
      session: this.#seal(session),
      entitlements: entitlements ? this.#seal(entitlements) : null,
      verifiedAt: record.verifiedAt
    });
    return true;
  }

  clear() {
    this.#memory = null;
    const file = this.#readFile();
    if (!file) return;
    if (file.pending) this.#writeFile({ pending: file.pending, session: null, entitlements: null, verifiedAt: null });
    else {
      try { this.#fs.unlinkSync(this.#filePath); } catch { /* already gone */ }
    }
  }

  // ------------------------------------------------------------ sign-in state

  rememberPending(state, pid = process.pid) {
    const file = this.#readFile() || {};
    const pending = { stateHash: hashState(state), createdAt: this.#now(), pid };
    try { this.#writeFile({ ...file, pending }); } catch { /* the in-memory copy still matches */ }
    return pending;
  }

  pending() {
    const pending = this.#readFile()?.pending;
    if (!pending || typeof pending.stateHash !== "string") return null;
    if (!Number.isFinite(pending.createdAt) || this.#now() - pending.createdAt > PENDING_TTL_MS) return null;
    return { ...pending };
  }

  matchesPending(state) {
    const pending = this.pending();
    if (!pending || typeof state !== "string" || !state) return false;
    const expected = Buffer.from(pending.stateHash, "hex");
    const actual = Buffer.from(hashState(state), "hex");
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  clearPending() {
    const file = this.#readFile();
    if (!file?.pending) return;
    if (file.session) this.#writeFile({ ...file, pending: null });
    else {
      try { this.#fs.unlinkSync(this.#filePath); } catch { /* already gone */ }
    }
  }
}

module.exports = { AccountSessionStore, PENDING_TTL_MS, hashState };
