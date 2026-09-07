import React from "react";

/* ===========================================================================
   ToastSystem — stacked contextual notifications for Mission Control

   Replaces ad-hoc inline status <p> elements across the app with a
   consistent, positioned, auto-dismissing notification layer. No external
   library. Pure React + CSS animation.

   Usage:
     const { toast } = useToast();
     toast.success("Worker started");
     toast.danger("Build failed — check terminal");
     toast.ai("Mission AI plan ready — 3 actions queued");
     toast.warning("MCP approval expiring in 2 minutes");

   The ToastContainer must be rendered once at the root (inside App).
   ======================================================================== */

const ToastContext = React.createContext(null);

let _nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = React.useState([]);
  const timersRef = React.useRef(new Map());

  React.useEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
  }, []);

  const add = React.useCallback((type, message, options = {}) => {
    const id = _nextId++;
    // T133/T142 — what persists and what passes.
    //
    // A toast that carries an action stays until the operator acts on it or
    // dismisses it, and so does a failure. A failure that vanishes after four
    // and a half seconds is a failure the operator may never have seen, and
    // "did that work?" is exactly the question this app exists to answer.
    // Confirmations of things that went right stay transient — they are
    // reassurance, and reassurance that piles up is noise.
    const hasAction = typeof options.action === "function";
    const persistent = hasAction || type === "danger";
    const duration = options.duration ?? (persistent ? 0 : 4500);
    setToasts(prev => [...prev.slice(-4), { id, type, message, duration, createdAt: Date.now(), action: options.action, actionLabel: options.actionLabel }]);
    if (duration > 0) {
      const timer = setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
        timersRef.current.delete(id);
      }, duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, []);

  const dismiss = React.useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) clearTimeout(timer);
    timersRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const toast = React.useMemo(() => ({
    success: (msg, opts) => add("success", msg, opts),
    danger: (msg, opts) => add("danger", msg, opts),
    warning: (msg, opts) => add("warning", msg, opts),
    info: (msg, opts) => add("info", msg, opts),
    ai: (msg, opts) => add("ai", msg, opts),
    dismiss,
  }), [add, dismiss]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return { toast: ctx };
}

const TOAST_ICONS = {
  success: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      <path d="M12 2a4 4 0 0 1 4 4v2a4 4 0 0 1-8 0V6a4 4 0 0 1 4-4Z"/><path d="M5 13c0-3.87 3.13-7 7-7s7 3.13 7 7v7H5v-7Z"/>
    </svg>
  ),
};

function Toast({ toast: t, onDismiss }) {
  const [visible, setVisible] = React.useState(false);

  React.useEffect(() => {
    // Trigger enter animation on next frame
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  const hasAction = typeof t.action === "function";
  return (
    <div
      className={`mc-toast mc-toast--${t.type} ${visible ? "is-visible" : ""}`}
      // An action toast is a small interactive prompt, not a passing status line.
      role={hasAction ? "alertdialog" : t.type === "danger" ? "alert" : "status"}
      aria-live={t.type === "danger" ? "assertive" : "polite"}
      aria-atomic="true"
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onDismiss(t.id); } }}
    >
      <span className="mc-toast__icon">{TOAST_ICONS[t.type]}</span>
      <span className="mc-toast__body">
        <span className="mc-toast__message"><span>{t.message}</span><time dateTime={new Date(t.createdAt).toISOString()}>{new Date(t.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></span>
        {hasAction && (
          <button type="button" className="mc-toast__action" onClick={() => { t.action(); onDismiss(t.id); }}>
            {t.actionLabel || "Act"}
          </button>
        )}
      </span>
      <button type="button" className="mc-toast__dismiss" onClick={() => onDismiss(t.id)} aria-label="Dismiss notification">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
      {t.duration > 0 && (
        <div
          className="mc-toast__progress"
          style={{ animationDuration: `${t.duration}ms` }}
        />
      )}
    </div>
  );
}

function ToastContainer({ toasts, onDismiss }) {
  if (!toasts.length) return null;
  return (
    <div className="mc-toast-container" aria-label="Notifications">
      {toasts.map(t => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
