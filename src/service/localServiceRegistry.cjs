"use strict";

// Local Service Registry for OUTARCH.
// Tracks active web services, development servers, database listeners, and API endpoints
// discovered from engine workers. Enforces generation scoping and state tracking.

const { parseServiceEndpoints } = require("../engine/serviceEndpointParser.cjs");

class LocalServiceRegistry {
  /** @type {Map<string, object>} key = serviceId */
  #services = new Map();
  /** @type {Map<string, number>} key = `${projectId}:${workerId}` -> generation counter */
  #generations = new Map();
  /** @type {Set<Function>} listener callbacks */
  #listeners = new Set();

  constructor() {}

  #genKey(projectId, workerId) {
    return `${projectId || "default"}:${workerId || "all"}`;
  }

  getGeneration(projectId, workerId) {
    return this.#generations.get(this.#genKey(projectId, workerId)) || 1;
  }

  bumpGeneration(projectId, workerId) {
    const key = this.#genKey(projectId, workerId);
    const next = (this.#generations.get(key) || 1) + 1;
    this.#generations.set(key, next);

    // Mark previous generation services as stale
    for (const [id, s] of this.#services) {
      if (s.projectId === projectId && s.workerId === workerId && s.generation < next) {
        s.state = "stale";
        s.updatedAt = Date.now();
      }
    }
    this.#notify({ type: "service:generation", projectId, workerId, generation: next });
    return next;
  }

  invalidateWorker(projectId, workerId) {
    let changed = false;
    for (const [id, s] of this.#services) {
      if (s.projectId === projectId && s.workerId === workerId && s.state !== "stale") {
        s.state = "stale";
        s.updatedAt = Date.now();
        changed = true;
      }
    }
    if (changed) {
      this.#notify({ type: "service:invalidated", projectId, workerId });
    }
  }

  processTerminalOutput(projectId, workerId, workerRunId, line, context = {}) {
    if (!line || typeof line !== "string") return [];
    const endpoints = parseServiceEndpoints(line, context);
    if (!endpoints.length) return [];

    const generation = this.getGeneration(projectId, workerId);
    const discovered = [];

    for (const ep of endpoints) {
      const serviceId = `svc_${projectId}_${workerId}_${ep.port}_${ep.path.replace(/[^a-zA-Z0-9]/g, "_")}`;
      const existing = this.#services.get(serviceId);
      const isNewGeneration = !existing || existing.generation < generation || existing.workerRunId !== workerRunId;

      const record = {
        id: serviceId,
        projectId: projectId || "default",
        workerId: workerId || "unknown",
        workerName: context.workerName || workerId || "Terminal",
        workerRunId: workerRunId || "run-1",
        generation,
        protocol: ep.protocol,
        host: ep.host,
        port: ep.port,
        path: ep.path,
        url: ep.url,
        advertised: ep.advertised,
        kind: ep.kind,
        // A worker printing "ready" is a claim about itself. It is recorded as
        // evidence, but the record stays "detected" until something verifies
        // the port actually accepts a connection — only markReady() promotes
        // it. Trusting the claim is how a panel ends up offering to open a
        // dev server that never came up.
        // Within one readiness cycle a dev server re-prints its address on every
        // hot reload. That must not undo a verification already made, or the
        // service would flip back to "detected" and be announced again.
        state: isNewGeneration ? "detected" : (existing?.state || "detected"),
        readyEvidence: isNewGeneration ? undefined : existing?.readyEvidence,
        readyAt: isNewGeneration ? undefined : existing?.readyAt,
        advertisedConfidence: ep.confidence,
        evidence: ep.evidence,
        detectedAt: isNewGeneration ? ep.detectedAt : (existing?.detectedAt || ep.detectedAt),
        updatedAt: Date.now()
      };

      this.#services.set(serviceId, record);
      discovered.push(record);

      if (isNewGeneration || existing?.state !== record.state) {
        this.#notify({
          type: "service:discovered",
          service: record,
          isNew: isNewGeneration
        });
      }
    }

    return discovered;
  }

  recordOutput(workerId, workerRunId, text, context = {}) {
    return this.processTerminalOutput(context.projectId || "default", workerId, workerRunId, text, context);
  }

  listServices(filter = null, workerId = null) {
    let projectId = filter;
    if (filter && typeof filter === "object") {
      projectId = filter.projectId || null;
      workerId = filter.workerId || null;
    }
    const list = Array.from(this.#services.values());
    return list.filter(s => {
      if (projectId && s.projectId !== projectId) return false;
      if (workerId && s.workerId !== workerId) return false;
      return true;
    }).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  getService(serviceId) {
    return this.#services.get(serviceId) || null;
  }

  /**
   * Promote a record to ready once something actually confirmed the port is
   * accepting connections. `evidence` records how it was confirmed, so the UI
   * can say "Listening" rather than implying the worker declared it.
   */
  markReady(serviceId, { evidence = "listening", at = Date.now() } = {}) {
    const service = this.#services.get(serviceId);
    if (!service) return null;
    if (service.state === "ready" && service.readyEvidence === evidence) return service;
    service.state = "ready";
    service.readyEvidence = evidence;
    service.readyAt = at;
    service.updatedAt = at;
    this.#notify({ type: "service:ready", service });
    return service;
  }

  /** Every service currently attributed to one worker, for stop/restart impact. */
  servicesForWorker(projectId, workerId) {
    return Array.from(this.#services.values())
      .filter(service => service.workerId === workerId && (!projectId || service.projectId === projectId));
  }

  clearProject(projectId) {
    for (const [id, s] of this.#services) {
      if (s.projectId === projectId) {
        this.#services.delete(id);
      }
    }
  }

  subscribe(callback) {
    if (typeof callback === "function") {
      this.#listeners.add(callback);
      return () => this.#listeners.delete(callback);
    }
    return () => {};
  }

  #notify(event) {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {}
    }
  }
}

// Global shared singleton
const localServiceRegistry = new LocalServiceRegistry();

module.exports = {
  LocalServiceRegistry,
  localServiceRegistry
};
