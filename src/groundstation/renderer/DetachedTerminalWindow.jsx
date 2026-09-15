import React from "react";
import TerminalPane from "./TerminalPane.jsx";
import { missionApi } from "./missionApi.js";
import useMissionState from "./useMissionState.js";
import { ToastProvider } from "./ToastSystem.jsx";
import { formatCost, formatTokens } from "./formatUsage.js";

// Slot identity mirrors the main process allocation. Colour is never the only
// signal: the number and the worker name carry the same information.
const SLOT_IDENTITY = {
  1: { color: "#60A5FA", name: "Window 1" },
  2: { color: "#A78BFA", name: "Window 2" },
  3: { color: "#2DD4BF", name: "Window 3" }
};

const STATUS_LABELS = {
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
  const identity = SLOT_IDENTITY[route.slot];

  const session = React.useMemo(
    () => (state?.sessions || []).find(item => item.id === route.workerId) || null,
    [state, route.workerId]
  );

  React.useEffect(() => {
    document.title = `${session?.name || route.workerName} — Mission Control`;
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

  const status = session?.status || (loading ? "starting" : "exited");
  const statusLabel = STATUS_LABELS[status] || status;

  return (
    <div className="popout-window" style={{ "--slot-accent": identity.color }}>
      <header className="popout-titlebar">
        <span className="detached-badge">{route.slot}</span>
        <span className="popout-title">{session?.name || route.workerName}</span>
        <span className="popout-state" data-status={status}>
          <i aria-hidden="true"/>
          <span>{statusLabel}</span>
        </span>
        <span className="popout-spacer"/>
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
          />
        ) : (
          <p className="ops-empty">
            {error || (loading ? "Connecting to this terminal…" : "This terminal is no longer in the open project.")}
            <span>{loading ? "" : "Close this window to return to Mission Control."}</span>
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
