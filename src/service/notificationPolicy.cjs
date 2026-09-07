"use strict";

// T034/T035 — the decision half of native notification delivery.
//
// Kept free of Electron on purpose. Whether an interruption is allowed is pure
// logic over a record, the operator's saved policy, and what has already been
// delivered, so it is unit-testable without a window, and the Electron layer
// above it only has to raise what this approves.
//
// The order below is deliberate: an operator's explicit choices (off, severity
// floor, quiet hours) are checked before the automatic protections (duplicate,
// rate limit), so a suppression reason always names the most meaningful cause
// rather than whichever guard happened to fire first.

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };

const DEFAULTS = {
  // A burst of five failures in a minute is a storm, not five things to read.
  maxPerWindow: 4,
  windowMs: 60_000,
  // The same recurring problem should not re-interrupt every refresh.
  dedupeMs: 5 * 60_000,
  historyLimit: 100
};

function severityRank(value) {
  return SEVERITY_RANK[String(value || "info")] ?? 0;
}

function localMinutesOfDay(at) {
  const date = new Date(at);
  return date.getHours() * 60 + date.getMinutes();
}

function parseTime(value) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ""));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// Quiet hours normally cross midnight (22:00 to 07:00), so the window is the
// union of two ranges rather than one comparison. A zero-length window is
// treated as "no quiet hours" — silencing everything forever is never what
// setting start equal to end is meant to express.
function inQuietHours(quietHours, minutes) {
  if (!quietHours || quietHours.enabled !== true) return false;
  const start = parseTime(quietHours.start);
  const end = parseTime(quietHours.end);
  if (start === null || end === null || start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

class NotificationPolicy {
  #maxPerWindow;
  #windowMs;
  #dedupeMs;
  #historyLimit;
  #minutesOfDay;
  #delivered;
  #lastByGroup;
  #stormNoticeAt;
  #counts;

  constructor(options = {}) {
    this.#maxPerWindow = Number.isInteger(options.maxPerWindow) && options.maxPerWindow > 0 ? options.maxPerWindow : DEFAULTS.maxPerWindow;
    this.#windowMs = Number.isInteger(options.windowMs) && options.windowMs > 0 ? options.windowMs : DEFAULTS.windowMs;
    this.#dedupeMs = Number.isInteger(options.dedupeMs) && options.dedupeMs >= 0 ? options.dedupeMs : DEFAULTS.dedupeMs;
    this.#historyLimit = Number.isInteger(options.historyLimit) && options.historyLimit > 0 ? options.historyLimit : DEFAULTS.historyLimit;
    this.#minutesOfDay = typeof options.minutesOfDay === "function" ? options.minutesOfDay : localMinutesOfDay;
    this.#delivered = [];
    this.#lastByGroup = new Map();
    this.#stormNoticeAt = null;
    this.#counts = { delivered: 0, suppressed: 0 };
  }

  // Returns the decision without changing anything, so callers can explain a
  // suppression without having to have delivered it.
  inspect(record, preferences, at) {
    const when = Number(at) || 0;

    if (preferences?.desktopNotifications === false) return { deliver: false, reason: "disabled" };
    if (severityRank(record?.severity) < severityRank(preferences?.minimumSeverity)) {
      return { deliver: false, reason: "below-threshold" };
    }
    if (inQuietHours(preferences?.quietHours, this.#minutesOfDay(when))) {
      return { deliver: false, reason: "quiet-hours" };
    }

    const group = String(record?.groupKey || record?.id || "");
    const lastAt = this.#lastByGroup.get(group);
    if (lastAt !== undefined && when - lastAt < this.#dedupeMs) {
      return { deliver: false, reason: "duplicate" };
    }

    const recent = this.#delivered.filter(entry => when - entry <= this.#windowMs).length;
    if (recent >= this.#maxPerWindow) {
      // One summary per window still gets through, so a storm degrades into a
      // single honest "N more" rather than silence the operator cannot detect.
      if (this.#stormNoticeAt === null || when - this.#stormNoticeAt >= this.#windowMs) return { deliver: true, reason: "storm-summary", summary: true };
      return { deliver: false, reason: "rate-limited" };
    }

    return { deliver: true, reason: "allowed" };
  }

  // Evaluates and, when the answer is yes, records the delivery so the next
  // call sees it. One entry point means the bookkeeping cannot drift from the
  // decision that justified it.
  consider(record, preferences, at) {
    const when = Number(at) || 0;
    const decision = this.inspect(record, preferences, when);
    if (!decision.deliver) {
      this.#counts.suppressed += 1;
      return decision;
    }
    if (decision.summary) this.#stormNoticeAt = when;
    this.#lastByGroup.set(String(record?.groupKey || record?.id || ""), when);
    this.#delivered.push(when);
    if (this.#delivered.length > this.#historyLimit) this.#delivered.splice(0, this.#delivered.length - this.#historyLimit);
    if (this.#lastByGroup.size > this.#historyLimit) {
      // Bounded like every other buffer in the engine: drop the oldest groups.
      const ordered = [...this.#lastByGroup.entries()].sort((a, b) => a[1] - b[1]);
      for (const [key] of ordered.slice(0, this.#lastByGroup.size - this.#historyLimit)) this.#lastByGroup.delete(key);
    }
    this.#counts.delivered += 1;
    return decision;
  }

  stats() {
    return { ...this.#counts };
  }
}

module.exports = { NotificationPolicy, inQuietHours, severityRank, SEVERITY_RANK, NOTIFICATION_POLICY_DEFAULTS: DEFAULTS };
