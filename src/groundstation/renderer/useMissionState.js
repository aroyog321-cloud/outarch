import React from "react";
import { engineEventFrom, missionApi } from "./missionApi.js";

const REFRESH_DELAY_MS = 35;

export default function useMissionState() {
  const [state, setState] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [recovery, setRecovery] = React.useState(null);
  const refreshTimer = React.useRef(null);
  const refreshPromise = React.useRef(null);
  const lastSequence = React.useRef(null);
  const mounted = React.useRef(true);

  const refresh = React.useCallback(async () => {
    if (refreshPromise.current) return refreshPromise.current;
    const operation = (async () => {
      try {
        const next = await missionApi().request("state.get");
        if (!mounted.current) return next;
        setState(next);
        lastSequence.current = Number.isInteger(next?.sequence) ? next.sequence : null;
        setError("");
        try {
          const recoveryStatus = await missionApi().request("system.recovery.get");
          if (mounted.current) setRecovery(recoveryStatus);
        } catch (recoveryError) {
          // Recovery status is additive. An older or temporarily unavailable
          // recovery service must not make real engine state disappear.
          if (mounted.current) setRecovery(null);
        }
        await missionApi().request("events.activate", { afterSequence: next?.sequence || 0 });
        return next;
      } catch (requestError) {
        if (mounted.current) {
          setError(requestError instanceof Error ? requestError.message : String(requestError));
        }
        return null;
      } finally {
        if (mounted.current) setLoading(false);
      }
    })();
    refreshPromise.current = operation;
    try {
      return await operation;
    } finally {
      if (refreshPromise.current === operation) refreshPromise.current = null;
    }
  }, []);

  React.useEffect(() => {
    mounted.current = true;
    let unsubscribe = () => {};

    try {
      unsubscribe = missionApi().subscribe(notification => {
        const event = engineEventFrom(notification);
        if (!event || event.type === "session:output") return;

        const seq = Number.isInteger(event.sequence)
          ? event.sequence
          : (Number.isInteger(notification.sequence) ? notification.sequence : null);

        // T167: Event sequence gap detection and full-snapshot recovery
        if (lastSequence.current !== null && seq !== null && seq > lastSequence.current + 1) {
          if (refreshTimer.current) {
            window.clearTimeout(refreshTimer.current);
            refreshTimer.current = null;
          }
          void refresh();
          return;
        }

        if (seq !== null && (lastSequence.current === null || seq > lastSequence.current)) {
          lastSequence.current = seq;
        }

        // T168: Incremental entity updates in renderer state before debounced reconciliation
        if (event.sessionId && ["session:status", "session:exit", "session:attention"].includes(event.type)) {
          setState(current => {
            if (!current || !Array.isArray(current.sessions)) return current;
            const idx = current.sessions.findIndex(s => s.id === event.sessionId);
            if (idx === -1) return current;
            const updated = [...current.sessions];
            const target = { ...updated[idx] };
            if (event.status) target.status = event.status;
            if (typeof event.isAlive === "boolean") target.isAlive = event.isAlive;
            if (typeof event.attentionRequired === "boolean") target.attentionRequired = event.attentionRequired;
            if (event.attentionReason !== undefined) target.attentionReason = event.attentionReason;
            updated[idx] = target;
            return { ...current, sessions: updated };
          });
        }

        if (refreshTimer.current) return;
        refreshTimer.current = window.setTimeout(() => {
          refreshTimer.current = null;
          void refresh();
        }, REFRESH_DELAY_MS);
      }, { type: "engine:event" });
    } catch (bridgeError) {
      setError(bridgeError instanceof Error ? bridgeError.message : String(bridgeError));
      setLoading(false);
      return undefined;
    }

    void refresh();

    return () => {
      mounted.current = false;
      unsubscribe?.();
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [refresh]);

  return { state, loading, error, recovery, refresh };
}
