import React from "react";
import TerminalPane from "./TerminalPane.jsx";
import { missionApi } from "./missionApi.js";
import useMissionState from "./useMissionState.js";
import { ToastProvider } from "./ToastSystem.jsx";
import { formatCost, formatTokens } from "./formatUsage.js";

// Slot numbers mirror the main process allocation. They route the window back
// to its pane; the strip itself names the worker, which is what a person reads.
const SLOT_IDENTITY = {
  1: { name: "Window 1" },
  2: { name: "Window 2" },
  3: { name: "Window 3" }
};

const STATUS_LABELS = {
  idle: "Idle",
  running: "Running",
  starting: "Starting",
  stopped: "Stopped",
  exited: "Exited",
  failed: "Failed"
};

export function readPopoutRoute(search = window.location.search) {
  const params = new URLSearchParams(search);
  if (params.get("popout") !== "1") return null;
  const workerId = params.get("worker");
  if (!workerId) return null;
  const slot = Number(params.get("slot"));
  return {
    workerId,
    workerName: params.get("name") || workerId,
    slot: SLOT_IDENTITY[slot] ? slot : 1
  };
}

/**
 * A detached terminal is the same worker, the same run and the same engine —
 * only the view moved. This window therefore renders the ordinary TerminalPane
 * and adds nothing but identity, state and a way back.
 */
function DetachedTerminalWindow({ route }) {
  const { state, loading, error } = useMissionState();
  const [usage, setUsage] = React.useState(null);
  const [notice, setNotice] = React.useState("");
  const [findSignal, setFindSignal] = React.useState(0);

  const session = React.useMemo(
    () => (state?.sessions || []).find(item => item.id === route.workerId) || null,
    [state, route.workerId]
  );

  React.useEffect(() => {
    document.title = `${session?.name || route.workerName} — OUTARCH`;
  }, [session, route.workerName]);

  React.useEffect(() => {
    let active = true;
    const read = () => {
      missionApi()
        .request("usage.query", { workerId: route.workerId })
        .then(result => { if (active) setUsage(result?.totals || null); })
        .catch(() => { if (active) setUsage(null); });
    };
    read();
    let unsubscribe = () => {};
    try {
      unsubscribe = missionApi().subscribe(message => {
        if (message?.type === "usage:changed") read();
      });
    } catch {
      // Usage is supplementary; the terminal itself does not depend on it.
    }
    return () => { active = false; unsubscribe?.(); };
  }, [route.workerId]);

  const recall = async () => {
    try {
      await missionApi().request("terminal.window.recall", { workerId: route.workerId });
      // The main process closes this window once the view is handed back.
    } catch (recallError) {
      setNotice(recallError.message || String(recallError));
    }
  };

  // The window has no confirmation dialog, so it performs only what needs
  // none: starting and restarting. Stopping or removing a worker stays in the
  // main window, and saying so beats a control that silently does nothing.
  const act = React.useCallback(async (type, workerId) => {
    if (type === "start" || type === "restart") {
      setNotice("");
      await missionApi().request("action.dispatch", { sessionId: workerId, action: { type } });
      return;
    }
    const message = "Stop or remove this worker from the main OUTARCH window, where it is confirmed.";
    setNotice(message);
    throw new Error(message);
  }, []);

  const status = session?.status || (loading ? "starting" : "exited");
  const statusLabel = STATUS_LABELS[status] || status;

  return (
    <div className="popout-window">
      {/* One neutral strip: the worker, its state in words, search, and the way
          back. It is also the window's drag handle, and it keeps clear of the
          native window controls painted over its right end. */}
      <header className="popout-titlebar">
        <span className="popout-title">{session?.name || route.workerName}</span>
        <span className="popout-state" data-status={status}>{statusLabel}</span>
        <span className="popout-spacer"/>
        {session && <button
          type="button"
          className="popout-tool"
          onClick={() => setFindSignal(value => value + 1)}
          aria-label="Find in output"
          title="Find in output · Ctrl F"
        ><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg></button>}
        <button
          type="button"
          className="popout-recall"
          onClick={() => void recall()}
          title="Return this terminal to its pane in the main window. The worker keeps running."
        >Recall</button>
      </header>

      <div className="popout-body">
        {session ? (
          <TerminalPane
            session={session}
            sessions={state?.sessions || []}
            profile={null}
            active
            expanded={false}
            shortcut={route.slot}
            canPopOut={false}
            chrome="window"
            findSignal={findSignal}
            onAction={act}
          />
        ) : (
          <p className="ops-empty">
            {error || (loading ? "Connecting to this terminal…" : "This terminal is no longer in the open project.")}
            <span>{loading ? "" : "Close this window to return to OUTARCH."}</span>
          </p>
        )}
      </div>

      <footer className="popout-footer">
        <span>{notice || (session?.isAlive ? "Connected" : statusLabel)}</span>
        <span>
          {usage?.callCount
            ? <><b>{formatTokens(usage.totalTokens)}</b> tokens · <b>{formatCost(usage.totalCost)}</b> estimated</>
            : "No AI usage detected"}
        </span>
      </footer>
    </div>
  );
}

export default function DetachedTerminalWindowRoot({ route }) {
  return <ToastProvider><DetachedTerminalWindow route={route}/></ToastProvider>;
}
