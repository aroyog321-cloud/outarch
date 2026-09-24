import React from "react";
import { playNotificationSound, primeNotificationSound } from "./notificationSound.js";

/* ===========================================================================
   ToastSystem — how OUTARCH shows a notification inside the window.

   Usage:
     const { toast } = useToast();
     toast.success("Web dev server is running");
     toast.danger("Port 4000 is already in use", { title: "Billing couldn't start", source: "Billing", actions: [...] });
     const pending = toast.progress("Starting Web dev server…");
     pending.succeed("Web dev server is running");   // or pending.fail(...)

   Rebuilt 2026-09-14. What it fixed:
   - A start or stop raised two toasts, "Working…" then "Done", neither saying
     what worked. An action is one toast now that changes in place, and a quick
     one never shows its "working" state at all.
   - Every notice was one undifferentiated line. A notice has a title (what
     happened), a body (the detail), the worker it came from, and its actions.
   - A pile of toasts covered the canvas. Three are shown, newest nearest the
     top; the rest wait behind a "+N more" row. Pointing at the stack pauses
     every countdown, so nothing disappears while it is being read.

   The ToastProvider is rendered once at the root (inside App).
   ======================================================================== */

const ToastContext = React.createContext(null);
// Kept apart from the toast API on purpose: the API object never changes, so
// the many effects that list it as a dependency never re-run, while the
// history re-renders only the few places that show it.
const NotificationHistoryContext = React.createContext(null);
const MAX_HISTORY = 40;
const VISIBLE = 3;
const PROGRESS_REVEAL_MS = 450;

let _nextId = 1;

// A toast carries one action (action/actionLabel) or several ({ label, run,
// tone, keepOpen }). The first is the primary verb; the rest are quieter.
function actionsOf(options) {
  const list = Array.isArray(options.actions) ? options.actions.filter(item => item && typeof item.run === "function" && item.label).slice(0, 4) : [];
  if (list.length) return list;
  return typeof options.action === "function" ? [{ label: options.actionLabel || "Act", run: options.action }] : [];
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);
  const [history, setHistory] = React.useState([]);
  const [paused, setPaused] = React.useState(false);
  // id -> { timer, deadline, remaining }
  const timersRef = React.useRef(new Map());
  const pausedRef = React.useRef(false);

  React.useEffect(() => () => {
    for (const entry of timersRef.current.values()) clearTimeout(entry.timer);
    timersRef.current.clear();
  }, []);

  // The audio device is opened now, not by the first notification, so the
  // first chime is not late.
  React.useEffect(() => { primeNotificationSound(); }, []);

  const remove = React.useCallback(id => {
    const entry = timersRef.current.get(id);
    if (entry) clearTimeout(entry.timer);
    timersRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const schedule = React.useCallback((id, duration) => {
    const existing = timersRef.current.get(id);
    if (existing) clearTimeout(existing.timer);
    timersRef.current.delete(id);
    if (!(duration > 0)) return;
    const entry = { timer: null, deadline: Date.now() + duration, remaining: duration };
    if (!pausedRef.current) entry.timer = setTimeout(() => remove(id), duration);
    timersRef.current.set(id, entry);
  }, [remove]);

  const add = React.useCallback((type, message, options = {}) => {
    const id = options.id ?? _nextId++;
    // T133/T142 — what persists and what passes.
    //
    // A toast that carries an action stays until the operator acts on it or
    // dismisses it, and so does a failure. A failure that vanishes after four
    // and a half seconds is a failure the operator may never have seen, and
    // "did that work?" is exactly the question this app exists to answer.
    // Confirmations of things that went right stay transient — they are
    // reassurance, and reassurance that piles up is noise.
    const actions = actionsOf(options);
    const hasAction = actions.length > 0;
    const persistent = hasAction || type === "danger";
    const duration = options.duration ?? (persistent ? 0 : 4500);
    const entry = {
      id,
      type,
      title: typeof options.title === "string" ? options.title : "",
      message: String(message ?? ""),
      detail: typeof options.detail === "string" ? options.detail : "",
      source: typeof options.source === "string" ? options.source : "",
      compact: options.compact === true,
      icon: typeof options.icon === "string" ? options.icon : "",
      duration,
      createdAt: Date.now(),
      actions
    };
    // A notice already on screen with the same id is changed in place — an
    // action that finished, or an overflow count that went up — rather than
    // stacking a second copy under the first.
    if (options.toast !== false) {
      setToasts(prev => {
        const index = prev.findIndex(t => t.id === id);
        if (index >= 0) {
          const next = [...prev];
          next[index] = { ...entry, createdAt: prev[index].createdAt };
          return next;
        }
        return [...prev.slice(-4), entry];
      });
      schedule(id, duration);
    }
    // What stays reviewable after the toast is gone: anything with something
    // to do about it, and anything that went wrong. A passing "Saved" is not
    // a notification anyone needs to find again.
    if ((hasAction || type === "danger" || type === "warning" || options.remember === true) && type !== "progress" && options.remember !== false) {
      setHistory(prev => [{ ...entry, read: false }, ...prev.filter(item => item.id !== id)].slice(0, MAX_HISTORY));
    }
    if (options.sound) playNotificationSound(options.sound);
    return id;
  }, [schedule]);

  const dismiss = React.useCallback((id) => remove(id), [remove]);

  // One toast for one action: it appears only if the action is still going
  // after a moment, and whatever happens replaces it. A start that takes 80ms
  // shows its result and nothing else.
  const progress = React.useCallback((message, options = {}) => {
    const id = `progress-${_nextId++}`;
    let settled = false;
    const reveal = setTimeout(() => {
      if (!settled) add("progress", message, { ...options, id, duration: 0, compact: true, remember: false });
    }, options.revealAfterMs ?? PROGRESS_REVEAL_MS);
    const settle = (type, text, extra = {}) => {
      if (settled) return id;
      settled = true;
      clearTimeout(reveal);
      const failed = type === "danger";
      return add(type, text, { compact: !failed && !extra.title, duration: failed ? undefined : 2600, ...extra, id });
    };
    return {
      id,
      succeed: (text, extra) => settle("success", text, extra),
      fail: (text, extra) => settle("danger", text, extra),
      warn: (text, extra) => settle("warning", text, extra),
      cancel: () => { settled = true; clearTimeout(reveal); remove(id); }
    };
  }, [add, remove]);

  const toast = React.useMemo(() => ({
    success: (msg, opts) => add("success", msg, opts),
    danger: (msg, opts) => add("danger", msg, opts),
    warning: (msg, opts) => add("warning", msg, opts),
    info: (msg, opts) => add("info", msg, opts),
    ai: (msg, opts) => add("ai", msg, opts),
    // Recorded in the notification list without taking a place on screen.
    remember: (type, msg, opts) => add(type, msg, { ...opts, toast: false, remember: true }),
    progress,
    dismiss,
  }), [add, progress, dismiss]);

  // Pointing at the stack holds every countdown where it is.
  const pause = React.useCallback(value => {
    if (pausedRef.current === value) return;
    pausedRef.current = value;
    setPaused(value);
    const now = Date.now();
    for (const [id, entry] of timersRef.current.entries()) {
      if (value) {
        clearTimeout(entry.timer);
        entry.timer = null;
        entry.remaining = Math.max(400, entry.deadline - now);
      } else {
        entry.deadline = now + entry.remaining;
        entry.timer = setTimeout(() => remove(id), entry.remaining);
      }
    }
  }, [remove]);

  // Closing the last toast removes the stack from under the pointer, so the
  // stack never hears the pointer leave and the pause it set was never lifted:
  // every later toast was created paused and stayed until it was hovered and
  // left again. With nothing on screen, nothing is being pointed at.
  React.useEffect(() => {
    if (!toasts.length && pausedRef.current) pause(false);
  }, [toasts.length, pause]);

  const markAllRead = React.useCallback(() => setHistory(prev => (prev.some(item => !item.read) ? prev.map(item => ({ ...item, read: true })) : prev)), []);
  const clearHistory = React.useCallback(() => setHistory([]), []);
  const forget = React.useCallback(id => setHistory(prev => prev.filter(item => item.id !== id)), []);
  const historyValue = React.useMemo(() => ({
    items: history,
    unread: history.filter(item => !item.read).length,
    markAllRead,
    clear: clearHistory,
    forget
  }), [history, markAllRead, clearHistory, forget]);

  return (
    <ToastContext.Provider value={toast}>
      <NotificationHistoryContext.Provider value={historyValue}>
        {children}
        <ToastContainer toasts={toasts} paused={paused} onPause={pause} onDismiss={dismiss} />
      </NotificationHistoryContext.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return { toast: ctx };
}

export function useNotificationHistory() {
  return React.useContext(NotificationHistoryContext) || { items: [], unread: 0, markAllRead: () => {}, clear: () => {}, forget: () => {} };
}

export function ToastIcon({ type }) {
  return TOAST_ICONS[type] || TOAST_ICONS.info;
}

// Filled glyphs on a tinted tile, the same set the OUTARCH website shows on
// its notification cards: the tile's colour and shape say what kind of notice
// it is before a word is read.
const TOAST_GLYPHS = {
  bell: (
    <svg width="19" height="19" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M224,71.1a8,8,0,0,1-10.78-3.42,94.13,94.13,0,0,0-33.46-36.91,8,8,0,1,1,8.54-13.54,111.46,111.46,0,0,1,39.12,43.09A8,8,0,0,1,224,71.1ZM35.71,72a8,8,0,0,0,7.1-4.32A94.13,94.13,0,0,1,76.27,30.77a8,8,0,1,0-8.54-13.54A111.46,111.46,0,0,0,28.61,60.32,8,8,0,0,0,35.71,72Zm186.1,103.94A16,16,0,0,1,208,200H167.2a40,40,0,0,1-78.4,0H48a16,16,0,0,1-13.79-24.06C43.22,160.39,48,138.28,48,112a80,80,0,0,1,160,0C208,138.27,212.78,160.38,221.81,175.94ZM150.62,200H105.38a24,24,0,0,0,45.24,0Z"/></svg>
  ),
  diamond: (
    <svg width="19" height="19" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M235.33,116.72,139.28,20.66a16,16,0,0,0-22.56,0l-96,96.06a16,16,0,0,0,0,22.56l96.05,96.06h0a16,16,0,0,0,22.56,0l96.05-96.06a16,16,0,0,0,0-22.56ZM120,80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z"/></svg>
  ),
  check: (
    <svg width="19" height="19" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm45.66,85.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"/></svg>
  ),
  info: (
    <svg width="19" height="19" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-4,48a12,12,0,1,1-12,12A12,12,0,0,1,124,72Zm12,112a16,16,0,0,1-16-16V128a8,8,0,0,1,0-16,16,16,0,0,1,16,16v40a8,8,0,0,1,0,16Z"/></svg>
  ),
  alert: (
    <svg width="19" height="19" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm-8,56a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm8,104a12,12,0,1,1,12-12A12,12,0,0,1,128,184Z"/></svg>
  ),
  sparkle: (
    <svg width="19" height="19" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M208,144a15.78,15.78,0,0,1-10.42,14.94L146,178l-19,51.62a15.92,15.92,0,0,1-29.88,0L78,178l-51.62-19a15.92,15.92,0,0,1,0-29.88L78,110l19-51.62a15.92,15.92,0,0,1,29.88,0L146,110l51.62,19A15.78,15.78,0,0,1,208,144ZM152,48h16V64a8,8,0,0,0,16,0V48h16a8,8,0,0,0,0-16H184V16a8,8,0,0,0-16,0V32H152a8,8,0,0,0,0,16Zm88,32h-8V72a8,8,0,0,0-16,0v8h-8a8,8,0,0,0,0,16h8v8a8,8,0,0,0,16,0V96h8a8,8,0,0,0,0-16Z"/></svg>
  ),
  shield: (
    <svg width="19" height="19" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M208,40H48A16,16,0,0,0,32,56v56c0,52.72,25.52,84.67,46.93,102.19,23.06,18.86,46,25.26,47,25.53a8,8,0,0,0,4.2,0c1-.27,23.91-6.67,47-25.53C198.48,196.67,224,164.72,224,112V56A16,16,0,0,0,208,40Zm-34.32,69.66-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35a8,8,0,0,1,11.32,11.32Z"/></svg>
  ),
};

const TOAST_ICONS = {
  success: TOAST_GLYPHS.check,
  danger: TOAST_GLYPHS.diamond,
  warning: TOAST_GLYPHS.alert,
  info: TOAST_GLYPHS.info,
  ai: TOAST_GLYPHS.sparkle,
  progress: <span className="mc-toast__spinner" aria-hidden="true"/>
};

// How long ago, the way a phone notification says it: "now" at first, then
// minutes, then the time of day.
function since(at, now) {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 45) return "now";
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m ago`;
  return clock(at);
}

function clock(at) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Toast({ toast: t, onDismiss }) {
  const [visible, setVisible] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  // The age on the card moves on while it is on screen.
  React.useEffect(() => {
    if (t.compact) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, [t.compact]);

  React.useEffect(() => {
    // Trigger enter animation on next frame
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const hasAction = t.actions.length > 0;
  const heading = t.title || t.message;
  const body = t.title ? t.message : "";
  // Something waiting on the operator keeps a slow ring on its tile.
  const ringing = !t.compact && (t.type === "warning" || t.type === "danger");
  return (
    <div
      className={`mc-toast mc-toast--${t.type} ${t.compact ? "is-compact" : ""} ${visible ? "is-visible" : ""}`}
      // An action toast is a small interactive prompt, not a passing status
      // line — but it is not a dialog either. It claimed `alertdialog` until
      // 2026-09-12, and because it never traps focus or labels itself that was
      // wrong twice over: assistive tech was told to expect a dialog, and every
      // surface in the app that steps aside for a real dialog stepped aside for
      // a toast. Measured: one persistent toast disabled Alt F and Alt B and
      // blanked the whole in-app browser for as long as it was on screen.
      role={hasAction || t.type === "danger" ? "alert" : "status"}
      aria-live={t.type === "danger" ? "assertive" : "polite"}
      aria-atomic="true"
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onDismiss(t.id); } }}
    >
      <span className={`mc-toast__icon ${ringing ? "is-ringing" : ""}`}>{(t.icon && TOAST_GLYPHS[t.icon]) || TOAST_ICONS[t.type] || TOAST_ICONS.info}</span>
      <div className="mc-toast__body">
        {!t.compact && <div className="mc-toast__meta">
          <b>OUTARCH</b>
          <time dateTime={new Date(t.createdAt).toISOString()} title={clock(t.createdAt)}>{since(t.createdAt, now)}</time>
        </div>}
        <div className="mc-toast__head">
          <strong className="mc-toast__title">{heading}</strong>
        </div>
        {(body || t.source) && <p className="mc-toast__text">
          {t.source && <span className="mc-toast__source">{t.source}</span>}
          {t.source && body ? " · " : null}
          {body}
        </p>}
        {t.detail && <p className="mc-toast__detail">{t.detail}</p>}
        {hasAction && <div className="mc-toast__actions">
          {t.actions.map((item, index) => (
            <button key={item.label} type="button" className={index === 0 ? "mc-toast__action" : `mc-toast__secondary ${item.tone === "danger" ? "is-danger" : ""}`} onClick={() => { item.run(); if (item.keepOpen !== true) onDismiss(t.id); }}>
              {item.label}
            </button>
          ))}
        </div>}
      </div>
      {t.type !== "progress" && <button type="button" className="mc-toast__dismiss" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>}
      {t.duration > 0 && (
        <div
          key={`${t.type}-${t.duration}`}
          className="mc-toast__progress"
          style={{ animationDuration: `${t.duration}ms` }}
        />
      )}
    </div>
  );
}

function ToastContainer({ toasts, paused, onPause, onDismiss }) {
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => { if (toasts.length <= VISIBLE) setExpanded(false); }, [toasts.length]);
  if (!toasts.length) return null;
  // Newest nearest the top edge the stack hangs from.
  const ordered = [...toasts].reverse();
  const shown = expanded ? ordered : ordered.slice(0, VISIBLE);
  const hidden = ordered.length - shown.length;
  return (
    <div
      className="mc-toast-container" aria-label="Notifications"
      data-paused={paused ? "true" : undefined}
      onMouseEnter={() => onPause(true)}
      onMouseLeave={() => onPause(false)}
      onFocus={() => onPause(true)}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onPause(false); }}
    >
      {shown.map(t => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
      {hidden > 0 && <button type="button" className="mc-toast-more" onClick={() => setExpanded(true)}>
        {hidden} more notification{hidden === 1 ? "" : "s"}
      </button>}
    </div>
  );
}
