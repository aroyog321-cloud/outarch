import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { PLAN_REQUIRED_EVENT, requestUpgrade, useAccount } from "./useAccount.js";
import { PLAN_FEATURES, currentPlan, missionAiAllowance, planLimits, recipeTrial, requiredPlanFor } from "./planRules.js";

// The premium grammar: one crown, one gold, one dialog. A feature the plan
// does not include keeps its place in the interface and wears the crown, so
// the operator can see what exists and what unlocks it — clicking it explains
// instead of failing.

export function CrownIcon({ size = 14, className = "" }) {
  return <svg className={`plan-crown${className ? ` ${className}` : ""}`} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M3.2 8.4 8.3 12.3 12 5.2l3.7 7.1 5.1-3.9-1.9 9.1H5.1Z" fill="currentColor"/>
    <rect x="5.1" y="18.6" width="13.8" height="2" rx="1" fill="currentColor"/>
    <circle cx="3.2" cy="8.2" r="1.35" fill="currentColor"/>
    <circle cx="12" cy="4.6" r="1.35" fill="currentColor"/>
    <circle cx="20.8" cy="8.2" r="1.35" fill="currentColor"/>
  </svg>;
}

function CheckIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7"/></svg>;
}

/** A small crown chip: "Pro", "Ultimate". */
export function PlanBadge({ plan, compact = false, className = "" }) {
  if (!plan) return null;
  const name = typeof plan === "string" ? plan : plan.name;
  return <span className={`plan-badge${compact ? " plan-badge--compact" : ""}${className ? ` ${className}` : ""}`} title={`${name} feature`}>
    <CrownIcon size={compact ? 10 : 11}/>{compact ? null : <span>{name}</span>}
    {compact ? <span className="sr-only">{name} feature</span> : null}
  </span>;
}

/** The crown for a feature the current plan does not include, or nothing. */
export function FeatureCrown({ feature, amount = 1, compact = false, className = "" }) {
  const { status } = useAccount();
  const locked = isFeatureLocked(status, feature, amount);
  if (!locked) return null;
  return <PlanBadge plan={requiredPlanFor(status, feature, amount)} compact={compact} className={className}/>;
}

export function isFeatureLocked(status, feature, amount = 1) {
  const limits = status?.limits && typeof status.limits === "object" ? status.limits : null;
  if (!limits) return false;
  switch (feature) {
    case "terminals": return limits.terminals != null && amount > limits.terminals;
    case "projectSwitching": return limits.projectSwitching !== true;
    case "mcp": return limits.mcp === "none";
    case "mcpActions": return limits.mcp !== "full";
    case "mobileCompanion": return limits.mobileCompanion !== true;
    case "vscodeBridge": return limits.vscodeBridge !== true;
    case "recipes": return limits.recipes != null && amount > limits.recipes;
    case "byokKeys": return limits.byokKeys != null && amount > limits.byokKeys;
    case "missionAiMessages": return limits.missionAiMessages != null;
    default: return false;
  }
}

const TITLES = {
  terminals: name => `Run more terminals with ${name}`,
  projectSwitching: name => `Switch between projects with ${name}`,
  mcp: name => `Secure MCP is part of ${name}`,
  mcpActions: name => `MCP actions are part of ${name}`,
  mobileCompanion: name => `The mobile companion is part of ${name}`,
  vscodeBridge: name => `The VS Code bridge is part of ${name}`,
  recipes: name => `Save more recipes with ${name}`,
  recipeTrial: name => `Keep using recipes with ${name}`,
  byokKeys: name => `Use your own AI keys with ${name}`,
  missionAiMessages: name => `Unlimited Mission AI with ${name}`
};

// The server's refusal ends by naming the plan; the dialog's button says that.
function detailFrom(message, feature) {
  const reason = String(message || "").replace(/\s*Upgrade to [A-Za-z]+ (?:to unlock it|for [^.]*)\.?\s*$/, "").trim();
  const what = PLAN_FEATURES[feature]?.detail || "";
  return [reason, what].filter(Boolean).join(" ");
}

export function UpgradeDialog({ request, onClose }) {
  const { status, api } = useAccount();
  const feature = request?.feature || "terminals";
  const required = request?.requiredPlan?.id ? request.requiredPlan : requiredPlanFor(status, feature, request?.amount || 1);
  const plan = (status?.plans || []).find(item => item.id === required.id) || null;
  const current = currentPlan(status);
  const title = (TITLES[feature] || (name => `Unlock this with ${name}`))(required.name);
  const upgrade = () => {
    void api?.openPortal?.("pricing", { plan: required.id, feature });
    onClose();
  };
  return <Dialog.Root open onOpenChange={open => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="plan-dialog-backdrop"/>
      <Dialog.Content className="plan-dialog" aria-describedby="plan-dialog-detail">
        <span className="plan-dialog__mark"><CrownIcon size={22}/></span>
        <div className="plan-dialog__body">
          <span className="plan-dialog__kicker">{required.name} feature</span>
          <Dialog.Title className="plan-dialog__title">{title}</Dialog.Title>
          <Dialog.Description id="plan-dialog-detail" className="plan-dialog__detail">{detailFrom(request?.message, feature)}</Dialog.Description>
          {plan?.highlights?.length ? <ul className="plan-dialog__list" aria-label={`${required.name} includes`}>
            {plan.highlights.slice(0, 6).map(item => <li key={item}><CheckIcon/><span>{item}</span></li>)}
          </ul> : null}
          <p className="plan-dialog__current">You are on the {current.name} plan{plan?.priceLabel ? <> · {required.name} is <b>{plan.priceLabel}</b></> : null}.</p>
        </div>
        <footer className="plan-dialog__footer">
          <Dialog.Close asChild><button type="button" className="plan-dialog__secondary">Not now</button></Dialog.Close>
          <button type="button" className="plan-dialog__primary" onClick={upgrade} disabled={!api}><CrownIcon size={14}/>Upgrade to {required.name}</button>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** Mounted once: opens the upgrade dialog whenever anything asks for it. */
export function UpgradeHost() {
  const [request, setRequest] = React.useState(null);
  React.useEffect(() => {
    const open = event => setRequest(event?.detail && typeof event.detail === "object" ? event.detail : { feature: "terminals" });
    window.addEventListener(PLAN_REQUIRED_EVENT, open);
    return () => window.removeEventListener(PLAN_REQUIRED_EVENT, open);
  }, []);
  return request ? <UpgradeDialog request={request} onClose={() => setRequest(null)}/> : null;
}

/**
 * Stands in for a section the plan does not include: what it does, the plan
 * that includes it, and the way there. The section's own settings are not
 * rendered under it, so nothing on screen can be clicked into a refusal.
 */
export function PlanLockPanel({ feature, title, description = "", children = null }) {
  const { status } = useAccount();
  const required = requiredPlanFor(status, feature);
  return <section className="plan-lock" aria-label={`${title}: ${required.name} feature`}>
    <span className="plan-lock__mark"><CrownIcon size={20}/></span>
    <div className="plan-lock__copy">
      <span className="plan-lock__kicker">{required.name} feature</span>
      <h3>{title}</h3>
      <p>{description || PLAN_FEATURES[feature]?.detail || ""}</p>
      {children}
    </div>
    <button type="button" className="plan-lock__cta" onClick={() => requestUpgrade({ feature, requiredPlan: required })}><CrownIcon size={13}/>Unlock with {required.name}</button>
  </section>;
}

/** "2 of 3 messages left today" — only on a plan that meters Mission AI. */
export function MissionAiAllowance({ className = "" }) {
  const { status } = useAccount();
  const allowance = missionAiAllowance(status);
  if (!allowance.limited) return null;
  const period = allowance.period === "month" ? "this month" : allowance.period === "lifetime" ? "on your plan" : "today";
  const empty = allowance.left === 0;
  return <button type="button" className={`plan-allowance${empty ? " is-empty" : ""}${className ? ` ${className}` : ""}`} onClick={() => requestUpgrade({ feature: "missionAiMessages" })} title="Mission AI messages your plan includes">
    <CrownIcon size={11}/>
    <span>{empty ? `No messages left ${period}` : `${allowance.left} of ${allowance.limit} left ${period}`}</span>
  </button>;
}

/** One line about a plan limit, with the way past it: used inside dialogs and page headers. */
export function PlanNote({ feature, text, amount = 1, action = true }) {
  const { status } = useAccount();
  const required = requiredPlanFor(status, feature, amount);
  return <div className="plan-note" role="status">
    <CrownIcon size={13}/>
    <span>{text}</span>
    {action ? <button type="button" className="plan-note__cta" onClick={() => requestUpgrade({ feature, amount, requiredPlan: required })}>Upgrade to {required.name}</button> : null}
  </div>;
}

/** The recipe trial and recipe count, on the Recipes page. */
export function RecipePlanNote({ count = 0 }) {
  const { status } = useAccount();
  const limits = planLimits(status);
  if (!limits) return null;
  const trial = recipeTrial(status);
  const limit = limits.recipes;
  if (trial.limited && !trial.active) return <PlanNote feature="recipeTrial" text="Your recipe trial has ended. Your saved recipes are kept; launching and editing them needs a paid plan."/>;
  const room = limit == null
    ? ""
    : count >= limit
      ? "you have reached your plan's recipe limit"
      : `you can save ${limit - count} more recipe${limit - count === 1 ? "" : "s"}`;
  if (trial.limited) {
    const days = `${trial.daysLeft} day${trial.daysLeft === 1 ? "" : "s"} left`;
    return <PlanNote feature="recipes" amount={(limit ?? 0) + 1} text={`Recipe trial: ${days}${room ? ` · ${room}` : ""}.`}/>;
  }
  if (limit == null) return null;
  return <PlanNote feature="recipes" amount={limit + 1} action={count >= limit} text={`Your plan includes ${limit} recipe${limit === 1 ? "" : "s"}; ${room}.`}/>;
}
