"use strict";

// Which version of OUTARCH's terms this Windows user agreed to, and when.
//
// The policy text lives in the renderer (src/groundstation/renderer/legal/
// outarchPolicies.js) and carries its own LEGAL_VERSION. The renderer asks
// for the record at launch, and shows the agreement screen when there is none
// or it names an older version. This store only keeps the record: one small
// JSON file in OUTARCH's data folder, written atomically. It is not a secret
// and holds no personal data beyond the time of agreement.

const fs = require("node:fs");
const path = require("node:path");

const VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DOCUMENT_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;
const MAX_DOCUMENTS = 8;

function clean(record) {
  if (!record || typeof record !== "object") return null;
  if (typeof record.version !== "string" || !VERSION_PATTERN.test(record.version)) return null;
  const acceptedAt = typeof record.acceptedAt === "string" && !Number.isNaN(Date.parse(record.acceptedAt)) ? new Date(record.acceptedAt).toISOString() : null;
  if (!acceptedAt) return null;
  const documents = Array.isArray(record.documents) ? record.documents.filter(id => typeof id === "string" && DOCUMENT_PATTERN.test(id)).slice(0, MAX_DOCUMENTS) : [];
  const appVersion = typeof record.appVersion === "string" ? record.appVersion.slice(0, 32) : "";
  return { version: record.version, acceptedAt, documents, appVersion };
}

class LegalAcceptanceStore {
  #file;
  #fs;
  #now;
  #appVersion;

  constructor(file, options = {}) {
    if (typeof file !== "string" || !file) throw new TypeError("LegalAcceptanceStore needs a file path");
    this.#file = file;
    this.#fs = options.fs || fs;
    this.#now = typeof options.now === "function" ? options.now : () => new Date();
    this.#appVersion = typeof options.appVersion === "string" ? options.appVersion : "";
  }

  // The stored record, or null when nothing valid has been agreed yet.
  read() {
    try {
      return clean(JSON.parse(this.#fs.readFileSync(this.#file, "utf8")));
    } catch {
      return null;
    }
  }

  status() {
    return { acceptance: this.read() };
  }

  accept(request = {}) {
    const version = typeof request.version === "string" ? request.version : "";
    if (!VERSION_PATTERN.test(version)) throw new TypeError("An agreement needs the policy version (YYYY-MM-DD)");
    const documents = Array.isArray(request.documents) ? request.documents : [];
    if (!documents.length || documents.some(id => typeof id !== "string" || !DOCUMENT_PATTERN.test(id)) || documents.length > MAX_DOCUMENTS) {
      throw new TypeError("An agreement must name the documents agreed to");
    }
    const record = clean({ version, documents, acceptedAt: this.#now().toISOString(), appVersion: this.#appVersion });
    const temporary = `${this.#file}.${process.pid}.tmp`;
    this.#fs.mkdirSync(path.dirname(this.#file), { recursive: true });
    this.#fs.writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    this.#fs.renameSync(temporary, this.#file);
    return { acceptance: record };
  }
}

module.exports = { LegalAcceptanceStore, VERSION_PATTERN };
