const EventEmitter = require("node:events");
const { SessionEngine } = require("./sessionEngine.cjs");
const {
  normalizeSavedCommandDefinition,
  normalizeSessionDefinition,
  openWorkspace
} = require("./workspaceConfig.cjs");
const { openActivityStore } = require("./activityStore.cjs");
const {
  ResourceSampler,
  normalizeResourceSampleInterval,
  workerHealth
} = require("./resourceSampler.cjs");
const { buildProjectMemory } = require("./projectMemory.cjs");
const {
  RECIPE_LIMIT,
  cloneRun,
  RECIPE_RUN_HISTORY_LIMIT,
  normalizeRecipe
} = require("./workspaceRecipes.cjs");
const {
  applyMissionEvent,
  expireMissionApprovals,
  lifecycleEntry,
  normalizeMission,
  progressFor,
  requestMissionApproval,
  setPhase
} = require("./missionSupervision.cjs");
const {
  AUDIT_LIMIT,
  AUTOMATION_LIMIT,
  auditRecord,
  createApproval,
  eventMatches,
  expireApprovals,
  normalizeAutomation
} = require("./automationWorkflows.cjs");

const ENGINE_CONTRACT_VERSION = 1;
const MAX_ACTIVITY_EVENTS = 200;
const ACTIVITY_PERSIST_DELAY_MS = 50;
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

const ENGINE_EVENTS = Object.freeze([
  "session:created",
  "session:output",
  "session:status",
  "session:exit",
  "session:spawn-error",
  "session:supervision",
  "session:evidence",
  "session:input-evidence",
  "session:renamed",
  "session:autostart",
  "session:reconfigured",
  "session:removed"
]);

class EngineAPI extends EventEmitter {
  #sessionEngine;
  #workspaceStore;
  #activityStore;
  #openWorkspace;
  #openActivityStore;
  #sessionOperations;
  #stopping;
  #stopPromise;
  #projectLoaded;
  #loadErrors;
  #savedCommands;
  #savedCommandErrors;
  #engineBindings;
  #eventSequence;
  #activityEvents;
  #activityLimit;
  #activityDroppedThrough;
  #publicationQueue;
  #publishing;
  #onSubscriberError;
  #activityPersistTimer;
  #activityPersistDelayMs;
  #activityDirty;
  #reportingActivityPersistError;
  #lastActivityPersistError;
  #recipes;
  #recipeRuns;
  #recipeRunHistory;
  #missions;
  #attentionRecords;
  #attentionPreferences;
  #resourceSampler;
  #resourceSampleIntervalMs;
  #resourceSampleTimer;
  #automations;
  #automationApprovals;
  #automationAudit;

  constructor(options = {}) {
    super();
    this.#sessionEngine = new SessionEngine(options);
    this.#workspaceStore = null;
    this.#activityStore = null;
    this.#openWorkspace = options.openWorkspace || openWorkspace;
    this.#openActivityStore = options.openActivityStore || openActivityStore;
    this.#sessionOperations = new Map();
    this.#stopping = false;
    this.#stopPromise = null;
    this.#projectLoaded = false;
    this.#loadErrors = [];
    this.#savedCommands = new Map();
    this.#savedCommandErrors = [];
    this.#engineBindings = [];
    this.#eventSequence = 0;
    this.#activityEvents = [];
    this.#activityLimit = Number.isInteger(options.maxActivityEvents) && options.maxActivityEvents > 0
      ? options.maxActivityEvents
      : MAX_ACTIVITY_EVENTS;
    this.#activityDroppedThrough = 0;
    this.#publicationQueue = [];
    this.#publishing = false;
    this.#onSubscriberError = typeof options.onSubscriberError === "function"
      ? options.onSubscriberError
      : () => {};
    this.#activityPersistTimer = null;
    this.#activityPersistDelayMs = Number.isInteger(options.activityPersistDelayMs) && options.activityPersistDelayMs >= 0
      ? options.activityPersistDelayMs
      : ACTIVITY_PERSIST_DELAY_MS;
    this.#activityDirty = false;
    this.#reportingActivityPersistError = false;
    this.#lastActivityPersistError = null;
    this.#recipes = new Map();
    this.#recipeRuns = new Map();
    this.#recipeRunHistory = new Map();
    this.#missions = new Map();
    this.#attentionRecords = new Map();
    this.#attentionPreferences = { minimumSeverity: "info", desktopNotifications: true, sound: true, quietHours: { enabled: false, start: "22:00", end: "07:00" } };
    this.#resourceSampler = options.resourceSampler || new ResourceSampler({
      probe: options.resourceProbe,
      now: options.now,
      totalMemoryBytes: options.totalMemoryBytes
    });
    this.#resourceSampleIntervalMs = normalizeResourceSampleInterval(options.resourceSampleIntervalMs);
    this.#resourceSampleTimer = null;
    this.#automations = new Map();
    this.#automationApprovals = [];
    this.#automationAudit = [];

    for (const type of ENGINE_EVENTS) {
      const listener = payload => {
        this.#publish(type, payload);
        const evidence = type === "session:evidence" ? this.#captureMissionEvidence(payload) : null;
        this.#updateMissionSupervision(type, evidence ? { ...payload, recordId: evidence.id } : payload);
        this.#considerAutomations(type, payload);
      };
      this.#sessionEngine.on(type, listener);
      this.#engineBindings.push([type, listener]);
    }

    if (this.#resourceSampleIntervalMs > 0) {
      this.#resourceSampleTimer = setInterval(() => {
        void this.sampleWorkerResources();
      }, this.#resourceSampleIntervalMs);
      this.#resourceSampleTimer.unref?.();
    }
  }

  loadProject(configOrPath) {
    if (this.#stopping) throw new Error("the engine is stopping");
    if (this.#projectLoaded || this.#sessionEngine.list().length > 0) {
      throw new Error("a workspace is already loaded; create a new EngineAPI to load another workspace");
    }
    let config = configOrPath;
    let baseDir = process.cwd();
    if (typeof configOrPath === "string") {
      this.#workspaceStore = this.#openWorkspace(configOrPath);
      this.#activityStore = this.#openActivityStore(this.#workspaceStore.filePath);
      try {
        const restored = this.#activityStore.load({
          contractVersion: ENGINE_CONTRACT_VERSION,
          maxEvents: this.#activityLimit
        });
        this.#eventSequence = restored.latestSequence;
        this.#activityEvents = restored.events;
        this.#activityDroppedThrough = restored.droppedThroughSequence;
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.#publish("activity:load-error", { error });
      }
      config = {
        sessions: this.#workspaceStore.definitions(),
        commands: this.#workspaceStore.commandDefinitions()
      };
      baseDir = this.#workspaceStore.directory;
    }
    const sessionDefinitions = config?.sessions === undefined ? [] : config.sessions;
    const commandDefinitions = config?.commands === undefined ? [] : config.commands;
    if (!Array.isArray(sessionDefinitions)) throw new Error("workspace sessions must be an array");
    if (!Array.isArray(commandDefinitions)) throw new Error("workspace commands must be an array");
    this.#projectLoaded = true;

    const knownWorkers = new Set(sessionDefinitions.map(item => item?.id).filter(Boolean));
    for (const mission of this.#workspaceStore?.missionDefinitions?.() || []) {
      if (!mission?.id || !mission?.agentId || !mission?.title) continue;
      try {
        const normalized = normalizeMission(mission, { previous: mission, knownWorkers, now: mission.updatedAt || Date.now() });
        this.#missions.set(normalized.id, normalized);
      } catch { /* Invalid historical missions do not block the project. */ }
    }
    for (const record of this.#workspaceStore?.attentionDefinitions?.() || []) {
      if (record?.id && record?.sessionId) this.#attentionRecords.set(record.id, record);
    }
    this.#attentionPreferences = { ...this.#attentionPreferences, ...(this.#workspaceStore?.attentionPreferences?.() || {}) };

    for (const value of this.#workspaceStore?.automationDefinitions?.() || []) {
      try {
        const automation = normalizeAutomation(value, { previous: value, now: value.updatedAt || Date.now() });
        this.#automations.set(automation.id, automation);
      } catch (error) {
        this.#publish("automation:load-error", { id: value?.id || null, error: error.message });
      }
    }
    this.#automationApprovals = this.#workspaceStore?.automationApprovalDefinitions?.() || [];
    this.#automationAudit = (this.#workspaceStore?.automationAuditDefinitions?.() || []).slice(-AUDIT_LIMIT);

    const recipeIds = new Set();
    for (const recipe of this.#workspaceStore?.recipeDefinitions?.() || []) {
      try {
        const normalized = normalizeRecipe(recipe, new Set(sessionDefinitions.map(item => item?.id).filter(Boolean)));
        if (recipeIds.has(normalized.id)) throw new Error(`recipe id already in use: ${normalized.id}`);
        recipeIds.add(normalized.id);
        this.#recipes.set(normalized.id, normalized);
      } catch (error) {
        this.#publish("project:recipe-error", { id: recipe?.id || null, error: error.message });
      }
    }

    const commandErrors = [];
    for (const def of commandDefinitions) {
      try {
        const normalized = normalizeSavedCommandDefinition(def, { baseDir });
        if (this.#savedCommands.has(normalized.runtime.id)) {
          throw new Error(`saved command id already in use: ${normalized.runtime.id}`);
        }
        this.#savedCommands.set(normalized.runtime.id, normalized);
      } catch (err) {
        commandErrors.push({
          id: def?.id || null,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    this.#savedCommandErrors = commandErrors.map(error => ({ ...error }));
    if (commandErrors.length) {
      this.#publish(
        "project:command-errors",
        { errors: commandErrors.map(error => ({ ...error })) },
        commandErrors.map(error => ({ ...error }))
      );
    }

    const errors = [];
    for (const def of sessionDefinitions) {
      try {
        const { runtime } = normalizeSessionDefinition(def, { baseDir });
        this.#sessionEngine.create(runtime);
      } catch (err) {
        errors.push({
          id: def?.id || null,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }

    this.#loadErrors = errors;
    if (errors.length) {
      this.#publish(
        "project:load-errors",
        { errors: errors.map(error => ({ ...error })) },
        errors
      );
    }
    return errors;
  }

  getWorkspace() {
    if (this.#workspaceStore) {
      return {
        ...this.#workspaceStore.info(),
        loadErrorCount: this.#loadErrors.length + this.#savedCommandErrors.length,
        sessionLoadErrorCount: this.#loadErrors.length,
        savedCommandCount: this.#savedCommands.size,
        savedCommandErrorCount: this.#savedCommandErrors.length,
        activityPersistent: Boolean(this.#activityStore)
      };
    }
    return {
      version: 1,
      name: "Unsaved workspace",
      path: null,
      directory: process.cwd(),
      persistent: false,
      activityPersistent: false,
      loadErrorCount: this.#loadErrors.length + this.#savedCommandErrors.length,
      sessionLoadErrorCount: this.#loadErrors.length,
      savedCommandCount: this.#savedCommands.size,
      savedCommandErrorCount: this.#savedCommandErrors.length
    };
  }

  // T182 — the renderer no longer reads this; `IntegrationHubView` queries each
  // service directly. The real caller is the advertised `integration.list`
  // protocol method, which external Protocol v1 clients may call, so this stays
  // as the engine-owned inventory rather than being retired with the legacy view.
  listIntegrations() {
    const workspace = this.getWorkspace();
    return [
      { id: "vscode", name: "VS Code Bridge", status: "available", capability: "Synchronize active file, diagnostics, Git, tasks, and editor terminal identities", permission: "Authenticated loopback; project-relative editor commands only", projectRequired: true, enabled: false },
      { id: "mission-ai", name: "Built-in Mission AI", status: "available", capability: "Answer project questions from bounded Mission Context", permission: "Observe-only; OS-encrypted Gemini key; stateless remote requests", projectRequired: true, enabled: false },
      { id: "assistant", name: "Secure MCP Gateway", status: "available", capability: "Expose bounded Mission Context and approval-gated operations through authenticated local MCP", permission: "OS-encrypted bearer token; explicit scopes; every mutation requires local approval", projectRequired: true, enabled: false },
      { id: "plugins", name: "Permissioned Plugins", status: "available", capability: "Install declarative manifests for bounded context, health, and approval-gated actions", permission: "No executable plugin code, filesystem, process, network, terminal, or secret authority", projectRequired: false, enabled: false },
      { id: "mobile", name: "Mobile Companion", status: "available", capability: "Review bounded project health and request approval-gated actions from a paired device", permission: "Proof-based pairing, encrypted payloads, replay protection, revocable device scopes", projectRequired: true, enabled: false }
    ].map(item => ({ ...item, blockedReason: item.projectRequired && !workspace.persistent ? "Open a project folder first" : null }));
  }

  listRecipes() {
    return [...this.#recipes.values()].map(recipe => ({ ...recipe, steps: recipe.steps.map(step => ({ ...step, dependsOn: [...step.dependsOn] })), run: cloneRun(this.#recipeRuns.get(recipe.id)), runHistory: this.listRecipeRunHistory(recipe.id) }));
  }

  #dependencyImpact(sessionId) {
    const recipeIds = [];
    const upstream = new Set();
    const directDependents = new Set();
    const downstream = new Set();
    for (const recipe of this.#recipes.values()) {
      const steps = Array.isArray(recipe.steps) ? recipe.steps : [];
      const selected = steps.find(step => step.workerId === sessionId);
      if (!selected) continue;
      recipeIds.push(recipe.id);
      for (const id of selected.dependsOn || []) upstream.add(id);
      const queue = [sessionId];
      const visited = new Set([sessionId]);
      while (queue.length) {
        const current = queue.shift();
        for (const step of steps) {
          if (!(step.dependsOn || []).includes(current) || visited.has(step.workerId)) continue;
          visited.add(step.workerId);
          downstream.add(step.workerId);
          if (current === sessionId) directDependents.add(step.workerId);
          queue.push(step.workerId);
        }
      }
    }
    const downstreamCount = downstream.size;
    return {
      recipeCount: recipeIds.length,
      recipeIds: recipeIds.slice(0, RECIPE_LIMIT),
      upstreamIds: [...upstream].slice(0, 50),
      directDependentIds: [...directDependents].slice(0, 50),
      downstreamIds: [...downstream].slice(0, 50),
      upstreamCount: upstream.size,
      directDependentCount: directDependents.size,
      downstreamCount,
      level: downstreamCount >= 4 ? "high" : downstreamCount > 0 ? "connected" : recipeIds.length ? "contained" : "independent"
    };
  }

  #decorateSession(session) {
    if (!session) return null;
    const resources = session.isAlive ? this.#resourceSampler.get(session.id) : null;
    return {
      ...session,
      resources,
      health: workerHealth(session, resources, { totalMemoryBytes: this.#resourceSampler.totalMemoryBytes }),
      dependencyImpact: this.#dependencyImpact(session.id)
    };
  }

  async sampleWorkerResources() {
    if (this.#stopping) return { sampledAt: Date.now(), workerCount: 0, availableCount: 0, stopped: true };
    const result = await this.#resourceSampler.sample(this.#sessionEngine.list());
    if (result.workerCount > 0 && !this.#stopping) {
      this.#publish(
        "worker:metrics",
        { workerCount: result.workerCount, availableCount: result.availableCount, sampledAt: result.sampledAt },
        { workerCount: result.workerCount, availableCount: result.availableCount, sampledAt: result.sampledAt },
        { persist: false, activity: false }
      );
    }
    return { ...result };
  }

  listMissions() {
    this.#expireMissionApprovals();
    return [...this.#missions.values()].map(mission => JSON.parse(JSON.stringify(mission)));
  }

  listMissionApprovals() {
    this.#expireMissionApprovals();
    return [...this.#missions.values()]
      .flatMap(mission => (mission.approvals || []).map(approval => ({ ...JSON.parse(JSON.stringify(approval)), missionTitle: mission.title })))
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  listAttention() {
    const now = Date.now();
    const activeSessionIds = new Set();
    for (const session of this.#sessionEngine.list()) {
      const snapshot = this.getSnapshot(session.id);
      if (!snapshot || (!snapshot.attentionRequired && snapshot.status !== "failed")) continue;
      activeSessionIds.add(snapshot.id);
      let record = [...this.#attentionRecords.values()].find(item => item.sessionId === snapshot.id && item.state !== "recovered");
      if (!record) {
        const reason = snapshot.attentionReason || (snapshot.status === "failed" ? "Worker failed" : "Operator decision required");
        const groupKey = `${snapshot.status === "failed" ? "failure" : snapshot.id.startsWith("agent-") ? "agent" : "attention"}:${String(reason).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").slice(0, 4).join("-")}`;
        record = { id: `attention-${snapshot.id}-${now}`, sessionId: snapshot.id, sessionName: snapshot.name, state: "new", severity: snapshot.status === "failed" ? "critical" : snapshot.id.startsWith("agent-") ? "warning" : "info", groupKey, reason, createdAt: snapshot.attentionSince || now, updatedAt: now, snoozedUntil: null, history: [{ state: "new", at: now }] };
        this.#attentionRecords.set(record.id, record);
        try { this.#workspaceStore?.upsertAttention(record); } catch { /* Live attention remains available if persistence fails. */ }
      }
    }
    for (const record of this.#attentionRecords.values()) {
      if (record.state !== "recovered" && !activeSessionIds.has(record.sessionId)) {
        record.state = "recovered"; record.updatedAt = now; record.recoveredAt = now;
        record.history = [...(record.history || []), { state: "recovered", at: now }].slice(-20);
        try { this.#workspaceStore?.upsertAttention(record); } catch { /* Best effort persistence. */ }
      }
    }
    return { records: [...this.#attentionRecords.values()].sort((a, b) => b.updatedAt - a.updatedAt).map(item => JSON.parse(JSON.stringify(item))), preferences: JSON.parse(JSON.stringify(this.#attentionPreferences)) };
  }

  transitionAttention(id, state, options = {}) {
    if (!this.#workspaceStore) return { ok: false, error: "attention lifecycle requires a persistent project workspace" };
    const record = this.#attentionRecords.get(String(id));
    if (!record) return { ok: false, error: "attention record not found" };
    if (!["new", "seen", "acting", "verifying", "recovered"].includes(state)) return { ok: false, error: "attention state is invalid" };
    const snapshot = this.getSnapshot(record.sessionId);
    if (state === "recovered" && (snapshot?.attentionRequired || snapshot?.status === "failed")) return { ok: false, error: "engine has not verified recovery" };
    record.state = state; record.updatedAt = Date.now();
    record.snoozedUntil = Number(options.snoozedUntil) > Date.now() ? Number(options.snoozedUntil) : null;
    record.history = [...(record.history || []), { state, at: record.updatedAt }].slice(-20);
    try { this.#workspaceStore.upsertAttention(record); } catch (error) { return { ok: false, error: error.message }; }
    this.#publish("attention:lifecycle", { attentionId: record.id, sessionId: record.sessionId, state });
    return { ok: true, record: JSON.parse(JSON.stringify(record)) };
  }

  // How notifications should behave, without materialising attention records —
  // the notification center reads this for every notice it delivers.
  getAttentionPreferences() {
    return JSON.parse(JSON.stringify(this.#attentionPreferences));
  }

  saveAttentionPreferences(value) {
    if (!this.#workspaceStore) return { ok: false, error: "attention preferences require a persistent project workspace" };
    const minimumSeverity = ["info", "warning", "critical"].includes(value?.minimumSeverity) ? value.minimumSeverity : "info";
    const time = input => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(input || "")) ? String(input) : null;
    const quietHours = { enabled: value?.quietHours?.enabled === true, start: time(value?.quietHours?.start) || "22:00", end: time(value?.quietHours?.end) || "07:00" };
    this.#attentionPreferences = { minimumSeverity, desktopNotifications: value?.desktopNotifications !== false, sound: value?.sound !== false, quietHours };
    try { this.#workspaceStore.setAttentionPreferences(this.#attentionPreferences); } catch (error) { return { ok: false, error: error.message }; }
    this.#publish("attention:preferences", this.#attentionPreferences);
    return { ok: true, preferences: JSON.parse(JSON.stringify(this.#attentionPreferences)) };
  }

  saveMission(value) {
    if (!this.#workspaceStore) return { ok: false, error: "durable missions require a persistent project workspace" };
    const agentId = String(value?.agentId || "");
    const title = String(value?.title || "").trim();
    if (!agentId.startsWith("agent-") || !this.getSnapshot(agentId)) return { ok: false, error: "mission agent is invalid" };
    if (!title || title.length > 240) return { ok: false, error: "mission title is invalid" };
    const existing = [...this.#missions.values()].find(mission => mission.agentId === agentId && mission.status === "active");
    const mission = normalizeMission({ ...value, agentId, title }, {
      previous: existing,
      knownWorkers: new Set(this.#sessionEngine.list().map(session => session.id)),
      now: Date.now()
    });
    try { this.#workspaceStore.upsertMission(mission); } catch (error) { return { ok: false, error: error.message }; }
    this.#missions.set(mission.id, mission);
    this.#publish("mission:saved", { missionId: mission.id, agentId, status: mission.status, phase: mission.phase, scopes: mission.scopes, checkpointCount: mission.checkpoints.length });
    return { ok: true, mission: JSON.parse(JSON.stringify(mission)) };
  }

  #saveAutomationState() {
    if (!this.#workspaceStore) return { ok: false, error: "automation workflows require a persistent project workspace" };
    try {
      this.#workspaceStore.setAutomationState({
        automations: [...this.#automations.values()],
        approvals: this.#automationApprovals,
        audit: this.#automationAudit
      });
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  }

  #appendAutomationAudit(record) {
    this.#automationAudit = [...this.#automationAudit.slice(-(AUDIT_LIMIT - 1)), record];
  }

  #expireAutomationApprovals() {
    const expired = expireApprovals(this.#automationApprovals, Date.now());
    if (!expired.changed) return;
    this.#automationApprovals = expired.approvals;
    for (const item of expired.approvals.filter(value => value.state === "expired" && !this.#automationAudit.some(record => record.approvalId === value.id && record.kind === "approval-expired"))) {
      this.#appendAutomationAudit(auditRecord("approval-expired", { automationId: item.automationId, approvalId: item.id }));
    }
    this.#saveAutomationState();
  }

  #considerAutomations(type, payload = {}) {
    if (!this.#workspaceStore || type.startsWith("automation:")) return;
    const now = Date.now();
    let changed = false;
    for (const automation of this.#automations.values()) {
      if (!automation.enabled || !eventMatches(automation, type, payload)) continue;
      if (automation.lastMatchedAt && now - automation.lastMatchedAt < automation.cooldownMs) continue;
      if (this.#automationApprovals.some(item => item.automationId === automation.id && item.state === "pending")) continue;
      automation.lastMatchedAt = now;
      automation.updatedAt = now;
      const approval = createApproval(automation, { type, ...payload }, now);
      this.#automationApprovals.push(approval);
      this.#appendAutomationAudit(auditRecord("trigger-matched", { automationId: automation.id, approvalId: approval.id, sourceType: type, outcome: "waiting-for-approval" }, now));
      this.#publish("automation:approval", { automationId: automation.id, approvalId: approval.id, outcome: "requested", actionType: automation.action.type });
      changed = true;
    }
    if (changed) this.#saveAutomationState();
  }

  listAutomations() {
    this.#expireAutomationApprovals();
    return {
      definitions: [...this.#automations.values()].map(item => JSON.parse(JSON.stringify(item))),
      approvals: this.#automationApprovals.slice().sort((a, b) => b.createdAt - a.createdAt).map(item => JSON.parse(JSON.stringify(item))),
      audit: this.#automationAudit.slice(-50).reverse().map(item => JSON.parse(JSON.stringify(item)))
    };
  }

  saveAutomation(value) {
    if (!this.#workspaceStore) return { ok: false, error: "automation workflows require a persistent project workspace" };
    const previous = value?.id ? this.#automations.get(String(value.id)) : null;
    let automation;
    try { automation = normalizeAutomation(value, { previous }); }
    catch (error) { return { ok: false, error: error.message }; }
    if (!previous && this.#automations.size >= AUTOMATION_LIMIT) return { ok: false, error: `automation workflow limit is ${AUTOMATION_LIMIT}` };
    if (["run-recipe"].includes(automation.action.type) && !this.#recipes.has(automation.action.targetId)) return { ok: false, error: "automation recipe target was not found" };
    if (!["run-recipe"].includes(automation.action.type) && !this.getSnapshot(automation.action.targetId)) return { ok: false, error: "automation worker target was not found" };
    const priorAudit = this.#automationAudit;
    this.#automations.set(automation.id, automation);
    this.#appendAutomationAudit(auditRecord("workflow-saved", { automationId: automation.id, enabled: automation.enabled }));
    const persisted = this.#saveAutomationState();
    if (!persisted.ok) {
      if (previous) this.#automations.set(previous.id, previous);
      else this.#automations.delete(automation.id);
      this.#automationAudit = priorAudit;
      return persisted;
    }
    this.#publish("automation:saved", { automationId: automation.id, enabled: automation.enabled });
    return { ok: true, automation: JSON.parse(JSON.stringify(automation)) };
  }

  deleteAutomation(id) {
    if (!this.#workspaceStore) return { ok: false, error: "automation workflows require a persistent project workspace" };
    if (!this.#automations.has(String(id))) return { ok: false, error: "automation workflow was not found" };
    const previous = this.#automations.get(String(id));
    const priorApprovals = this.#automationApprovals;
    const priorAudit = this.#automationAudit;
    this.#automations.delete(String(id));
    this.#automationApprovals = this.#automationApprovals.filter(item => item.automationId !== String(id) || item.state !== "pending");
    this.#appendAutomationAudit(auditRecord("workflow-deleted", { automationId: String(id) }));
    const persisted = this.#saveAutomationState();
    if (!persisted.ok) {
      this.#automations.set(previous.id, previous);
      this.#automationApprovals = priorApprovals;
      this.#automationAudit = priorAudit;
      return persisted;
    }
    this.#publish("automation:deleted", { automationId: String(id) });
    return { ok: true };
  }

  testAutomation(id) {
    const automation = this.#automations.get(String(id));
    if (!automation) return { ok: false, error: "automation workflow was not found" };
    const result = { matched: true, approvalRequired: true, action: { ...automation.action }, executed: false };
    this.#appendAutomationAudit(auditRecord("dry-run", { automationId: automation.id, outcome: "matched-no-execution" }));
    const persisted = this.#saveAutomationState();
    if (!persisted.ok) return persisted;
    this.#publish("automation:dry-run", { automationId: automation.id, actionType: automation.action.type });
    return { ok: true, result };
  }

  async resolveAutomationApproval(approvalId, decision) {
    this.#expireAutomationApprovals();
    const approval = this.#automationApprovals.find(item => item.id === String(approvalId));
    if (!approval) return { ok: false, error: "automation approval was not found" };
    if (approval.state !== "pending") return { ok: false, error: `automation approval is already ${approval.state}` };
    if (!["approve", "deny"].includes(decision)) return { ok: false, error: "automation decision is invalid" };
    const now = Date.now();
    approval.state = decision === "approve" ? "executing" : "denied";
    approval.resolvedAt = now;
    if (decision === "deny") {
      this.#appendAutomationAudit(auditRecord("approval-denied", { automationId: approval.automationId, approvalId: approval.id, outcome: "no-execution" }, now));
      this.#saveAutomationState();
      this.#publish("automation:approval", { automationId: approval.automationId, approvalId: approval.id, outcome: "denied" });
      return { ok: true, approval: JSON.parse(JSON.stringify(approval)) };
    }
    let result;
    if (approval.action.type === "start-worker") result = await this.start(approval.action.targetId);
    else if (approval.action.type === "restart-worker") result = await this.restart(approval.action.targetId);
    else if (approval.action.type === "acknowledge-worker") result = this.acknowledge(approval.action.targetId);
    else result = this.runRecipe(approval.action.targetId);
    approval.state = result?.ok ? "executed" : "failed";
    approval.execution = { ok: result?.ok === true, error: result?.ok ? null : result?.error || "automation action failed" };
    this.#appendAutomationAudit(auditRecord("approval-resolved", { automationId: approval.automationId, approvalId: approval.id, outcome: approval.state, actionType: approval.action.type }, Date.now()));
    this.#saveAutomationState();
    this.#publish("automation:approval", { automationId: approval.automationId, approvalId: approval.id, outcome: approval.state, actionType: approval.action.type });
    return result?.ok ? { ok: true, approval: JSON.parse(JSON.stringify(approval)) } : { ok: false, error: approval.execution.error };
  }

  #captureMissionEvidence(payload) {
    const mission = [...this.#missions.values()].find(item => item.agentId === payload.id && item.status === "active");
    if (!mission || !payload.evidence) return null;
    const category = payload.category;
    const type = category === "git" ? "diff" : category === "tests" ? "test" : category === "build" ? "result" : category;
    const facts = JSON.parse(JSON.stringify(payload.evidence));
    // Mission history keeps proof that work changed without retaining project file names.
    // The live session snapshot remains the source for operator-facing file details.
    if (category === "git") delete facts.changedFiles;
    const record = { id: `${mission.id}:${Date.now()}:${category}`, type, category, at: Date.now(), facts };
    if (category === "git") record.file = { changedPaths: payload.evidence.changedPaths || 0, branch: payload.evidence.branch || null };
    mission.evidence = [...mission.evidence.slice(-99), record];
    mission.updatedAt = Date.now();
    try { this.#workspaceStore?.upsertMission(mission); } catch { return; }
    this.#publish("mission:evidence", { missionId: mission.id, agentId: mission.agentId, evidenceType: type, category });
    return record;
  }

  #updateMissionSupervision(type, payload) {
    if (!String(payload?.id || "").startsWith("agent-")) return;
    const mission = [...this.#missions.values()].find(item => item.agentId === payload.id && item.status === "active");
    if (!mission) return;
    const updated = applyMissionEvent(mission, type, payload, this.getSnapshot(payload.id), Date.now());
    if (!updated.changed) return;
    try { this.#workspaceStore?.upsertMission(updated.mission); } catch { return; }
    this.#missions.set(updated.mission.id, updated.mission);
    this.#publish("mission:supervision", {
      missionId: updated.mission.id,
      agentId: updated.mission.agentId,
      phase: updated.mission.phase,
      currentAction: updated.mission.currentAction,
      progress: updated.mission.progress
    });
  }

  #expireMissionApprovals() {
    for (const mission of this.#missions.values()) {
      const expired = expireMissionApprovals(mission, Date.now());
      if (!expired.changed) continue;
      try { this.#workspaceStore?.upsertMission(expired.mission); } catch { continue; }
      this.#missions.set(expired.mission.id, expired.mission);
      this.#publish("mission:approval", { missionId: mission.id, agentId: mission.agentId, outcome: "expired" });
    }
  }

  requestMissionApproval(agentId, value = {}) {
    if (!this.#workspaceStore) return { ok: false, error: "mission approvals require a persistent project workspace" };
    const mission = [...this.#missions.values()].find(item => item.agentId === agentId && item.status === "active");
    if (!mission) return { ok: false, error: "agent has no active mission" };
    const requestedScopes = [...new Set((Array.isArray(value.scopes) ? value.scopes : []).filter(scope => !mission.scopes.includes(scope)))];
    if (!requestedScopes.length) return { ok: false, error: "requested mission authority is already granted or invalid" };
    if ((mission.approvals || []).some(item => item.state === "pending" && requestedScopes.every(scope => item.requestedScopes.includes(scope)))) {
      return { ok: false, error: "a matching mission approval is already pending" };
    }
    let requested;
    try { requested = requestMissionApproval(mission, { ...value, scopes: requestedScopes }, Date.now(), `mission-approval-${Date.now()}-${mission.approvals.length + 1}`); }
    catch (error) { return { ok: false, error: error.message }; }
    try { this.#workspaceStore.upsertMission(requested.mission); } catch (error) { return { ok: false, error: error.message }; }
    this.#missions.set(requested.mission.id, requested.mission);
    this.#publish("mission:approval", { missionId: mission.id, agentId, approvalId: requested.approval.id, outcome: "requested", requestedScopes: requested.approval.requestedScopes });
    return { ok: true, approval: requested.approval };
  }

  resolveMissionApproval(missionId, approvalId, decision) {
    this.#expireMissionApprovals();
    const mission = this.#missions.get(String(missionId));
    if (!mission) return { ok: false, error: "mission was not found" };
    const approval = mission.approvals.find(item => item.id === approvalId);
    if (!approval) return { ok: false, error: "mission approval was not found" };
    if (approval.state !== "pending") return { ok: false, error: `mission approval is already ${approval.state}` };
    if (!["approve", "deny"].includes(decision)) return { ok: false, error: "mission approval decision is invalid" };
    const now = Date.now();
    approval.state = decision === "approve" ? "approved" : "denied";
    approval.resolvedAt = now;
    mission.currentAction = {
      kind: "approval",
      summary: decision === "approve" ? "One-time mission authority was approved; no action has executed yet." : "The permission request was denied; no action executed.",
      source: "operator",
      observedAt: now,
      evidenceId: null
    };
    setPhase(mission, decision === "approve" ? "executing" : "review", mission.currentAction.summary, "operator", now);
    mission.updatedAt = now;
    try { this.#workspaceStore.upsertMission(mission); } catch (error) { return { ok: false, error: error.message }; }
    this.#publish("mission:approval", { missionId, agentId: mission.agentId, approvalId, outcome: approval.state, requestedScopes: approval.requestedScopes });
    return { ok: true, approval: JSON.parse(JSON.stringify(approval)), mission: JSON.parse(JSON.stringify(mission)) };
  }

  verifyMissionCheckpoint(missionId, checkpointId) {
    const mission = this.#missions.get(String(missionId));
    if (!mission || mission.status !== "active") return { ok: false, error: "active mission was not found" };
    const checkpoint = mission.checkpoints.find(item => item.id === checkpointId);
    if (!checkpoint) return { ok: false, error: "mission checkpoint was not found" };
    const now = Date.now();
    checkpoint.state = "verified";
    checkpoint.evidenceId = `operator:${now}`;
    checkpoint.updatedAt = now;
    mission.progress = progressFor(mission.checkpoints);
    mission.currentAction = { kind: "review", summary: `Operator verified checkpoint: ${checkpoint.title}.`, source: "operator", observedAt: now, evidenceId: checkpoint.evidenceId };
    setPhase(mission, "review", mission.currentAction.summary, "operator", now);
    mission.updatedAt = now;
    try { this.#workspaceStore.upsertMission(mission); } catch (error) { return { ok: false, error: error.message }; }
    this.#publish("mission:checkpoint", { missionId, agentId: mission.agentId, checkpointId, state: "verified", source: "operator" });
    return { ok: true, mission: JSON.parse(JSON.stringify(mission)) };
  }

  transitionMission(missionId, state) {
    const mission = this.#missions.get(String(missionId));
    if (!mission) return { ok: false, error: "mission was not found" };
    if (!["active", "completed", "cancelled"].includes(state)) return { ok: false, error: "mission transition is invalid" };
    const now = Date.now();
    mission.status = state;
    const phase = state === "active" ? "planned" : state;
    const reason = state === "completed" ? "Operator marked the mission complete after reviewing its evidence." : state === "cancelled" ? "Operator cancelled the mission." : "Operator resumed the mission.";
    setPhase(mission, phase, reason, "operator", now);
    mission.currentAction = { kind: state, summary: reason, source: "operator", observedAt: now, evidenceId: null };
    mission.updatedAt = now;
    try { this.#workspaceStore.upsertMission(mission); } catch (error) { return { ok: false, error: error.message }; }
    this.#publish("mission:lifecycle", { missionId, agentId: mission.agentId, status: state, phase });
    return { ok: true, mission: JSON.parse(JSON.stringify(mission)) };
  }

  recordMissionInstruction(agentId, metadata = {}) {
    const mission = [...this.#missions.values()].find(item => item.agentId === agentId && item.status === "active");
    if (!mission) return { ok: false, error: "agent has no active mission" };
    const requestedScopes = [...new Set((metadata.requestedScopes || []).filter(scope => ["read", "write", "execute", "network"].includes(scope)))];
    const denied = requestedScopes.filter(scope => !mission.scopes.includes(scope));
    let approval = null;
    if (denied.length) {
      approval = mission.approvals.find(item => item.id === metadata.approvalId && item.state === "approved" && !item.consumedAt && denied.every(scope => item.requestedScopes.includes(scope)));
      if (!approval) return { ok: false, error: `mission does not allow: ${denied.join(", ")}; a matching one-time approval is required` };
      approval.consumedAt = Date.now();
      approval.state = "consumed";
    }
    const record = { id: `${mission.id}:${Date.now()}:command`, type: "command", at: Date.now(), facts: { instructionLength: Math.min(100000, Number(metadata.instructionLength) || 0), requestedScopes, approvalId: approval?.id || null } };
    mission.evidence = [...mission.evidence.slice(-99), record]; mission.updatedAt = Date.now();
    try { this.#workspaceStore?.upsertMission(mission); } catch (error) { return { ok: false, error: error.message }; }
    this.#publish("mission:evidence", { missionId: mission.id, agentId, evidenceType: "command", approvalId: approval?.id || null });
    return { ok: true };
  }

  saveRecipe(value) {
    if (!this.#workspaceStore) return { ok: false, error: "shared recipes require a persistent project workspace" };
    const activeRun = value?.id ? this.#recipeRuns.get(String(value.id)) : null;
    if (activeRun && ["running", "paused", "cancelling"].includes(activeRun.phase)) return { ok: false, error: "an active recipe cannot be edited" };
    let recipe;
    try { recipe = normalizeRecipe(value, new Set(this.#sessionEngine.list().map(session => session.id))); }
    catch (error) { return { ok: false, error: error.message }; }
    if (!this.#recipes.has(recipe.id) && this.#recipes.size >= RECIPE_LIMIT) return { ok: false, error: `workspace recipe limit is ${RECIPE_LIMIT}` };
    // T076 — last-write-wins silently discards the other editor's work. A save
    // that names the revision it started from is rejected when that is no longer
    // current, so the second window is told rather than overwritten. A save that
    // names no revision is an explicit overwrite and is still allowed, because
    // scripted and external Protocol v1 clients predate this field.
    const existing = this.#recipes.get(recipe.id) || null;
    if (existing && Number.isInteger(value?.baseRevision) && value.baseRevision !== existing.revision) {
      return {
        ok: false,
        conflict: true,
        error: `This recipe changed since you opened it (you edited revision ${value.baseRevision}, the saved copy is revision ${existing.revision}). Reload it to see the current steps before saving.`,
        currentRevision: existing.revision,
        currentUpdatedAt: existing.updatedAt
      };
    }
    recipe.revision = existing ? existing.revision + 1 : 1;
    try { this.#workspaceStore.upsertRecipe(recipe); }
    catch (error) { return { ok: false, error: error.message }; }
    this.#recipes.set(recipe.id, recipe);
    this.#publish("recipe:saved", { recipeId: recipe.id, name: recipe.name, revision: recipe.revision });
    return { ok: true, recipe };
  }

  deleteRecipe(id) {
    if (!this.#workspaceStore) return { ok: false, error: "shared recipes require a persistent project workspace" };
    const activeRun = this.#recipeRuns.get(id);
    if (activeRun && ["running", "paused", "cancelling"].includes(activeRun.phase)) return { ok: false, error: "cancel the active recipe before deleting it" };
    try {
      if (!this.#workspaceStore.removeRecipe(id)) return { ok: false, error: `no such recipe: ${id}` };
    } catch (error) { return { ok: false, error: error.message }; }
    this.#recipes.delete(id);
    this.#recipeRuns.delete(id);
    this.#recipeRunHistory.delete(id);
    this.#publish("recipe:deleted", { recipeId: id });
    return { ok: true };
  }

  #recipeReady(session, mode) {
    if (!session) return false;
    if (mode === "running") return session.status === "running";
    if (mode === "service") return session.evidence?.service?.ready === true;
    if (mode === "tests") return Number.isInteger(session.evidence?.tests?.passed) && session.evidence.tests.failed === 0;
    if (mode === "build") return session.evidence?.build?.status === "completed";
    if (mode === "database") return session.evidence?.database?.connected === true;
    if (mode === "container") return session.evidence?.container?.healthy === true;
    if (mode === "git-clean") return session.evidence?.git?.clean === true;
    if (mode === "exited-zero") return session.status === "exited" && session.exitCode === 0;
    return session.health?.tone === "healthy"
      || session.evidence?.container?.healthy === true
      || session.evidence?.database?.connected === true
      || session.evidence?.service?.ready === true;
  }

  #publishRecipeStep(recipe, run, step, phase, detail = {}) {
    run.stepStates[step.workerId] = {
      ...(run.stepStates[step.workerId] || {}),
      phase,
      updatedAt: Date.now(),
      ...detail
    };
    this.#publish("recipe:step", {
      recipeId: recipe.id,
      runId: run.runId,
      workerId: step.workerId,
      phase,
      readiness: step.readiness,
      attempt: run.stepStates[step.workerId].attempt || 0,
      ...detail
    });
  }

  async #waitForRecipe(run, milliseconds = 0) {
    let remaining = Math.max(0, milliseconds);
    do {
      while (run.phase === "paused") await wait(50);
      if (["cancelling", "cancelled"].includes(run.phase)) return false;
      if (remaining <= 0) return true;
      const interval = Math.min(50, remaining);
      await wait(interval);
      remaining -= interval;
    } while (remaining >= 0);
    return true;
  }

  async #executeRecipeStep(recipe, run, step) {
    const initiallyAlive = this.getSnapshot(step.workerId)?.isAlive === true;
    const maximumAttempts = recipe.retryAttempts + 1;
    run.runningWorkerIds.push(step.workerId);
    run.currentWorkerId = run.runningWorkerIds[0] || null;
    try {
      for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
        if (!await this.#waitForRecipe(run)) return { cancelled: true };
        this.#publishRecipeStep(recipe, run, step, attempt === 1 ? "starting" : "retrying", { attempt, maximumAttempts });
        const snapshot = this.getSnapshot(step.workerId);
        let lifecycleResult = { ok: true };
        const restartExisting = snapshot?.isAlive && (attempt > 1 || recipe.restartPolicy === "restart-running");
        if (restartExisting) {
          const operation = this.restart(step.workerId);
          lifecycleResult = operation && typeof operation.then === "function" ? await operation : operation;
        } else if (!snapshot?.isAlive) {
          const operation = this.start(step.workerId);
          lifecycleResult = operation && typeof operation.then === "function" ? await operation : operation;
        }
        if (lifecycleResult?.ok && !initiallyAlive && !run.startedWorkerIds.includes(step.workerId)) {
          run.startedWorkerIds.push(step.workerId);
        }
        if (!lifecycleResult?.ok) {
          const reason = lifecycleResult?.error || "worker failed to start";
          if (attempt === maximumAttempts) return { ok: false, reason, attempts: attempt };
          this.#publishRecipeStep(recipe, run, step, "retry-wait", { attempt, maximumAttempts, reason });
          if (!await this.#waitForRecipe(run, recipe.retryDelayMs)) return { cancelled: true };
          continue;
        }

        let remaining = step.timeoutMs;
        while (!this.#recipeReady(this.getSnapshot(step.workerId), step.readiness) && remaining > 0) {
          if (!await this.#waitForRecipe(run, 50)) return { cancelled: true };
          remaining -= 50;
        }
        if (this.#recipeReady(this.getSnapshot(step.workerId), step.readiness)) {
          return { ok: true, attempts: attempt };
        }
        const reason = `${step.readiness} readiness timed out`;
        if (attempt === maximumAttempts) return { ok: false, reason, attempts: attempt };
        this.#publishRecipeStep(recipe, run, step, "retry-wait", { attempt, maximumAttempts, reason });
        if (!await this.#waitForRecipe(run, recipe.retryDelayMs)) return { cancelled: true };
      }
      return { ok: false, reason: "recipe step exhausted its retry policy", attempts: maximumAttempts };
    } finally {
      run.runningWorkerIds = run.runningWorkerIds.filter(workerId => workerId !== step.workerId);
      run.currentWorkerId = run.runningWorkerIds[0] || null;
    }
  }

  async #rollbackRecipe(recipe, run) {
    const workerIds = [...run.startedWorkerIds].reverse();
    run.rollback = { phase: "running", workerIds, stoppedCount: 0, failureCount: 0 };
    this.#publish("recipe:rollback", { recipeId: recipe.id, runId: run.runId, phase: "running", workerCount: workerIds.length });
    for (const workerId of workerIds) {
      const snapshot = this.getSnapshot(workerId);
      if (!snapshot?.isAlive) continue;
      const result = this.kill(workerId);
      if (result?.ok) run.rollback.stoppedCount++;
      else run.rollback.failureCount++;
    }
    run.rollback.phase = run.rollback.failureCount ? "incomplete" : "requested";
    this.#publish("recipe:rollback", { recipeId: recipe.id, runId: run.runId, phase: run.rollback.phase, stoppedCount: run.rollback.stoppedCount, failureCount: run.rollback.failureCount });
  }

  async #executeRecipe(recipe, run) {
    const pending = new Set(recipe.workerIds);
    const active = new Map();
    let stopScheduling = false;
    while (pending.size || active.size) {
      const cancelling = ["cancelling", "cancelled"].includes(run.phase);
      if (!cancelling && !stopScheduling) {
        if (!await this.#waitForRecipe(run)) continue;
        const blocked = recipe.steps.filter(step => pending.has(step.workerId) && step.dependsOn.some(dependency => ["failed", "blocked"].includes(run.stepStates[dependency]?.phase)));
        for (const step of blocked) {
          pending.delete(step.workerId);
          const reason = "dependency did not become ready";
          run.failures.push({ workerId: step.workerId, reason, attempts: 0, blocked: true });
          this.#publishRecipeStep(recipe, run, step, "blocked", { reason, attempt: 0 });
        }
        const capacity = Math.max(0, recipe.maxParallel - active.size);
        const ready = recipe.steps
          .filter(step => pending.has(step.workerId) && step.dependsOn.every(dependency => run.completed.includes(dependency)))
          .slice(0, capacity);
        if (ready.length) {
          run.wave++;
          for (const step of ready) {
            pending.delete(step.workerId);
            active.set(step.workerId, this.#executeRecipeStep(recipe, run, step).then(result => ({ step, result })));
          }
        }
      }

      if (!active.size) {
        if (["cancelling", "cancelled"].includes(run.phase)) break;
        if (!pending.size) break;
        for (const workerId of pending) {
          const step = recipe.steps.find(candidate => candidate.workerId === workerId);
          const reason = stopScheduling ? "recipe stopped after an earlier step failed" : "dependency graph could not make progress";
          run.failures.push({ workerId, reason, attempts: 0, blocked: true });
          this.#publishRecipeStep(recipe, run, step, "blocked", { reason, attempt: 0 });
        }
        pending.clear();
        break;
      }

      const { step, result } = await Promise.race(active.values());
      active.delete(step.workerId);
      if (result.cancelled) {
        this.#publishRecipeStep(recipe, run, step, "cancelled", { attempt: run.stepStates[step.workerId]?.attempt || 0 });
      } else if (result.ok) {
        run.completed.push(step.workerId);
        this.#publishRecipeStep(recipe, run, step, "ready", { attempt: result.attempts, maximumAttempts: recipe.retryAttempts + 1 });
      } else {
        run.failures.push({ workerId: step.workerId, reason: result.reason, attempts: result.attempts });
        this.#publishRecipeStep(recipe, run, step, "failed", { reason: result.reason, attempt: result.attempts, maximumAttempts: recipe.retryAttempts + 1 });
        if (recipe.failurePolicy === "stop") stopScheduling = true;
      }
    }
    if (["cancelling", "cancelled"].includes(run.phase)) {
      for (const workerId of pending) {
        const step = recipe.steps.find(candidate => candidate.workerId === workerId);
        this.#publishRecipeStep(recipe, run, step, "cancelled", { attempt: 0 });
      }
      run.phase = "cancelled";
    } else {
      run.phase = run.failures.length ? "failed" : "completed";
      if (run.phase === "failed" && recipe.recoveryPolicy === "rollback-started") await this.#rollbackRecipe(recipe, run);
    }
    run.currentWorkerId = null;
    run.runningWorkerIds = [];
    run.finishedAt = Date.now();
    this.#recordRecipeRun(recipe.id, run);
    const completion = { recipeId: recipe.id, runId: run.runId, phase: run.phase, completedCount: run.completed.length, failureCount: run.failures.length, waveCount: run.wave, recoveryOfRunId: run.recoveryOfRunId };
    this.#publish("recipe:run", completion);
    this.#considerAutomations("recipe:run", completion);
  }

  // T077 — a finished run is the only record of what a recipe actually did, and
  // it is the thing you need when deciding whether to recover. Kept bounded and
  // summarised: the per-step states and rollback outcome, never the output.
  #recordRecipeRun(recipeId, run) {
    const summary = {
      runId: run.runId,
      phase: run.phase,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      durationMs: Math.max(0, Number(run.finishedAt) - Number(run.startedAt)) || 0,
      completed: [...run.completed],
      failures: run.failures.map(failure => ({ ...failure })),
      waveCount: run.wave,
      recoveryOfRunId: run.recoveryOfRunId || null,
      rollback: run.rollback
        ? { phase: run.rollback.phase, stoppedCount: run.rollback.stoppedCount, failureCount: run.rollback.failureCount, workerIds: [...run.rollback.workerIds] }
        : null,
      stepStates: Object.fromEntries(Object.entries(run.stepStates).map(([workerId, state]) => [workerId, { ...state }]))
    };
    const history = this.#recipeRunHistory.get(recipeId) || [];
    history.unshift(summary);
    this.#recipeRunHistory.set(recipeId, history.slice(0, RECIPE_RUN_HISTORY_LIMIT));
  }

  listRecipeRunHistory(id) {
    const history = this.#recipeRunHistory.get(String(id)) || [];
    return JSON.parse(JSON.stringify(history));
  }

  runRecipe(id, options = {}) {
    const recipe = this.#recipes.get(id);
    if (!recipe) return { ok: false, error: `no such recipe: ${id}` };
    const active = this.#recipeRuns.get(id);
    if (active && ["running", "paused", "cancelling"].includes(active.phase)) return { ok: false, error: "recipe is already active" };
    const recoveryOfRunId = options?.recover === true && active?.phase === "failed" ? active.runId : null;
    const run = { runId: `${id}:${Date.now()}`, recipeId: id, phase: "running", completed: [], failures: [], currentWorkerId: null, runningWorkerIds: [], startedWorkerIds: [], stepStates: {}, wave: 0, rollback: null, recoveryOfRunId, startedAt: Date.now(), finishedAt: null };
    this.#recipeRuns.set(id, run);
    this.#publish("recipe:run", { recipeId: id, runId: run.runId, phase: "running", completedCount: 0, failureCount: 0, recoveryOfRunId });
    void this.#executeRecipe(recipe, run);
    return { ok: true, run: cloneRun(run) };
  }

  pauseRecipe(id) {
    const run = this.#recipeRuns.get(id);
    if (!run || run.phase !== "running") return { ok: false, error: "recipe is not running" };
    run.phase = "paused";
    this.#publish("recipe:run", { recipeId: id, runId: run.runId, phase: "paused", completedCount: run.completed.length, failureCount: run.failures.length });
    return { ok: true };
  }

  resumeRecipe(id) {
    const run = this.#recipeRuns.get(id);
    if (!run || run.phase !== "paused") return { ok: false, error: "recipe is not paused" };
    run.phase = "running";
    this.#publish("recipe:run", { recipeId: id, runId: run.runId, phase: "running", completedCount: run.completed.length, failureCount: run.failures.length });
    return { ok: true };
  }

  cancelRecipe(id) {
    const run = this.#recipeRuns.get(id);
    if (!run || !["running", "paused"].includes(run.phase)) return { ok: false, error: "recipe is not active" };
    run.phase = "cancelling";
    this.#publish("recipe:run", { recipeId: id, runId: run.runId, phase: "cancelling", completedCount: run.completed.length, failureCount: run.failures.length });
    return { ok: true };
  }

  create(definition) {
    if (this.#stopping) return { ok: false, error: "the engine is stopping" };
    const baseDir = this.#workspaceStore?.directory || process.cwd();
    let normalized;
    try {
      normalized = normalizeSessionDefinition(definition, { baseDir });
      if (this.#sessionEngine.get(normalized.runtime.id)) {
        return { ok: false, error: `session id already in use: ${normalized.runtime.id}` };
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const previousDefinition = this.#workspaceStore?.getDefinition(normalized.persisted.id) || null;
    if (this.#workspaceStore) {
      try {
        this.#workspaceStore.upsert(normalized.persisted);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.#publish("workspace:persist-error", { operation: "create", id: normalized.runtime.id, error });
        return { ok: false, error };
      }
    }

    let session;
    try {
      session = this.#sessionEngine.create(normalized.runtime);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (this.#workspaceStore) {
        try {
          if (previousDefinition) this.#workspaceStore.upsert(previousDefinition);
          else this.#workspaceStore.remove(normalized.runtime.id);
        } catch (rollbackError) {
          const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          this.#publish("workspace:persist-error", {
            operation: "create-rollback",
            id: normalized.runtime.id,
            error: rollback
          });
          return { ok: false, error: `${error}; workspace rollback failed: ${rollback}` };
        }
      }
      return { ok: false, error };
    }

    return { ok: true, session: session.summary() };
  }

  list() {
    return this.#sessionEngine.list().map(session => this.#decorateSession(session));
  }

  getSnapshot(id) {
    return this.#decorateSession(this.#sessionEngine.getSnapshot(id));
  }

  getSessionConfiguration(id) {
    const definition = this.#workspaceStore?.getDefinition(id) || this.#sessionEngine.getDefinition(id);
    if (!definition) return null;
    const env = definition.env && typeof definition.env === "object" ? definition.env : {};
    return {
      id: definition.id,
      name: definition.name || definition.id,
      command: definition.command,
      args: Array.isArray(definition.args) ? [...definition.args] : [],
      cwd: definition.cwd === undefined ? "." : definition.cwd,
      envKeys: Object.keys(env),
      powershellCompatibility: definition.powershellCompatibility === true,
      autoStart: definition.autoStart !== false
    };
  }

  listSavedCommands() {
    return [...this.#savedCommands.values()].map(command => {
      const definition = command.persisted;
      const env = definition.env && typeof definition.env === "object" ? definition.env : {};
      return {
        id: definition.id,
        name: definition.name || definition.id,
        command: definition.command,
        args: Array.isArray(definition.args) ? [...definition.args] : [],
        cwd: definition.cwd === undefined ? "." : definition.cwd,
        envKeys: Object.keys(env),
        powershellCompatibility: command.runtime.powershellCompatibility,
        autoStart: command.runtime.autoStart,
        available: !this.#sessionEngine.get(definition.id)
      };
    });
  }

  createFromSavedCommand(commandId) {
    if (this.#stopping) return { ok: false, error: "the engine is stopping" };
    const savedCommand = this.#savedCommands.get(commandId);
    if (!savedCommand) return { ok: false, error: `no such saved command: ${commandId}` };
    if (this.#sessionEngine.get(savedCommand.runtime.id)) {
      return { ok: false, error: `session id already in use: ${savedCommand.runtime.id}` };
    }

    const result = this.create({ ...savedCommand.persisted });
    if (!result.ok) return result;
    this.#publish("saved-command:instantiated", {
      id: result.session.id,
      commandId,
      session: {
        id: result.session.id,
        name: result.session.name,
        status: result.session.status,
        autoStart: result.session.autoStart
      }
    });
    return { ...result, commandId };
  }

  getState() {
    return {
      contractVersion: ENGINE_CONTRACT_VERSION,
      sequence: this.#eventSequence,
      generatedAt: Date.now(),
      workspace: this.getWorkspace(),
      loadErrors: this.#loadErrors.map(error => ({ ...error })),
      savedCommandErrors: this.#savedCommandErrors.map(error => ({ ...error })),
      savedCommands: this.listSavedCommands(),
      sessions: this.list(),
      activity: this.getActivity()
    };
  }

  getActivity(options = {}) {
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new TypeError("getActivity options must be an object");
    }
    const afterSequence = Number.isInteger(options.afterSequence) && options.afterSequence >= 0
      ? options.afterSequence
      : null;
    const limit = Number.isInteger(options.limit) && options.limit > 0
      ? Math.min(options.limit, this.#activityLimit)
      : Math.min(50, this.#activityLimit);
    const available = afterSequence === null
      ? this.#activityEvents
      : this.#activityEvents.filter(event => event.sequence > afterSequence);
    const selected = afterSequence === null
      ? available.slice(-limit)
      : available.slice(0, limit);
    const gap = afterSequence !== null && afterSequence < this.#activityDroppedThrough;
    const firstSelectedSequence = selected[0]?.sequence ?? null;

    return {
      contractVersion: ENGINE_CONTRACT_VERSION,
      latestSequence: this.#eventSequence,
      latestActivitySequence: this.#activityEvents.at(-1)?.sequence ?? null,
      oldestActivitySequence: this.#activityEvents[0]?.sequence ?? null,
      droppedThroughSequence: this.#activityDroppedThrough,
      gap,
      hasEarlier: this.#activityDroppedThrough > 0 || (
        firstSelectedSequence === null
          ? this.#activityEvents.length > 0
          : this.#activityEvents[0]?.sequence < firstSelectedSequence
      ),
      hasMore: afterSequence !== null && available.length > selected.length,
      events: selected.map(event => this.#cloneContractValue(event))
    };
  }

  getProjectMemory(options = {}) {
    const afterSequence = Number.isInteger(options.afterSequence) && options.afterSequence >= 0 ? options.afterSequence : 0;
    return buildProjectMemory(this.#activityEvents, this.list(), {
      afterSequence,
      latestSequence: this.#eventSequence
    });
  }

  recordSupervisorEvent(kind, payload = {}) {
    const normalizedKind = String(kind || "").trim();
    if (!/^(?:plan-requested|plan-approved|plan-denied|action-started|action-verified|action-failed)$/.test(normalizedKind)) {
      return { ok: false, error: "supervisor event kind is invalid" };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "supervisor event payload must be an object" };
    }
    const event = this.#publish(`supervisor:${normalizedKind}`, payload);
    return { ok: true, sequence: event.sequence, timestamp: event.timestamp };
  }

  recordConfirmationEvent(kind, payload = {}) {
    const normalizedKind = String(kind || "").trim();
    if (!/^(?:requested|confirmed|rejected|expired|completed)$/.test(normalizedKind)) {
      return { ok: false, error: "confirmation event kind is invalid" };
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "confirmation event payload must be an object" };
    }
    const operation = String(payload.operation || "").trim();
    if (!/^[a-z][a-z0-9.-]{1,80}$/.test(operation)) {
      return { ok: false, error: "confirmation operation is invalid" };
    }

    // Persist only the allow-listed operation name and outcome class. Tokens,
    // exact parameter bindings, paths, commands, decision text and payloads
    // never enter durable activity history.
    const eventPayload = { operation };
    if (typeof payload.outcomeCode === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(payload.outcomeCode)) {
      eventPayload.outcomeCode = payload.outcomeCode;
    }
    const event = this.#publish(`confirmation:${normalizedKind}`, eventPayload);
    return { ok: true, sequence: event.sequence, timestamp: event.timestamp };
  }

  subscribe(scope, callback) {
    if (typeof scope === "function") {
      callback = scope;
      scope = "all";
    }
    if (typeof callback !== "function") {
      throw new TypeError("subscribe requires a callback");
    }

    const listener = event => {
      if (scope === "all" || scope === event.id || scope === `session:${event.id}`) {
        try {
          callback(event);
        } catch (error) {
          this.#reportSubscriberError(error, { scope, event });
        }
      }
    };

    this.on("engine:event", listener);
    return () => this.off("engine:event", listener);
  }

  write(id, data) {
    return this.#sessionEngine.write(id, data);
  }

  resize(id, cols, rows) {
    return this.#sessionEngine.resize(id, cols, rows);
  }

  /**
   * Ends a recovery deferral: starts the workers whose saved autoStart would
   * have launched them at load. Returns the ids actually started.
   */
  releaseAutoStart() {
    if (typeof this.#sessionEngine.releaseAutoStart !== "function") return [];
    return this.#sessionEngine.releaseAutoStart();
  }

  get autoStartDeferred() {
    return this.#sessionEngine.deferAutoStart === true;
  }

  attachRawStream(id) {
    const stream = this.#sessionEngine.attachRawStream(id);
    if (!stream) {
      const snapshot = this.getSnapshot(id);
      this.#publish("attach:rejected", {
        id,
        reason: snapshot ? snapshot.status : "missing"
      });
    }
    return stream;
  }

  start(id) {
    return this.#runSessionOperation(id, () => this.#sessionEngine.start(id));
  }

  restart(id) {
    return this.#runSessionOperation(id, () => this.#sessionEngine.restart(id));
  }

  kill(id) {
    if (this.#sessionOperations.has(id)) {
      return { ok: false, error: "a lifecycle operation is already in progress for this session" };
    }
    return this.#sessionEngine.kill(id);
  }

  rename(id, name) {
    const snapshot = this.getSnapshot(id);
    if (!snapshot) return { ok: false, error: `no such session: ${id}` };
    const nextName = String(name || "").trim();
    if (!nextName) return { ok: false, error: "name cannot be empty" };
    if (nextName.length > 80) return { ok: false, error: "name cannot exceed 80 characters" };

    if (this.#workspaceStore) {
      try {
        if (!this.#workspaceStore.rename(id, nextName)) {
          return { ok: false, error: `session is missing from workspace configuration: ${id}` };
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.#publish("workspace:persist-error", { operation: "rename", id, error });
        return { ok: false, error };
      }
    }

    const result = this.#sessionEngine.rename(id, nextName);
    if (result.ok || !this.#workspaceStore) return result;

    try {
      this.#workspaceStore.rename(id, snapshot.name);
    } catch (rollbackError) {
      const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
      this.#publish("workspace:persist-error", { operation: "rename-rollback", id, error: rollback });
      return { ok: false, error: `${result.error}; workspace rollback failed: ${rollback}` };
    }
    return result;
  }

  setAutoStart(id, enabled) {
    return this.#runSessionOperation(id, () => {
      if (typeof enabled !== "boolean") {
        return { ok: false, error: "autoStart must be a boolean" };
      }
      const snapshot = this.getSnapshot(id);
      if (!snapshot) return { ok: false, error: `no such session: ${id}` };
      if (snapshot.autoStart === enabled) return { ok: true };

      if (this.#workspaceStore) {
        try {
          if (!this.#workspaceStore.setAutoStart(id, enabled)) {
            return { ok: false, error: `session is missing from workspace configuration: ${id}` };
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.#publish("workspace:persist-error", { operation: "autostart", id, error });
          return { ok: false, error };
        }
      }

      const result = this.#sessionEngine.setAutoStart(id, enabled);
      if (result.ok || !this.#workspaceStore) return result;

      try {
        this.#workspaceStore.setAutoStart(id, snapshot.autoStart);
      } catch (rollbackError) {
        const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        this.#publish("workspace:persist-error", {
          operation: "autostart-rollback",
          id,
          error: rollback
        });
        return { ok: false, error: `${result.error}; workspace rollback failed: ${rollback}` };
      }
      return result;
    });
  }

  reconfigure(id, patch) {
    return this.#runSessionOperation(id, () => {
      const snapshot = this.getSnapshot(id);
      if (!snapshot) return { ok: false, error: `no such session: ${id}` };
      if (snapshot.isAlive) {
        return { ok: false, error: "stop the session before changing its configuration" };
      }
      if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
        return { ok: false, error: "configuration patch must be an object" };
      }
      if (Object.hasOwn(patch, "id") && patch.id !== id) {
        return { ok: false, error: "session id cannot be changed" };
      }

      const allowedFields = new Set([
        "id", "name", "command", "args", "cwd", "env", "powershellCompatibility", "autoStart"
      ]);
      const unsupported = Object.keys(patch).filter(field => !allowedFields.has(field));
      if (unsupported.length) {
        return { ok: false, error: `unsupported configuration field: ${unsupported[0]}` };
      }

      const previousDefinition = this.#workspaceStore?.getDefinition(id) || this.#sessionEngine.getDefinition(id);
      if (!previousDefinition) return { ok: false, error: `no such session: ${id}` };
      const merged = { ...previousDefinition };
      for (const field of allowedFields) {
        if (field !== "id" && Object.hasOwn(patch, field)) merged[field] = patch[field];
      }
      merged.id = id;

      let normalized;
      try {
        normalized = normalizeSessionDefinition(merged, {
          baseDir: this.#workspaceStore?.directory || process.cwd()
        });
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }

      if (this.#workspaceStore) {
        try {
          if (!this.#workspaceStore.replace(id, normalized.persisted)) {
            return { ok: false, error: `session is missing from workspace configuration: ${id}` };
          }
        } catch (err) {
          const error = err instanceof Error ? err.message : String(err);
          this.#publish("workspace:persist-error", { operation: "reconfigure", id, error });
          return { ok: false, error };
        }
      }

      const result = this.#sessionEngine.reconfigure(id, normalized.runtime);
      if (result.ok || !this.#workspaceStore) return result;

      try {
        this.#workspaceStore.replace(id, previousDefinition);
      } catch (rollbackError) {
        const rollback = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
        this.#publish("workspace:persist-error", {
          operation: "reconfigure-rollback",
          id,
          error: rollback
        });
        return { ok: false, error: `${result.error}; workspace rollback failed: ${rollback}` };
      }
      return result;
    });
  }

  acknowledge(id) {
    return this.#sessionEngine.acknowledge(id);
  }

  async remove(id) {
    return this.#runSessionOperation(id, async () => {
      if (!this.#workspaceStore) return this.#sessionEngine.remove(id);

      const wasAlive = this.getSnapshot(id)?.isAlive || false;
      const stopped = await this.#sessionEngine.stopForRemoval(id);
      if (!stopped.ok) return stopped;

      try {
        if (!this.#workspaceStore.remove(id)) {
          return { ok: false, error: `session is missing from workspace configuration: ${id}` };
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.#publish("workspace:persist-error", { operation: "remove", id, error });
        return { ok: false, error, sessionStopped: wasAlive };
      }

      return this.#sessionEngine.finalizeRemove(id);
    });
  }

  #runSessionOperation(id, operation) {
    if (this.#stopping) return Promise.resolve({ ok: false, error: "the engine is stopping" });

    const previous = this.#sessionOperations.get(id) || Promise.resolve();
    const current = previous
      .catch(() => {})
      .then(operation);
    this.#sessionOperations.set(id, current);
    current.then(
      () => {
        if (this.#sessionOperations.get(id) === current) this.#sessionOperations.delete(id);
      },
      () => {
        if (this.#sessionOperations.get(id) === current) this.#sessionOperations.delete(id);
      }
    );
    return current;
  }

  #cloneContractValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  #deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const nested of Object.values(value)) this.#deepFreeze(nested);
    return Object.freeze(value);
  }

  #activityRecord(envelope) {
    const record = this.#cloneContractValue(envelope);
    if (record.type === "project:load-errors") {
      record.errorCount = Array.isArray(record.errors) ? record.errors.length : 0;
      delete record.errors;
    }
    if (record.type === "project:command-errors") {
      record.errorCount = Array.isArray(record.errors) ? record.errors.length : 0;
      delete record.errors;
    }
    if (["session:created", "session:reconfigured"].includes(record.type) && record.session) {
      record.session = {
        id: record.session.id,
        name: record.session.name,
        status: record.session.status,
        autoStart: record.session.autoStart
      };
    }
    return record;
  }

  #persistableActivityRecord(event) {
    const record = this.#cloneContractValue(event);
    if (record.type === "session:supervision") {
      delete record.attentionReason;
    }
    return record;
  }

  #activityPersistenceState() {
    return {
      contractVersion: ENGINE_CONTRACT_VERSION,
      latestSequence: this.#eventSequence,
      droppedThroughSequence: this.#activityDroppedThrough,
      events: this.#activityEvents.map(event => this.#persistableActivityRecord(event))
    };
  }

  #scheduleActivityPersist() {
    if (!this.#activityStore) return;
    this.#activityDirty = true;
    if (this.#activityPersistDelayMs === 0) {
      this.#persistActivityNow();
      return;
    }
    if (this.#activityPersistTimer) return;
    this.#activityPersistTimer = setTimeout(() => {
      this.#activityPersistTimer = null;
      this.#persistActivityNow();
    }, this.#activityPersistDelayMs);
    this.#activityPersistTimer.unref?.();
  }

  #persistActivityNow(reportError = true) {
    if (this.#activityPersistTimer) {
      clearTimeout(this.#activityPersistTimer);
      this.#activityPersistTimer = null;
    }
    if (!this.#activityStore || !this.#activityDirty) return { ok: true };

    try {
      this.#activityStore.save(this.#activityPersistenceState());
      this.#activityDirty = false;
      this.#lastActivityPersistError = null;
      return { ok: true };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      if (
        reportError &&
        error !== this.#lastActivityPersistError &&
        !this.#reportingActivityPersistError
      ) {
        this.#lastActivityPersistError = error;
        this.#reportingActivityPersistError = true;
        try {
          this.#publish("activity:persist-error", { error }, { error }, { persist: false });
        } finally {
          this.#reportingActivityPersistError = false;
        }
      }
      return { ok: false, error };
    }
  }

  #publish(type, payload = {}, observedPayload = payload, options = {}) {
    const envelopeValue = {
      ...payload,
      contractVersion: ENGINE_CONTRACT_VERSION,
      sequence: ++this.#eventSequence,
      timestamp: Date.now(),
      type
    };
    const envelope = type === "session:output"
      ? Object.freeze(envelopeValue)
      : this.#deepFreeze(this.#cloneContractValue(envelopeValue));

    const includeActivity = type !== "session:output" && options.activity !== false;
    const shouldPersist = includeActivity && options.persist !== false;
    if (includeActivity) {
      this.#activityEvents.push(this.#activityRecord(envelope));
      if (this.#activityEvents.length > this.#activityLimit) {
        const removed = this.#activityEvents.splice(0, this.#activityEvents.length - this.#activityLimit);
        this.#activityDroppedThrough = removed.at(-1)?.sequence ?? this.#activityDroppedThrough;
      }
    }

    this.#publicationQueue.push({ type, payload: observedPayload, envelope });
    if (this.#publishing) {
      if (shouldPersist) this.#scheduleActivityPersist();
      return envelope;
    }

    this.#publishing = true;
    try {
      while (this.#publicationQueue.length) {
        const next = this.#publicationQueue.shift();
        this.#emitObserved("engine:event", next.envelope);
        this.#emitObserved(next.type, next.payload);
      }
    } finally {
      this.#publishing = false;
    }
    if (shouldPersist) this.#scheduleActivityPersist();
    return envelope;
  }

  #emitObserved(type, payload) {
    for (const listener of this.rawListeners(type)) {
      try {
        listener.call(this, payload);
      } catch (error) {
        this.#reportSubscriberError(error, { type, payload });
      }
    }
  }

  #reportSubscriberError(error, context) {
    try {
      this.#onSubscriberError(error, context);
    } catch (reportingError) {
      // Observers must never be able to break PTY ownership or lifecycle work.
    }
  }

  stopAll(timeoutMs) {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopping = true;
    for (const run of this.#recipeRuns.values()) {
      if (["running", "paused", "cancelling"].includes(run.phase)) run.phase = "cancelled";
    }
    this.#stopPromise = (async () => {
      await Promise.allSettled([...this.#sessionOperations.values()]);
      const result = await this.#sessionEngine.stopAll(timeoutMs);
      this.#persistActivityNow();
      if (!result.ok) {
        this.#stopping = false;
        this.#stopPromise = null;
      }
      return result;
    })();
    return this.#stopPromise;
  }

  dispose() {
    if (this.#resourceSampleTimer) clearInterval(this.#resourceSampleTimer);
    this.#resourceSampleTimer = null;
    this.#resourceSampler.clear?.();
    for (const [type, listener] of this.#engineBindings) {
      this.#sessionEngine.off(type, listener);
    }
    this.#engineBindings = [];
    this.#persistActivityNow(false);
    this.#stopping = true;
    this.#sessionOperations.clear();
    this.#savedCommands.clear();
    this.#savedCommandErrors = [];
    for (const run of this.#recipeRuns.values()) run.phase = "cancelled";
    this.#recipeRuns.clear();
    this.#recipes.clear();
    this.#automations.clear();
    this.#automationApprovals = [];
    this.#automationAudit = [];
    this.#missions.clear();
    this.#activityEvents = [];
    if (this.#activityPersistTimer) clearTimeout(this.#activityPersistTimer);
    this.#activityPersistTimer = null;
    this.#publicationQueue = [];
    this.#sessionEngine.dispose();
    this.removeAllListeners();
  }
}

module.exports = { EngineAPI, ENGINE_EVENTS, ENGINE_CONTRACT_VERSION, MAX_ACTIVITY_EVENTS };
