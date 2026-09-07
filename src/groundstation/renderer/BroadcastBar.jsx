import React from "react";
import { confirmedRequest, missionApi } from "./missionApi.js";

/* ===========================================================================
   BroadcastBar — send one command to several engine-owned terminals (T023)

   Activated with Ctrl+Shift+B (Cmd+Shift+B on mac).

   Broadcast is the only action in Mission Control that multiplies a mistake by
   the number of workers, so the flow is deliberately slower than typing into a
   single terminal:

     1. The engine previews the plan — who receives it, who does not, and why —
        on every keystroke. Nothing is guessed in the renderer.
     2. Secrets are refused outright. A key broadcast to six workers is written
        into six scrollbacks and six shell histories; there is no undo for that.
     3. Destructive commands need an explicit acknowledgement in addition to the
        confirmation ceremony, because a dialog alone becomes a habit.
     4. Dispatch carries a server-issued token bound to the exact target list and
        input, so a token issued for two workers cannot be replayed against ten.

   Props:
     sessions  — all supervised WorkerSession objects
     visible   — controlled show/hide
     onClose   — callback to close the bar
     onResult  — optional notice sink for the delivery outcome
   ======================================================================== */

const EMPTY_PLAN = { ok: false, error: null, targets: [], skipped: [], destructive: [], secrets: [], requiresAcknowledgement: false };

export function BroadcastBar({ sessions, visible, onClose, onResult }) {
  const live = React.useMemo(() => (sessions || []).filter(session => session.isAlive), [sessions]);
  const [input, setInput] = React.useState("");
  const [excluded, setExcluded] = React.useState(() => new Set());
  const [plan, setPlan] = React.useState(EMPTY_PLAN);
  const [acknowledged, setAcknowledged] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const inputRef = React.useRef(null);

  const selectedIds = React.useMemo(
    () => live.filter(session => !excluded.has(session.id)).map(session => session.id),
    [live, excluded]
  );

  // Reset every time the bar opens so a previous command can never be sent by
  // reopening and pressing Enter.
  React.useEffect(() => {
    if (!visible) return;
    setInput("");
    setExcluded(new Set());
    setPlan(EMPTY_PLAN);
    setAcknowledged(false);
    setError("");
    const focus = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(focus);
  }, [visible]);

  React.useEffect(() => {
    if (!visible) return undefined;
    const handler = event => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, onClose]);

  // The plan is the engine's answer, not a renderer guess, so what the operator
  // reads before confirming is what the dispatch will actually enforce.
  React.useEffect(() => {
    if (!visible) return undefined;
    let active = true;
    if (!input.trim() || !selectedIds.length) { setPlan(EMPTY_PLAN); return undefined; }
    const handle = window.setTimeout(() => {
      missionApi().request("terminal.broadcast.preview", { sessionIds: selectedIds, input })
        .then(value => { if (active) { setPlan(value || EMPTY_PLAN); setError(""); } })
        .catch(value => { if (active) setError(value?.message || String(value)); });
    }, 120);
    return () => { active = false; window.clearTimeout(handle); };
  }, [visible, input, selectedIds]);

  React.useEffect(() => { setAcknowledged(false); }, [input]);

  if (!visible) return null;

  const toggle = id => setExcluded(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const blocked = !plan.ok || busy || (plan.requiresAcknowledgement && !acknowledged);

  const send = async () => {
    if (blocked) return;
    setBusy(true);
    setError("");
    try {
      const result = await confirmedRequest("terminal.broadcast", {
        sessionIds: plan.targets.map(target => target.id),
        input,
        ...(plan.requiresAcknowledgement ? { acknowledgeDestructive: true } : {})
      });
      const delivered = result?.delivered?.length || 0;
      const failed = result?.failed?.length || 0;
      onResult?.(failed
        ? `Broadcast reached ${delivered} of ${delivered + failed} workers — ${failed} could not accept input`
        : `Broadcast sent to ${delivered} worker${delivered === 1 ? "" : "s"}`);
      onClose();
    } catch (value) {
      setError(value?.message || String(value));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="broadcast-bar" role="dialog" aria-modal="true" aria-label="Broadcast command to terminals">
      <div className="broadcast-bar__inner">
        <div className="broadcast-bar__header">
          <div className="broadcast-bar__title">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2A19.79 19.79 0 0 1 11.39 18 19.5 19.5 0 0 1 5 11.61 19.79 19.79 0 0 1 2.12 2.18 2 2 0 0 1 4.11 0h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92Z"/>
            </svg>
            <span>BROADCAST COMMAND</span>
          </div>
          <button className="broadcast-bar__close" onClick={onClose} aria-label="Close broadcast bar">×</button>
        </div>

        {!live.length ? (
          <p className="broadcast-bar__empty" role="note">No worker is running. Start a worker before broadcasting to it.</p>
        ) : (
          <>
            <label className="broadcast-bar__field">
              <span>Command</span>
              <textarea
                ref={inputRef}
                rows="2"
                value={input}
                spellCheck="false"
                placeholder="git status"
                aria-describedby="broadcast-plan"
                onChange={event => setInput(event.target.value)}
              />
            </label>

            <fieldset className="broadcast-bar__targets">
              <legend>Send to ({plan.targets.length || selectedIds.length} of {live.length})</legend>
              {live.map(session => (
                <label key={session.id} className={excluded.has(session.id) ? "is-excluded" : ""}>
                  <input type="checkbox" checked={!excluded.has(session.id)} onChange={() => toggle(session.id)}/>
                  <span>{session.name || session.id}</span>
                </label>
              ))}
            </fieldset>

            <div id="broadcast-plan" className="broadcast-bar__plan" role="status">
              {!input.trim() && <p className="broadcast-bar__hint">Nothing is sent until you review the plan and confirm.</p>}
              {input.trim() && plan.secrets.length > 0 && (
                <p className="broadcast-bar__refused">{plan.error}</p>
              )}
              {input.trim() && !plan.secrets.length && plan.error && (
                <p className="broadcast-bar__hint">{plan.error}</p>
              )}
              {plan.ok && (
                <p className="broadcast-bar__preview">
                  Sends <code>{input.trim()}</code> to {plan.targets.length} worker{plan.targets.length === 1 ? "" : "s"}: {plan.targets.map(target => target.name).join(", ")}.
                  {plan.skipped.length > 0 && ` Skipping ${plan.skipped.length} (${plan.skipped.map(item => item.reason).join(", ")}).`}
                </p>
              )}
              {plan.requiresAcknowledgement && (
                <label className="broadcast-bar__acknowledge">
                  <input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)}/>
                  <span>I understand this runs {plan.destructive.map(item => item.label).join(" and ")} on all {plan.targets.length} selected workers.</span>
                </label>
              )}
              {error && <p className="broadcast-bar__refused" role="alert">{error}</p>}
            </div>

            <div className="broadcast-bar__actions">
              <button type="button" className="broadcast-bar__cancel" onClick={onClose}>Cancel</button>
              <button type="button" className="broadcast-bar__send" disabled={blocked} onClick={() => void send()}>
                {busy ? "Sending…" : `Broadcast to ${plan.targets.length || 0}`}
              </button>
            </div>
          </>
        )}
      </div>
      <div className="broadcast-bar__backdrop" onClick={onClose} aria-hidden="true" />
    </div>
  );
}
