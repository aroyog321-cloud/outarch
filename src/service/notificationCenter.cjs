"use strict";

// The one place OUTARCH decides how to tell you something.
//
// Before this there were two notifiers and a renderer subscription, each
// deciding alone. A single crash could arrive three times: as an attention
// record ("Web server needs you"), as a semantic event (a port conflict), and
// as an in-app toast — and the Windows toast appeared whether or not you were
// already looking at the app. Nothing played a sound: Windows ignores a custom
// audio file on a toast from an unpackaged app, so the chime written to disk
// was never heard.
//
// Every signal is now normalised into one notice and passed through here:
//
//   1. One incident, one notice. Signals about the same worker that arrive
//      together are held for a moment and the most specific one wins — "port
//      3000 is already in use" rather than "Billing needs you". A weaker signal
//      that arrives shortly after is recognised as part of the same incident.
//   2. The right surface. The in-app toast always shows. A Windows toast is
//      raised only when OUTARCH is not the window you are using, and
//      only within your severity floor, quiet hours and rate limits.
//   3. A sound, but not a nuisance. Quiet hours and the Sound setting silence
//      it, a severity floor applies, and chimes are spaced apart so a burst
//      rings once. The app always plays the chime itself, the moment the notice
//      is emitted, and the Windows toast is silent. Handing the sound to the
//      toast made it arrive well after the notice (Windows plays it only once
//      its banner is up) and at the system notification sound's level, which
//      operators heard as late and quiet.
//
// Electron is injected, so the whole decision path runs in tests.

const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");
const { NotificationPolicy, inQuietHours, severityRank } = require("./notificationPolicy.cjs");

// rank: how specific a notice is about what went wrong. When signals about one
// worker coincide, the highest rank is the one worth reading.
const KINDS = Object.freeze({
  "port.conflict": { tone: "critical", rank: 6 },
  "worker.spawnFailed": { tone: "critical", rank: 5 },
  "build.failed": { tone: "critical", rank: 5 },
  "worker.crashed": { tone: "critical", rank: 4 },
  "recipe.blocked": { tone: "critical", rank: 4 },
  "agent.awaitingApproval": { tone: "warning", rank: 3 },
  "worker.error": { tone: "warning", rank: 2 },
  "attention.needed": { tone: "warning", rank: 1 },
  "service.ready": { tone: "success", rank: 0 },
  "tests.completed": { tone: "info", rank: 0 },
  "agent.turnCompleted": { tone: "info", rank: 0 },
  "update.available": { tone: "info", rank: 0 },
  "notification.test": { tone: "info", rank: 0 }
});

const TONES = Object.freeze(["critical", "warning", "success", "info"]);
const POLICY_SEVERITY = Object.freeze({ critical: "critical", warning: "warning", success: "info", info: "info" });
// The renderer's synthesised chimes, by tone.
const APP_SOUND = Object.freeze({ critical: "alert", warning: "attention", success: "success", info: "soft" });
// Windows plays only its own sound events on a toast from an unpackaged app.
const WINDOWS_SOUND = Object.freeze({
  critical: "ms-winsoundevent:Notification.Reminder",
  warning: "ms-winsoundevent:Notification.Reminder",
  success: "ms-winsoundevent:Notification.Default",
  info: "ms-winsoundevent:Notification.Default"
});

const ACTION_IDS = new Set(["open-service", "copy-url", "restart", "stop", "focus-worker", "inspect-port", "review", "open-recipes", "install-update"]);
// A Windows toast button has to make sense from one click with nothing else on
// screen, so only these can be its button; the rest stay in the app.
const WINDOWS_ACTIONS = new Set(["open-service", "focus-worker", "review", "open-recipes", "install-update"]);
const ACTION_ROUTES = Object.freeze({ "open-service": "workspace", "focus-worker": "workspace", restart: "workspace", stop: "workspace", "inspect-port": "workspace", "copy-url": "workspace", review: "needs", "open-recipes": "recipes", "install-update": "settings" });

const MERGE_WINDOW_MS = 900;
const INCIDENT_WINDOW_MS = 15_000;
const SOUND_GAP_MS = 2_500;
const IN_APP_DEDUPE_MS = 20_000;
const IN_APP_BURST = Object.freeze({ max: 6, windowMs: 60_000 });
const MAX_LIVE_TOASTS = 12;
const MAX_KEYS = 300;

const DEFAULT_PREFERENCES = Object.freeze({ minimumSeverity: "info", desktopNotifications: true, sound: true, quietHours: { enabled: false, start: "22:00", end: "07:00" } });

function clip(value, limit) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function escapeXml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function minutesOfDay(at) {
  const date = new Date(at);
  return date.getHours() * 60 + date.getMinutes();
}

function preferencesFrom(value) {
  const source = value && typeof value === "object" ? value : {};
  return {
    minimumSeverity: ["info", "warning", "critical"].includes(source.minimumSeverity) ? source.minimumSeverity : DEFAULT_PREFERENCES.minimumSeverity,
    desktopNotifications: source.desktopNotifications !== false,
    sound: source.sound !== false,
    quietHours: source.quietHours && typeof source.quietHours === "object" ? { ...DEFAULT_PREFERENCES.quietHours, ...source.quietHours } : { ...DEFAULT_PREFERENCES.quietHours }
  };
}

// Only plain values cross to the renderer; a notice never carries a function
// or an object graph from the engine.
function plainData(value) {
  const out = {};
  if (!value || typeof value !== "object") return out;
  for (const [key, item] of Object.entries(value)) {
    if (["string", "number", "boolean"].includes(typeof item) || item === null) out[key] = typeof item === "string" ? item.slice(0, 500) : item;
  }
  return out;
}

function prune(map, limit = MAX_KEYS) {
  if (map.size <= limit) return;
  const ordered = [...map.entries()].sort((a, b) => (a[1]?.at ?? a[1]) - (b[1]?.at ?? b[1]));
  for (const [key] of ordered.slice(0, map.size - limit)) map.delete(key);
}

/**
 * A Windows toast with at most one button. Electron reports a button press and
 * a click on the toast the same way for XML toasts, so a second button could
 * not be told apart from the first; the one button is the primary action and a
 * click anywhere does the same thing.
 */
function buildToastXml({ title, body, attribution = null, actionLabel = null, audio = null }) {
  return [
    "<toast>",
    "<visual><binding template=\"ToastGeneric\">",
    `<text hint-maxLines="1">${escapeXml(title)}</text>`,
    body ? `<text>${escapeXml(body)}</text>` : "",
    attribution ? `<text placement="attribution">${escapeXml(attribution)}</text>` : "",
    "</binding></visual>",
    audio ? `<audio src="${escapeXml(audio)}"/>` : "<audio silent=\"true\"/>",
    actionLabel ? `<actions><action content="${escapeXml(actionLabel)}" arguments="primary" activationType="foreground"/></actions>` : "",
    "</toast>"
  ].join("");
}

/* --------------------------------------------------------------- mapping */

const ACTION_LABELS = Object.freeze({
  "open-service": "Open",
  "copy-url": "Copy URL",
  restart: "Restart",
  stop: "Stop",
  "focus-worker": "Open terminal",
  "inspect-port": "Who's using it",
  review: "Review",
  "open-recipes": "Open recipes",
  "install-update": "Update now"
});

const actions = (...ids) => ids.map(id => ({ id, label: ACTION_LABELS[id] }));

/** A semantic event from the workspace intelligence layer, as a notice. */
function fromSemanticEvent(event) {
  if (!event || typeof event !== "object") return null;
  const worker = clip(event.workerName || event.workerId || "A worker", 60);
  const base = { workerId: event.workerId || null, workerName: event.workerName || null, projectId: event.projectId || null, runId: event.runId || null };
  const data = event.data || {};
  switch (event.type) {
    case "service.ready": {
      if (!data.serviceId) return null;
      const label = data.kind === "frontend" ? "Frontend" : data.kind === "api" ? "API" : data.kind === "health" ? "Health check" : "Service";
      return {
        ...base,
        kind: "service.ready",
        title: `${worker} is ready`,
        body: `${data.url} · ${label} on port ${data.port}`,
        actions: actions("open-service", "copy-url", "restart", "stop"),
        // A re-print of the same address inside one readiness cycle is not news;
        // the next generation (a restart) is.
        dedupeKey: `service.ready:${event.projectId}:${event.workerId}:${data.serviceId}:${data.generation}`,
        groupKey: `service.ready:${event.workerId}:${data.port}`,
        data: { serviceId: data.serviceId, url: data.url, port: data.port, generation: data.generation, serviceKind: data.kind }
      };
    }
    case "port.conflict": {
      const port = Number.isInteger(data.port) ? data.port : null;
      if (data.movedOn) {
        return {
          ...base,
          kind: "port.conflict",
          tone: "warning",
          title: `${worker} moved to another port`,
          body: `Port ${port} was taken. The address it prints next is the one to use.`,
          actions: actions("focus-worker"),
          groupKey: `port.moved:${event.workerId}:${port}`,
          data: { port, movedOn: true }
        };
      }
      return {
        ...base,
        kind: "port.conflict",
        title: `${worker} couldn't start`,
        body: port ? `Port ${port} is already in use by another process.` : "The port it needs is already in use by another process.",
        actions: port ? actions("inspect-port", "focus-worker", "restart") : actions("focus-worker", "restart"),
        groupKey: `port.conflict:${event.workerId}:${port}`,
        dedupeKey: `port.conflict:${event.workerId}:${port}:${event.runId || ""}`,
        data: { port, detail: clip(event.description, 200) }
      };
    }
    case "build.failed":
      return { ...base, kind: "build.failed", title: `${worker}: build failed`, body: clip(event.description || "The build reported an error.", 200), actions: actions("focus-worker", "restart"), groupKey: `build.failed:${event.workerId}`, dedupeKey: `build.failed:${event.workerId}:${event.runId || ""}` };
    case "service.crashed":
      return { ...base, kind: "worker.crashed", title: `${worker} stopped with an error`, body: clip(event.description || "The process exited unexpectedly.", 200), actions: actions("focus-worker", "restart"), groupKey: `crashed:${event.workerId}` };
    case "agent.awaitingApproval": {
      // An agent stopped to ask before it runs something. The one action is the
      // terminal it asked in, because that is where it is answered.
      const question = clip(data.question || event.description, 200);
      return {
        ...base,
        kind: "agent.awaitingApproval",
        title: `${worker} is asking for your permission`,
        body: question || "It is waiting for you to allow or deny something before it continues.",
        actions: actions("focus-worker"),
        groupKey: `agent.waiting:${event.workerId}`,
        dedupeKey: `agent.permission:${event.workerId}:${data.promptId || question}`,
        data: { promptId: data.promptId || null, agent: data.agent || null, choices: clip(data.choices, 200) }
      };
    }
    case "recipe.blocked":
      return { ...base, kind: "recipe.blocked", title: clip(event.title || "A recipe is blocked", 90), body: clip(event.description, 200), actions: actions("open-recipes"), groupKey: `recipe.blocked:${data.recipeId || event.workerId || "recipe"}` };
    case "tests.completed":
      return { ...base, kind: "tests.completed", title: clip(event.title || `${worker} finished its tests`, 90), body: clip(event.description, 200), actions: actions("focus-worker"), groupKey: `tests:${event.workerId}` };
    case "agent.turnCompleted":
      return { ...base, kind: "agent.turnCompleted", title: clip(event.title || `${worker} finished`, 90), body: clip(event.description, 200), actions: actions("focus-worker"), groupKey: `agent.turn:${event.workerId}` };
    default:
      return null;
  }
}

/** An engine attention record (a worker that failed or needs you), as a notice. */
function fromAttentionRecord(record, snapshot = null) {
  if (!record || !record.id) return null;
  const name = clip(record.sessionName || snapshot?.name || record.sessionId || "A worker", 60);
  const reason = clip(record.reason, 200);
  const base = { workerId: record.sessionId || null, workerName: record.sessionName || snapshot?.name || null, dedupeKey: `attention:${record.id}`, groupKey: record.groupKey || `attention:${record.sessionId}`, data: { attentionId: record.id } };
  if (snapshot?.spawnError) {
    return { ...base, kind: "worker.spawnFailed", title: `${name} couldn't start`, body: clip(snapshot.spawnError, 200), actions: actions("focus-worker", "restart") };
  }
  if (snapshot?.status === "failed" || record.severity === "critical") {
    const code = Number.isInteger(snapshot?.exitCode) ? `Exited with code ${snapshot.exitCode}` : "The process stopped unexpectedly";
    const detail = reason && !/^(worker failed|process exited)/i.test(reason) ? ` · ${reason}` : "";
    return { ...base, kind: "worker.crashed", title: `${name} stopped with an error`, body: `${code}${detail}`, actions: actions("focus-worker", "restart") };
  }
  if (String(record.sessionId || "").startsWith("agent-") || record.severity === "warning") {
    return { ...base, kind: "attention.needed", title: `${name} needs you`, body: reason || "A decision is waiting in Needs You.", actions: actions("review", "focus-worker") };
  }
  // Attention inferred from output: the worker is still running, but it
  // printed an error.
  return { ...base, kind: "worker.error", title: `${name} reported an error`, body: reason || "An error appeared in its output.", actions: actions("focus-worker", "restart") };
}

/* ---------------------------------------------------------------- center */

class NotificationCenter extends EventEmitter {
  #Notification;
  #platform;
  #now;
  #isAppFocused;
  #getPreferences;
  #getProjectName;
  #flashWindow;
  #onActivate;
  #policy;
  #mergeWindowMs;
  #pending;
  #incidents;
  #recent;
  #burst;
  #lastSoundAt;
  #live;
  #lastError;
  #lastDeliveryAt;
  #lastSuppressed;
  #counts;
  #disposed;

  constructor(options = {}) {
    super();
    this.#Notification = options.Notification || null;
    this.#platform = options.platform || process.platform;
    this.#now = typeof options.now === "function" ? options.now : Date.now;
    this.#isAppFocused = typeof options.isAppFocused === "function" ? options.isAppFocused : () => false;
    this.#getPreferences = typeof options.getPreferences === "function" ? options.getPreferences : () => null;
    this.#getProjectName = typeof options.getProjectName === "function" ? options.getProjectName : () => null;
    this.#flashWindow = typeof options.flashWindow === "function" ? options.flashWindow : () => {};
    this.#onActivate = typeof options.onActivate === "function" ? options.onActivate : () => {};
    this.#policy = options.policy || new NotificationPolicy({ minutesOfDay: options.minutesOfDay });
    this.#mergeWindowMs = Number.isInteger(options.mergeWindowMs) && options.mergeWindowMs >= 0 ? options.mergeWindowMs : MERGE_WINDOW_MS;
    this.#pending = new Map();
    this.#incidents = new Map();
    this.#recent = new Map();
    this.#burst = [];
    this.#lastSoundAt = -Infinity;
    this.#live = new Map();
    this.#lastError = null;
    this.#lastDeliveryAt = null;
    this.#lastSuppressed = null;
    this.#counts = { published: 0, shown: 0, merged: 0, suppressed: 0, windows: 0 };
    this.#disposed = false;
    this.minutesOfDay = typeof options.minutesOfDay === "function" ? options.minutesOfDay : minutesOfDay;
  }

  get supported() {
    try {
      return Boolean(this.#Notification && typeof this.#Notification.isSupported === "function" && this.#Notification.isSupported());
    } catch {
      return false;
    }
  }

  status() {
    return {
      available: this.supported,
      running: !this.#disposed,
      delivered: this.#counts.windows,
      suppressed: this.#counts.suppressed,
      shown: this.#counts.shown,
      merged: this.#counts.merged,
      lastDeliveryAt: this.#lastDeliveryAt,
      lastSuppressedReason: this.#lastSuppressed,
      lastError: this.#lastError
    };
  }

  // Activation deep links (a click on a Windows toast), in the shape the
  // protocol forwards to renderers.
  subscribe(callback) {
    if (typeof callback !== "function") throw new TypeError("notification subscribe requires a callback");
    this.on("activate", callback);
    return () => this.off("activate", callback);
  }

  /**
   * Accept a notice. Returns what happened to it, for callers and tests.
   */
  publish(input) {
    if (this.#disposed) return { accepted: false, reason: "disposed" };
    const notice = this.#normalize(input);
    if (!notice) return { accepted: false, reason: "invalid" };
    this.#counts.published += 1;
    const at = this.#now();

    const previous = this.#recent.get(notice.dedupeKey);
    if (previous !== undefined && at - previous < IN_APP_DEDUPE_MS) {
      this.#suppress("duplicate");
      return { accepted: false, reason: "duplicate", id: notice.id };
    }

    if (notice.rank > 0 && notice.workerId) {
      // Keyed by worker alone: attention records and terminal events do not
      // label the project the same way, and worker ids are unique within the
      // open project.
      const key = notice.workerId;
      // A weaker signal shortly after a stronger one about the same worker is
      // the same incident — the crash that follows a port conflict, say.
      const incident = this.#incidents.get(key);
      if (incident && at - incident.at < INCIDENT_WINDOW_MS && notice.rank <= incident.rank) {
        this.#counts.merged += 1;
        this.#recent.set(notice.dedupeKey, at);
        return { accepted: true, merged: true, into: incident.id, id: notice.id };
      }
      const pending = this.#pending.get(key);
      if (pending) {
        this.#counts.merged += 1;
        this.#recent.set(notice.dedupeKey, at);
        if (notice.rank > pending.notice.rank) pending.notice = notice;
        return { accepted: true, merged: true, id: notice.id };
      }
      this.#recent.set(notice.dedupeKey, at);
      prune(this.#recent);
      if (this.#mergeWindowMs === 0) {
        this.#deliver(notice);
        return { accepted: true, delivered: true, id: notice.id };
      }
      const timer = setTimeout(() => {
        const entry = this.#pending.get(key);
        this.#pending.delete(key);
        if (entry && !this.#disposed) this.#deliver(entry.notice);
      }, this.#mergeWindowMs);
      timer.unref?.();
      this.#pending.set(key, { notice, timer });
      return { accepted: true, buffered: true, id: notice.id };
    }

    this.#recent.set(notice.dedupeKey, at);
    prune(this.#recent);
    this.#deliver(notice);
    return { accepted: true, delivered: true, id: notice.id };
  }

  /**
   * A worker that starts again is a fresh attempt. Whatever it did last time
   * must not swallow what it does now — a restart that hits the same port
   * conflict has to say so again.
   */
  forgetWorker(projectId, workerId) {
    if (!workerId) return;
    this.#incidents.delete(String(workerId));
  }

  /**
   * Another project is open. Worker ids are only unique within a project, so a
   * "web" that failed in the last one must not swallow the new one's first
   * failure. Anything still held for merging is delivered, not dropped.
   */
  forgetAll() {
    this.flush();
    this.#incidents.clear();
  }

  /**
   * The worker's problem is over — acknowledged, recovered or restarted. A
   * Windows toast about it left in the notification centre would ask for
   * attention that has already been given, so it is taken back. Notices that
   * are not problems (a server coming up) stay.
   */
  withdrawWorker(workerId) {
    if (!workerId) return 0;
    const id = String(workerId);
    let withdrawn = 0;
    for (const [notification, about] of [...this.#live.entries()]) {
      if (about.workerId !== id || !(about.rank > 0)) continue;
      this.#live.delete(notification);
      try { notification.close?.(); withdrawn += 1; } catch { /* the OS may have closed it already */ }
    }
    return withdrawn;
  }

  /**
   * One kind of notice about a worker is over — an agent's permission question
   * was answered. Its Windows toast is taken back, and the worker's incident is
   * forgotten so the agent's next question is news again rather than a repeat.
   */
  withdrawKind(workerId, kind) {
    if (!workerId || !kind) return 0;
    const id = String(workerId);
    let withdrawn = 0;
    for (const [notification, about] of [...this.#live.entries()]) {
      if (about.workerId !== id || about.kind !== kind) continue;
      this.#live.delete(notification);
      try { notification.close?.(); withdrawn += 1; } catch { /* the OS may have closed it already */ }
    }
    const incident = this.#incidents.get(id);
    if (incident && incident.kind === kind) this.#incidents.delete(id);
    for (const [key, entry] of [...this.#pending.entries()]) {
      if (key === id && entry.notice.kind === kind) {
        clearTimeout(entry.timer);
        this.#pending.delete(key);
      }
    }
    return withdrawn;
  }

  /** Deliver anything still held for merging (used at shutdown and in tests). */
  flush() {
    for (const [key, entry] of [...this.#pending.entries()]) {
      clearTimeout(entry.timer);
      this.#pending.delete(key);
      this.#deliver(entry.notice);
    }
  }

  /**
   * "Can this computer show me a notification, and will I hear it?" It skips
   * the policy on purpose — a test that obeyed quiet hours would answer a
   * different question — and shows the Windows toast even while the app is
   * focused, because that is the thing being tested.
   */
  test() {
    const prefs = preferencesFrom(this.#getPreferences());
    const notice = this.#normalize({ kind: "notification.test", title: "Notifications are working", body: "This is how OUTARCH tells you about crashes, port conflicts and servers coming up.", dedupeKey: `test:${this.#now()}` });
    const shown = this.supported ? this.#showWindows(notice, { audible: false, tone: "success" }) : false;
    const sound = prefs.sound ? APP_SOUND.success : null;
    this.#emitNotice(notice, { windows: shown, windowsReason: shown ? "test" : "unsupported", sound, soundBy: sound ? "app" : null, focused: this.#focused(), quiet: false, test: true });
    if (!this.supported) return { ok: false, delivered: false, error: "This platform does not support desktop notifications" };
    return shown
      ? { ok: true, delivered: true, at: this.#lastDeliveryAt }
      : { ok: false, delivered: false, error: this.#lastError || "The notification was not delivered" };
  }

  dispose() {
    this.#disposed = true;
    for (const entry of this.#pending.values()) clearTimeout(entry.timer);
    this.#pending.clear();
    for (const notification of this.#live.keys()) {
      try { notification.close?.(); } catch { /* the OS may have closed it already */ }
    }
    this.#live.clear();
    this.removeAllListeners();
  }

  #focused() {
    try { return this.#isAppFocused() === true; } catch { return false; }
  }

  #suppress(reason) {
    this.#counts.suppressed += 1;
    this.#lastSuppressed = reason;
  }

  #normalize(input) {
    if (!input || typeof input !== "object") return null;
    const spec = KINDS[input.kind];
    if (!spec) return null;
    const tone = TONES.includes(input.tone) ? input.tone : spec.tone;
    const title = clip(input.title, 90);
    if (!title) return null;
    const list = (Array.isArray(input.actions) ? input.actions : [])
      .filter(action => action && ACTION_IDS.has(action.id))
      .slice(0, 4)
      .map(action => ({ id: action.id, label: clip(action.label || ACTION_LABELS[action.id], 32) }));
    const workerId = input.workerId ? String(input.workerId) : null;
    const groupKey = clip(input.groupKey || `${input.kind}:${workerId || "app"}`, 200);
    return {
      id: `notice-${crypto.randomUUID().slice(0, 12)}`,
      kind: input.kind,
      tone,
      rank: spec.rank,
      title,
      body: clip(input.body, 240),
      workerId,
      workerName: input.workerName ? clip(input.workerName, 60) : null,
      projectId: input.projectId ? String(input.projectId) : null,
      groupKey,
      dedupeKey: clip(input.dedupeKey || groupKey, 240),
      actions: list,
      data: plainData(input.data),
      at: this.#now()
    };
  }

  #deliver(notice) {
    const at = this.#now();
    const prefs = preferencesFrom(this.#getPreferences());
    const focused = this.#focused();
    const quiet = inQuietHours(prefs.quietHours, this.minutesOfDay(at));

    if (notice.rank > 0 && notice.workerId) {
      this.#incidents.set(notice.workerId, { id: notice.id, rank: notice.rank, kind: notice.kind, at });
      prune(this.#incidents);
    }

    // A burst of in-app notices collapses into one summary rather than a wall
    // of toasts. It still records every notice, so the list is complete.
    this.#burst = this.#burst.filter(stamp => at - stamp < IN_APP_BURST.windowMs);
    const overflow = this.#burst.length >= IN_APP_BURST.max;
    this.#burst.push(at);

    let windows = false;
    let windowsReason = focused ? "app-focused" : null;
    const policySeverity = POLICY_SEVERITY[notice.tone];
    const aboveFloor = severityRank(policySeverity) >= severityRank(prefs.minimumSeverity);
    const wantsSound = prefs.sound && !quiet && aboveFloor && at - this.#lastSoundAt >= SOUND_GAP_MS && !overflow;

    if (!focused) {
      const decision = this.#policy.consider({ id: notice.id, severity: policySeverity, groupKey: notice.dedupeKey }, { ...prefs, desktopNotifications: prefs.desktopNotifications && this.supported }, at);
      windowsReason = decision.reason;
      if (decision.deliver) {
        windows = this.#showWindows(notice, { audible: false, tone: notice.tone, summary: decision.summary === true });
        if (windows) this.#counts.windows += 1;
      } else {
        this.#suppress(decision.reason);
      }
    }

    const sound = wantsSound ? APP_SOUND[notice.tone] : null;
    if (sound) this.#lastSoundAt = at;
    this.#emitNotice(notice, { windows, windowsReason, sound, soundBy: sound ? "app" : null, focused, quiet, collapsed: overflow });
    if (!focused && notice.tone === "critical") {
      try { this.#flashWindow(); } catch { /* attention is best effort */ }
    }
  }

  #emitNotice(notice, delivery) {
    this.#counts.shown += 1;
    this.emit("notification", { ...notice, delivery });
  }

  #showWindows(notice, { audible, tone, summary = false }) {
    if (!this.supported) {
      this.#lastError = "This platform does not support desktop notifications";
      return false;
    }
    const project = (() => { try { return this.#getProjectName(); } catch { return null; } })();
    const title = summary ? "Several things need your attention" : notice.title;
    const body = summary ? "More notifications arrived in the last minute. Open OUTARCH to see them all." : notice.body;
    const primary = summary ? null : notice.actions.find(action => WINDOWS_ACTIONS.has(action.id)) || null;
    const attribution = project ? `OUTARCH · ${clip(project, 40)}` : "OUTARCH";
    const options = { title, body, silent: !audible, urgency: tone === "critical" ? "critical" : "normal" };
    if (this.#platform === "win32") {
      options.toastXml = buildToastXml({ title, body, attribution, actionLabel: primary?.label || null, audio: audible ? WINDOWS_SOUND[tone] : null });
    }
    try {
      const notification = new this.#Notification(options);
      const activate = () => {
        const actionId = primary?.id || (notice.workerId ? "focus-worker" : null);
        const payload = {
          type: "activate",
          notificationId: notice.id,
          actionId: summary ? null : actionId,
          route: summary ? "workspace" : ACTION_ROUTES[actionId] || (notice.kind === "attention.needed" ? "needs" : "workspace"),
          sessionId: summary ? null : notice.workerId,
          attentionId: notice.data.attentionId || null,
          notice: summary ? null : notice
        };
        try { this.#onActivate(payload); } catch { /* activation is best effort */ }
        this.emit("activate", payload);
      };
      notification.on("click", activate);
      notification.on?.("action", activate);
      notification.on("close", () => this.#live.delete(notification));
      notification.on?.("failed", (_event, error) => { this.#lastError = String(error?.message || error || "The notification failed").slice(0, 240); });
      notification.show();
      this.#live.set(notification, { workerId: summary ? null : notice.workerId, rank: notice.rank, kind: notice.kind });
      if (this.#live.size > MAX_LIVE_TOASTS) {
        const oldest = this.#live.keys().next().value;
        this.#live.delete(oldest);
      }
      this.#lastDeliveryAt = this.#now();
      this.#lastError = null;
      return true;
    } catch (error) {
      this.#lastError = String(error?.message || error).slice(0, 240);
      return false;
    }
  }
}

module.exports = {
  NotificationCenter,
  KINDS,
  APP_SOUND,
  WINDOWS_SOUND,
  MERGE_WINDOW_MS,
  INCIDENT_WINDOW_MS,
  SOUND_GAP_MS,
  buildToastXml,
  fromSemanticEvent,
  fromAttentionRecord,
  preferencesFrom
};
