import React from "react";
import { missionApi } from "./missionApi.js";

// What each reconciled state means in plain terms. The wording distinguishes
// "we know this stopped" from "we lost track of it", because those need
// different decisions and only one of them is safe to restart unattended.
const RECOVERY_STATES = {
  "running-reconnectable": {
    label: "Still running",
    detail: "Reconnected to the process OUTARCH was already supervising.",
    tone: "ok",
    restartable: false
  },
  interrupted: {
    label: "Interrupted",
    detail: "Was running when OUTARCH stopped. Whether the process survived is unknown.",
    tone: "warning",
    restartable: true
  },
  "ready-to-restart": {
    label: "Ready to restart",
    detail: "Configured in this workspace and safe to start again after review.",
    tone: "warning",
    restartable: true
  },
  exited: {
    label: "Exited",
    detail: "Finished on its own before OUTARCH stopped.",
    tone: "idle",
    restartable: false
  }
};

/**
 * Shown after an unclean shutdown, before anything is relaunched.
 *
 * The engine has loaded every worker definition but deliberately started none,
 * so this is a decision surface rather than a notification: nothing here has
 * happened yet, and dismissing it leaves the workspace idle rather than
 * silently starting processes the operator has not looked at.
 */
export default function RecoveryReview({ report, onDismiss, onResumed }) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [expanded, setExpanded] = React.useState(false);
  const headingId = React.useId();

  const workers = Array.isArray(report?.workers) ? report.workers : [];
  const interrupted = workers.filter(worker => RECOVERY_STATES[worker.recoveryState]?.restartable);

  const resume = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await missionApi().request("recovery.resume");
      onResumed?.(result?.started || []);
      onDismiss?.();
    } catch (resumeError) {
      setError(resumeError.message || String(resumeError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="recovery-review" role="region" aria-labelledby={headingId}>
      <div className="recovery-review__head">
        <span className="recovery-review__mark" aria-hidden="true">!</span>
        <div className="recovery-review__lead">
          <strong id={headingId}>OUTARCH stopped unexpectedly</strong>
          <p>
            {interrupted.length
              ? `${interrupted.length} worker${interrupted.length === 1 ? " was" : "s were"} running. Nothing has been restarted — your layout is restored, the processes are not.`
              : "Your layout is restored. No worker was running when it stopped, so there is nothing to restart."}
          </p>
        </div>
        <div className="recovery-review__actions">
          {interrupted.length > 0 && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void resume()}>
              {busy ? "Starting…" : `Start ${interrupted.length} worker${interrupted.length === 1 ? "" : "s"}`}
            </button>
          )}
          <button type="button" className="btn-ghost" disabled={busy} onClick={onDismiss}>
            {interrupted.length ? "Leave stopped" : "Dismiss"}
          </button>
        </div>
      </div>

      {error && <p className="recovery-review__error" role="alert">{error}</p>}

      {workers.length > 0 && (
        <>
          <button
            type="button"
            className="recovery-review__toggle"
            aria-expanded={expanded}
            onClick={() => setExpanded(value => !value)}
          >
            {expanded ? "Hide" : "Review"} what was running ({workers.length})
          </button>
          {expanded && (
            <ul className="recovery-review__list">
              {workers.map(worker => {
                const state = RECOVERY_STATES[worker.recoveryState] || {
                  label: worker.recoveryState,
                  detail: worker.detail,
                  tone: "idle"
                };
                return (
                  <li key={worker.workerId} className="recovery-review__row" data-tone={state.tone}>
                    <span className="recovery-review__worker">
                      <i aria-hidden="true"/>
                      <strong>{worker.workerId}</strong>
                    </span>
                    <span className="recovery-review__state">{state.label}</span>
                    <span className="recovery-review__detail">{state.detail}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <p className="recovery-review__note">
        Starting a worker runs its saved command again. OUTARCH never re-runs a
        migration, deployment or one-off script on your behalf — check anything destructive first.
      </p>
    </section>
  );
}
