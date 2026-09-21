// What the operator's plan allows, as the renderer shows it.
//
// The main process decides (src/service/entitlements.cjs refuses anything
// outside the plan); this mirror only decides what to draw: a crown on a
// feature the plan does not include, the plan that would unlock it, and how
// much of a metered allowance is left. A null limit means unlimited, and a
// status without limits (a development harness) locks nothing.

export const PLAN_FEATURES = Object.freeze({
  terminals: { label: "More terminals", detail: "Run more terminals side by side." },
  projectSwitching: { label: "Switching projects", detail: "Open and switch between all of your projects." },
  mcp: { label: "Secure MCP gateway", detail: "Let Claude Code, Codex and other AI tools read your workspace." },
  mcpActions: { label: "MCP actions", detail: "Let AI tools start, stop and type into terminals, with your approval." },
  mobileCompanion: { label: "Mobile companion", detail: "Watch and answer your workspace from your phone." },
  vscodeBridge: { label: "VS Code bridge", detail: "Editor context and managed terminals in VS Code." },
  recipes: { label: "More recipes", detail: "Save more workspace recipes." },
  recipeTrial: { label: "Workspace recipes", detail: "Launch whole workspaces from a saved recipe." },
  byokKeys: { label: "Your own AI keys", detail: "Bring API keys from OpenAI, Anthropic, Gemini and more." },
  missionAiMessages: { label: "Unlimited Mission AI", detail: "Ask Mission AI as often as you like." }
});

const ORDER = ["free", "pro", "ultimate"];

export function limitsAllow(limits, feature, amount = 1) {
  if (!limits) return true;
  switch (feature) {
    case "terminals": return limits.terminals == null || amount <= limits.terminals;
    case "projectSwitching": return limits.projectSwitching === true;
    case "mcp": return limits.mcp !== "none";
    case "mcpActions": return limits.mcp === "full";
    case "mobileCompanion": return limits.mobileCompanion === true;
    case "vscodeBridge": return limits.vscodeBridge === true;
    case "recipes": return limits.recipes == null || amount <= limits.recipes;
    case "recipeTrial": return limits.recipeTrialDays == null;
    case "byokKeys": return limits.byokKeys == null || amount <= limits.byokKeys;
    case "missionAiMessages": return limits.missionAiMessages == null;
    default: return true;
  }
}

export function currentPlan(status) {
  const plan = status?.plan;
  return { id: plan?.id || "free", name: plan?.name || "Free", rank: Number.isFinite(plan?.rank) ? plan.rank : ORDER.indexOf(plan?.id || "free") };
}

// The cheapest plan above the current one that includes the feature.
export function requiredPlanFor(status, feature, amount = 1) {
  const current = currentPlan(status);
  const plans = Array.isArray(status?.plans) ? [...status.plans].sort((a, b) => a.rank - b.rank) : [];
  const found = plans.find(plan => plan.rank > current.rank && limitsAllow(plan.limits, feature, amount));
  if (found) return { id: found.id, name: found.name };
  const fallback = feature === "mcpActions" || feature === "vscodeBridge" || current.id === "pro" ? "ultimate" : "pro";
  return { id: fallback, name: fallback === "pro" ? "Pro" : "Ultimate" };
}

// The plan one step above the current one, or null at the top.
export function nextPlan(status) {
  const current = currentPlan(status);
  const plans = Array.isArray(status?.plans) ? [...status.plans].filter(plan => plan.purchasable !== false).sort((a, b) => a.rank - b.rank) : [];
  const found = plans.find(plan => plan.rank > current.rank);
  if (found) return { id: found.id, name: found.name };
  if (current.id === "free") return { id: "pro", name: "Pro" };
  if (current.id === "pro") return { id: "ultimate", name: "Ultimate" };
  return null;
}

// A managed status carries limits; the harness and tests do not, and lock nothing.
export function planLimits(status) {
  return status && status.limits && typeof status.limits === "object" ? status.limits : null;
}

export function isLocked(status, feature, amount = 1) {
  return !limitsAllow(planLimits(status), feature, amount);
}

export function recipeTrial(status, now = Date.now()) {
  const limits = planLimits(status);
  if (!limits || limits.recipeTrialDays == null) return { limited: false, active: true, endsAt: null, daysLeft: null };
  const endsAt = Date.parse(status?.recipeTrial?.endsAt || "") || null;
  const active = endsAt !== null && now < endsAt;
  const daysLeft = active ? Math.max(1, Math.ceil((endsAt - now) / 86_400_000)) : 0;
  return { limited: true, active, endsAt, daysLeft };
}

export function missionAiAllowance(status) {
  const usage = status?.usage?.missionAiMessages;
  const limit = planLimits(status)?.missionAiMessages;
  if (limit == null) return { limited: false, used: Number(usage?.used) || 0, limit: null, left: null, resetsAt: null, period: usage?.period || "day" };
  const used = Math.max(0, Number(usage?.used) || 0);
  return { limited: true, used, limit, left: Math.max(0, limit - used), resetsAt: usage?.resetsAt || null, period: usage?.period || "day" };
}

export function formatLimit(value, unit, plural = `${unit}s`) {
  if (value == null) return `Unlimited ${plural}`;
  return `${value} ${value === 1 ? unit : plural}`;
}
