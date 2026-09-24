import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { describeLaunch } from "./launchLabel.js";

// The launch policy for the open project: which terminals start when it opens.
// Everything else stays idle until someone starts it or a recipe does.
//
// Each row is a native checkbox inside its own label, so the whole row is one
// control: one tab stop, Space toggles it, and assistive technology hears a
// checkbox that is checked or not, rather than a button wrapped around a second
// control that both toggle the same thing.

function workerKind(session) {
  const source = `${session?.name || ""} ${session?.command || ""} ${(session?.args || []).join(" ")}`.toLowerCase();
  if (session?.id?.startsWith("agent-") || /claude|codex|gemini|opencode|antigravity|\bagy\b|\bqwen\b|\baider\b|cursor-agent|\bcopilot\b|kiro-cli/.test(source)) return "AI agent";
  if (/test|vitest|jest|playwright|pytest/.test(source)) return "Test watcher";
  if (/docker|container/.test(source)) return "Container";
  if (/postgres|mysql|mongo|redis|database|\bdb\b/.test(source)) return "Database";
  if (/(?:^|\s)git(?:\s|$)|github|branch|source control/.test(source)) return "Git";
  if (/build|compile|webpack|vite build/.test(source)) return "Build";
  if (/server|serve|dev|api|backend|frontend/.test(source)) return "Service";
  return "Terminal";
}

function commandLine(session) {
  return [session?.command, ...(session?.args || [])].filter(Boolean).join(" ");
}

const FILTERS = [
  ["all", "All"],
  ["autostart", "Auto-start"],
  ["manual", "Manual"]
];

export default function AutoStartManager({
  open,
  sessions = [],
  onClose,
  onToggleAutoStart,
  onBatchAutoStart,
  onAskAI
}) {
  const [search, setSearch] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [busyId, setBusyId] = React.useState(null);

  // A reopened dialog starts from the whole list, not from a filter left over
  // from last time that would hide terminals without saying so.
  React.useEffect(() => {
    if (open) return;
    setSearch("");
    setFilter("all");
  }, [open]);

  const autoStartCount = sessions.filter(session => session.autoStart).length;
  const counts = { all: sessions.length, autostart: autoStartCount, manual: sessions.length - autoStartCount };

  const visible = React.useMemo(() => {
    const query = search.trim().toLowerCase();
    return sessions.filter(session => {
      if (filter === "autostart" && !session.autoStart) return false;
      if (filter === "manual" && session.autoStart) return false;
      if (!query) return true;
      return `${session.name} ${commandLine(session)} ${session.cwd || ""}`.toLowerCase().includes(query);
    });
  }, [sessions, filter, search]);
  const narrowed = visible.length !== sessions.length;

  const toggle = async (session, enabled) => {
    if (busyId) return;
    setBusyId(session.id);
    try {
      await onToggleAutoStart(session.id, enabled);
    } finally {
      setBusyId(null);
    }
  };

  // Bulk changes apply to what is on screen. With a filter or a search active,
  // "all" would otherwise change terminals the person cannot currently see.
  const setVisible = async enabled => {
    const targets = visible.filter(session => Boolean(session.autoStart) !== enabled);
    if (busyId || !onBatchAutoStart || !targets.length) return;
    setBusyId("all");
    try {
      await onBatchAutoStart(targets.map(session => ({ id: session.id, enabled })));
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <Dialog.Root open={open} onOpenChange={isOpen => { if (!isOpen) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-backdrop" />
        <Dialog.Content
          className="dialog-card autostart-manager-dialog"
          aria-describedby="autostart-dialog-description"
        >
          <header className="dialog-header">
            <div>
              <span className="section-kicker">WORKSPACE LAUNCH POLICY</span>
              <Dialog.Title className="dialog-title">Start with workspace</Dialog.Title>
              <Dialog.Description id="autostart-dialog-description" className="dialog-description">
                Choose which terminals start when this project opens. The rest stay idle until you start them or a recipe does.
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button type="button" className="dialog-close" aria-label="Close">×</button>
            </Dialog.Close>
          </header>

          <div className="autostart-toolbar">
            <label className="autostart-search-box">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6"/><path d="m20 20-3.7-3.7"/></svg>
              <input
                type="search"
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Filter by name, command or folder"
                aria-label="Filter terminals"
              />
            </label>
            <div className="autostart-filter-chips" role="group" aria-label="Show terminals">
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`autostart-chip ${filter === value ? "is-active" : ""}`}
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                >
                  {label}<b>{counts[value]}</b>
                </button>
              ))}
            </div>
          </div>

          <div className="autostart-list-head">
            <p aria-live="polite">
              {autoStartCount === 0
                ? "Nothing starts when this project opens."
                : <><b>{autoStartCount}</b> of {sessions.length} start when this project opens.</>}
            </p>
            {onBatchAutoStart && sessions.length > 0 && (
              <div>
                <button
                  type="button"
                  className="autostart-batch"
                  disabled={Boolean(busyId) || !visible.some(session => !session.autoStart)}
                  onClick={() => setVisible(true)}
                >
                  {narrowed ? "Enable shown" : "Enable all"}
                </button>
                <button
                  type="button"
                  className="autostart-batch"
                  disabled={Boolean(busyId) || !visible.some(session => session.autoStart)}
                  onClick={() => setVisible(false)}
                >
                  {narrowed ? "Disable shown" : "Disable all"}
                </button>
              </div>
            )}
          </div>

          <div className="autostart-worker-list" role="group" aria-label="Terminals in this project">
            {visible.length === 0 ? (
              <div className="autostart-empty">
                <strong>{sessions.length ? "No terminals match" : "No terminals yet"}</strong>
                <span>{sessions.length ? "Clear the filter to see every terminal." : "Add a terminal, then choose whether it starts with the workspace."}</span>
              </div>
            ) : (
              visible.map(session => {
                const isAuto = Boolean(session.autoStart);
                const busy = busyId === session.id || busyId === "all";
                const command = describeLaunch(session.command, session.args).label;
                return (
                  <label
                    key={session.id}
                    className={`autostart-worker-row ${isAuto ? "is-autostart-enabled" : ""} ${busy ? "is-busy" : ""}`}
                  >
                    <span className={`autostart-status-dot status-${session.status || "idle"}`} aria-hidden="true" />
                    <span className="autostart-worker-meta">
                      <span className="autostart-worker-name-line">
                        <strong>{session.name}</strong>
                        <span className="autostart-kind-pill">{workerKind(session)}</span>
                      </span>
                      <code className="autostart-worker-cmd" title={commandLine(session) || undefined}>{command || "No command"}</code>
                      <span className="autostart-worker-cwd" title={session.cwd || "."}>{session.cwd || "."}</span>
                    </span>
                    <span className="autostart-row-state" aria-hidden="true">{isAuto ? "Auto-start" : "Manual"}</span>
                    <span className="pm-toggle">
                      <input
                        type="checkbox"
                        checked={isAuto}
                        disabled={busy}
                        onChange={event => toggle(session, event.target.checked)}
                        aria-label={`Start ${session.name} when the project opens`}
                      />
                      <i className="pm-toggle-track"><b className="pm-toggle-thumb" /></i>
                    </span>
                  </label>
                );
              })
            )}
          </div>

          <footer className="dialog-footer autostart-dialog-footer">
            {onAskAI ? (
              <button
                type="button"
                className="btn-ask-ai"
                onClick={() => {
                  onClose();
                  onAskAI("Look at the terminals configured in this project and recommend which should start when the project opens, and which should stay manual or be launched by a recipe. Give a reason for each.");
                }}
              >
                <span>AI</span> Ask Mission AI
              </button>
            ) : <i aria-hidden="true" />}
            <button type="button" className="primary-button" onClick={onClose}>Done</button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
