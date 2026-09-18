import React from "react";
import { useToast } from "./ToastSystem.jsx";
import { missionApi } from "./missionApi.js";

/* ===========================================================================
   CrashLens — inline crash detection and remediation bar

   Mounts inside the terminal pane when a worker process fails. Analyzes
   the last terminal output (session.lastLine + session.recentLines) for
   common error patterns and surfaces 1-click remediations.

   Never executes anything directly — every action goes through the engine's
   approval queue or routes to Mission AI with a pre-filled context prompt.
   ======================================================================== */

const CRASH_PATTERNS = [
  {
    id: "eaddrinuse",
    pattern: /EADDRINUSE|address already in use/i,
    title: "Port collision detected",
    detail: port => `Port ${port || "in use"} is already occupied by another process.`,
    portPattern: /:(\d{2,5})/,
    actions: ["inspect-port", "restart-worker", "ask-ai"],
  },
  {
    id: "missing-module",
    pattern: /Cannot find module|MODULE_NOT_FOUND|No module named/i,
    title: "Missing dependency",
    detail: mod => `Module "${mod || "unknown"}" is not installed.`,
    modulePattern: /Cannot find module '([^']+)'/,
    actions: ["ask-ai"],
  },
  {
    id: "syntax-error",
    pattern: /SyntaxError:|syntax error/i,
    title: "Syntax error in source",
    detail: () => "A syntax error prevented the process from starting.",
    actions: ["ask-ai"],
  },
  {
    id: "oom",
    pattern: /FATAL ERROR: .*out of memory|JavaScript heap out of memory/i,
    title: "Out of memory",
    detail: () => "The Node.js heap was exhausted. Increase --max-old-space-size or reduce load.",
    actions: ["restart-worker", "ask-ai"],
  },
  {
    id: "permission",
    pattern: /EACCES|permission denied/i,
    title: "Permission denied",
    detail: () => "A file or socket operation was rejected by the operating system.",
    actions: ["ask-ai"],
  },
  {
    id: "generic-exit",
    pattern: null,  // Catch-all for non-zero exit codes
    title: "Process exited unexpectedly",
    detail: code => `Exit code ${code ?? "non-zero"}. Review the last terminal output.`,
    actions: ["restart-worker", "ask-ai"],
  },
];

function detectCrash(session) {
  if (!session || session.status !== "failed") return null;

  const output = [
    ...(session.recentLines || []),
    session.lastLine || "",
  ].join("\n");

  for (const pattern of CRASH_PATTERNS) {
    if (pattern.pattern === null) {
      // Generic fallback
      return {
        ...pattern,
        detailText: pattern.detail(session.exitCode),
        port: null,
        moduleName: null,
      };
    }
    if (pattern.pattern.test(output)) {
      const port = pattern.portPattern ? (output.match(pattern.portPattern)?.[1] || null) : null;
      const moduleName = pattern.modulePattern ? (output.match(pattern.modulePattern)?.[1] || null) : null;
      return {
        ...pattern,
        detailText: pattern.detail(port || moduleName),
        port,
        moduleName,
      };
    }
  }
  return null;
}

function CrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3 2.7 19h18.6L12 3Z"/><path d="M12 9v4m0 3h.01"/>
    </svg>
  );
}

export function CrashLens({ session, onAction, onAskAI, onDismiss }) {
  const crash = React.useMemo(() => detectCrash(session), [session?.status, session?.lastLine]);
  const [actioning, setActioning] = React.useState("");
  const [dismissed, setDismissed] = React.useState(false);
  // T026 — the answer to "what is holding this port" is the engine's, including
  // whether the holder is a worker OUTARCH is allowed to stop.
  const [portOwner, setPortOwner] = React.useState(null);
  const { toast } = useToast();

  // Reset dismissed state when the session changes
  React.useEffect(() => {
    setDismissed(false);
    setPortOwner(null);
  }, [session?.id]);

  if (!crash || dismissed) return null;

  const handleAction = async (actionType) => {
    if (actioning) return;

    if (actionType === "restart-worker") {
      setActioning("restart");
      try {
        await onAction("restart", session.id);
        toast.info(`Restarting ${session.name}…`);
      } catch (err) {
        toast.danger(err.message || "Restart failed");
      } finally {
        setActioning("");
        setDismissed(true);
      }
    }

    if (actionType === "inspect-port") {
      setActioning("inspect");
      try {
        const result = await missionApi().request("crashlens.port.inspect", { port: Number(crash.port) });
        setPortOwner(result);
      } catch (err) {
        setPortOwner({ available: false, summary: err.message || "Port owners could not be inspected." });
      } finally {
        setActioning("");
      }
      return;
    }

    if (actionType === "stop-owner") {
      const owner = portOwner?.owners?.find(item => item.owned);
      if (!owner) return;
      setActioning("stop-owner");
      try {
        await onAction("kill", owner.sessionId);
        toast.info(`Stopping ${owner.sessionName}…`);
        setPortOwner(null);
      } catch (err) {
        toast.danger(err.message || "The worker could not be stopped");
      } finally {
        setActioning("");
      }
      return;
    }

    if (actionType === "ask-ai") {
      const prompt = [
        `${session.name} failed with exit code ${session.exitCode ?? "non-zero"}.`,
        crash.title,
        crash.detailText,
        session.lastLine ? `Last output: ${session.lastLine.slice(0, 200)}` : "",
        "What is causing this and how should I fix it?",
      ].filter(Boolean).join(" ");
      onAskAI?.(prompt);
      setDismissed(true);
    }
  };

  return (
    <div className="crash-lens" role="alert" aria-label={`Crash detected: ${crash.title}`}>
      <div className="crash-lens__header">
        <span className="crash-lens__icon"><CrashIcon /></span>
        <div className="crash-lens__copy">
          <strong className="crash-lens__title">{crash.title}</strong>
          <span className="crash-lens__detail">{crash.detailText}</span>
        </div>
      </div>
      {portOwner && (
        <div className="crash-lens__owner" role="status">
          <p>{portOwner.summary}</p>
          {portOwner.owners?.some(item => item.owned) && (
            <button
              className="crash-lens__btn crash-lens__btn--secondary"
              disabled={Boolean(actioning)}
              onClick={() => handleAction("stop-owner")}
            >
              {actioning === "stop-owner" ? "Stopping…" : `Stop ${portOwner.owners.find(item => item.owned).sessionName}`}
            </button>
          )}
        </div>
      )}
      <div className="crash-lens__actions">
        {crash.actions.includes("inspect-port") && !portOwner && (
          <button
            className="crash-lens__btn crash-lens__btn--secondary"
            disabled={Boolean(actioning)}
            onClick={() => handleAction("inspect-port")}
          >
            {actioning === "inspect" ? "Checking…" : "What is using this port?"}
          </button>
        )}
        {crash.actions.includes("restart-worker") && (
          <button
            className="crash-lens__btn crash-lens__btn--secondary"
            disabled={Boolean(actioning)}
            onClick={() => handleAction("restart-worker")}
          >
            {actioning === "restart" ? "Restarting…" : "Restart worker"}
          </button>
        )}
        {crash.actions.includes("ask-ai") && onAskAI && (
          <button
            className="crash-lens__btn crash-lens__btn--ai"
            disabled={Boolean(actioning)}
            onClick={() => handleAction("ask-ai")}
          >
            <span>AI</span> Ask Mission AI
          </button>
        )}
        <button
          className="crash-lens__dismiss"
          aria-label="Dismiss crash lens"
          onClick={() => { setDismissed(true); onDismiss?.(); }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
    </div>
  );
}
