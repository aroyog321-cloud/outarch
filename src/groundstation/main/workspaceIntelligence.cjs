"use strict";

// Workspace intelligence wiring.
//
// The service registry, usage ledger, agent classifier and semantic event
// router are all fed from one place: the engine's own output streams. Without
// this module those services exist but observe nothing, so every panel reads
// empty. Keeping the wiring here means main/index.cjs stays a lifecycle file
// and the observation rules stay testable on their own.

const { LocalServiceRegistry } = require("../../service/localServiceRegistry.cjs");
const { UsageLedger } = require("../../service/usageLedger.cjs");
const { AgentActivityService } = require("../../service/agentActivityService.cjs");
const { AgentPromptDetector } = require("../../service/agentPromptDetector.cjs");
const { SemanticEventRouter } = require("../../service/semanticEventRouter.cjs");
const { SessionJournal } = require("../../service/sessionJournal.cjs");
const { SessionRecoveryService } = require("../../service/sessionRecoveryService.cjs");
const { detectRestartSignal } = require("../../engine/serviceEndpointParser.cjs");
const { waitForListening } = require("../../service/serviceReadiness.cjs");

// Output arrives as PTY chunks, not lines. Detection runs on completed lines so
// an address split across two reads is still found, and the carry buffer is
// bounded so a binary blob or a progress bar with no newline cannot grow it.
const MAX_CARRY_BYTES = 8 * 1024;
const MAX_LINES_PER_CHUNK = 200;

class WorkspaceIntelligence {
  #services;
  #usage;
  #agents;
  #events;
  #journal;
  #recovery;
  #engineApi;
  #projectId;
  #unsubscribeEngine;
  /** @type {Map<string, object>} workerId -> { detach, carry, runId, name }  */
  #observed;
  #onChange;
  #reconcileScheduled;
  /** @type {Map<string, object>} serviceId -> in-flight readiness verification */
  #verifying;
  #waitForListening;
  #prompts;

  constructor(options = {}) {
    this.#services = options.services || new LocalServiceRegistry();
    this.#usage = options.usage || new UsageLedger();
    this.#agents = options.agents || new AgentActivityService();
    this.#events = options.events || new SemanticEventRouter();
    this.#journal = options.journal || new SessionJournal();
    this.#recovery = options.recovery || new SessionRecoveryService(this.#journal);
    this.#onChange = typeof options.onChange === "function" ? options.onChange : () => {};
    this.#engineApi = null;
    this.#projectId = "default";
    this.#unsubscribeEngine = null;
    this.#observed = new Map();
    this.#reconcileScheduled = false;
    this.#verifying = new Map();
    this.#waitForListening = options.waitForListening || waitForListening;
    this.#prompts = options.prompts || new AgentPromptDetector();

    // Anything the observers derive is pushed to renderers rather than polled,
    // so a panel updates the moment a dev server prints its address.
    this.#services.subscribe(event => this.#onChange({ type: "services:changed", detail: event.type }));
    this.#usage.subscribe(() => this.#onChange({ type: "usage:changed" }));
    this.#agents.on("change", activity => this.#onChange({ type: "agents:changed", workerId: activity.workerId }));
    this.#events.on("event", event => this.#onChange({ type: "operational:event", event }));
    // An agent asking for permission becomes one semantic event, so it reaches
    // the notification center and the renderers along the path every other
    // operational event takes.
    this.#prompts.on("prompt", prompt => {
      try { this.#agents.setAwaitingApproval(prompt.workerId, prompt); } catch {}
      this.#events.publish({
        type: "agent.awaitingApproval",
        severity: "warning",
        workerId: prompt.workerId,
        workerName: prompt.workerName,
        projectId: this.#projectId,
        runId: prompt.runId,
        title: `${prompt.workerName || prompt.workerId} is asking for your permission`,
        description: prompt.question,
        data: { promptId: prompt.id, question: prompt.question, choices: prompt.choices.join(" · "), agent: prompt.agent }
      });
    });
    this.#prompts.on("cleared", cleared => {
      try { this.#agents.setAwaitingApproval(cleared.workerId, null); } catch {}
      this.#onChange({ type: "agent:prompt-cleared", workerId: cleared.workerId, promptId: cleared.id, reason: cleared.reason });
    });
  }

  get prompts() { return this.#prompts; }

  /** The operator typed into a terminal: a question it was asking is answered. */
  noteInput(workerId) {
    try { return this.#prompts.noteInput(workerId); } catch { return false; }
  }

  get services() { return this.#services; }
  get usage() { return this.#usage; }
  get agents() { return this.#agents; }
  get events() { return this.#events; }
  get journal() { return this.#journal; }
  get recovery() { return this.#recovery; }
  get projectId() { return this.#projectId; }

  /**
   * What the previous session left behind. This MUST be read before
   * beginSession(), because starting a session overwrites the journal with a
   * fresh, deliberately unclean record — read it afterwards and you inspect
   * this run instead of the one that crashed.
   */
  inspectPriorSession(projectId = "default") {
    try {
      return this.#recovery.inspect(projectId, []);
    } catch {
      // An unreadable journal means "we cannot prove anything was running",
      // which resolves to no recovery prompt rather than a false one.
      return { projectId, cleanShutdown: true, recoveryRequired: false, uncleanWorkerCount: 0, workers: [] };
    }
  }

  /** Opens a journal session. Call only after inspectPriorSession(). */
  beginSession(projectId = "default") {
    try { return this.#journal.startSession(projectId, {}); }
    catch { return null; }
  }

  /**
   * Marks this session as ended cleanly. Anything still journalled as running
   * after this point was interrupted, which is what recovery keys on.
   */
  markCleanShutdown() {
    try { this.#journal.markCleanShutdown(this.#projectId); }
    catch { /* a missing marker degrades to "unclean", the safe direction */ }
  }

  attachEngine(engineApi, projectId = "default") {
    this.detachEngine();
    if (!engineApi) return;
    this.#engineApi = engineApi;
    this.#projectId = projectId || "default";
    if (typeof engineApi.subscribe === "function") {
      this.#unsubscribeEngine = engineApi.subscribe(event => {
        // A command typed into a terminal can start an agent CLI (agy, claude,
        // codex…) inside an ordinary shell; it is recognised from the line
        // itself, before the agent has drawn anything.
        if (event?.type === "session:input-evidence") this.#noteCommand(event);
        this.#scheduleReconcile();
      });
    }
    this.#reconcile();
  }

  detachEngine() {
    try { this.#unsubscribeEngine?.(); } catch {}
    this.#unsubscribeEngine = null;
    for (const [workerId, entry] of this.#observed) {
      try { entry.detach?.(); } catch {}
      this.#services.invalidateWorker(this.#projectId, workerId);
    }
    this.#observed.clear();
    this.#engineApi = null;
  }

  // Engine events arrive in bursts (one per output batch, status change and
  // supervision update). Reconciling on a microtask keeps a noisy worker from
  // driving one list() walk per event.
  #scheduleReconcile() {
    if (this.#reconcileScheduled) return;
    this.#reconcileScheduled = true;
    queueMicrotask(() => {
      this.#reconcileScheduled = false;
      try { this.#reconcile(); } catch {}
    });
  }

  #reconcile() {
    const engineApi = this.#engineApi;
    if (!engineApi || typeof engineApi.list !== "function") return;
    const sessions = engineApi.list() || [];
    const live = new Set();

    for (const session of sessions) {
      if (!session?.id) continue;
      live.add(session.id);
      const existing = this.#observed.get(session.id);

      if (session.isAlive) {
        // A run identity that changed means the PTY was replaced: this is a new
        // run, so previously advertised addresses no longer describe it.
        const runId = session.correlationId || `${session.id}:${session.startTime || 0}`;
        if (existing && existing.runId === runId) continue;
        if (existing) this.#stopObserving(session.id, { invalidate: true });
        this.#startObserving(session, runId);
      } else if (existing) {
        this.#stopObserving(session.id, { invalidate: true });
      }
    }

    for (const workerId of Array.from(this.#observed.keys())) {
      if (!live.has(workerId)) this.#stopObserving(workerId, { invalidate: true, forget: true });
    }
  }

  #startObserving(session, runId) {
    const engineApi = this.#engineApi;
    if (!engineApi || typeof engineApi.attachRawStream !== "function") return;
    let stream = null;
    try {
      stream = engineApi.attachRawStream(session.id);
    } catch {
      stream = null;
    }
    if (!stream || typeof stream.onData !== "function") return;

    // The new run supersedes whatever the previous one advertised.
    this.#services.bumpGeneration(this.#projectId, session.id);

    const entry = { runId, carry: "", name: session.name || session.id, detach: null };
    this.#observed.set(session.id, entry);

    try {
      this.#journal.recordConfirmedRun(this.#projectId, session.id, runId, session.pid ?? null);
    } catch {
      // A journal write must never stop the terminal from being observed.
    }

    try {
      // The whole command line: a worker is often a shell running the agent
      // ("powershell.exe -NoExit -Command agy"), not the agent's own executable.
      this.#agents.setProcessState(session.id, runId, {
        command: [session.command, ...(Array.isArray(session.args) ? session.args : [])].filter(Boolean).join(" "),
        processName: session.command || ""
      });
    } catch {}

    try {
      entry.detach = stream.onData((chunk, metadata) => this.#consume(session.id, entry, chunk, metadata));
    } catch {
      this.#observed.delete(session.id);
    }
  }

  #noteCommand(event) {
    const workerId = event?.id;
    if (!workerId || event.kind !== "command" || typeof event.preview !== "string") return;
    try { this.#agents.noteCommand(workerId, this.#observed.get(workerId)?.runId || null, event.preview); } catch {}
  }

  #stopObserving(workerId, { invalidate = false, forget = false, exitCode = null } = {}) {
    const entry = this.#observed.get(workerId);
    if (!entry) return;
    try { entry.detach?.(); } catch {}
    this.#observed.delete(workerId);
    try {
      this.#journal.recordRunExited(this.#projectId, workerId, exitCode);
    } catch {
      // Best effort: a missing exit record degrades to "interrupted", which is
      // the safe direction for recovery to guess.
    }
    if (invalidate) this.#services.invalidateWorker(this.#projectId, workerId);
    // A process that ended is no longer asking anything.
    try { this.#prompts.forget(workerId); } catch {}
    if (forget) {
      try { this.#agents.clearWorker(workerId); } catch {}
    }
  }

  #consume(workerId, entry, chunk, metadata = null) {
    if (typeof chunk !== "string" || !chunk) return;
    // A resize makes the terminal repaint its screen. The engine has already
    // separated the rows that were on screen from any that are new; reading the
    // repaint itself would announce a crash, a port conflict or a failed build
    // that happened minutes ago, again.
    if (metadata?.redraw === true) {
      entry.carry = "";
      chunk = typeof metadata.analysisText === "string" ? metadata.analysisText : "";
      if (!chunk) return;
    }
    // A permission prompt is read from the screen as it is drawn, before the
    // text is split into lines: agents draw their dialogs without a final newline.
    try {
      const activity = this.#agents.getWorkerActivity(workerId);
      this.#prompts.observe(workerId, chunk, { isAgent: activity?.isAgent === true, agentType: activity?.agentType || null, workerName: entry.name, runId: entry.runId });
    } catch {}
    // The engine recognised an error the operator has already acknowledged.
    // Addresses and agent activity in it are still read; it is not a new event.
    const acknowledged = metadata?.acknowledged === true;
    const text = entry.carry + chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    const parts = text.split("\n");
    entry.carry = parts.pop() || "";

    // A line that never terminates is truncated rather than buffered forever.
    if (entry.carry.length > MAX_CARRY_BYTES) {
      parts.push(entry.carry.slice(0, MAX_CARRY_BYTES));
      entry.carry = "";
    }

    const context = {
      projectId: this.#projectId,
      workerName: entry.name,
      command: entry.name
    };

    for (const line of parts.slice(-MAX_LINES_PER_CHUNK)) {
      if (!line.trim()) continue;

      // An in-terminal restart keeps the worker run but starts a new readiness
      // cycle, so the address it re-advertises is news again rather than a
      // duplicate of what was already reported.
      try {
        if (detectRestartSignal(line)) this.#services.bumpGeneration(this.#projectId, workerId);
      } catch {}

      try {
        const discovered = this.#services.processTerminalOutput(this.#projectId, workerId, entry.runId, line, context);
        for (const service of discovered) this.#verifyReadiness(service);
      } catch {}
      try {
        this.#agents.recordOutput(workerId, entry.runId, line, context);
      } catch {}
      if (!acknowledged) {
        try {
          this.#events.inspectOutput(workerId, entry.runId, line, context);
        } catch {}
      }
    }
  }

  /**
   * A printed address is a claim. Before anything is called ready — and before
   * a notification offers to open it — the port has to actually accept a
   * connection. Each service/generation is verified once.
   */
  #verifyReadiness(service) {
    if (!service || !service.port) return;
    const key = `${service.id}:${service.generation}`;
    if (this.#verifying.has(key)) return;

    const entry = this.#observed.get(service.workerId);
    const runId = entry?.runId;
    const token = { cancelled: false };
    this.#verifying.set(key, token);

    const cancelled = () => token.cancelled
      || this.#observed.get(service.workerId)?.runId !== runId
      || this.#services.getService(service.id)?.generation !== service.generation;

    Promise.resolve(this.#waitForListening({
      host: service.host === "localhost" ? "127.0.0.1" : service.host,
      hosts: service.host === "localhost" ? ["127.0.0.1", "::1"] : [service.host],
      port: service.port,
      isCancelled: cancelled
    })).then(result => {
      this.#verifying.delete(key);
      if (!result?.listening || cancelled()) return;

      const current = this.#services.getService(service.id);
      if (!current || current.generation !== service.generation) return;
      const alreadyReady = current.state === "ready";
      this.#services.markReady(service.id, { evidence: "listening" });
      this.#onChange({ type: "services:changed", detail: "service:ready" });
      if (alreadyReady) return;

      // The event carries the worker's own name because that is what the person
      // recognises — "Storefront is ready", not "svc_proj_worker_5173_".
      this.#events.publish({
        type: "service.ready",
        severity: "info",
        workerId: service.workerId,
        workerName: service.workerName,
        projectId: service.projectId,
        runId: service.workerRunId,
        title: `${service.workerName} is ready`,
        description: `${service.url} is accepting connections.`,
        data: {
          serviceId: service.id,
          url: service.url,
          port: service.port,
          generation: service.generation,
          kind: service.kind
        }
      });
    }).catch(() => {
      this.#verifying.delete(key);
    });
  }

  dispose() {
    this.detachEngine();
  }
}

module.exports = { WorkspaceIntelligence, MAX_CARRY_BYTES };
