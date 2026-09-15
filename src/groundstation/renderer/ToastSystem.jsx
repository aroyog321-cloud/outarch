import React from "react";
import { playNotificationSound } from "./notificationSound.js";

/* ===========================================================================
   ToastSystem — how Mission Control shows a notification inside the window.

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

const TOAST_ICONS = {
  success: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  ),
  danger: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 2.7 19h18.6L12 3Z"/><path d="M12 9v4m0 3h.01"/>
    </svg>
  ),
  warning: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/><path d="M12 8v4m0 3h.01"/>
    </svg>
  ),
  info: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>
    </svg>
  ),
  ai: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3.5c.4 4.4 4.1 8.1 8.5 8.5-4.4.4-8.1 4.1-8.5 8.5-.4-4.4-4.1-8.1-8.5-8.5 4.4-.4 8.1-4.1 8.5-8.5Z"/>
    </svg>
  ),
  progress: <span className="mc-toast__spinner" aria-hidden="true"/>
};

function clock(at) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function Toast({ toast: t, onDismiss }) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // Trigger enter animation on next frame
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const hasAction = t.actions.length > 0;
  const heading = t.title || t.message;
  const body = t.title ? t.message : "";
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
      <span className="mc-toast__icon">{TOAST_ICONS[t.type] || TOAST_ICONS.info}</span>
      <div className="mc-toast__body">
        <div className="mc-toast__head">
          <strong className="mc-toast__title">{heading}</strong>
          {!t.compact && <time dateTime={new Date(t.createdAt).toISOString()}>{clock(t.createdAt)}</time>}
        </div>
        {body && <p className="mc-toast__text">{body}</p>}
        {t.detail && <p className="mc-toast__detail">{t.detail}</p>}
        {t.source && <span className="mc-toast__source">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="m7.5 10 2.5 2-2.5 2"/></svg>
          {t.source}
        </span>}
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
