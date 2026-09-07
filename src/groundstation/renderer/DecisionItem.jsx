import React from "react";

const DECISION_SEVERITIES = new Set(["info", "warning", "critical"]);
const DECISION_LIFECYCLES = new Set(["new", "seen", "pending", "acting", "verifying", "recovered", "snoozed"]);

function requiredText(value, name) {
  const text = String(value || "").trim();
  if (!text) throw new TypeError(`Decision ${name} is required`);
  return text;
}

function optionalText(value) {
  const text = String(value || "").trim();
  return text || null;
}

export function normalizeDecisionItem(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Decision item must be an object");
  const severity = DECISION_SEVERITIES.has(value.severity) ? value.severity : "warning";
  const lifecycle = DECISION_LIFECYCLES.has(value.lifecycle) ? value.lifecycle : "pending";
  return {
    id: requiredText(value.id, "id"),
    source: requiredText(value.source, "source"),
    title: requiredText(value.title, "title"),
    severity,
    lifecycle,
    evidence: optionalText(value.evidence) || "No additional evidence supplied.",
    impact: optionalText(value.impact) || "Review the request before deciding.",
    recommendedAction: optionalText(value.recommendedAction) || "Inspect the evidence.",
    expiry: optionalText(value.expiry),
    recovery: optionalText(value.recovery),
    badges: (Array.isArray(value.badges) ? value.badges : []).map(optionalText).filter(Boolean).slice(0, 4)
  };
}

export function DecisionQueue({ eyebrow, title, summary, message, children, className = "" }) {
  const headingId = React.useId();
  return <section className={`decision-queue ${className}`.trim()} aria-labelledby={headingId}>
    <header className="decision-queue__header">
      <div><span>{eyebrow}</span><h2 id={headingId}>{title}</h2></div>
      {summary && <small>{summary}</small>}
    </header>
    {message && <p className="decision-queue__message" role="status">{message}</p>}
    <div className="decision-queue__items">{children}</div>
  </section>;
}

export function DecisionItem({ decision, index = 0, prefix = "D", actions, children, className = "" }) {
  const item = normalizeDecisionItem(decision);
  const instanceId = React.useId().replace(/[^a-zA-Z0-9_-]/g, "-");
  const headingId = `decision-${item.id.replace(/[^a-zA-Z0-9_-]/g, "-")}-${instanceId}`;
  return <article className={`decision-item severity-${item.severity} lifecycle-${item.lifecycle} ${className}`.trim()} aria-labelledby={headingId}>
    <div className="decision-item__index" aria-hidden="true">{prefix}{String(index + 1).padStart(2, "0")}</div>
    <div className="decision-item__body">
      <div className="decision-item__meta">
        <span>{item.source}</span>
        <em>{item.lifecycle}</em>
        {item.badges.map(badge => <em key={badge}>{badge}</em>)}
        {item.expiry && <time>{item.expiry}</time>}
      </div>
      <h3 id={headingId}>{item.title}</h3>
      <dl className="decision-item__facts">
        <div><dt>Evidence</dt><dd>{item.evidence}</dd></div>
        <div><dt>Impact</dt><dd>{item.impact}</dd></div>
        <div><dt>Recommended</dt><dd>{item.recommendedAction}</dd></div>
        {item.recovery && <div><dt>Recovery</dt><dd>{item.recovery}</dd></div>}
      </dl>
      {children}
    </div>
    {actions && <footer className="decision-item__actions">{actions}</footer>}
  </article>;
}
