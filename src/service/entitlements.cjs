"use strict";

// What the signed-in operator's plan allows, and the one place that decides
// whether a request is inside it.
//
// The limits come from the plan row in Supabase (public.plans.limits), so the
// owner changes what Free, Pro and Ultimate include by editing the database,
// not the app. A null number means unlimited. The catalogue of every plan is
// read too, so a refusal can name the cheapest plan that would allow it.
//
// Pure: no Electron, no network. The main process builds one of these from
// AccountService's snapshot; the protocol asks it about each request.

const PLAN_ORDER = Object.freeze(["free", "pro", "ultimate"]);

// Used only when nothing has been read from the server yet (never when the
// operator is signed in and verified). Deliberately the Free limits.
const FALLBACK_LIMITS = Object.freeze({
  terminals: 3,
  projects: 1,
  projectSwitching: false,
  mcp: "none",
  mobileCompanion: false,
  vscodeBridge: false,
  recipes: 1,
  recipeTrialDays: 3,
  byokKeys: 0,
  missionAiMessages: 3,
  missionAiPeriod: "day"
});

// The features a refusal can be about, with the words the UI uses for them.
const FEATURES = Object.freeze({
  terminals: { label: "More terminals" },
  projectSwitching: { label: "Switching projects" },
  mcp: { label: "Secure MCP gateway" },
  mcpActions: { label: "MCP actions" },
  mobileCompanion: { label: "Mobile companion" },
  vscodeBridge: { label: "VS Code bridge" },
  recipes: { label: "More recipes" },
  recipeTrial: { label: "Workspace recipes" },
  byokKeys: { label: "Your own AI keys" },
  missionAiMessages: { label: "Unlimited Mission AI" }
});

const MCP_LEVELS = Object.freeze(["none", "read", "full"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function limitNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : null;
}

function normalizeLimits(raw) {
  const source = isPlainObject(raw) ? raw : {};
  const pick = (key, fallback) => (Object.hasOwn(source, key) ? source[key] : fallback);
  return {
    terminals: limitNumber(pick("terminals", FALLBACK_LIMITS.terminals)),
    projects: limitNumber(pick("projects", FALLBACK_LIMITS.projects)),
    projectSwitching: pick("projectSwitching", FALLBACK_LIMITS.projectSwitching) === true,
    mcp: MCP_LEVELS.includes(pick("mcp", FALLBACK_LIMITS.mcp)) ? pick("mcp", FALLBACK_LIMITS.mcp) : "none",
    mobileCompanion: pick("mobileCompanion", FALLBACK_LIMITS.mobileCompanion) === true,
    vscodeBridge: pick("vscodeBridge", FALLBACK_LIMITS.vscodeBridge) === true,
    recipes: limitNumber(pick("recipes", FALLBACK_LIMITS.recipes)),
    recipeTrialDays: limitNumber(pick("recipeTrialDays", FALLBACK_LIMITS.recipeTrialDays)),
    byokKeys: limitNumber(pick("byokKeys", FALLBACK_LIMITS.byokKeys)),
    missionAiMessages: limitNumber(pick("missionAiMessages", FALLBACK_LIMITS.missionAiMessages)),
    missionAiPeriod: ["day", "month", "lifetime"].includes(pick("missionAiPeriod", "day")) ? pick("missionAiPeriod", "day") : "day"
  };
}

function normalizePlanCatalogue(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(row => isPlainObject(row) && typeof row.id === "string")
    .map(row => ({
      id: row.id,
      name: String(row.name || row.id),
      rank: Number.isFinite(Number(row.rank)) ? Number(row.rank) : PLAN_ORDER.indexOf(row.id),
      tagline: String(row.tagline || ""),
      priceLabel: String(row.price_label ?? row.priceLabel ?? ""),
      highlights: Array.isArray(row.highlights) ? row.highlights.map(String).slice(0, 12) : [],
      purchasable: row.purchasable !== false,
      limits: normalizeLimits(row.limits)
    }))
    .sort((a, b) => a.rank - b.rank);
}

// Does a plan's limits allow this feature (at this size)?
function limitsAllow(limits, feature, amount = 1) {
  switch (feature) {
    case "terminals": return limits.terminals === null || amount <= limits.terminals;
    case "projectSwitching": return limits.projectSwitching === true;
    case "mcp": return limits.mcp !== "none";
    case "mcpActions": return limits.mcp === "full";
    case "mobileCompanion": return limits.mobileCompanion === true;
    case "vscodeBridge": return limits.vscodeBridge === true;
    case "recipes": return limits.recipes === null || amount <= limits.recipes;
    case "recipeTrial": return limits.recipeTrialDays === null;
    case "byokKeys": return limits.byokKeys === null || amount <= limits.byokKeys;
    case "missionAiMessages": return limits.missionAiMessages === null;
    default: return false;
  }
}

class PlanRefusal extends Error {
  constructor(details) {
    super(details.message);
    this.name = "PlanRefusal";
    this.code = "PLAN_REQUIRED";
    this.feature = details.feature;
    this.requiredPlan = details.requiredPlan || null;
    this.currentPlan = details.currentPlan || null;
    this.limit = details.limit ?? null;
  }

  toJSON() {
    return { code: this.code, feature: this.feature, requiredPlan: this.requiredPlan, currentPlan: this.currentPlan, limit: this.limit, message: this.message };
  }
}

class Entitlements {
  #snapshot;
  #limits;
  #plans;
  #now;

  constructor(snapshot = {}, options = {}) {
    this.#snapshot = isPlainObject(snapshot) ? snapshot : {};
    this.#limits = normalizeLimits(this.#snapshot.limits);
    this.#plans = normalizePlanCatalogue(this.#snapshot.plans);
    this.#now = typeof options.now === "function" ? options.now : Date.now;
  }

  get planId() { return this.#snapshot.plan?.id || "free"; }
  get planName() { return this.#snapshot.plan?.name || "Free"; }
  get limits() { return { ...this.#limits }; }

  // The cheapest plan in the catalogue that allows the feature at this size.
  requiredPlanFor(feature, amount = 1) {
    const current = this.#plans.find(plan => plan.id === this.planId);
    const currentRank = current ? current.rank : PLAN_ORDER.indexOf(this.planId);
    const candidate = this.#plans.find(plan => plan.rank > currentRank && limitsAllow(plan.limits, feature, amount));
    if (candidate) return { id: candidate.id, name: candidate.name };
    // No catalogue yet: the plan table's defaults.
    const fallback = ["mcpActions", "vscodeBridge"].includes(feature) ? "ultimate" : "pro";
    if (PLAN_ORDER.indexOf(fallback) <= currentRank) return { id: "ultimate", name: "Ultimate" };
    return { id: fallback, name: fallback === "pro" ? "Pro" : "Ultimate" };
  }

  #refuse(feature, message, extra = {}) {
    const required = this.requiredPlanFor(feature, extra.amount ?? 1);
    return new PlanRefusal({
      feature,
      requiredPlan: required,
      currentPlan: { id: this.planId, name: this.planName },
      limit: extra.limit ?? null,
      message: `${message} ${required ? `Upgrade to ${required.name} to unlock it.` : ""}`.trim()
    });
  }

  terminalLimit() { return this.#limits.terminals; }

  // A new worker definition beyond the plan's terminal count.
  checkCreateTerminal(existingCount) {
    const limit = this.#limits.terminals;
    if (limit === null || existingCount < limit) return null;
    return this.#refuse("terminals", `Your ${this.planName} plan includes ${limit} terminal${limit === 1 ? "" : "s"}.`, { limit, amount: existingCount + 1 });
  }

  // Starting one more process while `running` are already live.
  checkRunTerminal(running) {
    const limit = this.#limits.terminals;
    if (limit === null || running < limit) return null;
    return this.#refuse("terminals", `Your ${this.planName} plan runs up to ${limit} terminal${limit === 1 ? "" : "s"} at once.`, { limit, amount: running + 1 });
  }

  checkProjectSwitch({ currentPersistent = true, sameProject = false } = {}) {
    if (this.#limits.projectSwitching || sameProject) return null;
    // The first project a Free operator opens is their project.
    if (!currentPersistent) return null;
    return this.#refuse("projectSwitching", `Your ${this.planName} plan keeps one project open.`);
  }

  mcpLevel() { return this.#limits.mcp; }

  checkMcp() {
    if (this.#limits.mcp !== "none") return null;
    return this.#refuse("mcp", `The Secure MCP gateway is not included in the ${this.planName} plan.`);
  }

  checkMcpAction() {
    if (this.#limits.mcp === "full") return null;
    if (this.#limits.mcp === "none") return this.checkMcp();
    return this.#refuse("mcpActions", `Your ${this.planName} plan gives AI tools read-only MCP access.`);
  }

  checkMobile() {
    if (this.#limits.mobileCompanion) return null;
    return this.#refuse("mobileCompanion", `The mobile companion is not included in the ${this.planName} plan.`);
  }

  checkVsCode() {
    if (this.#limits.vscodeBridge) return null;
    return this.#refuse("vscodeBridge", `The VS Code bridge is not included in the ${this.planName} plan.`);
  }

  recipeTrial() {
    const days = this.#limits.recipeTrialDays;
    if (days === null) return { limited: false, active: true, endsAt: null, days: null };
    const endsAt = Date.parse(this.#snapshot.recipeTrial?.endsAt || "") || null;
    return { limited: true, active: endsAt !== null && this.#now() < endsAt, endsAt, days };
  }

  checkRecipeUse() {
    const trial = this.recipeTrial();
    if (!trial.limited || trial.active) return null;
    return this.#refuse("recipeTrial", `Your ${trial.days}-day recipe trial has ended.`);
  }

  checkRecipeCreate(existingCount) {
    const used = this.checkRecipeUse();
    if (used) return used;
    const limit = this.#limits.recipes;
    if (limit === null || existingCount < limit) return null;
    return this.#refuse("recipes", `Your ${this.planName} plan includes ${limit} recipe${limit === 1 ? "" : "s"}.`, { limit, amount: existingCount + 1 });
  }

  byokLimit() { return this.#limits.byokKeys; }

  checkByokAdd(existingCount) {
    const limit = this.#limits.byokKeys;
    if (limit === null || existingCount < limit) return null;
    if (limit === 0) return this.#refuse("byokKeys", `Bringing your own AI keys is not included in the ${this.planName} plan.`, { limit, amount: 1 });
    return this.#refuse("byokKeys", `Your ${this.planName} plan includes ${limit} key${limit === 1 ? "" : "s"} of your own.`, { limit, amount: existingCount + 1 });
  }

  // Which saved keys may answer: the oldest ones, up to the plan's count.
  allowedByokKeyIds(keys) {
    const limit = this.#limits.byokKeys;
    const ordered = [...(Array.isArray(keys) ? keys : [])].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    return new Set((limit === null ? ordered : ordered.slice(0, limit)).map(key => key.id));
  }
}

module.exports = { Entitlements, FALLBACK_LIMITS, FEATURES, MCP_LEVELS, PLAN_ORDER, PlanRefusal, limitsAllow, normalizeLimits, normalizePlanCatalogue };
