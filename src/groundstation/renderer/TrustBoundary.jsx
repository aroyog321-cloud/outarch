import React from "react";

function cleanFacts(facts) {
  return (Array.isArray(facts) ? facts : [])
    .filter(item => item && item.label && item.value)
    .map(item => ({ label: String(item.label), value: String(item.value) }));
}

export default function TrustBoundary({
  eyebrow = "Trust boundary",
  title,
  summary,
  facts = [],
  tone = "neutral",
  compact = false,
  className = ""
}) {
  const items = cleanFacts(facts);
  return <section className={`trust-boundary tone-${tone} ${compact ? "is-compact" : ""} ${className}`.trim()} aria-label={eyebrow}>
    <div className="trust-boundary__summary">
      <span className="trust-boundary__mark" aria-hidden="true">TB</span>
      <span>
        <small>{eyebrow}</small>
        <strong>{title}</strong>
        {summary && <p>{summary}</p>}
      </span>
    </div>
    {items.length > 0 && <details>
      <summary>View access and authority</summary>
      <dl>{items.map(item => <div key={`${item.label}:${item.value}`}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
    </details>}
  </section>;
}
