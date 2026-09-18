import React from "react";
import { Box, Text, useInput } from "ink";
import SessionList from "./SessionList.js";
import RightPane from "./RightPane.js";
import RenamePrompt from "./RenamePrompt.js";
import ConfirmPrompt from "./ConfirmPrompt.js";
import NewSessionPrompt from "./NewSessionPrompt.js";
import EditSessionPrompt from "./EditSessionPrompt.js";
import SavedCommandPicker from "./SavedCommandPicker.js";
import OverviewStrip from "./OverviewStrip.js";
import HelpOverlay from "./HelpOverlay.js";
import ActivityFeed from "./ActivityFeed.js";
import { isEscapeInput } from "./input.js";

const e = React.createElement;
const OUTPUT_REFRESH_MS = 100;

function tailLineLimit() {
  const rows = Number.isInteger(process.stdout.rows) ? process.stdout.rows : 30;
  return Math.max(8, Math.min(100, rows - 8));
}

function sessionLineLimit() {
  const rows = Number.isInteger(process.stdout.rows) ? process.stdout.rows : 30;
  return Math.max(6, Math.min(24, rows - 12));
}

export default function App({ engineApi, requestFullAttach, onQuit = () => {} }) {
  const mountedRef = React.useRef(true);
  const initialSessions = React.useMemo(() => engineApi.list(), [engineApi]);
  const [sessions, setSessions] = React.useState(initialSessions);
  const [selectedId, setSelectedId] = React.useState(initialSessions[0]?.id || null);
  const [mode, setMode] = React.useState("snapshot");
  const modeRef = React.useRef(mode);
  modeRef.current = mode;
  const [snapshot, setSnapshot] = React.useState(
    initialSessions[0] ? engineApi.getSnapshot(initialSessions[0].id) : null
  );
  const [renameTarget, setRenameTarget] = React.useState(null);
  const [confirm, setConfirm] = React.useState(null);
  const [newSessionOpen, setNewSessionOpen] = React.useState(false);
  const [editTarget, setEditTarget] = React.useState(null);
  const [savedCommandChoices, setSavedCommandChoices] = React.useState(null);
  const [helpOpen, setHelpOpen] = React.useState(false);
  const helpOpenRef = React.useRef(helpOpen);
  helpOpenRef.current = helpOpen;
  const [activity, setActivity] = React.useState(() => engineApi.getActivity({ limit: 4 }).events);
  const workspace = React.useMemo(() => engineApi.getWorkspace(), [engineApi]);
  const [notice, setNotice] = React.useState(
    workspace.loadErrorCount
      ? `${workspace.loadErrorCount} workspace definition${workspace.loadErrorCount === 1 ? "" : "s"} could not be loaded`
      : ""
  );
  const selectedIdRef = React.useRef(selectedId);
  selectedIdRef.current = selectedId;

  const selectedIndex = Math.max(0, sessions.findIndex(session => session.id === selectedId));
  const current = sessions.find(session => session.id === selectedId) || null;
  const modalOpen = Boolean(
    renameTarget || confirm || newSessionOpen || editTarget || savedCommandChoices || helpOpen
  );

  React.useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  React.useEffect(() => {
    if (sessions.length === 0) {
      setSelectedId(null);
      setSnapshot(null);
      setMode("snapshot");
      return;
    }
    if (!sessions.some(session => session.id === selectedId)) {
      setSelectedId(sessions[0].id);
    }
  }, [sessions, selectedId]);

  React.useEffect(() => {
    setSnapshot(selectedId ? engineApi.getSnapshot(selectedId) : null);
  }, [engineApi, selectedId]);

  React.useEffect(() => {
    let timer = null;
    let listPending = false;
    let snapshotPending = false;
    let activityPending = false;

    const flush = () => {
      timer = null;
      if (listPending) {
        listPending = false;
        setSessions(engineApi.list());
      }
      if (snapshotPending) {
        snapshotPending = false;
        const activeId = selectedIdRef.current;
        setSnapshot(activeId ? engineApi.getSnapshot(activeId) : null);
      }
      if (activityPending) {
        activityPending = false;
        setActivity(engineApi.getActivity({ limit: 4 }).events);
      }
    };

    const schedule = delay => {
      if (timer) return;
      timer = setTimeout(flush, delay);
    };

    const unsubscribe = engineApi.subscribe("all", event => {
      const outputDriven = event.type === "session:output" || event.type === "session:supervision";
      const sessionEvent = event.type.startsWith("session:");
      if (sessionEvent && event.type !== "session:output") listPending = true;
      if (event.type !== "session:output") activityPending = true;
      if (sessionEvent && event.id === selectedIdRef.current) snapshotPending = true;
      schedule(outputDriven ? OUTPUT_REFRESH_MS : 0);
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [engineApi]);

  const moveSelection = React.useCallback(delta => {
    if (!sessions.length) return;
    const nextIndex = Math.max(0, Math.min(sessions.length - 1, selectedIndex + delta));
    setSelectedId(sessions[nextIndex].id);
    setNotice("");
  }, [sessions, selectedIndex]);

  const attachCurrent = React.useCallback(() => {
    if (!current) return;
    const latest = engineApi.getSnapshot(current.id);
    if (latest?.isAlive) {
      requestFullAttach(current.id);
      return;
    }
    setNotice(`Cannot attach: ${latest?.name || current.name} is ${latest?.status || "unavailable"}`);
  }, [current, engineApi, requestFullAttach]);

  const handleInput = React.useCallback((input, key) => {
    // Keep one stable listener responsible for the Help overlay. Moving input
    // ownership from this component to a newly mounted child creates a brief
    // effect-order gap where a fast Escape can be dropped after Help is visible.
    if (helpOpenRef.current) {
      if (isEscapeInput(input, key) || input === "?" || input === "h") {
        setHelpOpen(false);
      }
      return;
    }

    // Ink updates useInput callbacks in an effect after rendering. A fast key
    // can arrive after the Tail frame is visible but before that effect runs;
    // read the current mode through a ref so the preceding callback still
    // handles Escape correctly instead of dropping it.
    if (modeRef.current === "tail") {
      if (isEscapeInput(input, key)) {
        setMode("snapshot");
        return;
      }
      if ((input === "f" || input === "F") && current) {
        attachCurrent();
      }
      return;
    }

    if (key.upArrow || input === "k") {
      moveSelection(-1);
      return;
    }
    if (key.downArrow || input === "j") {
      moveSelection(1);
      return;
    }
    if (key.return && current) {
      setMode("tail");
      return;
    }
    if ((input === "f" || input === "F") && current) {
      attachCurrent();
      return;
    }
    if (input === "r" && current) {
      setNotice("Restarting…");
      engineApi.restart(current.id).then(result => {
        if (mountedRef.current) {
          setNotice(result.ok ? "Restarted" : `Restart failed: ${result.error}`);
        }
      });
      return;
    }
    if (input === "s" && current) {
      if (current.isAlive) {
        setNotice(`${current.name} is already running`);
        return;
      }
      setNotice("Starting…");
      engineApi.start(current.id).then(result => {
        if (mountedRef.current) {
          setNotice(result.ok ? "Started" : `Start failed: ${result.error}`);
        }
      });
      return;
    }
    if (input === "u" && current) {
      const nextAutoStart = !current.autoStart;
      engineApi.setAutoStart(current.id, nextAutoStart).then(result => {
        if (mountedRef.current) {
          setNotice(result.ok
            ? `Startup set to ${nextAutoStart ? "automatic" : "manual"}`
            : `Startup policy failed: ${result.error}`);
        }
      });
      return;
    }
    if (input === "g") {
      const attentionSessions = sessions.filter(session => session.attentionRequired);
      const currentAttentionIndex = attentionSessions.findIndex(session => session.id === selectedId);
      const attentionSession = attentionSessions.length
        ? attentionSessions[(currentAttentionIndex + 1) % attentionSessions.length]
        : null;
      if (attentionSession) {
        setSelectedId(attentionSession.id);
        const position = attentionSessions.findIndex(session => session.id === attentionSession.id) + 1;
        setNotice(`Attention ${position} of ${attentionSessions.length}`);
      } else {
        setNotice("No sessions currently need attention");
      }
      return;
    }
    if (input === "?" || input === "h") {
      setHelpOpen(true);
      return;
    }
    if (input === "a" && current) {
      const result = engineApi.acknowledge(current.id);
      setNotice(result.ok ? "Attention acknowledged" : result.error);
      return;
    }
    if (input === "n" && current) {
      setRenameTarget({ id: current.id, name: current.name });
      return;
    }
    if (input === "e" && current) {
      const latest = engineApi.getSnapshot(current.id);
      if (latest?.isAlive) {
        setNotice("Stop the worker before editing its configuration");
        return;
      }
      const configuration = engineApi.getSessionConfiguration(current.id);
      if (!configuration) {
        setNotice(`Configuration unavailable for ${current.name}`);
        return;
      }
      setEditTarget(configuration);
      setNotice("");
      return;
    }
    if (input === "c") {
      setNewSessionOpen(true);
      setNotice("");
      return;
    }
    if (input === "p") {
      const commands = engineApi.listSavedCommands();
      if (!commands.length) {
        setNotice("No saved worker presets are configured");
        return;
      }
      setSavedCommandChoices(commands);
      setNotice("");
      return;
    }
    if (input === "x" && current && current.isAlive) {
      setConfirm({
        action: "kill",
        id: current.id,
        command: current.command,
        message: `Kill the running session “${current.name}”?`
      });
      return;
    }
    if (input === "d" && current) {
      setConfirm({
        action: "remove",
        id: current.id,
        command: current.command,
        expectedText: "REMOVE",
        message: `Remove “${current.name}” from this workspace?`
      });
      return;
    }
    if (input === "q") onQuit();
  }, [attachCurrent, current, engineApi, moveSelection, onQuit, sessions]);

  useInput(handleInput, { isActive: !modalOpen || helpOpen });

  if (helpOpen) {
    return e(HelpOverlay, { onClose: () => setHelpOpen(false) });
  }

  if (renameTarget) {
    return e(RenamePrompt, {
      currentName: renameTarget.name,
      onSubmit: name => {
        const result = engineApi.rename(renameTarget.id, name);
        setNotice(result.ok ? "Renamed" : `Rename failed: ${result.error}`);
        setRenameTarget(null);
      },
      onCancel: () => setRenameTarget(null)
    });
  }

  if (newSessionOpen) {
    return e(NewSessionPrompt, {
      onSubmit: definition => {
        const result = engineApi.create(definition);
        setNewSessionOpen(false);
        if (result.ok) {
          setSelectedId(result.session.id);
          if (result.session.status === "failed") {
            setNotice(`Created, but failed to start: ${result.session.spawnError || "unknown error"}`);
          } else {
            setNotice("Session created");
          }
        } else {
          setNotice(`Create failed: ${result.error}`);
        }
      },
      onCancel: () => setNewSessionOpen(false)
    });
  }

  if (editTarget) {
    return e(EditSessionPrompt, {
      configuration: editTarget,
      onSubmit: patch => {
        const id = editTarget.id;
        setEditTarget(null);
        setNotice("Saving worker configuration…");
        engineApi.reconfigure(id, patch).then(result => {
          if (mountedRef.current) {
            setNotice(result.ok
              ? (result.changedFields.length ? "Worker configuration updated · press s to start" : "Configuration unchanged")
              : `Configuration update failed: ${result.error}`);
          }
        });
      },
      onCancel: () => setEditTarget(null)
    });
  }

  if (savedCommandChoices) {
    return e(SavedCommandPicker, {
      commands: savedCommandChoices,
      onSubmit: command => {
        const result = engineApi.createFromSavedCommand(command.id);
        setSavedCommandChoices(null);
        if (!result.ok) {
          setNotice(`Saved preset failed: ${result.error}`);
          return;
        }
        setSelectedId(result.session.id);
        setNotice(result.session.isAlive
          ? `Started saved preset: ${result.session.name}`
          : `Added saved preset: ${result.session.name} · press s to start`);
      },
      onCancel: () => setSavedCommandChoices(null)
    });
  }

  if (confirm) {
    return e(ConfirmPrompt, {
      confirm,
      onResolve: approved => {
        if (approved) {
          if (confirm.action === "remove") {
            setNotice("Removing session…");
            engineApi.remove(confirm.id).then(result => {
              if (mountedRef.current) {
                setNotice(result.ok
                  ? "Session removed"
                  : `Remove failed: ${result.error}${result.sessionStopped ? " · session stopped safely" : ""}`);
              }
            });
          } else {
            const result = engineApi.kill(confirm.id);
            setNotice(result.ok ? "Kill requested" : `Kill failed: ${result.error}`);
          }
        }
        setConfirm(null);
      }
    });
  }

  const lines = mode === "tail"
    ? (snapshot?.lines || []).slice(-tailLineLimit())
    : [];

  return e(
    Box,
    { flexDirection: "column", gap: 1 },
    e(
      Box,
      { justifyContent: "space-between" },
      e(Text, { color: "cyan", bold: true }, "OUTARCH"),
      e(Text, { color: "gray" }, `${workspace.name} · ${workspace.persistent ? "saved" : "temporary"} · ${mode}`)
    ),
    e(OverviewStrip, { sessions }),
    mode === "snapshot" ? e(ActivityFeed, { events: activity, sessions }) : null,
    e(
      Box,
      { gap: 2 },
      mode === "snapshot"
        ? e(SessionList, { sessions, selected: selectedIndex, maxVisible: sessionLineLimit() })
        : e(Box, { width: 38 }),
      e(RightPane, { session: current, snapshot, mode, tailLines: lines })
    ),
    notice ? e(Text, { color: "yellow" }, notice) : null,
    mode === "snapshot"
      ? e(Text, { color: "gray" }, "j/k move · g next attention · Enter tail · F attach · s start · r restart · p presets · ? help · q quit")
      : e(Text, { color: "gray" }, "Esc snapshot   F full attach (same PTY)")
  );
}
