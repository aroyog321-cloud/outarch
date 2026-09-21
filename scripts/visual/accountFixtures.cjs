// Account and update states for the visual harness.
//
//   OUTARCH_HARNESS_ACCOUNT = signed-out | signing-in | checking | free | pro | ultimate | free-empty | none
//   OUTARCH_HARNESS_UPDATE  = available | downloading | ready | dev   (unset: up to date)
//
// "none" leaves the account bridge out entirely, which is how every older probe
// ran (nothing locked). Each status has the exact shape AccountService.status()
// returns, so the renderer runs its real code path.

const PLANS = [
  { id: "free", name: "Free", rank: 0, tagline: "", priceLabel: "", purchasable: false, highlights: ["3 terminals", "1 project", "Recipes: 3-day trial, 1 recipe", "Mission AI: 3 messages a day"], limits: { terminals: 3, projects: 1, projectSwitching: false, mcp: "none", mobileCompanion: false, vscodeBridge: false, recipes: 1, recipeTrialDays: 3, byokKeys: 0, missionAiMessages: 3, missionAiPeriod: "day" } },
  { id: "pro", name: "Pro", rank: 1, tagline: "", priceLabel: "", purchasable: true, highlights: ["8 terminals", "Unlimited projects and switching", "MCP read access", "Mobile companion", "3 recipes", "1 BYOK key", "Full Mission AI"], limits: { terminals: 8, projects: null, projectSwitching: true, mcp: "read", mobileCompanion: true, vscodeBridge: false, recipes: 3, recipeTrialDays: null, byokKeys: 1, missionAiMessages: null, missionAiPeriod: "day" } },
  { id: "ultimate", name: "Ultimate", rank: 2, tagline: "", priceLabel: "", purchasable: true, highlights: ["Unlimited terminals", "Full MCP access", "Mobile companion", "VS Code bridge", "Unlimited recipes", "Unlimited BYOK keys", "Full Mission AI"], limits: { terminals: null, projects: null, projectSwitching: true, mcp: "full", mobileCompanion: true, vscodeBridge: true, recipes: null, recipeTrialDays: null, byokKeys: null, missionAiMessages: null, missionAiPeriod: "day" } }
];

function status(kind) {
  const now = Date.now();
  const base = {
    engineReady: true,
    offline: false,
    graceEndsAt: null,
    plans: PLANS,
    builtinAiProviders: ["gemini", "nvidia"],
    verifiedAt: now,
    signIn: null,
    error: null,
    websiteUrl: "http://localhost:5173",
    supportEmail: ""
  };
  if (["signed-out", "signing-in", "checking"].includes(kind)) {
    return { ...base, state: kind, authorized: false, engineReady: false, user: null, plan: { id: "free", name: "Free", rank: 0 }, limits: PLANS[0].limits, signIn: kind === "signing-in" ? { mode: "signin", startedAt: now, expiresAt: now + 900000 } : null };
  }
  const planId = kind.startsWith("free") ? "free" : kind;
  const plan = PLANS.find(item => item.id === planId);
  return {
    ...base,
    state: "authorized",
    authorized: true,
    user: { id: "u1", email: "satish@outarch.dev", name: "Satish Kumar", provider: "google" },
    plan: { id: plan.id, name: plan.name, rank: plan.rank },
    subscription: { planId: plan.id, status: "active", currentPeriodEnd: plan.id === "pro" ? new Date(now + 24 * 86400000).toISOString() : null, provider: "manual" },
    limits: plan.limits,
    usage: { missionAiMessages: { used: kind === "free-empty" ? 3 : 1, limit: plan.limits.missionAiMessages, period: "day", resetsAt: new Date(now + 6 * 3600000).toISOString() } },
    recipeTrial: plan.id === "free" ? { days: 3, startedAt: new Date(now - 86400000).toISOString(), endsAt: new Date(now + 2 * 86400000).toISOString() } : null
  };
}

function updateStatus(kind) {
  const available = { version: "2.20.0", notes: "Sign in with Google, plans, and automatic updates.\nAgent permission prompts now notify you.", size: 18_400_000, publishedAt: new Date().toISOString(), mandatory: false };
  switch (kind) {
    case "available": return { state: "available", currentVersion: "2.19.0", available, progress: null, error: null, checkedAt: Date.now(), canInstall: true, installBlockedReason: null };
    case "downloading": return { state: "downloading", currentVersion: "2.19.0", available, progress: { received: 7_600_000, total: 18_400_000 }, error: null, checkedAt: Date.now(), canInstall: true, installBlockedReason: null };
    case "ready": return { state: "ready", currentVersion: "2.19.0", available, progress: { received: 18_400_000, total: 18_400_000 }, error: null, checkedAt: Date.now(), canInstall: true, installBlockedReason: null };
    case "dev": return { state: "available", currentVersion: "2.19.0", available, progress: null, error: null, checkedAt: Date.now(), canInstall: false, installBlockedReason: "This copy of OUTARCH is a development checkout, so it is never overwritten. Update it with git." };
    default: return { state: "up-to-date", currentVersion: "2.19.0", available: null, progress: null, error: null, checkedAt: Date.now(), canInstall: false, installBlockedReason: null };
  }
}

module.exports = { PLANS, status, updateStatus };
