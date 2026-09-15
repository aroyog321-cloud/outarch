// Shared formatting for the usage ledger, used by the workspace drawer and by
// each detached terminal window so one number never reads two ways.

/** Compact token counts for dense rows: 940, 12.4k, 1.20M. */
export function formatTokens(total) {
  if (!Number.isFinite(total) || total <= 0) return "0";
  if (total < 1000) return String(total);
  if (total < 1_000_000) return `${(total / 1000).toFixed(total < 10_000 ? 1 : 0)}k`;
  return `${(total / 1_000_000).toFixed(2)}M`;
}

/**
 * A cost that was never measured is an em dash, not $0.00. Showing a zero for
 * an unmeasured request would read as "this was free" — the one thing the
 * ledger cannot claim.
 */
export function formatCost(amount, { precision = 4 } = {}) {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return "—";
  return `$${amount.toFixed(precision)}`;
}

/** Relative timestamps for evidence lines: "just now", "8s ago", "3m ago". */
export function relativeTime(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return "";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
