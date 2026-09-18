"use strict";

const crypto = require("node:crypto");
const EventEmitter = require("node:events");
const { redactText } = require("./contextSanitizer.cjs");

const PLUGIN_APPROVAL_TTL_MS = 15 * 60 * 1000;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function safeReason(value) { return redactText(value, { maxLength: 500 }).value.trim() || "No reason provided"; }

function automationCapable(engine, operation) {
  if (operation === "test") return typeof engine?.testAutomation === "function";
  if (operation === "run") return typeof engine?.runAutomation === "function";
  return false;
}

class PermissionedPluginPlatform extends EventEmitter {
  constructor(options = {}) {
    super();
    if (!options.store) throw new TypeError("PermissionedPluginPlatform requires a store");
    if (!options.missionContext || typeof options.missionContext.snapshot !== "function") throw new TypeError("PermissionedPluginPlatform requires Mission Context");
    if (typeof options.getEngineApi !== "function") throw new TypeError("PermissionedPluginPlatform requires getEngineApi");
    this.store = options.store;
    this.missionContext = options.missionContext;
    this.getEngineApi = options.getEngineApi;
    this.chooseManifest = options.chooseManifest || null;
    this.now = options.now || Date.now;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
  }

  status() { this.#expire(); return { ...this.store.status(), authority: "manifest-declared-local-approval", runtime: "declarative", forbiddenAuthorities: ["filesystem", "process", "network", "terminal-input", "raw-terminal", "secrets", "renderer-code"] }; }
  list() { return this.store.plugins(); }
  listApprovals() { this.#expire(); return this.store.approvals().sort((a, b) => b.createdAt - a.createdAt); }
  listAudit(limit) { return this.store.audit(limit); }
  subscribe(callback) { if (typeof callback !== "function") throw new TypeError("Plugin platform subscribe requires a callback"); this.on("status", callback); return () => this.off("status", callback); }

  async chooseAndInstall() {
    if (typeof this.chooseManifest !== "function") throw new Error("Native plugin manifest selection is unavailable");
    const selected = await this.chooseManifest();
    if (!selected) return { canceled: true };
    const installed = this.store.install(selected.manifest, selected.source || "local-manifest");
    this.#audit({ kind: "manifest", outcome: "installed", pluginId: installed.manifest.id, capability: installed.manifest.permissions.join(",") });
    this.#emitStatus();
    return { canceled: false, plugin: installed };
  }

  configure(id, configuration) {
    const previous = this.store.plugins().find(item => item.manifest.id === String(id));
    if (!previous) throw new Error("Plugin is not installed");
    const result = this.store.configure(id, configuration);
    const revoked = previous.grantedPermissions.filter(permission => !result.grantedPermissions.includes(permission));
    if (revoked.length || result.enabled === false) {
      const approvals = this.store.approvals().map(item => item.pluginId === String(id) && item.state === "pending" ? { ...item, state: "revoked", resolvedAt: this.now() } : item);
      this.store.setApprovals(approvals);
    }
    this.#audit({ kind: "permission", outcome: result.enabled ? "configured" : "disabled", pluginId: id, capability: result.grantedPermissions.join(",") || "none" });
    this.#emitStatus();
    return result;
  }

  uninstall(id) { this.store.uninstall(id); this.#audit({ kind: "manifest", outcome: "uninstalled", pluginId: id }); this.#emitStatus(); return { uninstalled: true, pluginId: String(id) }; }

  read(pluginId, request = {}) {
    const plugin = this.#authorized(pluginId);
    const permission = String(request.permission || "context.read");
    if (!plugin.grantedPermissions.includes(permission)) throw new Error(`Plugin permission required: ${permission}`);
    let value;
    if (permission === "context.read" || permission === "health.read") {
      const context = this.missionContext.snapshot({ afterSequence: Number.isInteger(request.afterSequence) ? Math.max(0, request.afterSequence) : 0, includeOutput: false, workerIds: Array.isArray(request.workerIds) ? request.workerIds.slice(0, 10) : [] });
      value = permission === "health.read" ? { generatedAt: context.generatedAt, project: context.project, overall: context.overall, workers: context.workers?.map(item => ({ id: item.id, name: item.name, status: item.status, health: item.health, resources: item.resources, dependencyImpact: item.dependencyImpact })) } : { contextVersion: context.contextVersion, generatedAt: context.generatedAt, project: context.project, overall: context.overall, workers: context.workers, missions: context.missions, recipes: context.recipes, visibility: context.visibility, privacy: context.privacy };
    } else if (permission === "memory.read") value = this.missionContext.snapshot({ includeOutput: false }).projectMemory;
    else if (permission === "attention.read") value = this.missionContext.snapshot({ includeOutput: false }).attention;
    else if (permission === "events.read") {
      const activity = this.getEngineApi().getActivity({ afterSequence: Number.isInteger(request.afterSequence) ? Math.max(0, request.afterSequence) : 0, limit: 100 });
      value = {
        gap: activity.gap === true,
        hasMore: activity.hasMore === true,
        latestSequence: activity.latestSequence,
        events: (activity.events || []).map(event => ({ sequence: event.sequence, at: event.at, type: event.type, id: event.id || null, phase: event.phase || null, reason: event.reason || null }))
      };
    }
    else throw new Error("Plugin permission does not expose a readable resource");
    this.#audit({ kind: "read", outcome: "completed", pluginId, capability: permission });
    return clone(value);
  }

  requestAction(pluginId, value = {}) {
    const plugin = this.#authorized(pluginId);
    const actionId = String(value.actionId || "");
    const definition = plugin.manifest.actions.find(item => item.id === actionId);
    if (!definition) throw new Error("Plugin action is not declared in its manifest");
    const permission = definition.type === "worker"
      ? "worker.lifecycle.request"
      : definition.type === "recipe"
      ? "recipe.run.request"
      : "automation.run.request";
    if (!plugin.grantedPermissions.includes(permission)) throw new Error(`Plugin permission required: ${permission}`);
    // An action that declares a single operation needs no choice.
    const operation = String(value.operation || (definition.operations.length === 1 ? definition.operations[0] : ""));
    if (!definition.operations.includes(operation)) throw new Error("Plugin action operation is not declared");
    const engine = this.getEngineApi();
    const target = String(value.target || "").slice(0, 64);
    let targetName;
    if (definition.type === "worker") {
      const worker = engine.getSnapshot(target); if (!worker) throw new Error("Plugin worker target was not found"); targetName = worker.name;
    } else if (definition.type === "recipe") {
      const recipe = engine.listRecipes().find(item => item.id === target); if (!recipe) throw new Error("Plugin recipe target was not found"); targetName = recipe.name;
    } else if (definition.type === "automation") {
      // EngineAPI lists workflows as `definitions`; an array is accepted from simpler hosts.
      const listed = typeof engine.listAutomations === "function" ? engine.listAutomations() : null;
      const workflows = Array.isArray(listed) ? listed : Array.isArray(listed?.definitions) ? listed.definitions : [];
      const automation = workflows.find(item => item.id === target);
      if (!automation) throw new Error("Plugin automation target was not found");
      if (!automationCapable(engine, operation)) throw new Error(`This version cannot ${operation} an automation workflow on a plugin's request`);
      targetName = automation.name || automation.id;
    }
    const approval = { id: `plugin-approval-${this.randomUUID()}`, pluginId: plugin.manifest.id, pluginName: plugin.manifest.name, actionId, actionLabel: definition.label, type: definition.type, operation, target, targetName, reason: safeReason(value.reason), state: "pending", createdAt: this.now(), expiresAt: this.now() + PLUGIN_APPROVAL_TTL_MS };
    this.store.setApprovals([...this.store.approvals(), approval].slice(-100));
    this.#audit({ kind: "approval", outcome: "requested", pluginId, capability: operation, target }); this.#emitStatus();
    return clone(approval);
  }

  async resolveApproval(id, decision) {
    this.#expire();
    const approvals = this.store.approvals();
    const approval = approvals.find(item => item.id === String(id));
    if (!approval) throw new Error("Plugin approval request was not found");
    if (approval.state !== "pending") throw new Error(`Plugin approval is already ${approval.state}`);
    if (!['approve', 'deny'].includes(decision)) throw new Error("Plugin approval decision is invalid");
    if (decision === "deny") { approval.state = "denied"; approval.resolvedAt = this.now(); this.store.setApprovals(approvals); this.#audit({ kind: "approval", outcome: "denied", pluginId: approval.pluginId, capability: approval.operation, target: approval.target }); this.#emitStatus(); return clone(approval); }
    const plugin = this.#authorized(approval.pluginId);
    const definition = plugin.manifest.actions.find(item => item.id === approval.actionId);
    const permission = approval.type === "worker"
      ? "worker.lifecycle.request"
      : approval.type === "recipe"
      ? "recipe.run.request"
      : "automation.run.request";
    if (!definition?.operations.includes(approval.operation) || !plugin.grantedPermissions.includes(permission)) throw new Error("Plugin action authority was revoked before approval");
    approval.state = "executing"; approval.resolvedAt = this.now(); this.store.setApprovals(approvals); this.#emitStatus();
    try { approval.result = await this.#execute(approval); approval.state = "approved"; }
    catch (error) { approval.state = "failed"; approval.error = error instanceof Error ? error.message : String(error); }
    approval.completedAt = this.now(); this.store.setApprovals(approvals); this.#audit({ kind: "approval", outcome: approval.state, pluginId: approval.pluginId, capability: approval.operation, target: approval.target }); this.#emitStatus(); return clone(approval);
  }

  dispose() { this.removeAllListeners(); return true; }

  #authorized(id) { const plugin = this.store.plugins().find(item => item.manifest.id === String(id)); if (!plugin) throw new Error("Plugin is not installed"); if (!plugin.enabled) throw new Error("Plugin is disabled"); return plugin; }
  async #execute(approval) {
    const engine = this.getEngineApi();
    let result;
    if (approval.type === "worker") {
      const method = approval.operation === "stop" ? "kill" : approval.operation;
      result = engine[method](approval.target);
    } else if (approval.type === "recipe") {
      if (approval.operation === "cancel") result = engine.cancelRecipe(approval.target);
      else if (approval.operation === "pause") result = typeof engine.pauseRecipe === "function" ? engine.pauseRecipe(approval.target) : { ok: false, error: "Pausing a recipe is not available" };
      else if (approval.operation === "resume") result = typeof engine.resumeRecipe === "function" ? engine.resumeRecipe(approval.target) : { ok: false, error: "Resuming a recipe is not available" };
      else result = engine.runRecipe(approval.target, { recover: approval.operation === "recover" });
    } else if (approval.type === "automation") {
      // A dry run is a test; a run is never quietly downgraded to one, and
      // nothing is reported as done that the engine did not do.
      if (!automationCapable(engine, approval.operation)) result = { ok: false, error: `This version cannot ${approval.operation} an automation workflow on a plugin's request` };
      else if (approval.operation === "test") result = engine.testAutomation(approval.target);
      else result = engine.runAutomation(approval.target);
    } else {
      result = { ok: false, error: `Unsupported plugin action type: ${approval.type}` };
    }
    if (result && typeof result.then === "function") result = await result;
    if (!result?.ok) throw new Error(result?.error || "EngineAPI rejected the approved plugin action");
    return clone(result);
  }
  #expire() { const now = this.now(); const approvals = this.store.approvals(); let changed = false; for (const item of approvals) if (item.state === "pending" && item.expiresAt <= now) { item.state = "expired"; item.resolvedAt = now; changed = true; this.#audit({ kind: "approval", outcome: "expired", pluginId: item.pluginId, capability: item.operation, target: item.target }); } if (changed) this.store.setApprovals(approvals); }
  #audit(record) { try { this.store.appendAudit({ ...record, id: `plugin-audit-${this.randomUUID()}`, at: this.now() }); } catch {} }
  #emitStatus() { const status = this.status(); for (const listener of this.rawListeners("status")) try { listener(status); } catch {} }
}

module.exports = { PLUGIN_APPROVAL_TTL_MS, PermissionedPluginPlatform };
