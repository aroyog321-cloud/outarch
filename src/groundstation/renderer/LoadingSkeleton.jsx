import React from "react";

export function RegisterSkeleton({ rows = 4, label = "Loading records" }) {
  return <div className="mc-skeleton-register" aria-busy="true" aria-label={label} role="status">
    {Array.from({ length: rows }, (_, index) => <div className="mc-skeleton-row" key={index} aria-hidden="true">
      <i/><span/><span/><b/>
    </div>)}
    <span className="sr-only">{label}</span>
  </div>;
}

export function PanelSkeleton({ label = "Loading panel" }) {
  return <div className="mc-skeleton-panel" aria-busy="true" aria-label={label} role="status">
    <i aria-hidden="true"/><span aria-hidden="true"/><span aria-hidden="true"/><span className="sr-only">{label}</span>
  </div>;
}
