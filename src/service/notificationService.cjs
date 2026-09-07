"use strict";

// T033/T035/T036/T037 — native desktop notification delivery.
//
// Everything Electron-specific is injected, so the whole lifecycle is testable
// without a window: `Notification` (constructor + isSupported), `focusWindow`,
// and the clock. `NotificationPolicy` owns whether an interruption is allowed;
// this owns turning an allowed one into an OS notification, and turning a click
// on it into a deep link.
//
// Delivery is driven by real engine events. `EngineAPI.listAttention()` is what
// materialises attention records, so the service calls it in response to the
// lifecycle events that can create one, coalesced on a short timer. It never
// polls on an interval: with no engine activity, nothing runs.

const { EventEmitter } = require("node:events");
const { NotificationPolicy } = require("./notificationPolicy.cjs");

// Engine events that can plausibly create or clear an attention record. Output
// is excluded — it is by far the highest-volume event and never on its own a
// reason to interrupt someone.
const TRIGGER_EVENTS = new Set([
  "session:status",
  "session:exit",
  "session:error",
  "session:created",
  "session:removed",
  "attention:lifecycle",
  "attention:preferences"
]);

const COALESCE_MS = 250;
const MAX_BODY = 180;

function clip(value, limit = MAX_BODY) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

class NotificationService extends EventEmitter {
  #Notification;
  #getEngineApi;
  #focusWindow;
  #policy;
  #now;
  #coalesceMs;
  #started;
  #unsubscribe;
  #timer;
  #seen;
  #lastError;
  #lastDeliveryAt;
  #lastSuppressed;
  #live;

  constructor(options = {}) {
    super();
    this.#Notification = options.Notification || null;
    this.#getEngineApi = typeof options.getEngineApi === "function" ? options.getEngineApi : () => options.engineApi || null;
    this.#focusWindow = typeof options.focusWindow === "function" ? options.focusWindow : () => {};
    this.#policy = options.policy || new NotificationPolicy(options.policyOptions || {});
    this.#now = typeof options.now === "function" ? options.now : Date.now;
    this.#coalesceMs = Number.isInteger(options.coalesceMs) && options.coalesceMs >= 0 ? options.coalesceMs : COALESCE_MS;
    this.#started = false;
    this.#unsubscribe = null;
    this.#timer = null;
    // Bounded: one entry per attention record already considered.
    this.#seen = new Set();
    this.#lastError = null;
    this.#lastDeliveryAt = null;
    this.#lastSuppressed = null;
    this.#live = new Set();
  }

  get supported() {
    try {
      return Boolean(this.#Notification && typeof this.#Notification.isSupported === "function" && this.#Notification.isSupported());
    } catch {
      return false;
    }
  }

  // The renderer must be able to tell "this platform cannot" from "you turned
  // it off" from "it tried and failed", so all three are separate fields.
  status() {
    const stats = this.#policy.stats();
    return {
      available: this.supported,
      running: this.#started,
      delivered: stats.delivered,
      suppressed: stats.suppressed,
      lastDeliveryAt: this.#lastDeliveryAt,
      lastSuppressedReason: this.#lastSuppressed,
      lastError: this.#lastError
    };
  }

  subscribe(callback) {
    if (typeof callback !== "function") throw new TypeError("notification subscribe requires a callback");
    this.on("event", callback);
    return () => this.off("event", callback);
  }

  start() {
    if (this.#started) return false;
    const engineApi = this.#getEngineApi();
    if (!engineApi || typeof engineApi.subscribe !== "function") return false;
    this.#started = true;
    this.#unsubscribe = engineApi.subscribe("all", event => {
      if (!TRIGGER_EVENTS.has(String(event?.type || ""))) return;
      this.#schedule();
    });
    return true;
  }

  stop() {
    this.#started = false;
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null; }
    try { this.#unsubscribe?.(); } catch { /* teardown is best effort */ }
    this.#unsubscribe = null;
    for (const notification of this.#live) {
      try { notification.close(); } catch { /* the OS may have closed it already */ }
    }
    this.#live.clear();
  }

  #schedule() {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = null;
      try { this.#drain(); } catch (error) { this.#lastError = String(error?.message || error).slice(0, 240); }
    }, this.#coalesceMs);
    // A pending notification sweep must never hold the process open at exit.
    if (typeof this.#timer?.unref === "function") this.#timer.unref();
  }

  #drain() {
    const engineApi = this.#getEngineApi();
    if (!engineApi || typeof engineApi.listAttention !== "function") return;

    let attention;
    try {
      attention = engineApi.listAttention();
    } catch (error) {
      this.#lastError = String(error?.message || error).slice(0, 240);
      return;
    }

    const preferences = attention?.preferences || {};
    const records = Array.isArray(attention?.records) ? attention.records : [];
    const active = new Set();

    for (const record of records) {
      if (!record?.id) continue;
      active.add(record.id);
      // Only an unacknowledged record is an interruption. A record the operator
      // has already seen, is acting on, or the engine has verified recovered is
      // history, not news.
      if (record.state !== "new") continue;
      if (this.#seen.has(record.id)) continue;
      this.#seen.add(record.id);

      const decision = this.#policy.consider(record, preferences, this.#now());
      if (!decision.deliver) {
        this.#lastSuppressed = decision.reason;
        continue;
      }
      this.#deliver(record, decision);
    }

    // Records the engine has cleared can be forgotten, so a worker that fails
    // again much later is allowed to interrupt again.
    for (const id of [...this.#seen]) if (!active.has(id)) this.#seen.delete(id);
  }

  #deliver(record, decision) {
    if (!this.supported) {
      this.#lastError = "This platform does not support desktop notifications";
      return;
    }
    const summary = decision.reason === "storm-summary";
    const title = summary
      ? "Several workers need you"
      : `${clip(record.sessionName || record.sessionId, 60)} needs you`;
    const body = summary
      ? "Mission Control paused individual alerts for a moment. Open Needs You for the full queue."
      : clip(record.reason || "A decision is waiting in Needs You.");

    try {
      const notification = new this.#Notification({ title, body, urgency: record.severity === "critical" ? "critical" : "normal" });
      // T036 — a notification that cannot take you to the thing it is about is
      // an interruption with no payoff.
      notification.on("click", () => {
        try { this.#focusWindow(); } catch { /* focus is best effort */ }
        this.emit("event", {
          type: "activate",
          attentionId: summary ? null : record.id,
          sessionId: summary ? null : record.sessionId,
          route: "needs"
        });
      });
      notification.on("close", () => this.#live.delete(notification));
      notification.show();
      this.#live.add(notification);
      this.#lastDeliveryAt = this.#now();
      this.#lastError = null;
    } catch (error) {
      this.#lastError = String(error?.message || error).slice(0, 240);
    }
  }

  // T037 — a diagnostic the operator can act on. It deliberately bypasses the
  // severity, quiet-hours and rate policy: the question it answers is "can this
  // machine show me a notification at all", and a test that silently obeyed
  // quiet hours would answer a different question than the one being asked.
  test() {
    if (!this.supported) {
      return { ok: false, delivered: false, error: "This platform does not support desktop notifications" };
    }
    try {
      const notification = new this.#Notification({
        title: "Mission Control test notification",
        body: "Desktop notifications are working. Real alerts still follow your severity and quiet-hours policy."
      });
      notification.on("click", () => {
        try { this.#focusWindow(); } catch { /* focus is best effort */ }
      });
      notification.on("close", () => this.#live.delete(notification));
      notification.show();
      this.#live.add(notification);
      const at = this.#now();
      this.#lastDeliveryAt = at;
      this.#lastError = null;
      return { ok: true, delivered: true, at };
    } catch (error) {
      const message = String(error?.message || error).slice(0, 240);
      this.#lastError = message;
      return { ok: false, delivered: false, error: message };
    }
  }
}

module.exports = { NotificationService, TRIGGER_EVENTS };
