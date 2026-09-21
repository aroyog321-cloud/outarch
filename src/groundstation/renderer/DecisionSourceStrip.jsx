import React from "react";

/**
 * Completeness signal for Needs You. Quiet when every decision source reported
 * successfully; explicit when one did not — so an empty queue is never mistaken
 * for "all sources down". No count is ever shown as a confident number while a
 * source is missing from it.
 */

const SOURCE_LABEL = {
  session: "Workers",
  missionSupervisor: "Mission Supervisor",
  mission: "Agent missions",
  mcp: "MCP",
  automation: "Automation",
  mobile: "Mobile"
};

const DOWN = new Set(["error", "unavailable"]);

export function DecisionSourceStrip({ status, sources, onRetry }) {
  if (status === "loading") return null;

  if (status === "error") {
    return (
      <div className="decision-source-strip is-blocked" role="status">
        <span className="decision-source-strip__lead">Decision sources could not be loaded.</span>
        <span>The queue below may be incomplete.</span>
        {onRetry && <button type="button" onClick={onRetry}>Retry</button>}
      </div>
    );
  }

  const down = (sources || []).filter(source => DOWN.has(source.availability));
  if (!down.length) return null;

  const total = sources.length;
  return (
    <div className="decision-source-strip is-degraded" role="status">
      <span className="decision-source-strip__lead">
        Showing decisions from {total - down.length} of {total} sources.
      </span>
      <span className="decision-source-strip__list">
        {down.map(source => (
          <span key={source.id} className="decision-source-strip__down" title={source.error || "Not available on this connection"}>
            {SOURCE_LABEL[source.id] || source.id}
            {source.availability === "unavailable" ? " unavailable" : " failed to load"}
          </span>
        ))}
      </span>
      {onRetry && <button type="button" onClick={onRetry}>Retry</button>}
    </div>
  );
}
