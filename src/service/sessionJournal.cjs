"use strict";

// Transactional Session Journal for Mission Control.
// Records clean shutdown markers, launch intents, and active worker runs
// to enable safe crash recovery and pre-autostart reconciliation.

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const JOURNAL_SCHEMA_VERSION = 1;
const DEFAULT_JOURNAL_DIR = path.join(os.homedir(), ".mission-control", "journals");

function sanitizePath(input) {
  return String(input || "").replace(/[^a-zA-Z0-9_\-]/g, "_");
}

class SessionJournal {
  #journalDir;

  constructor(journalDir = DEFAULT_JOURNAL_DIR) {
    this.#journalDir = journalDir;
    try {
      if (!fs.existsSync(this.#journalDir)) {
        fs.mkdirSync(this.#journalDir, { recursive: true });
      }
    } catch {}
  }

  #getJournalFilePath(projectId) {
    const safeName = sanitizePath(projectId || "default");
    return path.join(this.#journalDir, `journal_${safeName}.json`);
  }

  #readJournal(projectId) {
    const filePath = this.#getJournalFilePath(projectId);
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, "utf8");
        return JSON.parse(raw);
      }
    } catch {}
    return null;
  }

  #writeJournal(projectId, data) {
    const filePath = this.#getJournalFilePath(projectId);
    try {
      const payload = JSON.stringify({
        version: JOURNAL_SCHEMA_VERSION,
        updatedAt: Date.now(),
        ...data
      }, null, 2);
      fs.writeFileSync(filePath, payload, "utf8");
    } catch {}
  }

  startSession(projectId, sessionInfo = {}) {
    const current = this.#readJournal(projectId);
    const wasClean = current ? current.cleanShutdown === true : true;

    const newSession = {
      projectId,
      sessionId: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      startedAt: Date.now(),
      cleanShutdown: false,
      priorSessionWasClean: wasClean,
      priorSession: current ? {
        sessionId: current.sessionId,
        startedAt: current.startedAt,
        cleanShutdown: current.cleanShutdown,
        runs: current.activeRuns || []
      } : null,
      activeRuns: [],
      intents: []
    };

    this.#writeJournal(projectId, newSession);
    return newSession;
  }

  recordLaunchIntent(projectId, workerId, command, cwd) {
    const current = this.#readJournal(projectId);
    if (!current) return;

    current.intents = current.intents || [];
    current.intents.push({
      workerId,
      command: String(command || "").slice(0, 120),
      cwd: String(cwd || ".").slice(0, 120),
      at: Date.now()
    });
    if (current.intents.length > 50) current.intents = current.intents.slice(-50);
    this.#writeJournal(projectId, current);
  }

  recordConfirmedRun(projectId, workerId, workerRunId, pid = null) {
    const current = this.#readJournal(projectId);
    if (!current) return;

    current.activeRuns = current.activeRuns || [];
    // Update or append
    const existingIdx = current.activeRuns.findIndex(r => r.workerId === workerId);
    const entry = {
      workerId,
      workerRunId,
      pid: pid ? Number(pid) : null,
      startedAt: Date.now(),
      status: "running"
    };

    if (existingIdx >= 0) {
      current.activeRuns[existingIdx] = entry;
    } else {
      current.activeRuns.push(entry);
    }

    this.#writeJournal(projectId, current);
  }

  recordRunExited(projectId, workerId, exitCode = 0) {
    const current = this.#readJournal(projectId);
    if (!current || !Array.isArray(current.activeRuns)) return;

    current.activeRuns = current.activeRuns.map(r => {
      if (r.workerId === workerId) {
        return { ...r, status: "exited", exitCode, exitedAt: Date.now() };
      }
      return r;
    });

    this.#writeJournal(projectId, current);
  }

  markCleanShutdown(projectId) {
    const current = this.#readJournal(projectId);
    if (!current) return;

    current.cleanShutdown = true;
    current.shutdownAt = Date.now();
    this.#writeJournal(projectId, current);
  }

  inspectPriorSession(projectId) {
    const current = this.#readJournal(projectId);
    if (!current) {
      return {
        hadPriorSession: false,
        wasClean: true,
        reconciliationNeeded: false,
        priorRuns: []
      };
    }

    return {
      hadPriorSession: true,
      wasClean: current.cleanShutdown === true,
      reconciliationNeeded: current.cleanShutdown !== true && Array.isArray(current.activeRuns) && current.activeRuns.some(r => r.status === "running"),
      priorSessionId: current.sessionId,
      startedAt: current.startedAt,
      shutdownAt: current.shutdownAt || null,
      priorRuns: current.activeRuns || []
    };
  }
}

const sessionJournal = new SessionJournal();

module.exports = {
  SessionJournal,
  sessionJournal
};
