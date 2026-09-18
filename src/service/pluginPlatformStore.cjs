"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const PLUGIN_STORE_VERSION = 1;
const MAX_PLUGIN_STORE_BYTES = 512 * 1024;
const MAX_PLUGINS = 32;
const MAX_PLUGIN_APPROVALS = 100;
const MAX_PLUGIN_AUDIT = 200;
const MAX_PLUGIN_CONTRIBUTIONS = 12;
// Composite rules nest `all` / `any`; deeper than this is a mistake, not a rule.
const MAX_RULE_DEPTH = 4;
const MAX_RULE_TEXT = 256;
const PLUGIN_PERMISSIONS = Object.freeze([
  "context.read",
  "memory.read",
  "attention.read",
  "events.read",
  "health.read",
  "worker.lifecycle.request",
  "recipe.run.request",
  "automation.run.request"
]);
const PLUGIN_SURFACES = Object.freeze([
  "settings.summary",
  "needs.request",
  "context.resource",
  "health.status",
  "cockpit.banner",
  "worker.detail",
  "mission.overview"
]);
const PLUGIN_CONTRIBUTION_SURFACES = Object.freeze([
  "settings.summary",
  "context.resource",
  "health.status",
  "cockpit.banner",
  "worker.detail",
  "mission.overview"
]);
const PLUGIN_CONTRIBUTION_TONES = Object.freeze(["neutral", "healthy", "warning", "critical"]);
const FORBIDDEN_MANIFEST_FIELDS = Object.freeze([
  "main", "entry", "script", "scripts", "command", "commands", "environment",
  "env", "filesystem", "network", "process", "terminal", "secrets", "url"
]);

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
function cleanText(value, name, maximum, fallback = "") {
  const text = String(value ?? fallback).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text && !fallback) throw new TypeError(`Plugin ${name} is required`);
  return (text || fallback).slice(0, maximum);
}
function normalizeList(value, allowed, name, maximum) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some(item => typeof item !== "string")) throw new TypeError(`Plugin ${name} must be an array of strings`);
  const unknown = value.find(item => !allowed.includes(item));
  if (unknown) throw new TypeError(`Unsupported plugin ${name.slice(0, -1)}: ${unknown}`);
  return allowed.filter(item => value.includes(item)).slice(0, maximum);
}

// A pattern with a quantified group that itself repeats ("(a+)+") can take
// exponential time. Plugins are declarative text, so such patterns are refused.
function isSafePluginPattern(pattern) {
  const source = String(pattern ?? "");
  if (!source || source.length > 64) return false;
  if (/\\[1-9]/.test(source)) return false;
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{?]/.test(source)) return false;
  try { new RegExp(source, "i"); } catch { return false; }
  return true;
}

function normalizeAction(value) {
  if (!isPlainObject(value)) throw new TypeError("Plugin actions must be objects");
  const id = cleanText(value.id, "action id", 64);
  if (!/^[a-z][a-z0-9.-]*$/.test(id)) throw new TypeError("Plugin action id must use lowercase letters, numbers, dots, or hyphens");
  const type = value.type === "worker" ? "worker" : value.type === "recipe" ? "recipe" : value.type === "automation" ? "automation" : null;
  if (!type) throw new TypeError("Plugin action type must be worker, recipe, or automation");
  const allowed = type === "worker" ? ["start", "restart", "stop", "acknowledge"] : type === "recipe" ? ["run", "recover", "cancel", "pause", "resume"] : ["run", "test"];
  const operations = normalizeList(value.operations, allowed, "action operations", allowed.length);
  if (!operations.length) throw new TypeError("Plugin action requires at least one allow-listed operation");
  return { id, label: cleanText(value.label, "action label", 80), type, operations };
}

function normalizeRule(value, depth = 1) {
  if (!isPlainObject(value)) throw new TypeError("Plugin contribution rules must be objects");
  if (depth > MAX_RULE_DEPTH) throw new TypeError(`Plugin rules nest at most ${MAX_RULE_DEPTH} levels`);
  const supported = ["metric", "operator", "operand", "value", "detail", "tone", "title", "actionId", "actionLabel", "target", "all", "any"];
  const unknown = Object.keys(value).find(field => !supported.includes(field));
  if (unknown) throw new TypeError(`Unsupported plugin contribution rule field: ${unknown}`);
  
  let all, any;
  if (value.all !== undefined) {
    if (!Array.isArray(value.all) || !value.all.length) throw new TypeError("Plugin rule 'all' must be a non-empty array");
    all = value.all.slice(0, 10).map(item => normalizeRule(item, depth + 1));
  }
  if (value.any !== undefined) {
    if (!Array.isArray(value.any) || !value.any.length) throw new TypeError("Plugin rule 'any' must be a non-empty array");
    any = value.any.slice(0, 10).map(item => normalizeRule(item, depth + 1));
  }

  const metric = value.metric !== undefined ? cleanText(value.metric, "rule metric", 64) : undefined;
  const operator = value.operator ? cleanText(value.operator, "rule operator", 16) : (metric ? "eq" : undefined);
  if (operator && !["eq", "neq", "gt", "gte", "lt", "lte", "truthy", "falsy", "in", "regex", "matches", "contains", "between"].includes(operator)) {
    throw new TypeError(`Unsupported plugin rule operator: ${operator}`);
  }
  if ((operator === "regex" || operator === "matches") && !isSafePluginPattern(value.operand)) {
    throw new TypeError("Plugin rule pattern must be a simple regular expression of at most 64 characters, without nested repetition");
  }
  const tone = value.tone === undefined ? undefined : cleanText(value.tone, "rule tone", 16);
  if (tone && !PLUGIN_CONTRIBUTION_TONES.includes(tone)) {
    throw new TypeError(`Unsupported plugin rule tone: ${tone}`);
  }

  const actionId = value.actionId !== undefined ? cleanText(value.actionId, "rule actionId", 64) : undefined;
  if (actionId && !/^[a-z][a-z0-9.-]*$/.test(actionId)) {
    throw new TypeError("Plugin rule actionId must use lowercase letters, numbers, dots, or hyphens");
  }

  return {
    ...(metric ? { metric } : {}),
    ...(operator ? { operator } : {}),
    operand: value.operand !== undefined ? (typeof value.operand === "number" || typeof value.operand === "boolean" ? value.operand : (Array.isArray(value.operand) ? value.operand.map(item => typeof item === "number" ? item : cleanText(item, "rule operand item", 64)) : cleanText(value.operand, "rule operand", 64))) : undefined,
    value: value.value !== undefined ? cleanText(value.value, "rule value", 120) : undefined,
    detail: value.detail !== undefined ? cleanText(value.detail, "rule detail", 240) : undefined,
    tone,
    title: value.title !== undefined ? cleanText(value.title, "rule title", 80) : undefined,
    ...(actionId ? { actionId } : {}),
    actionLabel: value.actionLabel !== undefined ? cleanText(value.actionLabel, "rule actionLabel", 80) : undefined,
    target: value.target !== undefined ? cleanText(value.target, "rule target", 64) : undefined,
    ...(all ? { all } : {}),
    ...(any ? { any } : {})
  };
}

function normalizeContribution(value) {
  if (!isPlainObject(value)) throw new TypeError("Plugin contributions must be objects");
  const supported = ["id", "surface", "title", "value", "detail", "tone", "rules", "actionId", "actionLabel", "target"];
  const unknown = Object.keys(value).find(field => !supported.includes(field));
  if (unknown) throw new TypeError(`Unsupported plugin contribution field: ${unknown}`);
  const id = cleanText(value.id, "contribution id", 64);
  if (!/^[a-z][a-z0-9.-]*$/.test(id)) throw new TypeError("Plugin contribution id must use lowercase letters, numbers, dots, or hyphens");
  const surface = cleanText(value.surface, "contribution surface", 32);
  if (!PLUGIN_CONTRIBUTION_SURFACES.includes(surface)) throw new TypeError(`Unsupported plugin contribution surface: ${surface}`);
  const tone = value.tone === undefined ? "neutral" : cleanText(value.tone, "contribution tone", 16);
  if (!PLUGIN_CONTRIBUTION_TONES.includes(tone)) throw new TypeError(`Unsupported plugin contribution tone: ${tone}`);
  
  const actionId = value.actionId !== undefined ? cleanText(value.actionId, "contribution actionId", 64) : undefined;
  if (actionId && !/^[a-z][a-z0-9.-]*$/.test(actionId)) {
    throw new TypeError("Plugin contribution actionId must use lowercase letters, numbers, dots, or hyphens");
  }

  let rules;
  if (value.rules !== undefined) {
    if (!Array.isArray(value.rules)) throw new TypeError("Plugin contribution rules must be an array");
    rules = value.rules.slice(0, 10).map(normalizeRule);
  }
  return {
    id,
    surface,
    title: cleanText(value.title, "contribution title", 80),
    value: cleanText(value.value, "contribution value", 120),
    detail: value.detail === undefined || String(value.detail).trim() === "" ? "" : cleanText(value.detail, "contribution detail", 240),
    tone,
    ...(actionId ? { actionId } : {}),
    actionLabel: value.actionLabel !== undefined ? cleanText(value.actionLabel, "contribution actionLabel", 80) : undefined,
    target: value.target !== undefined ? cleanText(value.target, "contribution target", 64) : undefined,
    ...(rules ? { rules } : {})
  };
}

function extractMetricValue(snapshot, metricPath) {
  if (!snapshot || !metricPath) return undefined;
  if (metricPath === "workers.total" || metricPath === "workers.total.count") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.length : 0;
  }
  if (metricPath === "workers.failed.count" || metricPath === "workers.failed") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.status === "failed" || w.health === "critical" || w.health === "failed").length : 0;
  }
  if (metricPath === "workers.failed.names") {
    if (!Array.isArray(snapshot.workers)) return "none";
    const failed = snapshot.workers.filter(w => w.status === "failed" || w.health === "critical" || w.health === "failed");
    return failed.length ? failed.map(w => w.name || w.id).join(", ") : "none";
  }
  // The first failing / running worker, so a card action can name its target.
  if (metricPath === "workers.failed.first.id" || metricPath === "workers.failed.first.name") {
    const first = Array.isArray(snapshot.workers) ? snapshot.workers.find(w => w.status === "failed" || w.health === "critical" || w.health === "failed") : null;
    return first ? String(metricPath.endsWith(".id") ? first.id : first.name || first.id) : "";
  }
  if (metricPath === "workers.running.first.id") {
    const first = Array.isArray(snapshot.workers) ? snapshot.workers.find(w => w.status === "running") : null;
    return first ? String(first.id) : "";
  }
  if (metricPath === "workers.running.count" || metricPath === "workers.running") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.status === "running").length : 0;
  }
  if (metricPath === "workers.running.names") {
    if (!Array.isArray(snapshot.workers)) return "none";
    const running = snapshot.workers.filter(w => w.status === "running");
    return running.length ? running.map(w => w.name || w.id).join(", ") : "none";
  }
  if (metricPath === "workers.idle.count" || metricPath === "workers.idle") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.status === "idle").length : 0;
  }
  if (metricPath === "workers.critical.count") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.health === "critical" || w.status === "critical").length : 0;
  }
  if (metricPath === "attention.count" || metricPath === "attention.pending.count") {
    return Array.isArray(snapshot.attention) ? snapshot.attention.length : 0;
  }
  if (metricPath === "attention.first.title" || metricPath === "attention.first.reason") {
    return Array.isArray(snapshot.attention) && snapshot.attention[0] ? (snapshot.attention[0].title || snapshot.attention[0].reason || "Attention required") : "None";
  }
  if (metricPath === "overall.status") {
    return snapshot.overall?.status || "unknown";
  }
  if (metricPath === "recipes.count" || metricPath === "recipes.total") {
    return Array.isArray(snapshot.recipes) ? snapshot.recipes.length : 0;
  }
  if (metricPath === "recipes.running.count") {
    return Array.isArray(snapshot.recipes) ? snapshot.recipes.filter(r => r.run?.status === "running").length : 0;
  }
  if (metricPath === "recipes.failed.count") {
    return Array.isArray(snapshot.recipes) ? snapshot.recipes.filter(r => r.run?.status === "failed").length : 0;
  }
  if (metricPath === "missions.count" || metricPath === "missions.total") {
    return Array.isArray(snapshot.missions) ? snapshot.missions.length : 0;
  }
  if (metricPath === "missions.active.count") {
    return Array.isArray(snapshot.missions) ? snapshot.missions.filter(m => m.status === "in_progress" || m.status === "active").length : 0;
  }
  if (metricPath === "project.name") {
    return snapshot.project?.name || "Project";
  }
  const parts = String(metricPath).split(".").filter(Boolean);
  let current = snapshot;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (part === "__proto__" || part === "constructor" || part === "prototype") return undefined;
    current = current[part];
  }
  return current;
}

function matchCondition(metricValue, operator, operand) {
  switch (operator) {
    case "eq":
      return metricValue === operand;
    case "neq":
      return metricValue !== operand;
    case "gt":
      return typeof metricValue === "number" && metricValue > Number(operand);
    case "gte":
      return typeof metricValue === "number" && metricValue >= Number(operand);
    case "lt":
      return typeof metricValue === "number" && metricValue < Number(operand);
    case "lte":
      return typeof metricValue === "number" && metricValue <= Number(operand);
    case "truthy":
      return Boolean(metricValue);
    case "falsy":
      return !metricValue;
    case "in":
      return Array.isArray(operand) ? operand.includes(metricValue) : false;
    case "contains":
      if (Array.isArray(metricValue)) return metricValue.includes(operand);
      if (typeof metricValue === "string") return metricValue.toLowerCase().includes(String(operand).toLowerCase());
      return false;
    case "regex":
    case "matches":
      // Patterns are vetted at install (no nested quantifiers) and the text is
      // bounded, so a manifest cannot stall the process evaluating it.
      if (!isSafePluginPattern(operand)) return false;
      try {
        const re = new RegExp(String(operand), "i");
        return re.test(String(metricValue ?? "").slice(0, MAX_RULE_TEXT));
      } catch {
        return false;
      }
    case "between":
      if (Array.isArray(operand) && operand.length === 2 && typeof metricValue === "number") {
        return metricValue >= Number(operand[0]) && metricValue <= Number(operand[1]);
      }
      return false;
    default:
      return false;
  }
}

function matchRuleNode(rule, snapshot) {
  if (!rule || typeof rule !== "object") return false;
  if (Array.isArray(rule.all) && rule.all.length > 0) {
    return rule.all.every(sub => matchRuleNode(sub, snapshot));
  }
  if (Array.isArray(rule.any) && rule.any.length > 0) {
    return rule.any.some(sub => matchRuleNode(sub, snapshot));
  }
  if (rule.metric !== undefined) {
    const metricVal = extractMetricValue(snapshot, rule.metric);
    return matchCondition(metricVal, rule.operator || "eq", rule.operand);
  }
  return false;
}

function formatTemplate(template, metricValue, snapshot) {
  if (typeof template !== "string") return template;
  let text = template
    .replace(/\{metric\}/g, String(metricValue ?? ""))
    .replace(/\{count\}/g, String(metricValue ?? ""))
    .replace(/\{value\}/g, String(metricValue ?? ""));
  if (snapshot && text.includes("{")) {
    text = text.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, path) => {
      if (path === "metric" || path === "count" || path === "value") return match;
      const extracted = extractMetricValue(snapshot, path);
      return extracted !== undefined ? String(extracted) : match;
    });
  }
  return text;
}

function evaluateContribution(contribution, snapshot) {
  if (!contribution) return null;
  const base = {
    id: contribution.id,
    surface: contribution.surface,
    title: contribution.title,
    value: contribution.value,
    detail: contribution.detail || "",
    tone: contribution.tone || "neutral",
    actionId: contribution.actionId || null,
    actionLabel: contribution.actionLabel || null,
    target: contribution.target || null,
    pluginId: contribution.pluginId,
    pluginName: contribution.pluginName
  };

  if (!Array.isArray(contribution.rules) || !contribution.rules.length || !snapshot) {
    return {
      ...base,
      title: formatTemplate(base.title, undefined, snapshot),
      value: formatTemplate(base.value, undefined, snapshot),
      detail: formatTemplate(base.detail, undefined, snapshot),
      target: formatTemplate(base.target, undefined, snapshot)
    };
  }

  for (const rule of contribution.rules) {
    if (matchRuleNode(rule, snapshot)) {
      const metricVal = rule.metric ? extractMetricValue(snapshot, rule.metric) : undefined;
      return {
        ...base,
        title: rule.title !== undefined ? formatTemplate(rule.title, metricVal, snapshot) : formatTemplate(base.title, metricVal, snapshot),
        value: rule.value !== undefined ? formatTemplate(rule.value, metricVal, snapshot) : formatTemplate(base.value, metricVal, snapshot),
        detail: rule.detail !== undefined ? formatTemplate(rule.detail, metricVal, snapshot) : formatTemplate(base.detail, metricVal, snapshot),
        tone: rule.tone || base.tone,
        actionId: rule.actionId !== undefined ? rule.actionId : base.actionId,
        actionLabel: rule.actionLabel !== undefined ? rule.actionLabel : base.actionLabel,
        target: formatTemplate(rule.target !== undefined ? rule.target : base.target, metricVal, snapshot)
      };
    }
  }

  return {
    ...base,
    title: formatTemplate(base.title, undefined, snapshot),
    value: formatTemplate(base.value, undefined, snapshot),
    detail: formatTemplate(base.detail, undefined, snapshot),
    target: formatTemplate(base.target, undefined, snapshot)
  };
}

function evaluateContributions(contributions, snapshot) {
  if (!Array.isArray(contributions)) return [];
  return contributions.map(item => evaluateContribution(item, snapshot)).filter(Boolean);
}

function normalizeManifest(value) {
  if (!isPlainObject(value)) throw new TypeError("Plugin manifest must be an object");
  const forbidden = FORBIDDEN_MANIFEST_FIELDS.find(field => Object.hasOwn(value, field));
  if (forbidden) throw new TypeError(`Executable or privileged plugin field is not allowed: ${forbidden}`);
  const supported = ["manifestVersion", "id", "name", "version", "publisher", "description", "permissions", "surfaces", "actions", "contributions"];
  const unknown = Object.keys(value).find(field => !supported.includes(field));
  if (unknown) throw new TypeError(`Unsupported plugin manifest field: ${unknown}`);
  if (value.manifestVersion !== 1) throw new TypeError("Plugin manifestVersion must be 1");
  const id = cleanText(value.id, "id", 96);
  if (!/^[a-z][a-z0-9.-]{2,95}$/.test(id)) throw new TypeError("Plugin id must be a stable lowercase dotted identifier");
  const version = cleanText(value.version, "version", 32);
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new TypeError("Plugin version must use semantic versioning");
  const actions = value.actions === undefined ? [] : value.actions;
  if (!Array.isArray(actions) || actions.length > 20) throw new TypeError("Plugin actions must contain at most 20 entries");
  const normalizedActions = actions.map(normalizeAction);
  if (new Set(normalizedActions.map(item => item.id)).size !== normalizedActions.length) throw new TypeError("Plugin action ids must be unique");
  const permissions = normalizeList(value.permissions, PLUGIN_PERMISSIONS, "permissions", PLUGIN_PERMISSIONS.length);
  const surfaces = normalizeList(value.surfaces, PLUGIN_SURFACES, "surfaces", PLUGIN_SURFACES.length);
  const contributions = value.contributions === undefined ? [] : value.contributions;
  if (!Array.isArray(contributions) || contributions.length > MAX_PLUGIN_CONTRIBUTIONS) throw new TypeError(`Plugin contributions must contain at most ${MAX_PLUGIN_CONTRIBUTIONS} entries`);
  const normalizedContributions = contributions.map(normalizeContribution);
  if (new Set(normalizedContributions.map(item => item.id)).size !== normalizedContributions.length) throw new TypeError("Plugin contribution ids must be unique");
  for (const action of normalizedActions) {
    const permission = action.type === "worker" ? "worker.lifecycle.request" : action.type === "recipe" ? "recipe.run.request" : "automation.run.request";
    if (!permissions.includes(permission)) throw new TypeError(`Plugin action ${action.id} requires ${permission}`);
  }
  for (const contribution of normalizedContributions) {
    if (!surfaces.includes(contribution.surface)) throw new TypeError(`Plugin contribution ${contribution.id} requires declared surface ${contribution.surface}`);
    const permission = contribution.surface === "context.resource" ? "context.read" : contribution.surface === "health.status" ? "health.read" : null;
    if (permission && !permissions.includes(permission)) throw new TypeError(`Plugin contribution ${contribution.id} requires ${permission}`);
    if (contribution.actionId && !normalizedActions.some(item => item.id === contribution.actionId)) {
      throw new TypeError(`Plugin contribution ${contribution.id} requires declared action ${contribution.actionId}`);
    }
    if (Array.isArray(contribution.rules)) {
      for (const rule of contribution.rules) {
        if (rule.actionId && !normalizedActions.some(item => item.id === rule.actionId)) {
          throw new TypeError(`Plugin contribution rule requires declared action ${rule.actionId}`);
        }
      }
    }
  }
  return {
    manifestVersion: 1,
    id,
    name: cleanText(value.name, "name", 80),
    version,
    publisher: cleanText(value.publisher, "publisher", 80, "Unknown publisher"),
    description: cleanText(value.description, "description", 300, "No description provided"),
    permissions,
    surfaces,
    actions: normalizedActions,
    contributions: normalizedContributions
  };
}

class PluginPlatformStore {
  constructor(filePath, options = {}) {
    if (typeof filePath !== "string" || !filePath) throw new TypeError("Plugin platform store path is required");
    this.filePath = path.resolve(filePath);
    this.fs = options.fs || fs;
    this.now = options.now || Date.now;
    this.randomUUID = options.randomUUID || crypto.randomUUID;
  }

  status() {
    const value = this.#read();
    return {
      available: true,
      pluginCount: value.plugins.length,
      enabledCount: value.plugins.filter(item => item.enabled).length,
      pendingApprovalCount: value.approvals.filter(item => item.state === "pending").length,
      auditCount: value.audit.length,
      updatedAt: value.updatedAt,
      isolation: "declarative-no-code-execution"
    };
  }

  plugins() { return this.#read().plugins.map(clone); }
  approvals() { return this.#read().approvals.map(clone); }
  audit(limit = 50) { const count = Number.isInteger(limit) ? Math.min(100, Math.max(1, limit)) : 50; return this.#read().audit.slice(-count).reverse().map(clone); }

  install(manifest, source = "local-manifest") {
    const normalized = normalizeManifest(manifest);
    const value = this.#read();
    const index = value.plugins.findIndex(item => item.manifest.id === normalized.id);
    const previous = index >= 0 ? value.plugins[index] : null;
    const record = {
      manifest: normalized,
      enabled: previous?.enabled === true,
      grantedPermissions: normalized.permissions.filter(permission => previous?.grantedPermissions?.includes(permission)),
      installedAt: previous?.installedAt || this.now(),
      updatedAt: this.now(),
      source: cleanText(source, "source", 120, "local-manifest")
    };
    if (index >= 0) value.plugins[index] = record;
    else {
      if (value.plugins.length >= MAX_PLUGINS) throw new Error(`Plugin platform supports at most ${MAX_PLUGINS} installed manifests`);
      value.plugins.push(record);
    }
    this.#write({ ...value, plugins: value.plugins, updatedAt: this.now() });
    return clone(record);
  }

  configure(id, configuration = {}) {
    if (!isPlainObject(configuration)) throw new TypeError("Plugin configuration must be an object");
    const unsupported = Object.keys(configuration).find(key => !["enabled", "grantedPermissions"].includes(key));
    if (unsupported) throw new TypeError(`Unsupported plugin configuration field: ${unsupported}`);
    const value = this.#read();
    const plugin = value.plugins.find(item => item.manifest.id === String(id));
    if (!plugin) throw new Error("Plugin is not installed");
    if (configuration.grantedPermissions !== undefined) {
      if (!Array.isArray(configuration.grantedPermissions) || configuration.grantedPermissions.some(item => typeof item !== "string")) throw new TypeError("Plugin grants must be an array of strings");
      const unsupportedGrant = configuration.grantedPermissions.find(permission => !plugin.manifest.permissions.includes(permission));
      if (unsupportedGrant) throw new TypeError(`Plugin did not declare permission: ${unsupportedGrant}`);
      plugin.grantedPermissions = plugin.manifest.permissions.filter(permission => configuration.grantedPermissions.includes(permission));
    }
    if (configuration.enabled !== undefined) plugin.enabled = configuration.enabled === true;
    plugin.updatedAt = this.now();
    this.#write({ ...value, updatedAt: this.now() });
    return clone(plugin);
  }

  uninstall(id) {
    const value = this.#read();
    const before = value.plugins.length;
    value.plugins = value.plugins.filter(item => item.manifest.id !== String(id));
    if (value.plugins.length === before) throw new Error("Plugin is not installed");
    value.approvals = value.approvals.map(item => item.pluginId === String(id) && item.state === "pending" ? { ...item, state: "revoked", resolvedAt: this.now() } : item);
    this.#write({ ...value, updatedAt: this.now() });
    return true;
  }

  setApprovals(approvals) {
    if (!Array.isArray(approvals)) throw new TypeError("Plugin approvals must be an array");
    const value = this.#read();
    value.approvals = approvals.filter(isPlainObject).slice(-MAX_PLUGIN_APPROVALS).map(clone);
    this.#write({ ...value, updatedAt: this.now() });
  }

  appendAudit(record) {
    const value = this.#read();
    const clean = {
      id: cleanText(record?.id, "audit id", 160, `plugin-audit-${this.randomUUID()}`),
      at: Number.isInteger(record?.at) ? record.at : this.now(),
      kind: cleanText(record?.kind, "audit kind", 64, "platform"),
      outcome: cleanText(record?.outcome, "audit outcome", 64, "recorded"),
      pluginId: record?.pluginId ? cleanText(record.pluginId, "plugin id", 96) : null,
      capability: record?.capability ? cleanText(record.capability, "capability", 120) : null,
      target: record?.target ? cleanText(record.target, "target", 120) : null
    };
    value.audit = [...value.audit, clean].slice(-MAX_PLUGIN_AUDIT);
    this.#write({ ...value, updatedAt: this.now() });
    return clone(clean);
  }

  #read() {
    let raw;
    try { raw = this.fs.readFileSync(this.filePath); }
    catch (error) {
      if (error?.code === "ENOENT") return { version: PLUGIN_STORE_VERSION, plugins: [], approvals: [], audit: [], updatedAt: null };
      throw error;
    }
    if (!Buffer.isBuffer(raw)) raw = Buffer.from(raw);
    if (raw.length > MAX_PLUGIN_STORE_BYTES) throw new Error("Plugin platform store exceeds its safety limit");
    let value;
    try { value = JSON.parse(raw.toString("utf8")); } catch { throw new Error("Plugin platform store is invalid"); }
    if (!isPlainObject(value) || value.version !== PLUGIN_STORE_VERSION) throw new Error("Plugin platform store version is unsupported");
    const plugins = [];
    for (const item of Array.isArray(value.plugins) ? value.plugins.slice(-MAX_PLUGINS) : []) {
      try {
        const manifest = normalizeManifest(item.manifest);
        plugins.push({ manifest, enabled: item.enabled === true, grantedPermissions: manifest.permissions.filter(permission => item.grantedPermissions?.includes(permission)), installedAt: Number.isInteger(item.installedAt) ? item.installedAt : null, updatedAt: Number.isInteger(item.updatedAt) ? item.updatedAt : null, source: cleanText(item.source, "source", 120, "local-manifest") });
      } catch { /* A corrupt plugin cannot block the rest of OUTARCH. */ }
    }
    return { version: PLUGIN_STORE_VERSION, plugins, approvals: Array.isArray(value.approvals) ? value.approvals.filter(isPlainObject).slice(-MAX_PLUGIN_APPROVALS).map(clone) : [], audit: Array.isArray(value.audit) ? value.audit.filter(isPlainObject).slice(-MAX_PLUGIN_AUDIT).map(clone) : [], updatedAt: Number.isInteger(value.updatedAt) ? value.updatedAt : null };
  }

  #write(value) {
    const directory = path.dirname(this.filePath);
    this.fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${process.pid}.${this.now()}.tmp`;
    const encoded = `${JSON.stringify(value, null, 2)}\n`;
    if (Buffer.byteLength(encoded) > MAX_PLUGIN_STORE_BYTES) throw new Error("Plugin platform store exceeds its safety limit");
    try {
      this.fs.writeFileSync(temporary, encoded, { encoding: "utf8", mode: 0o600, flag: "wx" });
      this.fs.renameSync(temporary, this.filePath);
      try { this.fs.chmodSync(this.filePath, 0o600); } catch {}
    } catch (error) {
      try { this.fs.unlinkSync(temporary); } catch {}
      throw error;
    }
  }
}

module.exports = {
  FORBIDDEN_MANIFEST_FIELDS,
  MAX_PLUGIN_APPROVALS,
  MAX_PLUGIN_AUDIT,
  MAX_PLUGIN_CONTRIBUTIONS,
  MAX_PLUGIN_STORE_BYTES,
  MAX_PLUGINS,
  PLUGIN_CONTRIBUTION_SURFACES,
  PLUGIN_PERMISSIONS,
  PLUGIN_STORE_VERSION,
  PLUGIN_SURFACES,
  PluginPlatformStore,
  normalizeManifest,
  normalizeRule,
  evaluateContribution,
  evaluateContributions
};
