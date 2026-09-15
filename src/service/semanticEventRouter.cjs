"use strict";

const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");

const EVENT_TYPES = Object.freeze([
  "service.ready",
  "port.conflict",
  "build.failed",
  "agent.turnCompleted",
  "agent.awaitingApproval",
  "recovery.required"
]);

const BUILD_FAIL_PATTERNS = Object.freeze([
  /(?:build failed|compilation failed|failed to compile|syntaxerror:|typeerror:)/i,
  /(?:error: TS[0-9]+:|npm ERR! code|yarn error|cargo build failed)/i,
  /(?:\[vite\] internal server error|webpack compile error)/i
]);

// A server that cannot bind because something already holds its port. Node,
// Python, Go and Vite each say it their own way; the port is read from the
// line when the line names it.
const PORT_CONFLICT_PATTERNS = Object.freeze([
  /EADDRINUSE/i,
  /address already in use/i,
  /port\s+\d{2,5}\s+is\s+(?:already\s+)?in use/i,
  /only one usage of each socket address/i
]);

function conflictPort(line) {
  const match = line.match(/(?::|port\s+)(\d{2,5})(?!\d)/i);
  const port = Number(match?.[1]);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
}

class SemanticEventRouter extends EventEmitter {
  #events;
  #conflicts = new Set();
  #maxEntries;
  #now;

  constructor(options = {}) {
    super();
    this.#maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0 ? options.maxEntries : 500;
    this.#events = [];
    this.#now = typeof options.now === "function" ? options.now : Date.now;
  }

  publish(rawEvent) {
    if (!rawEvent || typeof rawEvent !== "object") return null;
    const type = String(rawEvent.type || "unknown");
    const event = {
      id: rawEvent.id || crypto.randomUUID(),
      type,
      severity: rawEvent.severity || "info", // "info" | "warning" | "error" | "critical"
      workerId: rawEvent.workerId || null,
      workerName: rawEvent.workerName || null,
      projectId: rawEvent.projectId || null,
      runId: rawEvent.runId || null,
      title: String(rawEvent.title || type),
      description: String(rawEvent.description || ""),
      data: rawEvent.data && typeof rawEvent.data === "object" ? { ...rawEvent.data } : {},
      timestamp: Number.isInteger(rawEvent.timestamp) ? rawEvent.timestamp : this.#now()
    };

    this.#events.push(event);
    if (this.#events.length > this.#maxEntries) {
      this.#events.splice(0, this.#events.length - this.#maxEntries);
    }

    this.emit("event", event);
    this.emit(`event:${type}`, event);
    return event;
  }

  inspectOutput(workerId, runId, text, metadata = {}) {
    if (!workerId || !text) return null;
    const clean = String(text).replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
    if (PORT_CONFLICT_PATTERNS.some(pattern => pattern.test(clean))) {
      const port = conflictPort(clean);
      // A crash prints the error code on several lines of one stack trace, and
      // that is one conflict, not three. A line that names no port is folded
      // into the one that did.
      const runKey = `${workerId}:${runId || "run"}`;
      if (this.#conflicts.has(`${runKey}:${port}`) || (!port && [...this.#conflicts].some(key => key.startsWith(`${runKey}:`)))) return null;
      this.#conflicts.add(`${runKey}:${port}`);
      if (this.#conflicts.size > 500) this.#conflicts.delete(this.#conflicts.values().next().value);
      // Vite and friends step to the next free port on their own: worth knowing
      // (the address is not the usual one), not a failure.
      const movedOn = /trying another/i.test(clean);
      return this.publish({
        type: "port.conflict",
        severity: movedOn ? "warning" : "error",
        workerId,
        runId,
        projectId: metadata.projectId || null,
        workerName: metadata.workerName || null,
        title: movedOn ? `Port ${port} was taken, so another port is being used` : port ? `Port ${port} is already in use` : "A port is already in use",
        description: clean.slice(0, 200).trim(),
        data: { port, movedOn, rawSnippet: clean.slice(0, 500) }
      });
    }
    for (const pattern of BUILD_FAIL_PATTERNS) {
      if (pattern.test(clean)) {
        return this.publish({
          type: "build.failed",
          severity: "error",
          workerId,
          runId,
          projectId: metadata.projectId || null,
          workerName: metadata.workerName || null,
          title: "Build or compilation failed",
          description: clean.slice(0, 200).trim(),
          data: { rawSnippet: clean.slice(0, 500) }
        });
      }
    }
    return null;
  }

  query({ type, workerId, projectId, severity, since, limit = 50 } = {}) {
    let list = this.#events;
    if (type) {
      list = list.filter(e => e.type === type);
    }
    if (workerId) {
      list = list.filter(e => e.workerId === workerId);
    }
    if (projectId) {
      list = list.filter(e => e.projectId === projectId);
    }
    if (severity) {
      list = list.filter(e => e.severity === severity);
    }
    if (typeof since === "number") {
      list = list.filter(e => e.timestamp >= since);
    }
    const safeLimit = Math.max(1, Math.min(Number(limit) || 50, this.#maxEntries));
    return list.slice(-safeLimit).map(e => ({ ...e, data: { ...e.data } }));
  }

  clear() {
    this.#events = [];
  }
}

module.exports = { SemanticEventRouter, EVENT_TYPES, BUILD_FAIL_PATTERNS, PORT_CONFLICT_PATTERNS };
