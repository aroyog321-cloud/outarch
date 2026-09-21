import React from "react";
import { requestUpgrade, useAccount, useUpdates } from "./useAccount.js";
import { currentPlan, formatLimit, missionAiAllowance, nextPlan, planLimits, recipeTrial, requiredPlanFor } from "./planRules.js";
import { CrownIcon, PlanBadge, isFeatureLocked } from "./PlanLock.jsx";

// Settings → Account & plan, the Updates panel in About, and the two places
// the account is always visible: the sidebar row and the status tape chip.

function initialOf(user) {
  const source = String(user?.name || user?.email || "").trim();
  return (Array.from(source)[0] || "O").toUpperCase();
}

function formatDate(value) {
  const at = Date.parse(value || "");
  if (!Number.isFinite(at)) return "";
  return new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function signedInWith(user) {
  return user?.provider === "google" ? "Google" : "email and password";
}

function UserIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5a7.2 7.2 0 0 1 14.4 0"/></svg>;
}

function RefreshIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.3 4.9L20 16"/><path d="M20 20v-4h-4"/></svg>;
}

// Each row of "what your plan includes", with the crown when it is locked.
function planRows(status) {
  const limits = planLimits(status);
  if (!limits) return [];
  const allowance = missionAiAllowance(status);
  const trial = recipeTrial(status);
  const recipes = trial.limited
    ? trial.active
      ? `${formatLimit(limits.recipes, "recipe")} · trial ends in ${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"}`
      : "Trial ended"
    : formatLimit(limits.recipes, "recipe");
  const period = allowance.period === "month" ? "this month" : allowance.period === "lifetime" ? "in total" : "today";
  return [
    { id: "terminals", label: "Terminals", value: limits.terminals == null ? "Unlimited" : `${limits.terminals} at once`, feature: "terminals", amount: (limits.terminals ?? 0) + 1 },
    { id: "projects", label: "Projects", value: limits.projectSwitching ? "All projects, switch any time" : "One project", feature: "projectSwitching" },
    { id: "mission-ai", label: "Mission AI", value: allowance.limited ? `${allowance.left} of ${allowance.limit} messages left ${period}` : "Unlimited", feature: "missionAiMessages" },
    { id: "byok", label: "Your own AI keys", value: limits.byokKeys === 0 ? "Not included" : limits.byokKeys == null ? "Unlimited" : formatLimit(limits.byokKeys, "key"), feature: "byokKeys", amount: (limits.byokKeys ?? 0) + 1 },
    { id: "recipes", label: "Recipes", value: recipes, feature: trial.limited ? "recipeTrial" : "recipes", amount: (limits.recipes ?? 0) + 1 },
    { id: "mcp", label: "Secure MCP", value: limits.mcp === "full" ? "Full access" : limits.mcp === "read" ? "Read-only access" : "Not included", feature: limits.mcp === "none" ? "mcp" : "mcpActions" },
    { id: "mobile", label: "Mobile companion", value: limits.mobileCompanion ? "Included" : "Not included", feature: "mobileCompanion" },
    { id: "vscode", label: "VS Code bridge", value: limits.vscodeBridge ? "Included" : "Not included", feature: "vscodeBridge" }
  ];
}

function rowLocked(status, row) {
  if (row.feature === "recipeTrial") return planLimits(status)?.recipeTrialDays != null;
  return isFeatureLocked(status, row.feature, row.amount || 1);
}

export function AccountSettings({ onConfirm }) {
  const { status, api } = useAccount();
  const [refreshing, setRefreshing] = React.useState(false);
  const [error, setError] = React.useState("");
  const plan = currentPlan(status);
  const user = status?.user || null;
  const subscription = status?.subscription || null;
  const rows = planRows(status);
  const next = nextPlan(status);
  const top = !next;

  const refresh = async () => {
    setRefreshing(true);
    setError("");
    try { await api?.refresh(); }
    catch (reason) { setError(reason?.message || "Your plan could not be refreshed."); }
    finally { setRefreshing(false); }
  };
  const signOut = () => {
    const run = async () => {
      try { await api?.signOut(); }
      catch (reason) { setError(reason?.message || "Signing out did not finish."); }
    };
    if (typeof onConfirm === "function") {
      onConfirm({
        title: "Sign out of OUTARCH?",
        detail: "OUTARCH locks until you sign in again. Terminals that are running keep running.",
        recovery: "Sign in again with the same account to pick up where you left off.",
        confirmLabel: "Sign out",
        run
      });
    } else void run();
  };

  const periodEnd = subscription?.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : "";
  const planLine = plan.id === "free"
    ? "Free forever. Upgrade when you need more."
    : subscription?.status && subscription.status !== "active" && subscription.status !== "trialing"
      ? `Your ${plan.name} plan is ${subscription.status.replace("_", " ")}.`
      : periodEnd ? `Active until ${periodEnd}` : "Active, no end date";

  return <div className="settings-view"><div className="settings-grid"><section className="settings-panel settings-panel-wide pm-card account-panel">
    <div className="settings-panel__head"><UserIcon/><div><h3>Account and plan</h3><p>Who is signed in, and what your plan includes. Plans are managed on the OUTARCH website.</p></div></div>

    <div className="account-identity">
      <span className="account-avatar" aria-hidden="true">{initialOf(user)}</span>
      <div className="account-identity__copy">
        <strong>{user?.name || user?.email || "Signed in"}</strong>
        <small>{user?.name && user?.email ? `${user.email} · ` : ""}Signed in with {signedInWith(user)}</small>
      </div>
      <button type="button" className="btn-ghost account-identity__signout" onClick={signOut}>Sign out</button>
    </div>

    <div className={`account-plan account-plan--${plan.id}`}>
      <span className="account-plan__mark" aria-hidden="true"><CrownIcon size={18}/></span>
      <div className="account-plan__copy">
        <strong>{plan.name} plan</strong>
        <small>{planLine}</small>
      </div>
      <div className="account-plan__actions">
        <button type="button" className="btn-secondary account-plan__refresh" disabled={refreshing || !api} onClick={() => void refresh()} aria-label="Check your plan again"><RefreshIcon/><span>{refreshing ? "Checking…" : "Refresh"}</span></button>
        {top
          ? <button type="button" className="btn-secondary" disabled={!api} onClick={() => void api?.openPortal("account")}>Manage plan</button>
          : <button type="button" className="plan-upgrade-button" disabled={!api} onClick={() => void api?.openPortal("pricing", { plan: next?.id })}><CrownIcon size={13}/>Upgrade to {next?.name || "Pro"}</button>}
      </div>
    </div>

    {rows.length ? <dl className="account-limits" aria-label={`What the ${plan.name} plan includes`}>
      {rows.map(row => {
        const locked = rowLocked(status, row);
        return <div key={row.id} className={locked ? "is-locked" : ""}>
          <dt>{row.label}</dt>
          <dd>
            <span>{row.value}</span>
            {locked ? <button type="button" className="account-limits__unlock" onClick={() => requestUpgrade({ feature: row.feature, amount: row.amount })} aria-label={`${row.label}: see the plan that includes more`}><PlanBadge plan={requiredPlanFor(status, row.feature, row.amount || 1)}/></button> : null}
          </dd>
        </div>;
      })}
    </dl> : null}

    {status?.offline ? <p className="settings-note account-note" role="status">You are offline. OUTARCH keeps your last confirmed plan until {status.graceEndsAt ? formatDate(new Date(status.graceEndsAt).toISOString()) : "it can check again"}.</p> : null}
    {error || status?.error ? <p className="settings-save-error" role="alert">{error || status.error}</p> : null}
  </section></div></div>;
}

// ------------------------------------------------------------------ updates

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

export function confirmUpdate({ api, status, onConfirm }) {
  const version = status?.available?.version || "the new version";
  const run = async () => { await api?.install(); };
  if (typeof onConfirm !== "function") return void run();
  onConfirm({
    title: `Restart to update to ${version}?`,
    detail: "OUTARCH stops its terminals cleanly, installs the update and opens again. Anything a terminal is doing right now is interrupted.",
    recovery: "If the update cannot be applied, the current version is restored and opens instead.",
    confirmLabel: "Restart and update",
    run
  });
}

export function UpdatesPanel({ onConfirm }) {
  const { status, api } = useUpdates();
  const [busy, setBusy] = React.useState(false);
  if (!api) return null;
  const state = status?.state || "idle";
  const available = status?.available || null;
  const progress = status?.progress;
  const percent = progress?.total ? Math.min(100, Math.round((progress.received / progress.total) * 100)) : 0;
  const act = async operation => {
    setBusy(true);
    try { await operation(); } catch { /* the status line carries the reason */ }
    finally { setBusy(false); }
  };
  let line = "OUTARCH checks for updates in the background.";
  if (state === "checking") line = "Checking for updates…";
  else if (state === "up-to-date") line = "You have the latest version.";
  else if (state === "downloading") line = `Downloading ${available?.version || "the update"}… ${percent}%`;
  else if (state === "ready") line = `${available?.version} is downloaded and verified.`;
  else if (state === "installing") line = "Installing — OUTARCH will restart.";
  else if (available) line = `${available.version} is available${available.size ? ` · ${formatBytes(available.size)}` : ""}.`;

  return <div className="update-panel" aria-live="polite">
    <div className="update-panel__row">
      <div className="update-panel__copy">
        <strong>Updates</strong>
        <small>{line}</small>
        {status?.error ? <small className="update-panel__error" role="alert">{status.error}</small> : null}
        {available && !status?.canInstall && status?.installBlockedReason ? <small className="update-panel__note">{status.installBlockedReason}</small> : null}
      </div>
      <div className="update-panel__actions">
        {available && status?.canInstall && state !== "installing"
          ? <button type="button" className="btn-primary" disabled={busy || state === "downloading"} onClick={() => confirmUpdate({ api, status, onConfirm })}>{state === "ready" ? "Restart to update" : "Update now"}</button>
          : <button type="button" className="btn-secondary" disabled={busy || state === "checking" || state === "downloading"} onClick={() => void act(() => api.check())}>Check for updates</button>}
      </div>
    </div>
    {state === "downloading" ? <span className="update-panel__progress" aria-hidden="true"><i style={{ transform: `scaleX(${percent / 100})` }}/></span> : null}
    {available?.notes ? <details className="update-panel__notes"><summary>What's new in {available.version}</summary><p>{available.notes}</p></details> : null}
    <small className="update-panel__trust">Every update is signed by OUTARCH and verified before it installs.</small>
  </div>;
}

// ------------------------------------------------------------ always visible

/** The account row in the sidebar footer, the counterpart of the project switcher. */
export function SidebarAccountButton({ onOpen }) {
  const { status } = useAccount();
  if (!status || status.unmanaged) return null;
  const plan = currentPlan(status);
  const user = status.user;
  const label = user?.email || user?.name || "Account";
  return <button type="button" className={`top-account top-account--${plan.id}`} data-tooltip={`${plan.name} plan · ${label}`} aria-label={`Account and plan. ${plan.name} plan, signed in as ${label}`} onClick={onOpen}>
    <span className="top-account__mark" aria-hidden="true">{initialOf(user)}</span>
    <div><small><CrownIcon size={10}/>{plan.name} plan</small><strong>{label}</strong></div>
  </button>;
}

/** A quiet "Upgrade" in the status tape for a plan below the top one. */
export function PlanTapeChip() {
  const { status } = useAccount();
  if (!status || status.unmanaged || !status.limits) return null;
  const plan = currentPlan(status);
  const next = nextPlan(status);
  if (!next) return null;
  return <button type="button" className="status-plan-chip" onClick={() => requestUpgrade({ feature: next.id === "ultimate" ? "vscodeBridge" : "terminals", requiredPlan: next })} aria-label={`${plan.name} plan. Upgrade to ${next.name}`}>
    <CrownIcon size={11}/><span>{plan.name}</span><b>Upgrade</b>
  </button>;
}

/** "Update ready" in the status tape once a verified update is downloaded or available. */
export function UpdateTapeChip({ onConfirm }) {
  const { status, api } = useUpdates();
  if (!api || !status?.available || !status.canInstall || status.state === "installing") return null;
  return <button type="button" className="status-update-chip" onClick={() => confirmUpdate({ api, status, onConfirm })} aria-label={`Update OUTARCH to ${status.available.version}`}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m5.5 11.5 6.5-6.5 6.5 6.5"/></svg>
    <span>Update {status.available.version}</span>
  </button>;
}
