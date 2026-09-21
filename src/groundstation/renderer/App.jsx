import React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import * as Popover from "@radix-ui/react-popover";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Command as CmdkCommand } from "cmdk";
import TerminalPane from "./TerminalPane.jsx";
import WorkerDialog from "./WorkerDialog.jsx";
import AutoStartManager from "./AutoStartManager.jsx";
import RecoveryReview from "./RecoveryReview.jsx";
import ProjectsView from "./ProjectsView.jsx";
import { confirmedRequest, missionApi } from "./missionApi.js";
import { describeLaunch } from "./launchLabel.js";
import { formatCost, formatTokens, relativeTime } from "./formatUsage.js";
import useMissionState from "./useMissionState.js";
import useTerminalLayout, { TERMINAL_LAYOUTS } from "./useTerminalLayout.js";
import { syncWindowChrome } from "./windowChrome.js";
import { evenTileSizes, normalizeTileSizes, resizeTile, seedFromRatios, tileAddress, tileEdges, tileGrid, tileRows, tileShapeKey, tileTemplates, TILE_MIN_HEIGHT, TILE_MIN_WIDTH } from "./canvasTiles.js";
import useInterfacePreferences, { describePreferenceReset, DEFAULT_INTERFACE_PREFERENCES } from "./useInterfacePreferences.js";
import useCapabilities from "./useCapabilities.js";
import AgentWorkspace from "./AgentWorkspace.jsx";
import WorkspaceRecipes from "./WorkspaceRecipes.jsx";
import WorkspaceBrowser from "./WorkspaceBrowser.jsx";
import WorkspaceAssistant from "./WorkspaceAssistant.jsx";
import RecipesView from "./RecipesView.jsx";
import IntegrationHubView from "./IntegrationsView.jsx";
import MissionGraph from "./MissionGraph.jsx";
import { MissionAISettings } from "./MissionAI.jsx";
import MissionAIScreen from "./MissionAIScreen.jsx";
import { McpGatewaySettings } from "./McpGateway.jsx";
import { MobileCompanionSettings } from "./MobileCompanion.jsx";
import StatusBar from "./StatusBar.jsx";
import HelpOverlay from "./HelpOverlay.jsx";
import TrustBoundary from "./TrustBoundary.jsx";
import { DecisionItem } from "./DecisionItem.jsx";
import { DecisionList, decisionDeepLinkLabel, decisionSourceLabel } from "./DecisionList.jsx";
import { DecisionSourceStrip } from "./DecisionSourceStrip.jsx";
import { useDecisions } from "./useDecisions.js";
import { ToastProvider, useToast } from "./ToastSystem.jsx";
import NotificationTray from "./NotificationTray.jsx";
import { playNotificationSound } from "./notificationSound.js";
import { BroadcastBar } from "./BroadcastBar.jsx";
import { RegisterSkeleton } from "./LoadingSkeleton.jsx";
import { BrandIcon, BrandWordmark, PRODUCT_NAME, PRODUCT_VERSION } from "./BrandMark.jsx";
import { AiGlyph } from "./AiGlyph.jsx";
import { EdgeScroll } from "./EdgeScroll.jsx";
import { copyText } from "./clipboard.js";
import ContextSnapshotButton from "./ContextSnapshotButton.jsx";
import StatusChip from "./StatusChip.jsx";
import { FilterGroup, SegmentedChoice } from "./Segmented.jsx";
import { AccountProvider, requestUpgrade, useAccount } from "./useAccount.js";
import { AccountBoundary } from "./AccountGate.jsx";
import { CrownIcon, PlanLockPanel, UpgradeHost, isFeatureLocked } from "./PlanLock.jsx";
import { AccountSettings, SidebarAccountButton, UpdatesPanel, confirmUpdate } from "./AccountSettings.jsx";
import { planLimits, recipeTrial } from "./planRules.js";

function Command({ value: _selectedValue, onValueChange: _onSelectedValueChange, ...props }) {
  return <CmdkCommand {...props}/>;
}
Command.Input = CmdkCommand.Input;
Command.List = CmdkCommand.List;
Command.Empty = CmdkCommand.Empty;
Command.Item = CmdkCommand.Item;
// cmdk groups the results; without this re-export `<Command.Group>` renders as
// `undefined` and opening the palette tears the whole tree down to a blank
// screen instead of listing commands.
Command.Group = CmdkCommand.Group;

// The operator's home destinations, in scan order: status, work, blockers,
// crew, launch, record, configuration. Recipes earns a slot back because
// launching a saved workspace is a daily verb, not a buried dialog.
//
// Integrations trails the primary seven as a contextual eighth. Every
// connected bridge (Mission AI, VS Code, MCP, Automation, Mobile)
// lives there, so it must stay one click away rather than hide inside
// Settings, but it is a place you configure, not a place you operate from.
// AppSidebar renders it below a divider so the seven stay legible as a group.
const NAVIGATION = [
  ["groundstation", "Groundstation", "pulse"],
  ["workspace", "Workspace", "terminal"],
  ["needs", "Needs You", "attention"],
  ["recipes", "Recipes", "grid"],
  ["history", "History", "history"],
  ["settings", "Settings", "settings"],
  ["integrations", "Integrations", "expand"]
];
const PRIMARY_NAV_COUNT = 6;

const SECONDARY_DESTINATIONS = [
  ["projects", "Switch project", "projects"]
];
const NAV_SHORTCUTS = { groundstation: "Alt G", workspace: "Alt W", recipes: "Alt R", needs: "Alt N", agents: "Alt A", integrations: "Alt I", history: "Alt H", settings: "Alt S" };
// Palette synonyms live beside the destinations they belong to so moving a
// route between the primary and secondary lists cannot silently drop them.
const NAV_ALIASES = {
  needs: ["attention","approvals","failures"],
  history: ["activity","events","memory","logs"],
  integrations: ["mission ai","mcp","vscode","mobile","bridges"],
  recipes: ["recipe","daily workspace","startup","launch","stack"],
  projects: ["workspace","switch"]
};
const HISTORY_CURSOR_KEY = "mission-control.history-cursor.v1";
const COMMAND_RECENTS_KEY = "mission-control.command-recents.v1";
const DECISION_STATE_KEY = "mission-control.decision-queue.v1";

const ICON_PATHS = {
  pulse: <><path d="M3 12h4l2.2-6 4.2 12 2.3-6H21"/></>,
  globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18Z"/></>,
  terminal: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3M13 15h4"/></>,
  attention: <><path d="M12 3 2.7 19h18.6L12 3Z"/><path d="M12 9v4m0 3h.01"/></>,
  agents: <><path d="M12 4.5V8"/><circle cx="12" cy="3.5" r="1"/><rect x="4.5" y="8" width="15" height="11.5" rx="3.5"/><path d="M9.5 12.5v2M14.5 12.5v2M2 13v3M22 13v3"/></>,
  history: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/></>,
  projects: <><path d="M3 6h7l2 2h9v11H3z"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/></>,
  plus: <><path d="M12 5v14M5 12h14"/></>,
  expand: <><path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5"/></>,
  collapse: <><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/></>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  arrow: <><path d="m9 18 6-6-6-6"/></>,
  command: <><path d="M9 6V5a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v14a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6Z"/></>,
  docker: <><path d="M4 10h16v4a6 6 0 0 1-6 6H9a5 5 0 0 1-5-5z"/><path d="M7 7h3v3H7zm4 0h3v3h-3zm0-4h3v3h-3zm4 4h3v3h-3zM20 11c1-1 2-1 3-1"/></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3M10 10h4v4h-4z"/></>,
  play: <><path d="m8 5 11 7-11 7z"/></>,
  info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></>,
  star: <><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8z"/></>,
  stop: <><rect x="6" y="6" width="12" height="12" rx="2"/></>,
  shield: <><path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/></>,
  selector: <><path d="m7 9 5-5 5 5"/><path d="m7 15 5 5 5-5"/></>,
  server: <><rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/></>,
  database: <><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/></>,
  flask: <><path d="M9 3h6M10 3v6.5L4.8 18.2A1.8 1.8 0 0 0 6.3 21h11.4a1.8 1.8 0 0 0 1.5-2.8L14 9.5V3"/><path d="M7.5 15h9"/></>,
  branch: <><path d="M6 3v12"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M18 9a9 9 0 0 1-9 9"/></>,
  box: <><path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/></>
};

/* T152 - one icon scale, and one optical weight.
   Call sites had asked for 12, 13, 14, 16, 17, 18 and 19px: seven sizes for one
   icon set, none of which read as different on purpose. Sizes snap to the four
   steps below, so a stray number cannot reintroduce the spread.

   Stroke is the optical half. The paths are drawn in a 24-unit box, so a fixed
   `stroke-width` renders THINNER the smaller the icon gets - 1.7 becomes 0.85px
   at 12px and 1.28px at 18px, which is why the dense icons looked faint beside
   the text they label. Scaling the stroke with the box keeps one weight. */
const ICON_SIZES = [12, 14, 16, 18];

function Icon({ name, size = 18 }) {
  const step = ICON_SIZES.reduce((best, value) => (Math.abs(value - size) < Math.abs(best - size) ? value : best), ICON_SIZES[0]);
  const stroke = Math.round((1.15 * 24 / step) * 100) / 100;
  return <svg className="icon" width={step} height={step} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{ICON_PATHS[name]}</svg>;
}

const ACTION_FEEDBACK = Object.freeze({
  start: { pending: "Starting", done: "is running", failed: "couldn't start" },
  restart: { pending: "Restarting", done: "restarted", failed: "couldn't restart" },
  kill: { pending: "Stopping", done: "stopped", failed: "couldn't be stopped" },
  remove: { pending: "Removing", done: "removed", failed: "couldn't be removed" },
  acknowledge: { pending: "Acknowledging", done: "acknowledged — its health is unchanged", failed: "couldn't be acknowledged" }
});

function timeAgo(timestamp) {
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function runtime(session) {
  if (!session?.startTime || !session?.isAlive) return "Idle";
  const minutes = Math.max(0, Math.floor((Date.now() - session.startTime) / 60000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function eventTitle(event) {
  // T114 — a unified history row already carries a written title (a decision or
  // a recipe run has no engine event type to humanise). Activity events keep
  // the old derivation, so nothing about the existing timeline changes.
  if (event?.historyTitle) return event.historyTitle;
  if (event?.type === "session:evidence") return `${event.category || "Worker"} evidence recorded`;
  return String(event?.type || "Workspace event").replaceAll(":", " · ").replaceAll("-", " ");
}

function evidenceSummary(event) {
  const evidence = event?.evidence || {};
  if (event?.category === "tests") return `${evidence.passed ?? 0} passed · ${evidence.failed ?? 0} failed${evidence.failedTests?.length ? ` · ${evidence.failedTests.length} named failures` : ""}`;
  if (event?.category === "git") return evidence.branch ? `Branch ${evidence.branch} · ${evidence.changedPaths ?? 0} changed${evidence.commit ? ` · ${evidence.commit.slice(0,7)}` : ""}` : evidence.clean ? "Working tree clean" : `${evidence.changedPaths ?? 0} changed paths`;
  if (event?.category === "build") return `${evidence.status || "Build"}${evidence.phase ? ` · ${evidence.phase}` : ""}${evidence.artifacts?.length ? ` · ${evidence.artifacts.length} artifacts` : ""}`;
  if (event?.category === "service") return `${evidence.origin || (evidence.port ? `Port ${evidence.port}` : "Service")}${evidence.health ? ` · health ${evidence.health}` : ""}`;
  if (event?.category === "database") return `${evidence.connection || "unknown"} connection · migrations ${evidence.migrations || "unknown"}`;
  if (event?.category === "container") return `${evidence.name || "Container"} · ${evidence.state || "unknown"}${Number.isFinite(evidence.cpuPercent) ? ` · ${evidence.cpuPercent}% CPU` : ""}`;
  return "Structured worker evidence recorded";
}

function sessionEvents(session, activity, limit = 6) {
  if (!session) return [];
  return activity.filter(event => event.id === session.id || event.sessionId === session.id || event.name === session.name).slice(-limit).reverse();
}

// T070 — project health is derived from the same decision model Needs You uses,
// including whether that model could see everything.
//
// The ordering is the point. A known failure outranks an unknown, because it is
// actionable. But "Healthy" is a claim about the whole project, and it may not
// be made while a decision source failed to load: that source could be holding
// the very failure the word denies. Incomplete evidence produces "Partial view",
// not a green light — the same rule Needs You follows when it hedges its count.
function healthFor(sessions, workspace, decisions) {
  const failed = sessions.filter(item => item.status === "failed").length + (workspace?.loadErrorCount || 0);
  const critical = Number(decisions?.counts?.critical) || 0;
  const pending = decisions?.status === "ready" ? Number(decisions.counts?.pending) || 0 : sessions.filter(item => item.attentionRequired).length;
  const blindSources = (decisions?.sources || []).filter(source => source.availability === "error" || source.availability === "unavailable");
  const complete = decisions ? decisions.complete !== false && blindSources.length === 0 : true;

  if (failed || critical) {
    const count = failed || critical;
    return { label: "Degraded", detail: `${count} failure${count === 1 ? "" : "s"} detected`, tone: "danger" };
  }
  if (pending) return { label: "Waiting on you", detail: `${pending} decision${pending === 1 ? "" : "s"} ready`, tone: "warning" };
  if (!complete) {
    const names = blindSources.map(source => source.id).filter(Boolean);
    return {
      label: "Partial view",
      detail: names.length
        ? `${names.length} decision source${names.length === 1 ? "" : "s"} did not report (${names.slice(0, 3).join(", ")})`
        : "Not every decision source reported",
      tone: "warning"
    };
  }
  if (!sessions.length) return { label: "Ready", detail: "No workers configured", tone: "neutral" };
  return { label: "Healthy", detail: "Every decision source reported and nothing is waiting", tone: "healthy" };
}

function needsAttention(session) {
  return Boolean(session?.attentionRequired) || session?.status === "failed";
}

const liveAgentClassification = new Map();

// Two things make a session an AI agent, and neither is more real than the
// other: a worker created through the crew flow carries the prefix in its id,
// and a plain terminal the engine has *observed* running an agent CLI reports
// it. Splitting those into two registers split the crew in half — the same
// question ("which agents are working for me?") had two answers in two places.
function isAgentSession(session) {
  if (!session?.id) return false;
  return session.id.startsWith("agent-") || liveAgentClassification.get(session.id)?.isAgent === true;
}

function workerKind(session) {
  // What the engine actually observed in this run wins over anything the name
  // suggests: a PowerShell terminal running Claude is an AI agent, and a
  // terminal merely called "codex-notes" is not.
  const observed = session?.id ? liveAgentClassification.get(session.id) : null;
  if (observed?.isAgent === true) return "AI agent";
  const source = `${session?.name || ""} ${session?.command || ""} ${(session?.args || []).join(" ")}`.toLowerCase();
  if (observed?.isAgent === false) {
    // Observed and not an agent: fall through to the non-agent heuristics.
  } else if (session?.id?.startsWith("agent-") || /claude|codex|gemini|opencode/.test(source)) return "AI agent";
  if (/test|vitest|jest|playwright|pytest/.test(source)) return "Test watcher";
  if (/docker|container/.test(source)) return "Container";
  if (/postgres|mysql|mongo|redis|database|\bdb\b/.test(source)) return "Database";
  if (/(?:^|\s)git(?:\s|$)|github|branch|source control/.test(source)) return "Git";
  if (/build|compile|webpack|vite build/.test(source)) return "Build";
  if (/server|serve|dev|api|backend|frontend/.test(source)) return "Service";
  return "Terminal";
}

function workerProfile(session) {
  const kind = workerKind(session);
  const source = `${session?.command || ""} ${(session?.args || []).join(" ")}`;
  const evidence = [...(session?.recentLines || []), session?.lastLine || ""].filter(Boolean).join(" \n");
  const structured = session?.evidence || {};
  const port = structured.service?.port || `${source} ${evidence}`.match(/(?:--port(?:=|\s+)|localhost:|127\.0\.0\.1:)(\d{2,5})/i)?.[1] || null;
  const url = structured.service?.origin || evidence.match(/https?:\/\/[^\s]+/i)?.[0]?.replace(/[),.;]+$/, "") || null;
  const tests = evidence.match(/(?:tests?\s*)?(\d+)\s+(?:passed|passing).*?(?:(\d+)\s+(?:failed|failing))?/i);
  const testPassed = structured.tests?.passed ?? (tests ? Number(tests[1]) : null);
  const testFailed = structured.tests?.failed ?? (tests?.[2] ? Number(tests[2]) : 0);
  const buildTime = Number.isFinite(structured.build?.durationMs) ? `${structured.build.durationMs}ms` : evidence.match(/(?:built|compiled|ready)\s+(?:in\s+)?([\d.]+\s*(?:ms|s|sec|seconds?))/i)?.[1] || null;
  const branch = structured.git?.branch || evidence.match(/(?:on branch|^##)\s+([^\s.]+)/im)?.[1] || source.match(/git\s+(?:checkout|switch)\s+([^\s]+)/i)?.[1] || null;
  const gitChanges = structured.git?.changedPaths ?? evidence.split("\n").filter(line => /^\s*(?:[MADRCU?]{1,2}|modified:|new file:|deleted:)\s+/i.test(line)).length;
  const gitClean = structured.git?.clean === true || /working tree clean|nothing to commit/i.test(evidence);
  const healthy = structured.service?.health === "confirmed" || structured.database?.connection === "confirmed" || structured.container?.healthy === true || /healthy|ready to accept connections|listening on|server running|compiled successfully|build succeeded/i.test(evidence);
  const profiles = {
    "AI agent": { key: "agent", label: "AI AGENT", metric: session?.isAlive ? "Connected" : "Offline", detail: session?.attentionRequired ? "Waiting for your review" : "Supervised local CLI" },
    "Test watcher": { key: "test", label: "TEST FEEDBACK", metric: testPassed !== null ? `${testPassed} passed${testFailed ? ` · ${testFailed} failed` : ""}` : session?.isAlive ? "Watching" : "Not running", detail: session?.attentionRequired ? "Failure evidence available" : structured.tests ? "Engine-owned structured evidence" : tests ? "Parsed from recent terminal output" : "Awaiting a test summary" },
    Container: { key: "container", label: "CONTAINER RUNTIME", metric: structured.container?.state || (healthy ? "healthy" : session?.isAlive ? "engine active" : "stopped"), detail: structured.container?.image ? `${structured.container.image}${Number.isFinite(structured.container.memoryMB) ? ` · ${structured.container.memoryMB} MB` : ""}` : "Awaiting Docker state evidence" },
    Database: { key: "database", label: "DATA SERVICE", metric: structured.database?.connection || (session?.isAlive ? "Process online" : "Disconnected"), detail: structured.database ? `Migrations ${structured.database.migrations || "unknown"}` : "Awaiting connectivity and migration evidence" },
    Git: { key: "git", label: "SOURCE CONTROL", metric: branch || (gitClean ? "Working tree clean" : gitChanges ? `${gitChanges} change${gitChanges === 1 ? "" : "s"}` : session?.isAlive ? "Git session active" : "Ready"), detail: structured.git?.commit ? `${structured.git.commit.slice(0,7)} · ${structured.git.author || "recorded attribution"}` : branch ? `${gitChanges ? `${gitChanges} changed paths · ` : ""}Engine-backed status evidence` : "Run git status to report branch and changes" },
    Build: { key: "build", label: "BUILD PIPELINE", metric: structured.build?.phase || (buildTime ? `Completed in ${buildTime}` : session?.isAlive ? "Building" : session?.status === "failed" ? "Build failed" : "Ready"), detail: structured.build?.artifacts?.length ? `${structured.build.artifacts.length} artifact records` : session?.attentionRequired ? "Review build output" : "Awaiting artifact evidence" },
    Service: { key: "service", label: "APP SERVICE", metric: structured.service?.health === "confirmed" ? "Health confirmed" : structured.service?.health === "failed" ? "Health failed" : url || (port ? `Port ${port}` : session?.isAlive ? "Process online" : "Offline"), detail: structured.service?.checkedAt ? `Checked ${timeAgo(structured.service.checkedAt)} ago` : port || url ? "Endpoint seen; health not yet confirmed" : "Awaiting endpoint and health-check evidence" },
    Terminal: { key: "terminal", label: "SHELL SESSION", metric: session?.isAlive ? "Interactive" : "Idle", detail: "Direct project terminal" }
  };
  return { kind, ...(profiles[kind] || profiles.Terminal), port, url, branch, gitChanges, evidence: Boolean(evidence) };
}

function agentPhase(agent) {
  if (agent.attentionRequired) return "Waiting for you";
  if (agent.status === "failed") return "Failed";
  if (agent.status === "starting") return "Starting";
  if (agent.isAlive) return "Working — progress not reported";
  return "Ready for a mission";
}

function sessionSummary(session, activity) {
  if (!session) return "Select a worker to see its live operational summary.";
  const related = [...activity].reverse().find(event => event.id === session.id || event.sessionId === session.id || event.name === session.name);
  if (session.attentionRequired) return session.attentionReason || "This worker is waiting for your decision.";
  if (session.status === "failed") return `The worker failed${session.exitCode !== undefined ? ` with exit code ${session.exitCode}` : ""}. Open its terminal to inspect the last output.`;
  if (session.isAlive) return related ? `${eventTitle(related)} · the process is running and output is flowing.` : "The process is running normally and OUTARCH is supervising it.";
  const launch = describeLaunch(session.command, session.args);
  if (launch.shell && !launch.runs) return `${session.name} is ready. Starting it opens an interactive ${launch.shell} in an engine-owned PTY.`;
  return `${session.name} is ready. Starting it runs ${launch.label || session.command} in an engine-owned PTY.`;
}

function decisionFor(session) {
  if (session.rendererAttention) return {
    kind: "Terminal connection",
    title: session.attentionReason || `${session.name} terminal is unavailable`,
    impact: "The worker may still be running, but its live terminal cannot currently be read or controlled from this pane.",
    recommended: "Open terminal",
    tone: "attention"
  };
  const isAgent = session.id.startsWith("agent-");
  const failed = session.status === "failed";
  return {
    kind: isAgent ? "AI agent" : failed ? "Worker failure" : "Worker attention",
    title: session.attentionReason || (failed ? `${session.name} stopped unexpectedly` : `${session.name} needs review`),
    impact: failed ? "This worker is unavailable until it starts successfully." : isAgent ? "The agent may be blocked until you review its operational history." : "Work may be waiting for operator input.",
    recommended: failed ? "Restart and verify" : isAgent ? "Review agent" : "Inspect evidence",
    tone: failed ? "critical" : "attention"
  };
}

// A screen that throws while rendering takes only itself down. Without this the
// error unmounted the whole tree, sidebar included, and left a black window with
// no way back but a restart. Keyed by view, so moving to another screen retries.
class ViewErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("OUTARCH view failed to render", error, info?.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return <section className="view-error" role="alert">
      <span className="view-error__mark" aria-hidden="true">!</span>
      <div>
        <h2>This screen could not be shown</h2>
        <p>{this.state.error?.message || "It stopped while rendering."} Your workers and terminals are unaffected.</p>
      </div>
      <button type="button" className="btn-ghost" onClick={() => this.setState({ error: null })}>Try again</button>
    </section>;
  }
}

function SinceLastCheck({ events, onReview, onDismiss }) {
  if (!events.length) return null;
  const risks = events.filter(event => /failed|error|attention/i.test(String(event.type))).length;
  const actors = [...new Set(events.map(event => event.name || event.id || event.sessionId).filter(Boolean))].slice(0,3);
  const latest = events.at(-1);
  return <section className={`since-briefing ${risks ? "has-risk" : ""}`}><div className="since-mark"><Icon name="history" size={17}/></div><div><span className="section-kicker">SINCE YOU LAST CHECKED</span><strong>{events.length} meaningful event{events.length === 1 ? "" : "s"}{risks ? ` · ${risks} need review` : " · no recorded risks"}</strong><p>{actors.length ? `Activity involved ${actors.join(", ")}. ` : ""}Latest: {eventTitle(latest)}.</p></div><div className="since-actions"><button onClick={onDismiss}>Mark reviewed</button><button className="primary" onClick={onReview}>Review memory <Icon name="arrow" size={12}/></button></div></section>;
}

function GroundstationOnboarding({ onAddWorker, onRecipes }) {
  return <section className="groundstation-onboarding mc-gs-onboarding">
    <BrandIcon large className="groundstation-onboarding__brand"/>
    <span className="section-kicker">FIRST WORKSPACE</span>
    <h2>Build your supervised project</h2>
    <p>Add the commands you already use. OUTARCH will own their PTYs, track evidence, and surface decisions.</p>
    <ol>
      <li><b>1</b><span><strong>Add a worker</strong><small>Frontend, backend, tests, shell, database, or agent.</small></span></li>
      <li><b>2</b><span><strong>Arrange the workspace</strong><small>Choose a terminal layout or save a Recipe.</small></span></li>
      <li><b>3</b><span><strong>Supervise by exception</strong><small>Needs You interrupts only when judgment is required.</small></span></li>
    </ol>
    <div><button className="btn-primary" onClick={onAddWorker}>Add your first worker</button><button type="button" className="btn-secondary" onClick={onRecipes}>Create a recipe</button></div>
  </section>;
}

function WorkerFocusDialog({ session, activity, onClose, onOpenTerminal }) {
  const history = sessionEvents(session, activity);
  if (!session) return null;
  return <Dialog.Root open onOpenChange={value => !value && onClose()}><Dialog.Portal><Dialog.Overlay className="palette-backdrop worker-focus-backdrop"/><Dialog.Content className="worker-focus-dialog" aria-describedby={undefined}>
      <header><div><span className="section-kicker">WORKER FOCUS</span><h2>{session.name}</h2><p><code title={describeLaunch(session.command, session.args).full || undefined}>{describeLaunch(session.command, session.args).label || session.command}</code> · {runtime(session)} · {session.status}</p></div><button onClick={onClose} aria-label="Close worker focus">×</button></header>
      <div className="worker-focus-summary"><span className={`status-orbit status-${session.status}`}><i/></span><div><strong>What is happening</strong><p>{sessionSummary(session, activity)}</p></div></div>
      <div className="worker-focus-history"><div className="worker-focus-label"><span>Terminal history</span><small>{history.length ? `${history.length} recent events` : "No recent state changes"}</small></div>{history.length ? history.map((event, index) => <article key={event.sequence || `${event.type}-${index}`}><i/><div><strong>{eventTitle(event)}</strong><span>{timeAgo(event.timestamp)} ago{event.reason ? ` · ${event.reason}` : ""}</span></div></article>) : <div className="worker-focus-empty">This terminal is healthy and has no recent lifecycle events to review.</div>}</div>
      <footer><button className="secondary-action" onClick={onClose}>Back to Groundstation</button><button className="primary-button" onClick={() => onOpenTerminal(session.id)}>Open this terminal <Icon name="arrow" size={14}/></button></footer>
    </Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function WorkerQuickLook({ session, activity, onAction, onOpenTerminal, onClose }) {
  const panelRef = React.useRef(null);
  React.useEffect(() => {
    if (!session) return undefined;
    // T132: a proper dialog lifecycle — Escape closes, Tab is contained, focus
    // moves in on open and returns to the invoking element on close.
    const previous = document.activeElement;
    panelRef.current?.focus({ preventScroll: true });
    const onKey = event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose?.(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...(panelRef.current?.querySelectorAll('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])') || [])];
      if (focusable.length < 2) return;
      if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
      else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      const target = previous && document.contains(previous) ? previous : document.getElementById("main-content");
      target?.focus?.({ preventScroll: true });
    };
  }, [session?.id, onClose]);
  if (!session) return null;
  const events = sessionEvents(session, activity, 4);
  return <div className="quicklook-backdrop"><section ref={panelRef} tabIndex="-1" className="quicklook-panel" role="dialog" aria-modal="true" aria-label={`${session.name} quick look`}><header><div><span className="section-kicker">QUICK LOOK · HOLD SPACE</span><h2>{session.name}</h2><p>{workerKind(session)} · {session.status} · {runtime(session)}</p></div><span className={`status-orbit status-${session.status}`}><i/></span></header><div className="quicklook-summary"><span>What is happening</span><strong>{sessionSummary(session, activity)}</strong></div><dl><div><dt>Command</dt><dd>{session.command} {(session.args || []).join(" ")}</dd></div><div><dt>Working directory</dt><dd>{session.cwd || "."}</dd></div><div><dt>Restore policy</dt><dd>{session.autoStart ? "Starts with workspace" : "Manual start"}</dd></div><div><dt>Last output</dt><dd>{timeAgo(session.lastOutputAt)} ago</dd></div></dl><div className="quicklook-events"><span className="section-kicker">RECENT EVIDENCE</span>{events.length ? events.map(event => <article key={`${event.sequence}-${event.type}`}><time>{timeAgo(event.timestamp)}</time><span>{eventTitle(event)}</span></article>) : <p>No recent lifecycle evidence for this worker.</p>}</div><footer><span>Release Space to close</span><div><button onClick={() => onAction(session.isAlive ? "restart" : "start", session.id)}>{session.isAlive ? "Restart" : "Start"}</button><button className="primary" onClick={() => onOpenTerminal(session.id)}>Open terminal</button></div></footer></section></div>;
}

/* A saved recipe reports the run state the engine actually owns —
   running, paused, cancelling, cancelled, failed, completed — instead of
   inferring it from whether its workers happen to be alive. A recipe whose
   workers were deleted says so rather than failing at launch. */
function recipeStatus(recipe, knownIds) {
  const run = recipe.run || null;
  const phase = run?.phase || "idle";
  const workerIds = recipe.workerIds || [];
  const total = workerIds.length;
  const missing = workerIds.filter(id => !knownIds.has(id));
  if (missing.length) return {
    tone: "crit",
    label: `${missing.length} of ${total} worker${total === 1 ? "" : "s"} missing`,
    action: "Launch",
    canRun: false,
    reason: `This recipe references ${missing.length} worker${missing.length === 1 ? "" : "s"} that no longer exist in this project. Open Manage to repair it.`
  };
  if (phase === "running") return {
    tone: "ok",
    label: `Running · ${run.completed?.length || 0}/${total} started`,
    action: "Running",
    canRun: false,
    reason: "This run is already in progress."
  };
  if (phase === "paused") return { tone: "warn", label: "Paused", action: "Paused", canRun: false, reason: "Resume this run from Manage." };
  if (phase === "cancelling") return { tone: "warn", label: "Stopping…", action: "Stopping", canRun: false, reason: "OUTARCH is stopping this run." };
  if (phase === "failed") {
    const failures = run.failures || [];
    return {
      tone: "crit",
      label: `Failed · ${failures.length} step${failures.length === 1 ? "" : "s"}`,
      action: "Recover",
      canRun: true,
      recover: true,
      reason: failures[0]?.reason ? `First failure: ${failures[0].reason}` : "Re-runs the steps that did not complete."
    };
  }
  if (phase === "cancelled") return { tone: "idle", label: "Cancelled", action: "Launch", canRun: true };
  if (phase === "completed") return {
    tone: "idle",
    label: Number.isFinite(run.finishedAt) ? `Ran ${timeAgo(run.finishedAt)} ago` : "Ready",
    action: "Launch",
    canRun: true
  };
  return {
    tone: "idle",
    label: total ? `${total} worker${total === 1 ? "" : "s"}` : "No workers",
    action: "Launch",
    canRun: total > 0
  };
}

function ReferenceRecipePanel({ sessions, onLaunch, onManage }) {
  // `null` is "not loaded yet" — distinct from an empty list, so a failed
  // load can never be reported to the operator as "you have no recipes".
  const [recipes, setRecipes] = React.useState(null);
  const [error, setError] = React.useState("");
  const [reloadToken, setReloadToken] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    const refresh = () => missionApi().request("recipe.list")
      .then(value => { if (active) { setRecipes(Array.isArray(value) ? value : []); setError(""); } })
      .catch(value => { if (active) setError(value?.message || String(value)); });
    void refresh();
    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (String(notification?.type || "").startsWith("recipe:")) void refresh();
      });
    } catch { /* Manage stays reachable; the panel just will not live-update. */ }
    return () => { active = false; unsubscribe?.(); };
  }, [reloadToken]);

  const knownIds = new Set(sessions.map(session => session.id));
  const stepName = workerId => sessions.find(session => session.id === workerId)?.name || workerId;
  return <section className="mc-ref-panel mc-ref-recipes">
    <header><h3>Recipes</h3><button onClick={onManage}>Manage</button></header>
    {error ? <div className="mc-gs-recipe-note is-error" role="status">
      <strong>Recipes could not be loaded</strong>
      <span>{error}</span>
      <button onClick={() => setReloadToken(value => value + 1)}>Try again</button>
    </div> : recipes === null ? <RegisterSkeleton rows={3} label="Loading recipes"/>
      : recipes.length === 0 ? <div className="mc-gs-recipe-note">
        <strong>No recipes yet</strong>
        <span>Save the terminals you open together so one launch starts them in dependency order.</span>
        <button type="button" className="btn-secondary" onClick={onManage}>Create a recipe</button>
      </div> : <div className="mc-ref-recipe-list">
        {recipes.slice(0, 3).map(recipe => {
          const status = recipeStatus(recipe, knownIds);
          const steps = recipe.steps || [];
          const chain = steps.slice(0, 3).map(step => stepName(step.workerId)).join(" → ");
          return <article key={recipe.id} className={`mc-gs-recipe tone-${status.tone}`}>
            <div className="mc-gs-recipe-head">
              <strong title={recipe.name}>{recipe.name}</strong>
              <span className={`mc-gs-recipe-state tone-${status.tone}`}>{status.label}</span>
            </div>
            <span className="mc-gs-recipe-chain" title={steps.map(step => stepName(step.workerId)).join(" → ")}>
              {chain}{steps.length > 3 ? ` +${steps.length - 3}` : ""}
            </span>
            <button
              className="mc-gs-recipe-run"
              disabled={!status.canRun}
              title={status.reason || `Launch ${recipe.name}`}
              onClick={() => onLaunch(recipe, { recover: status.recover === true })}
            >{status.action}</button>
          </article>;
        })}
      </div>}
    {recipes && recipes.length > 3 && <footer className="mc-gs-recipe-more">
      <button onClick={onManage}>+{recipes.length - 3} more saved</button>
    </footer>}
  </section>;
}

/* Manifest state is derived once so the row, the inspector, the filter chips
   and the mission graph all classify a worker exactly the same way. */
function manifestState(session) {
  if (session?.status === "failed") return "crit";
  if (session?.attentionRequired) return "warn";
  if (session?.isAlive) return "ok";
  return "idle";
}

/* Only structured engine evidence becomes a badge. Nothing here is parsed
   from raw terminal text and nothing is invented when evidence is absent. */
function evidenceBadges(session) {
  const structured = session?.evidence || {};
  const badges = [];
  if (structured.tests) {
    const failed = Number(structured.tests.failed) || 0;
    badges.push({ key: "tests", label: `${structured.tests.passed ?? 0}p${failed ? ` ${failed}f` : ""}`, tone: failed ? "warn" : "ok", title: `Tests: ${structured.tests.passed ?? 0} passed, ${failed} failed` });
  }
  if (structured.git) {
    const changed = Number(structured.git.changedPaths) || 0;
    badges.push({ key: "git", label: structured.git.clean ? "clean" : `${changed}Δ`, tone: "idle", title: `Git: ${structured.git.branch || "branch not reported"}${changed ? ` · ${changed} changed paths` : " · working tree clean"}` });
  }
  if (structured.service) {
    badges.push({ key: "service", label: structured.service.port ? `:${structured.service.port}` : structured.service.health || "service", tone: structured.service.health === "failed" ? "crit" : structured.service.health === "confirmed" ? "ok" : "idle", title: `Service: ${structured.service.origin || (structured.service.port ? `port ${structured.service.port}` : "endpoint not reported")}${structured.service.health ? ` · health ${structured.service.health}` : ""}` });
  }
  if (structured.build) {
    badges.push({ key: "build", label: structured.build.status || structured.build.phase || "build", tone: /fail/i.test(String(structured.build.status)) ? "crit" : "idle", title: `Build: ${structured.build.status || structured.build.phase || "phase not reported"}${structured.build.artifacts?.length ? ` · ${structured.build.artifacts.length} artifacts` : ""}` });
  }
  if (structured.database) {
    badges.push({ key: "database", label: structured.database.connection || "db", tone: structured.database.connection === "confirmed" ? "ok" : "idle", title: `Database: ${structured.database.connection || "connection not reported"} · migrations ${structured.database.migrations || "unknown"}` });
  }
  if (structured.container) {
    badges.push({ key: "container", label: structured.container.state || "container", tone: structured.container.healthy === false ? "crit" : "idle", title: `Container: ${structured.container.name || "unnamed"} · ${structured.container.state || "state not reported"}` });
  }
  return badges.slice(0, 3);
}

/* One activity sentence per worker, sourced only from reported facts. When
   the engine has reported nothing we say so instead of implying progress. */
function workerActivity(session) {
  if (session?.attentionRequired) return session.attentionReason || "Waiting for your decision";
  if (session?.status === "failed") return Number.isFinite(session.exitCode) ? `Exited with code ${session.exitCode}` : "Stopped unexpectedly";
  if (session?.isAlive) return Number.isFinite(session.lastOutputAt) ? `Output ${timeAgo(session.lastOutputAt)} ago` : "Running · no output reported yet";
  return session?.autoStart ? "Starts with the workspace" : "Start when ready";
}

function ReferenceManifestRow({ session, agent, selected, favorite, rowIndex, onSelect, onFocus, onAction, onFavorite, onOpenDecision }) {
  const state = manifestState(session);
  const resources = session.resources || {};
  const machineText = session.isAlive
    ? `${Number.isFinite(resources.cpuPercent) ? `${resources.cpuPercent.toFixed(1)}%` : "—"} · ${Number.isFinite(resources.memoryMB) ? `${Math.round(resources.memoryMB)} MB` : runtime(session)}`
    : session.status === "failed" ? "Exited" : "—";
  // An agent's cost is counted in tokens, not megabytes, so that is what its
  // row shows when the CLI has reported any. The machine reading stays on the
  // tooltip rather than being dropped.
  const agentState = agent ? (AGENT_STATE_COPY[agent.state] || { label: agent.state || "Unknown", tone: "idle" }) : null;
  const agentDetail = agentStateLine(agent);
  const agentTokens = agent?.lastTurnTokens?.totalTokens || 0;
  const resourceText = agentTokens ? `${agentTokens.toLocaleString()} tok` : machineText;
  const resourceTitle = agentTokens
    ? `${agentTokens.toLocaleString()} tokens in the last turn · ${machineText}${agent?.updatedAt ? ` · ${relativeTime(agent.updatedAt)}` : ""}`
    : undefined;
  const statusText = session.status === "failed" ? "Needs you"
    : session.attentionRequired ? "Review"
    : agentState && session.isAlive ? agentState.label
    : session.isAlive ? (session.id.startsWith("agent-") ? "Working" : "Running") : "Idle";
  const launch = describeLaunch(session.command, session.args);
  const commandText = launch.label || "Ready to configure";
  // An agent waiting on a decision is the one case where the row's verb is not
  // about the process: it opens the decision, not the terminal.
  const reviewAgent = Boolean(agent && agent.state === "awaiting_approval" && onOpenDecision);
  const action = reviewAgent || session.status === "failed" || session.attentionRequired ? "focus" : session.isAlive ? "restart" : "start";
  const chipTone = state === "crit" || agentState?.tone === "failed" ? "critical"
    : state === "warn" || agentState?.tone === "attention" ? "warning"
    : state === "ok" ? "running" : "idle";
  const badges = evidenceBadges(session);
  return <article
    className={`mc-ref-manifest-row state-${state} ${selected ? "is-selected" : ""}`}
    role="row"
    aria-rowindex={rowIndex}
    tabIndex={selected ? 0 : -1}
    aria-selected={selected}
    data-worker-id={session.id}
    onClick={() => onSelect(session.id)}
    onDoubleClick={() => onFocus(session.id)}
  >
    <i className={manifestState(session)}/>
    <button
      type="button"
      role="gridcell"
      className={`mc-gs-star ${favorite ? "is-on" : ""}`}
      aria-pressed={favorite}
      aria-label={favorite ? `Unpin ${session.name}` : `Pin ${session.name} to the top`}
      onClick={event => { event.stopPropagation(); onFavorite(session.id); }}
    ><Icon name="star" size={13}/></button>
    <div className="mc-ref-worker-name" role="gridcell">
      <span className="mc-gs-name-line"><strong>{session.name}</strong>{badges.map(badge => <b key={badge.key} className={`mc-gs-evidence tone-${badge.tone}`} title={badge.title}>{badge.label}</b>)}</span>
      <code title={launch.full || undefined}>{commandText}</code>
    </div>
    <span className={`mc-ref-role ${agent ? "" : "is-inferred"}`} role="gridcell" title={agent ? `Observed running ${agent.agentType || "an agent CLI"} — reported by the engine from this worker's output, not guessed from its command` : "Role inferred from the command — not an engine-reported fact"}>{agent?.agentType ? `AI agent · ${agent.agentType}` : workerKind(session)}</span>
    <StatusChip role="gridcell" className="mc-ref-status" tone={chipTone} label={statusText} title={agentState?.full}/>
    <span className="mc-gs-activity" role="gridcell" title={agentDetail || undefined}>{agentDetail || workerActivity(session)}</span>
    <span className="mc-ref-resource" role="gridcell" title={resourceTitle}>{resourceText}</span>
    <button type="button" role="gridcell" className="mc-gs-row-action" onClick={event => {
      event.stopPropagation();
      if (reviewAgent) onOpenDecision(session.id);
      else if (action === "focus") onFocus(session.id);
      else onAction(action, session.id);
    }}>{action === "focus" ? "Review" : action === "restart" ? "Restart" : "Start"}</button>
  </article>;
}

/* Pinned workers are a per-project view preference, never engine state. */
const GS_FAVORITES_KEY = "mission-control.groundstation-favorites.v1";

function useFavoriteWorkers(projectPath) {
  const key = `${GS_FAVORITES_KEY}:${projectPath || "default"}`;
  const [favorites, setFavorites] = React.useState(() => new Set());
  React.useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) || "[]");
      setFavorites(new Set(Array.isArray(stored) ? stored : []));
    } catch { setFavorites(new Set()); }
  }, [key]);
  const toggle = React.useCallback(id => {
    setFavorites(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { window.localStorage.setItem(key, JSON.stringify([...next])); } catch { /* View preference only. */ }
      return next;
    });
  }, [key]);
  return [favorites, toggle];
}

function GroundstationStatusBar({ workspace, sessions, agents, health, attentionCount, filter, onFilter, onNavigate, onRecipes, onAskAI }) {
  const running = sessions.filter(session => session.isAlive).length;
  const activeAgents = agents.filter(agent => agent.isAlive).length;
  return <header className={`mc-gs-statusbar tone-${health.tone}`} role="region" aria-label="Project status">
    <div className="mc-gs-identity">
      <span className="mc-gs-health" aria-hidden="true"><i/></span>
      <div>
        <strong title={workspace?.path || workspace?.name || ""}>{workspace?.name || "Workspace"}</strong>
        <span>{health.label} · {health.detail}</span>
      </div>
    </div>
    <div className="mc-gs-counts" role="group" aria-label="Workspace counts">
      <button type="button" className={filter === "live" ? "is-active" : ""} aria-pressed={filter === "live"} onClick={() => onFilter(filter === "live" ? "all" : "live")}>
        <b>{running}<small>/{sessions.length}</small></b><span>Running</span>
      </button>
      <button type="button" className={filter === "idle" ? "is-active" : ""} aria-pressed={filter === "idle"} onClick={() => onFilter(filter === "idle" ? "all" : "idle")}>
        <b>{sessions.length - running}</b><span>Idle</span>
      </button>
      <button type="button" onClick={() => onNavigate("agents")}>
        <b>{activeAgents}<small>/{agents.length}</small></b><span>AI crew</span>
      </button>
      <button type="button" className={`mc-gs-needs ${attentionCount ? "has-attention" : ""}`} onClick={() => onNavigate("needs")}>
        <b>{attentionCount}</b><span>Needs you</span>
      </button>
    </div>
    <div className="mc-gs-statusbar-actions">
      <button type="button" className="primary" onClick={() => onNavigate("recipes")}><Icon name="play" size={13}/> Run recipe</button>
      <button type="button" onClick={() => onNavigate("workspace")}><Icon name="terminal" size={13}/> Workspace</button>
      <ContextSnapshotButton/>
      <button type="button" className="ai" onClick={onAskAI}><span>AI</span> Ask Mission AI</button>
    </div>
  </header>;
}

/* T103 — the single most urgent thing in the whole project, whatever produced
   it. The unified list is already sorted status → severity → expiry → age, so
   its first active record IS the answer; the panel does not re-rank it. A lead
   drawn from an integration source is the case the old worker-only preview
   could not show at all: it counted such a decision and then said nothing about
   it. */
function MostUrgentDecision({ record, onNavigate, onOpenSource }) {
  if (!record) return null;
  return <article className={`mc-gs-urgent severity-${record.severity || "warning"}`} aria-label="Most urgent decision">
    <div className="mc-gs-urgent__body">
      <span className="mc-gs-kicker">MOST URGENT · {decisionSourceLabel(record).toUpperCase()}</span>
      <strong>{record.title}</strong>
      <p>{record.evidence}</p>
    </div>
    <div className="mc-gs-urgent__actions">
      {onOpenSource && record.deepLink?.view && <button type="button" onClick={() => onOpenSource(record)}>{decisionDeepLinkLabel(record)}</button>}
      <button type="button" className="primary" onClick={() => onNavigate("needs")}>Decide</button>
    </div>
  </article>;
}

/* T104 — with nothing waiting the panel still has to earn its space. Every
   line below is read off state the engine already reported, and each is a fact
   followed by an offer: no invented urgency, no progress estimate, no
   telemetry the engine never sent. */
// The Groundstation used to carry a reassurance band when nothing was waiting
// — a pill saying every system was nominal, a count of workers that were not
// running, and a link to the Workspace. It was removed on 2026-09-12: the
// status tape above it already reports health and the needs-you count, the
// register below already reports which workers are running, and a project
// with no workers at all is met by the onboarding panel inside that register.
// An empty attention queue renders nothing now, which is the honest answer.

function AttentionInbox({ attention, totalDecisions, records = [], sources = [], decisionsStatus = "ready", onFocus, onAction, onNavigate, onOpenSource, onRefresh }) {
  const [expanded, setExpanded] = React.useState(false);
  const total = Number.isInteger(totalDecisions) ? totalDecisions : attention.length;
  const lead = records.find(record => ACTIVE_DECISION_STATUSES.has(record.status)) || null;
  const completeness = <DecisionSourceStrip status={decisionsStatus} sources={sources} onRetry={onRefresh}/>;
  if (!attention.length && !total) return null;
  // Rows preview the worker-level decisions; integration approvals are counted in
  // the header and reached through "View all".
  const external = Math.max(0, total - attention.length);
  if (!attention.length) {
    return <section className="mc-gs-attention" role="region" aria-label={`Attention queue; ${total} decisions waiting`}>
      <header>
        <div><span className="mc-gs-kicker">NEEDS YOU</span><strong>{total} decision{total === 1 ? "" : "s"} waiting</strong></div>
        <button type="button" onClick={() => onNavigate("needs")}>View all <Icon name="arrow" size={12}/></button>
      </header>
      {completeness}
      <MostUrgentDecision record={lead} onNavigate={onNavigate} onOpenSource={onOpenSource}/>
      <p className="mc-gs-attention__external">All are integration approvals — open Needs You to review them.</p>
    </section>;
  }
  /* Failures first, then oldest evidence first: the operator sees the most
     consequential decision without re-sorting the list themselves. */
  const ordered = [...attention].sort((a, b) => {
    const severity = (a.status === "failed" ? 0 : 1) - (b.status === "failed" ? 0 : 1);
    if (severity) return severity;
    return (a.lastOutputAt || a.startTime || 0) - (b.lastOutputAt || b.startTime || 0);
  });
  const shown = expanded ? ordered : ordered.slice(0, 3);
  return <section className="mc-gs-attention" role="region" aria-label={`Attention queue; ${total} decisions waiting`}>
    <header>
      <div><span className="mc-gs-kicker">NEEDS YOU</span><strong>{total} decision{total === 1 ? "" : "s"} waiting</strong>{external > 0 && <small>{external} integration approval{external === 1 ? "" : "s"} in Needs You</small>}</div>
      <button type="button" onClick={() => onNavigate("needs")}>View all <Icon name="arrow" size={12}/></button>
    </header>
    {completeness}
    {lead && lead.source !== "session" && <MostUrgentDecision record={lead} onNavigate={onNavigate} onOpenSource={onOpenSource}/>}
    <div>{shown.map(session => {
      const decision = decisionFor(session);
      return <article key={`inbox-${session.id}`} className={`mc-gs-decision is-${decision.tone}`}>
        <i aria-hidden="true"/>
        <div className="mc-gs-decision-body">
          <small>{decision.kind} · {session.name} · {Number.isFinite(session.lastOutputAt) ? `${timeAgo(session.lastOutputAt)} ago` : "age not reported"}</small>
          <strong>{decision.title}</strong>
          <p>{decision.impact}</p>
        </div>
        <div className="mc-gs-decision-actions">
          <button type="button" onClick={() => onFocus(session.id)}>{decision.recommended}</button>
          {session.status === "failed"
            ? <button type="button" className="primary" onClick={() => onAction("restart", session.id)}>Restart</button>
            : <button type="button" className="primary" onClick={() => onAction("acknowledge", session.id)}>Acknowledge</button>}
        </div>
      </article>;
    })}</div>
    {ordered.length > 3 && <footer><button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer" : `+${ordered.length - 3} more decision${ordered.length - 3 === 1 ? "" : "s"}`}</button></footer>}
  </section>;
}

function ManifestToolbar({ filter, counts, query, onFilter, onQuery, searchRef }) {
  return <div className="mc-gs-toolbar" role="group" aria-label="Filter and search workers">
    <FilterGroup
      className="mc-gs-chips"
      label="Filter workers by state"
      value={filter}
      onChange={onFilter}
      options={[["all", "All"], ["live", "Live"], ["idle", "Idle"], ["review", "Review"], ["failed", "Failed"]].map(([value, label]) => ({ value, label, count: counts[value], className: `chip-${value}` }))}
    />
    <label className="mc-gs-search">
      <Icon name="search" size={13}/>
      <input ref={searchRef} type="search" value={query} placeholder="Search name or command…" aria-label="Search workers by name or command" onChange={event => onQuery(event.target.value)}/>
      {query ? <button type="button" aria-label="Clear search" onClick={() => onQuery("")}>×</button> : <kbd aria-hidden="true">Ctrl F</kbd>}
    </label>
  </div>;
}

function WorkerInspector({ session, activity, favorite, onClose, onFocus, onAction, onFavorite, onAskAI }) {
  if (!session) return null;
  const events = sessionEvents(session, activity, 6);
  const profile = workerProfile(session);
  const badges = evidenceBadges(session);
  const state = manifestState(session);
  return <aside className={`mc-gs-inspector state-${state}`} role="complementary" aria-label="Selected worker details">
    <header>
      <div>
        <span className="mc-gs-kicker is-inferred" title="Role inferred from the command — not an engine-reported fact">{workerKind(session)} · inferred</span>
        <h2>{session.name}</h2>
        <code title={describeLaunch(session.command, session.args).full || undefined}>{describeLaunch(session.command, session.args).label}</code>
      </div>
      <button type="button" className="mc-gs-inspector-close" aria-label="Close worker details" onClick={onClose}>×</button>
    </header>
    <div className="mc-gs-inspector-now"><span>Currently</span><p>{sessionSummary(session, activity)}</p></div>
    {badges.length > 0 && <div className="mc-gs-inspector-evidence">{badges.map(badge => <b key={badge.key} className={`mc-gs-evidence tone-${badge.tone}`} title={badge.title}>{badge.label}</b>)}<small>{profile.label}</small></div>}
    <dl className="mc-gs-inspector-facts">
      <div><dt>State</dt><dd>{session.status}</dd></div>
      <div><dt>Runtime</dt><dd>{runtime(session)}</dd></div>
      <div><dt>Last output</dt><dd>{Number.isFinite(session.lastOutputAt) ? `${timeAgo(session.lastOutputAt)} ago` : "Not reported"}</dd></div>
      <div><dt>Ownership</dt><dd>{session.isAlive && session.pid ? `Engine PTY · pid ${session.pid}` : "No engine PTY"}</dd></div>
      <div><dt>Directory</dt><dd title={session.cwd || "."}>{session.cwd || "."}</dd></div>
      <div>
        <dt>Restore</dt>
        <dd>
          <label className="inspector-autostart-toggle" title="Start this worker when the project opens">
            <span className={`inspector-autostart-status ${session.autoStart ? "is-enabled" : "is-disabled"}`}>
              {session.autoStart ? "Auto-start" : "Manual"}
            </span>
            <span className="pm-toggle" onClick={e => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={Boolean(session.autoStart)}
                onChange={event => onAction("setAutoStart", session.id, { enabled: event.target.checked })}
                aria-label={`Start ${session.name} when the project opens`}
              />
              <i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i>
            </span>
          </label>
        </dd>
      </div>
    </dl>
    <div className="mc-gs-inspector-events">
      <span className="mc-gs-kicker">RECENT EVIDENCE</span>
      {events.length ? events.map((event, index) => <article key={`${event.sequence || index}-${event.type}`}><time>{timeAgo(event.timestamp)}</time><span>{eventTitle(event)}</span></article>) : <p>No recent lifecycle evidence for this worker.</p>}
    </div>
    <footer>
      <button type="button" className="mc-gs-inspector-btn--action" onClick={() => onAction(session.isAlive ? "restart" : "start", session.id)}>{session.isAlive ? "Restart" : "Start"}</button>
      <button type="button" className="primary" onClick={() => onFocus(session.id)}><Icon name="terminal" size={13}/> {session.id.startsWith("agent-") ? "Open agent" : "Open terminal"}</button>
      <button type="button" className={`mc-gs-star ${favorite ? "is-on" : ""}`} aria-pressed={favorite} aria-label={favorite ? "Unpin worker" : "Pin worker"} onClick={() => onFavorite(session.id)}><Icon name="star" size={13}/></button>
      {onAskAI && <button type="button" className="mc-gs-inspector-ai" onClick={() => onAskAI(`${session.name} (${session.command}) is ${session.status}. ${sessionSummary(session, activity)} What should I check or do next?`)}><span>AI</span> Ask Mission AI</button>}
    </footer>
  </aside>;
}

function ActivityWaterline({ activity, attentionCount, onNavigate, onSelect }) {
  const recent = [...activity].reverse().slice(0, 6);
  return <section className="mc-ref-panel mc-ref-now">
    <header><h3>NOW — what&apos;s happening</h3><button onClick={() => onNavigate(attentionCount ? "needs" : "history")}>{attentionCount ? "Review" : "History"}</button></header>
    <div className="mc-gs-feed" aria-live="polite">{recent.length ? recent.map((event, index) => {
      const tone = /failed|error/i.test(String(event.type)) ? "crit" : /attention/i.test(String(event.type)) ? "warn" : /evidence/i.test(String(event.type)) ? "ok" : "idle";
      return <button key={`${event.sequence || index}-${event.type}`} type="button" className={`tone-${tone}`} onClick={() => event.sessionId && onSelect(event.sessionId)}>
        <time>{timeAgo(event.timestamp)}</time>
        <strong>{event.name || event.sessionId || "Workspace"}</strong>
        <span>{eventTitle(event)}</span>
      </button>;
    }) : <p>Activity will appear here as workers change state.</p>}</div>
  </section>;
}

function ManifestList({ workers, activities, favorites, selectedId, label = "Worker register", keyPrefix = "", onSelect, onFocus, onAction, onFavorite, onOpenDecision }) {
  // A complete grid: container role="grid", real column headers, gridcell children,
  // and 1-based aria-rowindex so assistive tech announces "row N of M". Roving
  // tabindex + arrow-key navigation live on the parent (see the manifest keydown
  // effect in LiveGroundstationView).
  return <div className="mc-ref-manifest" role="grid" aria-label={label} aria-rowcount={workers.length + 1}>
    <div className="mc-ref-manifest-header" role="row" aria-rowindex={1}>
      <span role="columnheader" aria-hidden="true"/><span role="columnheader" aria-hidden="true"/><span role="columnheader">Worker</span><span role="columnheader">Role</span><span role="columnheader">State</span><span role="columnheader">Current activity</span><span role="columnheader">Resources</span><span role="columnheader">Action</span>
    </div>
    {workers.map((session, index) => <ReferenceManifestRow
      key={`${keyPrefix}${session.id}`}
      session={session}
      agent={activities?.get(session.id) || null}
      rowIndex={index + 2}
      selected={session.id === selectedId}
      favorite={favorites.has(session.id)}
      onSelect={onSelect}
      onFocus={onFocus}
      onAction={onAction}
      onFavorite={onFavorite}
      onOpenDecision={onOpenDecision}
    />)}
  </div>;
}

/* Pinned first, then the order an operator actually triages in: failures,
   decisions, running work, idle. Sorting is presentation only. */
function orderManifest(list, favorites) {
  const rank = session => (favorites.has(session.id) ? 0 : 1) * 10 + (session.status === "failed" ? 0 : session.attentionRequired ? 1 : session.isAlive ? 2 : 3);
  return [...list].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

function matchesFilter(session, filter) {
  if (filter === "all") return true;
  if (filter === "live") return session.isAlive;
  if (filter === "review") return session.attentionRequired && session.status !== "failed";
  if (filter === "failed") return session.status === "failed";
  return !session.isAlive && session.status !== "failed";
}

// What each running agent is doing, in the place the system is watched from.
// Every line is either a state the CLI reported or a tool it named — never an
// invented percentage, and never "finished" inferred from silence.
const AGENT_STATE_COPY = {
  idle: { label: "Idle", full: "Idle — nothing reported since its last turn", tone: "idle" },
  thinking: { label: "Working", full: "Working — the CLI reported it is thinking", tone: "busy" },
  executing: { label: "In a tool", full: "Running a tool — the tool it named is beside this", tone: "busy" },
  awaiting_approval: { label: "Approval", full: "Waiting for your approval before it continues", tone: "attention" },
  response_ready: { label: "Ready", full: "A response is ready to read", tone: "ready" },
  failed: { label: "Failed", full: "The agent CLI reported a failure", tone: "failed" }
};

// What an agent is doing, in one line. This used to be a panel of its own at
// the top of Groundstation; it is now the "current activity" of the agent's row
// in the crew register, so a configured agent and a detected one describe
// themselves in exactly the same words. Every string here is either a state the
// CLI reported or a tool it named — never a percentage, and never "finished"
// inferred from silence.
function agentStateLine(activity) {
  if (!activity) return "";
  if (activity.currentTool) return activity.currentTool;
  if (activity.state === "response_ready") return "Output ready to read";
  if (activity.state === "awaiting_approval") return "Waiting for your decision";
  return "";
}

// True while an element's content box is narrower than `threshold` — the same
// measurement an inline-size container query makes.
function useNarrowContainer(ref, threshold) {
  const [narrow, setNarrow] = React.useState(false);
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver !== "function") return undefined;
    const measure = () => {
      const style = getComputedStyle(node);
      const inline = node.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      setNarrow(inline < threshold);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref, threshold]);
  return narrow;
}

// The canvas width below which the worker inspector is a drawer laid over the
// register rather than a column beside it (screens.css, @container groundstation).
const GS_INSPECTOR_RAIL_MIN = 1100;

function LiveGroundstationView({ sessions, workspace, activity, unseenActivity, selectedId: sharedSelectedId, onSelect: selectShared, onFocus, onAction, onNavigate, onDismissActivity, onRecipes, onCreateRecipe, onLaunchRecipe, onAddWorker, onAskAI, onMissionGraph, onOpenDecisionSource, decisionCount, decisions }) {
  const ops = useWorkspaceOps();
  const health = healthFor(sessions, workspace, decisions);
  // The crew is every agent the project has, however OUTARCH came to
  // know about it. `ops.agents` is the engine's live classification, so this
  // recomputes as terminals are observed starting and stopping an agent CLI.
  const agentActivity = React.useMemo(() => {
    const map = new Map();
    for (const activity of ops.agents || []) if (activity?.isAgent) map.set(activity.workerId, activity);
    return map;
  }, [ops.agents]);
  const agents = sessions.filter(isAgentSession);
  const workers = sessions.filter(session => !isAgentSession(session));
  const detectedAgents = agents.filter(session => !session.id.startsWith("agent-")).length;
  const attention = sessions.filter(needsAttention);
  // The unified decision count (workers + every integration approval) when it has
  // loaded, otherwise the always-available worker-attention count.
  const needsCount = Number.isInteger(decisionCount) ? decisionCount : attention.length;
  const [filter, setFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [favorites, toggleFavorite] = useFavoriteWorkers(workspace?.path);
  const searchRef = React.useRef(null);
  const focusSelectedRowRef = React.useRef(false);
  const arrivedSelectionRef = React.useRef(false);
  // As a drawer, the inspector covers the attention queue. The worker the app
  // seeds on arrival therefore does not open it; one the operator picks (a
  // click, the arrow keys, the waterline) does.
  const groundstationRef = React.useRef(null);
  const drawerInspector = useNarrowContainer(groundstationRef, GS_INSPECTOR_RAIL_MIN);
  const [inspectorChosen, setInspectorChosen] = React.useState(false);
  const onSelect = React.useCallback(id => { setInspectorChosen(Boolean(id)); selectShared(id); }, [selectShared]);
  const selectedId = drawerInspector && !inspectorChosen ? null : sharedSelectedId;
  const term = query.trim().toLowerCase();
  const matches = session => matchesFilter(session, filter)
    && `${session.name} ${session.command || ""} ${(session.args || []).join(" ")}`.toLowerCase().includes(term);
  const visibleWorkers = orderManifest(workers.filter(matches), favorites);
  const visibleAgents = orderManifest(agents.filter(matches), favorites);
  // T105: the contextual inspector only reflects a worker that is in the visible
  // register. Selecting one then filtering it out clears the inspector rather than
  // leaving a stale panel; the shared selection state itself is left untouched so
  // other routes keep it.
  const selectedInView = [...visibleWorkers, ...visibleAgents].some(session => session.id === selectedId);
  const selected = (selectedInView && sessions.find(session => session.id === selectedId)) || null;
  const counts = {
    all: sessions.length,
    live: sessions.filter(session => session.isAlive).length,
    idle: sessions.filter(session => !session.isAlive && session.status !== "failed").length,
    review: sessions.filter(session => session.attentionRequired && session.status !== "failed").length,
    failed: sessions.filter(session => session.status === "failed").length
  };
  const navigable = [...visibleWorkers, ...visibleAgents].map(session => session.id);

  /* Keyboard model for the manifest. Everything here is selection, filtering
     or an action the operator could already reach with the mouse; nothing new
     is dispatched to the engine and destructive stops still route through the
     shared confirmation dialog. */
  React.useEffect(() => {
    const editable = target => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable;
    const onKey = event => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (event.key === "Escape" && editable(event.target) && event.target === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
        return;
      }
      if (editable(event.target) || event.altKey) return;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
        const key = event.key.toLowerCase();
        if (!selected || !["r", "s", "f"].includes(key)) return;
        event.preventDefault();
        if (key === "f") toggleFavorite(selected.id);
        else if (key === "r") onAction(selected.isAlive ? "restart" : "start", selected.id);
        else if (selected.isAlive) onAction("kill", selected.id);
        return;
      }
      if (event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
        if (!navigable.length) return;
        event.preventDefault();
        const current = navigable.indexOf(selectedId);
        const step = event.key === "ArrowDown" ? 1 : -1;
        const next = event.key === "Home" ? 0
          : event.key === "End" ? navigable.length - 1
          : current < 0 ? (step > 0 ? 0 : navigable.length - 1)
          : Math.min(navigable.length - 1, Math.max(0, current + step));
        focusSelectedRowRef.current = true; // T130: keyboard nav moves DOM focus to the row
        onSelect(navigable[next]);
        return;
      }
      if (event.key === "Enter" && selectedId && navigable.includes(selectedId)) {
        event.preventDefault();
        onFocus(selectedId);
        return;
      }
      // Escape belongs to the topmost layer first: only clear the manifest
      // selection when no dialog, palette or quick look is open above it.
      if (event.key === "Escape" && selectedId && !document.querySelector("[role='dialog'],[role='alertdialog']")) onSelect(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigable.join("|"), onAction, onFocus, onSelect, selected, selectedId, toggleFavorite]);

  /* Keep the selected row scrolled into view, and — when the keyboard drove the
     selection — move DOM focus onto it so assistive tech announces the row. */
  React.useEffect(() => {
    if (!selectedId || !navigable.includes(selectedId)) return;
    // The selection the route arrives with is not one the operator just made
    // (the app seeds the first worker). Scrolling to it opened Groundstation
    // part-way down its column, past the attention queue at the top.
    if (!arrivedSelectionRef.current) {
      arrivedSelectionRef.current = true;
      if (!focusSelectedRowRef.current) return;
    }
    const row = document.querySelector(`.mc-ref-manifest-row[data-worker-id="${CSS.escape(selectedId)}"]`);
    row?.scrollIntoView({ block: "nearest" });
    if (focusSelectedRowRef.current) {
      row?.focus({ preventScroll: true });
      focusSelectedRowRef.current = false;
    }
  }, [selectedId]);

  const manifestProps = { favorites, selectedId, onSelect, onFocus, onAction, onFavorite: toggleFavorite };

  return <div ref={groundstationRef} className={`mc-ref-groundstation ${selected ? "has-inspector" : ""}`}>
    <h1 className="sr-only">Groundstation</h1>
    <GroundstationStatusBar workspace={workspace} sessions={sessions} agents={agents} health={health} attentionCount={needsCount} filter={filter} onFilter={setFilter} onNavigate={onNavigate} onRecipes={onRecipes} onAskAI={onAskAI}/>

    <div className="mc-gs-body">
      <div className="mc-gs-main">
        <AttentionInbox
          attention={attention}
          totalDecisions={needsCount}
          records={decisions?.records || []}
          sources={decisions?.sources || []}
          decisionsStatus={decisions?.status || "ready"}
          onFocus={onFocus}
          onAction={onAction}
          onNavigate={onNavigate}
          onOpenSource={onOpenDecisionSource}
          onRefresh={decisions?.refresh}
        />

        <section className="mc-ref-section mc-gs-register mc-gs-register--operations" role="region" aria-label="Supervised workers">
          <header className="mc-ref-section-head">
            <h2>Project operations</h2>
            <span>{visibleWorkers.length} of {workers.length} shown · {workers.filter(session => session.isAlive).length} live</span>
          </header>
          <ManifestToolbar filter={filter} counts={counts} query={query} onFilter={setFilter} onQuery={setQuery} searchRef={searchRef}/>
          {workers.length === 0
            ? <GroundstationOnboarding onAddWorker={onAddWorker} onRecipes={onCreateRecipe}/>
            : visibleWorkers.length === 0
              ? <div className="mc-ref-empty"><strong>No workers match this view</strong><span>Clear the search or choose a different status filter.</span><button onClick={() => { setFilter("all"); setQuery(""); }}>Show all workers</button></div>
              : <ManifestList workers={visibleWorkers} label="Supervised workers" {...manifestProps}/>}
        </section>

        {agents.length > 0 && <section className="mc-ref-section mc-gs-register mc-gs-register--crew" role="region" aria-label="Assigned AI agents">
          <header className="mc-ref-section-head">
            <h2>AI crew</h2>
            <span>{agents.filter(agent => agent.isAlive).length} active · {agents.length} in this project{detectedAgents ? ` · ${detectedAgents} detected from output` : ""}</span>
          </header>
          {visibleAgents.length
            ? <ManifestList workers={visibleAgents} activities={agentActivity} onOpenDecision={onOpenDecisionSource} keyPrefix="crew-" label="Assigned AI agents" {...manifestProps}/>
            : <p className="mc-gs-muted">No agents match this view.</p>}
        </section>}

        <section className="mc-ref-lower-grid">
          <ActivityWaterline activity={activity} attentionCount={needsCount} onNavigate={onNavigate} onSelect={onSelect}/>
          <ReferenceRecipePanel sessions={sessions} onLaunch={onLaunchRecipe} onManage={onRecipes}/>
          <section className="mc-ref-panel mc-ref-graph" aria-hidden="true" hidden style={{ display: "none" }}>
            <header><h3>Mission dependencies</h3><button onClick={onMissionGraph}>Open</button></header>
            <div>{sessions.slice(0, 6).map(session => <button key={`graph-${session.id}`} onClick={() => onSelect(session.id)}><i className={manifestState(session)}/><code>{session.name}</code></button>)}{!sessions.length && <span>No configured workers</span>}</div>
          </section>
        </section>

        <SinceLastCheck events={unseenActivity} onReview={() => onNavigate("history")} onDismiss={onDismissActivity}/>
      </div>

      <WorkerInspector session={selected} activity={activity} favorite={favorites.has(selected?.id)} onClose={() => onSelect(null)} onFocus={onFocus} onAction={onAction} onFavorite={toggleFavorite} onAskAI={onAskAI}/>
    </div>
  </div>;
}

function EmptyState({ title, detail, action }) {
  return <div className="empty-state"><span className="empty-orbit"><i/></span><strong>{title}</strong><p>{detail}</p>{action}</div>;
}

function EmptyTerminalSlot({ sessions, style, onSelect, onAddWorker, onDropSession }) {
  return <article className="terminal-pane terminal-pane-empty" style={style} onDragOver={event => { if (event.dataTransfer.types.includes("application/x-mission-worker")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const id = event.dataTransfer.getData("application/x-mission-worker"); if (id) onDropSession(id); }}><span>+</span><strong>Open a terminal worker</strong><p>Show an existing PTY here, drag a worker into this pane, or create a project command.</p><div className="empty-pane-actions"><DropdownMenu.Root><DropdownMenu.Trigger asChild><button className="empty-pane-trigger">Choose existing <span>⌄</span></button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="empty-pane-menu radix-menu" sideOffset={8}>{sessions.map(item => <DropdownMenu.Item asChild key={item.id}><button onClick={() => onSelect(item.id)}><i className={`status-${item.status}`}/><span><strong>{item.name}</strong><small>{item.command}</small></span></button></DropdownMenu.Item>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root><button className="empty-pane-create" onClick={onAddWorker}>+ Create worker</button></div></article>;
}

function DetachedTerminalSlot({ session, slotInfo, style, onRecall, onFocusWindow }) {
  const slot = slotInfo?.detachedSlot || 1;
  const slotColor = slotInfo?.identity?.color;
  const slotName = slotInfo?.identity?.name || `Window ${slot}`;
  // The identity colour is data, so it arrives as a custom property rather than
  // as a hard-coded value in the stylesheet, and every rule derives from it.
  const paneStyle = slotColor || style ? { ...style, ...(slotColor ? { "--slot-accent": slotColor } : null) } : undefined;
  // The placeholder has to stay truthful when the worker ends while detached.
  // Saying "still running" over an exited process is the kind of state that
  // sends someone looking for output that will never arrive.
  const alive = session.isAlive !== false && session.status !== "exited" && session.status !== "failed";
  return (
    <article className="terminal-pane terminal-pane--detached" style={paneStyle} aria-label={`${session.name} is open in ${slotName}`}>
      {/* A blurred stand-in for the terminal that left, so the pane still reads
          as a terminal rather than an empty box. It is generated from the slot
          colour, never a screenshot of the output — a frosted picture of real
          terminal content would leak whatever was on screen. */}
      <div className="detached-ghost" aria-hidden="true">
        <span/><span/><span/><span/><span/><span/>
      </div>
      <span className="detached-badge">{slot} · {slotName}</span>
      <h3>{session.name} is popped out</h3>
      <p>
        {alive
          ? "Only its view moved — the worker is still running. This pane is held for it, so recalling puts it back in the same split."
          : `The process has ${session.status === "failed" ? "failed" : "exited"}, and its window is still open. Recall it to read the last output here.`}
      </p>
      <div className="detached-actions">
        <button type="button" className="btn-primary" onClick={() => onRecall?.(session.id)}>Recall here</button>
        <button type="button" className="btn-ghost" onClick={() => onFocusWindow?.(session.id)}>Focus window</button>
      </div>
    </article>
  );
}

// A service's state is evidence, not decoration: each label says what was
// actually observed, so "Ready" is never inferred from a printed line alone.
// The label says how the state was established, because "Ready" earned by a
// successful connection and "Detected" from a printed line are different claims.
function serviceStateLabel(service) {
  if (service.state === "stale") return "No longer reported";
  if (service.state === "ready") return service.readyEvidence === "listening" ? "Ready · listening" : "Ready";
  return service.advertisedConfidence === "ready" ? "Announced · checking" : "Detected";
}

function ChevronIcon({ open }) {
  return (
    <svg
      className={`ops-chevron ${open ? "is-open" : ""}`}
      width="10" height="10" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6"/>
    </svg>
  );
}

/**
 * Reads local service discovery, the usage ledger and detached-window state.
 * These update when the engine observes something, so the drawer subscribes
 * rather than polling: a dev server address appears the moment it is printed.
 */
function useWorkspaceOps() {
  const [state, setState] = React.useState({
    agents: [],
    services: [],
    usage: null,
    detached: [],
    maxDetached: 3,
    status: "loading",
    error: ""
  });

  const refresh = React.useCallback(async () => {
    try {
      const [services, usage, windows, agents] = await Promise.all([
        missionApi().request("services.list"),
        missionApi().request("usage.query"),
        missionApi().request("terminal.window.list").catch(() => ({ detached: [], max: 3 })),
        missionApi().request("agents.activity").catch(() => ({ activities: [] }))
      ]);
      const activities = Array.isArray(agents?.activities) ? agents.activities : [];
      liveAgentClassification.clear();
      for (const activity of activities) liveAgentClassification.set(activity.workerId, activity);
      setState({
        agents: activities,
        services: Array.isArray(services?.services) ? services.services : [],
        usage: usage?.totals || null,
        detached: Array.isArray(windows?.detached) ? windows.detached : [],
        maxDetached: Number.isInteger(windows?.max) ? windows.max : 3,
        status: "ready",
        error: ""
      });
    } catch (error) {
      // Discovery is an enhancement: a failure here must not blank the panel,
      // it must say what is unavailable.
      setState(current => ({ ...current, status: "error", error: error.message || String(error) }));
    }
  }, []);

  React.useEffect(() => {
    let active = true;
    let pending = null;
    const schedule = () => {
      if (!active || pending) return;
      // Bursts of discovery events collapse into one read.
      pending = setTimeout(() => { pending = null; if (active) void refresh(); }, 150);
    };

    void refresh();
    let unsubscribe = () => {};
    try {
      unsubscribe = missionApi().subscribe(message => {
        if (!active) return;
        if (["services:changed", "usage:changed", "terminal:detached", "terminal:recalled"].includes(message?.type)) schedule();
      });
    } catch {
      // Without the bridge there is nothing to observe; refresh already ran.
    }
    return () => {
      active = false;
      if (pending) clearTimeout(pending);
      unsubscribe?.();
    };
  }, [refresh]);

  return { ...state, refresh };
}

function ServicesPanel({ services, status, error, onAction, onConfirm }) {
  const { toast } = useToast();
  const [busyId, setBusyId] = React.useState("");

  // Stopping or restarting is an action on the *worker*, and a worker can serve
  // several addresses. The impact is stated before it happens rather than
  // discovered afterwards. Execution goes through the app's normal dispatch, so
  // there is one confirmation path and one refresh path.
  const owner = async (service, action) => {
    let detail;
    try {
      detail = await missionApi().request("services.owner", { serviceId: service.id });
    } catch (requestError) {
      toast.danger(requestError.message || String(requestError));
      return;
    }
    if (!detail.workerExists) {
      toast.danger(`${detail.workerName || service.workerId} is not in this project any more.`);
      return;
    }

    const others = detail.services.filter(item => item.id !== service.id);
    const impact = others.length
      ? `${detail.workerName} also serves ${others.map(item => item.url).join(", ")}. ${action === "kill" ? "Stopping" : "Restarting"} it takes ${others.length === 1 ? "that address" : "those addresses"} down too.`
      : `${detail.workerName} serves only ${service.url}.`;

    if (action === "kill") {
      // dispatch already confirms a stop; the override adds the impact this
      // panel knows about and the generic confirmation cannot.
      await onAction?.("kill", detail.workerId, {}, { detail: impact });
      return;
    }
    if (others.length && onConfirm) {
      onConfirm({
        title: `Restart ${detail.workerName}?`,
        detail: impact,
        confirmLabel: "Restart worker",
        run: () => onAction?.("restart", detail.workerId)
      });
      return;
    }
    await onAction?.("restart", detail.workerId);
  };

  // Read-only: it proves who holds the port. It never terminates a process it
  // did not start.
  const inspectPort = async service => {
    setBusyId(`${service.id}:port`);
    try {
      const result = await missionApi().request("services.inspectPort", { port: service.port });
      if (result.available === false) {
        toast.info(result.error || "Port inspection is not available on this platform.");
        return;
      }
      if (!result.owners?.length) {
        toast.info(`Nothing is listening on port ${service.port} right now.`);
        return;
      }
      const owned = result.owners.filter(entry => entry.ownedByWorker);
      const foreign = result.owners.filter(entry => !entry.ownedByWorker);
      if (foreign.length) {
        toast.warning(`Port ${service.port} is held by ${foreign.map(entry => `${entry.processName || "an unknown process"} (PID ${entry.pid})`).join(", ")} — not an OUTARCH worker.`);
      } else {
        toast.success(`Port ${service.port} is held by this project's ${owned[0]?.workerName || "worker"}.`);
      }
    } catch (error_) {
      toast.danger(error_.message || String(error_));
    } finally {
      setBusyId("");
    }
  };

  const act = async (method, service, { external = false } = {}) => {
    setBusyId(`${service.id}:${method}`);
    try {
      // The action carries the service id and the generation it was drawn for,
      // so a record that went stale since render is refused rather than opened.
      const result = await missionApi().request(method, {
        serviceId: service.id,
        expectedGeneration: service.generation,
        ...(external ? { external: true } : {})
      });
      if (method === "services.copy" && result?.url) {
        await copyText(result.url);
        toast.success(`Copied ${result.url}`);
      } else if (result?.opened) {
        // Which surface it opened in is the fact worth reporting: the two are
        // different places to have to go looking for the page.
        toast.success(result.target === "system"
          ? `Opened ${result.url} in your system browser`
          : `Opened ${result.url} in the OUTARCH browser`);
      }
    } catch (requestError) {
      toast.danger(requestError.message || String(requestError));
    } finally {
      setBusyId("");
    }
  };

  if (status === "loading") {
    return <p className="ops-empty" role="status">Looking for local services…</p>;
  }
  if (status === "error") {
    return <p className="ops-empty" role="status">Local service discovery is unavailable.<span>{error}</span></p>;
  }
  if (!services.length) {
    return (
      <p className="ops-empty">
        No local services detected yet.
        <span>Start a terminal that prints a local address, such as a dev server, and it appears here.</span>
      </p>
    );
  }

  return (
    <ul className="ops-services">
      {services.map(service => {
        const stale = service.state === "stale";
        const label = service.workerName || service.workerId;
        const busy = Boolean(busyId);
        return (
          <li key={service.id} className="ops-service" data-state={service.state}>
            <div className="ops-service-main">
              <div className="ops-service-title">
                <strong title={label}>{label}</strong>
                <code title={service.url}>{service.url}</code>
              </div>
              <p className="ops-service-state">
                <i aria-hidden="true"/>
                <span>
                  {serviceStateLabel(service)}
                  {service.updatedAt ? ` · ${relativeTime(service.updatedAt)}` : ""}
                </span>
              </p>
            </div>
            <div className="ops-service-actions">
              <button
                type="button"
                className="btn-ghost"
                disabled={busy}
                onClick={() => void act("services.copy", service)}
              >Copy<span className="sr-only"> the address for {label}</span></button>
              <button
                type="button"
                className="btn-secondary"
                disabled={stale || busy}
                onClick={() => void act("services.open", service)}
                title={stale ? `${label} is no longer reporting this address` : undefined}
              >Open<span className="sr-only"> {service.url} in the OUTARCH browser</span></button>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button type="button" className="btn-ghost ops-service-more" disabled={busy} aria-label={`More actions for ${label}`}>⋯</button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content className="radix-menu terminal-action-menu" sideOffset={6} align="end">
                    {/* Stopping or restarting acts on the worker, and a worker can
                        serve several addresses — the impact is confirmed first. */}
                    <DropdownMenu.Item className="terminal-action-item" onSelect={() => void owner(service, "restart")}>
                      <span>Restart {label}</span>
                      <small>Restart the worker that serves this address</small>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="terminal-action-item" onSelect={() => void owner(service, "stop")}>
                      <span>Stop {label}</span>
                      <small>Stop the worker — every address it serves goes with it</small>
                    </DropdownMenu.Item>
                    <DropdownMenu.Separator className="terminal-action-separator"/>
                    <DropdownMenu.Item className="terminal-action-item" onSelect={() => void act("services.open", service, { external: true })}>
                      <span>Open in system browser</span>
                      <small>Leave OUTARCH and hand this address to the operating system</small>
                    </DropdownMenu.Item>
                    <DropdownMenu.Item className="terminal-action-item" onSelect={() => void inspectPort(service)}>
                      <span>Inspect port {service.port}</span>
                      <small>Show which process is holding this port</small>
                    </DropdownMenu.Item>
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function UsagePanel({ usage, onRefresh }) {
  const { toast } = useToast();
  const [importing, setImporting] = React.useState(false);

  // Agent CLIs bill their own accounts and never pass through this app, so
  // their usage is read from the transcripts they leave on disk. It is an
  // explicit action: reading local files is not something to do on a timer.
  const importCli = async () => {
    setImporting(true);
    try {
      const summary = await missionApi().request("usage.import");
      onRefresh?.();
      if (!summary.recordsImported) {
        toast.info("No new CLI usage found since the last import.");
      } else {
        const partial = summary.partialRecords
          ? ` ${summary.partialRecords} had unreliable output counts and are marked partial.`
          : "";
        toast.success(`Imported ${summary.recordsImported} request${summary.recordsImported === 1 ? "" : "s"} from local CLI history.${partial}`);
      }
    } catch (importError) {
      toast.danger(importError.message || String(importError));
    } finally {
      setImporting(false);
    }
  };

  const importButton = (
    <button type="button" className="btn-secondary ops-usage-import" disabled={importing} onClick={() => void importCli()}>
      {importing ? "Reading…" : "Import CLI history"}
    </button>
  );

  if (!usage || !usage.callCount) {
    return (
      <p className="ops-empty">
        No terminal AI usage recorded in this project yet.
        <span>What this project’s terminals spend on AI models. Mission AI and your own keys answer questions in the app and are metered separately, so asking about the cost never changes it. Agent CLIs meter themselves — import their local history to include them.</span>
        <span className="ops-empty-action">{importButton}</span>
      </p>
    );
  }

  const models = Object.entries(usage.byModel || {});
  const unmeasured = usage.unknownTokenRequests || 0;
  const unpriced = usage.unpricedRequests || 0;

  return (
    <>
      <div className="ops-usage-head">
        <span>Workspace terminals · metered from provider-reported counts</span>
        {importButton}
      </div>
      <dl className="ops-usage">
        <div className="ops-usage-tile">
          <dt>Estimated cost</dt>
          <dd>{formatCost(usage.totalCost)}</dd>
          <small>From published API prices — your bill may differ.</small>
        </div>
        <div className="ops-usage-tile">
          <dt>Tokens</dt>
          <dd>{formatTokens(usage.totalTokens)}</dd>
          <small>{unmeasured ? `${unmeasured} request${unmeasured === 1 ? "" : "s"} reported no counts` : "Reported by the provider"}</small>
        </div>
        <div className="ops-usage-tile">
          <dt>Requests</dt>
          <dd>{usage.callCount}</dd>
          <small>{usage.failedRequests ? `${usage.failedRequests} failed or cancelled` : "All succeeded"}</small>
        </div>
      </dl>

      {models.length > 0 && (
        <table className="ops-usage-models">
          <caption className="sr-only">Usage by model</caption>
          <thead>
            <tr><th scope="col">Model</th><th scope="col">Requests</th><th scope="col">Tokens</th><th scope="col">Cost</th></tr>
          </thead>
          <tbody>
            {models.map(([model, row]) => (
              <tr key={model}>
                <td>{model}</td>
                <td>{row.requests}</td>
                <td>{formatTokens(row.tokens)}</td>
                <td>{row.unpriced === row.requests ? "—" : formatCost(row.cost)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(unmeasured || unpriced) > 0 && (
        <p className="ops-note">
          This total is partial:{" "}
          {unmeasured ? `${unmeasured} request${unmeasured === 1 ? "" : "s"} returned no usage data` : ""}
          {unmeasured && unpriced ? ", and " : ""}
          {unpriced ? `${unpriced} could not be priced` : ""}. Unmeasured requests are not counted as zero.
        </p>
      )}
    </>
  );
}

/**
 * The workspace status rail. Closed by default so the terminal keeps the height;
 * each segment is a disclosure button that opens the drawer onto its own panel.
 */
function WorkspaceOps({ ops, openTab, onOpenTab, onAction, onConfirm }) {
  const panelId = React.useId();
  const railRef = React.useRef(null);
  const toggle = tab => onOpenTab(openTab === tab ? null : tab);

  const readyServices = ops.services.filter(service => service.state !== "stale").length;
  // A cost of zero and a cost never measured are different facts, and the rail
  // is where that distinction is most likely to be misread at a glance. With
  // nothing measured there is also nothing to qualify, so "est." drops away.
  const metered = Boolean(ops.usage?.callCount);
  const costLabel = metered ? formatCost(ops.usage.totalCost, { precision: 2 }) : "—";

  // Escape closes the drawer and returns focus to the segment that opened it,
  // the same way the dialogs in this app behave.
  const onKeyDown = event => {
    if (event.key !== "Escape" || !openTab) return;
    event.stopPropagation();
    onOpenTab(null);
    railRef.current?.querySelector(`[data-ops-tab="${openTab}"]`)?.focus();
  };

  return (
    <section
      className={`workspace-ops ${openTab ? "is-open" : ""}`}
      aria-label="Local services and AI usage"
      onKeyDown={onKeyDown}
    >
      <div className="workspace-ops-rail" ref={railRef}>
        <button
          type="button"
          className="workspace-ops-tab"
          data-ops-tab="services"
          aria-expanded={openTab === "services"}
          aria-controls={openTab === "services" ? panelId : undefined}
          onClick={() => toggle("services")}
        >
          <ChevronIcon open={openTab === "services"}/>
          Services <b>{readyServices}</b>
        </button>
        <button
          type="button"
          className="workspace-ops-tab"
          data-ops-tab="usage"
          aria-expanded={openTab === "usage"}
          aria-controls={openTab === "usage" ? panelId : undefined}
          onClick={() => toggle("usage")}
        >
          <ChevronIcon open={openTab === "usage"}/>
          Usage <b>{costLabel}</b>{metered ? " est." : ""}
        </button>
        <span className="workspace-ops-spacer"/>
        {/* The live region stays mounted so a pop-out opening or closing is
            announced, rather than the region itself appearing and vanishing. */}
        <span className="workspace-ops-status" aria-live="polite">
          {ops.detached.length > 0 ? `${ops.detached.length} of ${ops.maxDetached} terminals popped out` : ""}
        </span>
      </div>
      {openTab && (
        <div
          className="workspace-ops-panel"
          id={panelId}
          role="region"
          aria-label={openTab === "services" ? "Local services" : "Token and cost usage"}
        >
          {openTab === "services"
            ? <ServicesPanel services={ops.services} status={ops.status} error={ops.error} onAction={onAction} onConfirm={onConfirm}/>
            : <UsagePanel usage={ops.usage} onRefresh={ops.refresh}/>}
        </div>
      )}
    </section>
  );
}

function TerminalSlot({ session, sessions, detachedInfo, active, expanded, minimized, shortcut, tileOrder, tileSpan = 1, tilePlacement = null, canEmpty = true, terminalPreferences, onFocus, onExpand, onAction, onSelect, onAddWorker, onReconfigure, onDuplicate, onTerminalError, onTerminalRecovered, onAskAI, onRecall, onFocusWindow }) {
  // A mosaic tile is placed by `order`, so the canvas can be rearranged without
  // moving anything in the DOM. Outside the mosaic this is undefined and the
  // slot layouts place panes exactly as before.
  // A short last row divides the canvas between the tiles it does have, so a
  // worker count that is not a multiple of the column count never leaves a
  // hole the size of a terminal in the corner of focus mode.
  // A canvas sized per terminal places every tile between its own two grid
  // lines, which is what lets one terminal be wider than the one below it.
  const tileStyle = Number.isInteger(tileOrder) || tileSpan > 1 || tilePlacement
    ? {
        ...(Number.isInteger(tileOrder) ? { order: tileOrder } : null),
        ...(tilePlacement ? { gridColumn: tilePlacement.column, gridRow: tilePlacement.gridRow } : tileSpan > 1 ? { gridColumn: `span ${tileSpan}` } : null)
      }
    : undefined;
  if (!session) return <EmptyTerminalSlot sessions={sessions} style={tileStyle} onSelect={onSelect} onDropSession={onSelect} onAddWorker={onAddWorker}/>;
  if (detachedInfo) {
    return <DetachedTerminalSlot session={session} slotInfo={detachedInfo} style={tileStyle} onRecall={onRecall} onFocusWindow={onFocusWindow} />;
  }
  return <TerminalPane session={session} style={tileStyle} canEmpty={canEmpty} sessions={sessions} profile={workerProfile(session)} active={active} expanded={expanded} minimized={minimized} shortcut={shortcut} terminalFontSize={terminalPreferences.terminalFontSize} terminalTheme={terminalPreferences.terminalTheme} terminalCursor={terminalPreferences.terminalCursor} terminalScrollback={terminalPreferences.terminalScrollback} onFocus={onFocus} onToggleExpanded={onExpand} onAction={onAction} onSelectSession={onSelect} onDropSession={onSelect} onReconfigure={onReconfigure} onDuplicate={onDuplicate} onTerminalError={onTerminalError} onTerminalRecovered={onTerminalRecovered} onAskAI={onAskAI}/>;
}

function layoutForCount(count) {
  const id = count <= 1 ? "single" : count === 2 ? "horizontal" : count <= 4 ? "grid-2x2" : "grid-3x2";
  return TERMINAL_LAYOUTS.find(layout => layout.id === id) || TERMINAL_LAYOUTS[0];
}

function layoutFor(id) {
  return TERMINAL_LAYOUTS.find(layout => layout.id === id) || TERMINAL_LAYOUTS[0];
}

// Each automatic folder shows its role's own glyph, tinted per role in the
// stylesheet, so the row reads at a glance without a box around every entry.
const FOLDER_ICONS = { agent: "agents", terminal: "terminal", service: "server", container: "box", database: "database", test: "flask", git: "branch", build: "layers" };

function WorkerFolders({ workspaceKey, sessions, activeId, onSelect, vscodeStatus }) {
  const storageKey = `mission-control.worker-folders.v1:${workspaceKey || "default"}`;
  const [custom, setCustom] = React.useState([]);
  const [adding, setAdding] = React.useState(false);
  const [name, setName] = React.useState("");
  const [members, setMembers] = React.useState([]);
  React.useEffect(() => { try { const value = JSON.parse(localStorage.getItem(storageKey) || "[]"); setCustom(Array.isArray(value) ? value.filter(group => group?.id && group?.name && Array.isArray(group.workerIds)).slice(0, 12) : []); } catch { setCustom([]); } }, [storageKey]);
  const persist = next => { setCustom(next); try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Folder organization remains available for this session. */ } };
  const automatic = Object.entries(sessions.reduce((groups, session) => { const role = workerProfile(session).key; (groups[role] ||= []).push(session.id); return groups; }, {})).map(([role, workerIds]) => ({ id: `auto:${role}`, role, name: role === "agent" ? "AI agents" : role === "terminal" ? "Shell terminals" : `${role[0].toUpperCase()}${role.slice(1)} terminals`, workerIds, automatic: true }));
  const save = event => { event.preventDefault(); const label = name.trim(); if (!label || !members.length) return; const group = { id: globalThis.crypto?.randomUUID?.() || `folder-${Date.now()}`, name: label.slice(0, 40), workerIds: members }; persist([...custom, group].slice(0, 12)); setName(""); setMembers([]); setAdding(false); onSelect(group); };
  const removeGroup = group => { persist(custom.filter(item => item.id !== group.id)); if (activeId === group.id) onSelect(null); };

  const vscodeTerminals = vscodeStatus?.terminals || [];
  const vscodeFolder = vscodeStatus?.connected ? {
    id: "vscode:bridge",
    name: "VS Code Bridge",
    workerIds: [],
    automatic: true,
    isVSCode: true,
    terminals: vscodeTerminals,
    status: vscodeStatus
  } : null;

  return <nav className="worker-folders" aria-label="Worker folders">
    <EdgeScroll className="worker-folders__rail"><div className="worker-folder-list" data-edge-scroller>
      <button className={!activeId ? "is-current" : ""} onClick={() => onSelect(null)}><Icon name="grid" size={12}/><span>All terminals</span><b>{sessions.length}</b></button>
      {vscodeFolder && <div className={`worker-folder-item ${activeId === vscodeFolder.id ? "is-current" : ""}`} key={vscodeFolder.id}>
        <button className="worker-folder-select is-vscode-folder" onClick={() => onSelect(vscodeFolder)} title="Active VS Code terminals">
          <span className="vscode-folder-mark">⌁</span><span>VS Code Bridge</span><b>{vscodeTerminals.length}</b>
        </button>
      </div>}
      {[...automatic, ...custom].map(group => <div className={`worker-folder-item ${activeId === group.id ? "is-current" : ""}`} data-role={group.automatic ? group.role : "custom"} key={group.id}>
        <button className="worker-folder-select" onClick={() => onSelect(group)} title={group.workerIds.map(id => sessions.find(session => session.id === id)?.name).filter(Boolean).join(", ")}><Icon name={group.automatic ? FOLDER_ICONS[group.role] || "terminal" : "projects"} size={12}/><span>{group.name}</span><b>{group.workerIds.filter(id => sessions.some(session => session.id === id)).length}</b></button>
        {!group.automatic && <button type="button" className="worker-folder-delete" onClick={() => removeGroup(group)} aria-label={`Delete ${group.name}`}>×</button>}
      </div>)}
      <button className="worker-folder-add" onClick={() => { setAdding(value => !value); setMembers([]); }}><Icon name="plus" size={12}/><span>New folder</span></button>
    </div></EdgeScroll>
    {adding && <form className="worker-folder-builder" onSubmit={save}><header><div><span className="section-kicker">CUSTOM TERMINAL FOLDER</span><strong>Group the terminals you use together</strong></div><button type="button" aria-label="Close folder builder" onClick={() => setAdding(false)}>×</button></header><input autoFocus maxLength="40" value={name} onChange={event => setName(event.target.value)} placeholder="Frontend stack"/><div>{sessions.map(session => <label key={session.id}><input type="checkbox" checked={members.includes(session.id)} onChange={() => setMembers(current => current.includes(session.id) ? current.filter(id => id !== session.id) : [...current, session.id])}/><span><strong>{session.name}</strong><small>{workerKind(session)}</small></span></label>)}</div><footer><span>{members.length} selected</span><button disabled={!name.trim() || !members.length}>Create folder</button></footer></form>}
  </nav>;
}

function resourceValue(value, suffix = "") {
  return Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })}${suffix}` : "—";
}

function WorkerResourceIntelligence({ session, sessions }) {
  const resources = session.resources;
  const health = session.health || { tone: session.status === "failed" ? "critical" : session.attentionRequired ? "attention" : session.isAlive ? "observing" : "idle", label: session.status, summary: "Waiting for engine analysis." };
  const impact = session.dependencyImpact || { recipeCount: 0, directDependentIds: [], downstreamCount: 0, level: "independent" };
  const names = impact.directDependentIds.map(id => sessions.find(item => item.id === id)?.name || id);
  const cpu = Number(resources?.cpuPercent);
  const cpuWidth = Number.isFinite(cpu) ? Math.min(100, Math.max(0, cpu)) : 0;
  const memory = Number(resources?.memoryMB);
  const memoryWidth = Number.isFinite(memory) ? Math.min(100, Math.max(2, memory / 20)) : 0;
  return <section className="worker-resource-intelligence" aria-label="Engine-owned Worker Intelligence">
    <header className={`worker-health tone-${health.tone}`}><span><i/></span><div><small>ENGINE HEALTH ANALYSIS</small><strong>{health.label}</strong><p>{health.summary}</p></div></header>
    <div className="worker-resource-readings">
      <div><span><small>CPU</small><strong>{resourceValue(resources?.cpuPercent, "%")}</strong></span><i><b style={{ width: `${cpuWidth}%` }}/></i></div>
      <div><span><small>MEMORY</small><strong>{resourceValue(resources?.memoryMB, " MB")}</strong></span><i><b style={{ width: `${memoryWidth}%` }}/></i></div>
    </div>
    <div className="worker-impact"><span><small>DEPENDENCY IMPACT</small><strong>{impact.level === "independent" ? "Independent worker" : `${impact.downstreamCount} downstream worker${impact.downstreamCount === 1 ? "" : "s"}`}</strong></span><p>{names.length ? `Directly unlocks ${names.join(", ")}.` : impact.recipeCount ? "No configured worker waits directly on this worker." : "Not linked to a Workspace Recipe."}</p></div>
    <footer><span>{resources?.available ? `Root process · PID ${resources.pid}` : session.isAlive ? "Process sample pending" : "No active process"}</span><span>{resources?.sampledAt ? `${timeAgo(resources.sampledAt)} ago` : "Engine lifecycle only"}</span></footer>
  </section>;
}

function cleanTerminalLine(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(/\x1b\][^\x07\x1b\r\n]*(?:\x07|\x1b\\|[\r\n]|$)/g, "")
    .replace(/\x1b[\(\)][AB012UK]/g, "")
    .replace(/\x1b\[[?><=0-9;]*[ -/]*[@-~]/g, "")
    .replace(/\[[?><=][0-9;]*[a-zA-Z]/g, "")
    .replace(/\([AB012UK]/g, "")
    .replace(/\](?:633|133|1337);[^\r\n]*/g, "")
    .replace(/\x1b[@-Z\\-_]|[\x80-\x9A\x9C-\x9F]/g, "")
    .trimEnd();
}

function VSCodeTerminalTile({ terminal, isManaged, onSendInput, onFocus, onClose, sendingId }) {
  const [inputVal, setInputVal] = React.useState("");
  const [history, setHistory] = React.useState([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const consoleBottomRef = React.useRef(null);
  const isRunning = terminal.commandState === "running";
  const isClosed = terminal.state === "closed";
  const logs = terminal.logs || [];

  React.useEffect(() => {
    if (consoleBottomRef.current) {
      consoleBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs.length]);

  const handleSend = () => {
    const trimmed = inputVal.trim();
    if (!trimmed || isClosed || sendingId === terminal.id) return;
    setHistory(prev => [...prev.filter(h => h !== trimmed), trimmed]);
    setHistoryIndex(-1);
    onSendInput(terminal.id, trimmed);
    setInputVal("");
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSend();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInputVal(history[nextIndex] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        setInputVal("");
      } else {
        setHistoryIndex(nextIndex);
        setInputVal(history[nextIndex] || "");
      }
    }
  };

  return (
    <article className={`vscode-terminal-tile ${isRunning ? "is-running" : ""} ${isManaged ? "is-managed" : "is-observed"}`}>
      <div className="vscode-tile-head">
        <div className="vscode-tile-identity">
          <span className="vscode-tile-badge">{isManaged ? "MANAGED" : "VS CODE"}</span>
          <strong>{terminal.name}</strong>
        </div>
        <div className="vscode-tile-head-actions">
          <span className={`vscode-tile-status is-${terminal.commandState || "idle"}`}>
            {terminal.active ? "ACTIVE · " : ""}{terminal.commandState || "idle"}
          </span>
        </div>
      </div>

      <div className="vscode-tile-meta">
        <span><strong>CWD:</strong> {terminal.cwd || "."}</span>
        <span><strong>Shell:</strong> {terminal.shellIntegration ? "Integrated Stream" : "Standard"}</span>
      </div>

      <div className="vscode-tile-console" role="log" aria-live="polite">
        {logs.length === 0 ? (
          <div className="vscode-console-empty">
            <span className="vscode-console-empty-prompt">$</span>
            <span>{"Ready for command input. Enter any command to execute in VS Code."}</span>
          </div>
        ) : (
          logs.map((log, idx) => {
            if (log.type === "input") {
              const cleaned = cleanTerminalLine(log.text);
              if (!cleaned) return null;
              return (
                <div key={idx} className="vscode-log-line is-input">
                  <span className="vscode-log-prompt">$</span>
                  <span className="vscode-log-cmd">{cleaned}</span>
                </div>
              );
            }
            if (log.type === "system") {
              return (
                <div key={idx} className="vscode-log-line is-system">
                  <span className={`vscode-log-system-pill ${log.exitCode === 0 ? "is-ok" : "is-fail"}`}>
                    {log.text}
                  </span>
                </div>
              );
            }
            const cleaned = cleanTerminalLine(log.text);
            if (!cleaned) return null;
            return (
              <div key={idx} className="vscode-log-line is-output">
                {cleaned}
              </div>
            );
          })
        )}
        <div ref={consoleBottomRef} style={{ height: 1 }} />
      </div>

      <div className="vscode-tile-input-deck">
        <input
          type="text"
          className="vscode-tile-input"
          placeholder={isClosed ? "Terminal is closed" : `Run command in ${terminal.name}… (↑/↓ for history)`}
          aria-label={`Run command in ${terminal.name}`}
          value={inputVal}
          onChange={e => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isClosed || sendingId === terminal.id}
        />
        <button
          type="button"
          className="vscode-tile-send"
          aria-label={`Send command to ${terminal.name}`}
          onClick={handleSend}
          disabled={isClosed || sendingId === terminal.id || !inputVal.trim()}
        >
          {sendingId === terminal.id ? "Sending…" : "Send ↵"}
        </button>
      </div>

      <div className="vscode-tile-footer">
        <button type="button" className="vscode-tile-btn" onClick={() => onFocus(terminal.id)}>
          Focus in VS Code
        </button>
        <button type="button" className="vscode-tile-btn is-danger" onClick={() => onClose(terminal.id, terminal.name)}>
          Close
        </button>
      </div>
    </article>
  );
}

function VSCodeWorkspaceDeck({ status, onRefresh, onConfirm }) {
  const [sendingId, setSendingId] = React.useState("");
  const [newTermName, setNewTermName] = React.useState("OUTARCH");
  const [newTermCwd, setNewTermCwd] = React.useState(".");
  const [creating, setCreating] = React.useState(false);
  const [actionNotice, setActionNotice] = React.useState("");
  const noticeTimerRef = React.useRef(null);

  React.useEffect(() => () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
  }, []);

  const showNotice = (msg, durationMs = 4000) => {
    setActionNotice(msg);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    if (durationMs > 0) {
      noticeTimerRef.current = setTimeout(() => setActionNotice(""), durationMs);
    }
  };

  const terminals = status?.terminals || [];
  const connected = status?.connected === true;

  const handleSendInput = async (terminalId, input) => {
    if (!input) return;
    setSendingId(terminalId);
    setActionNotice("");
    try {
      await confirmedRequest("vscode.terminal.write", { terminalId, input });
      showNotice(`Command "${input}" sent to VS Code terminal.`);
      onRefresh?.();
    } catch (err) {
      showNotice(`Failed to send input: ${err.message || String(err)}`, 6000);
    } finally {
      setSendingId("");
    }
  };

  const handleFocus = async terminalId => {
    try {
      await missionApi().request("vscode.terminal.focus", { terminalId });
      showNotice("Focused terminal in VS Code.", 3000);
    } catch (err) {
      showNotice(err.message || String(err), 5000);
    }
  };

  const handleCreateTerminal = async e => {
    e.preventDefault();
    const name = newTermName.trim() || "OUTARCH";
    const cwd = newTermCwd.trim() || ".";
    setCreating(true);
    try {
      await confirmedRequest("vscode.terminal.create", { name, cwd });
      setNewTermName("OUTARCH");
      showNotice(`Created terminal "${name}" in VS Code.`);
      onRefresh?.();
    } catch (err) {
      showNotice(err.message || String(err), 5000);
    } finally {
      setCreating(false);
    }
  };

  const executeClose = async (terminalId, name) => {
    try {
      await confirmedRequest("vscode.terminal.close", { terminalId });
      showNotice(`Closed terminal "${name}".`, 3000);
      onRefresh?.();
    } catch (err) {
      showNotice(err.message || String(err), 5000);
    }
  };

  const handleClose = (terminalId, name) => {
    if (onConfirm) {
      onConfirm({
        title: `Close terminal "${name}" in VS Code?`,
        detail: "The terminal session and its running processes in VS Code will be terminated.",
        confirmLabel: "Close terminal",
        run: () => executeClose(terminalId, name)
      });
    } else {
      void executeClose(terminalId, name);
    }
  };

  return <div className="vscode-workspace-deck">
    <div className="vscode-workspace-deck__header">
      <div className="vscode-deck-title">
        <span className="vscode-deck-mark">⌁</span>
        <div>
          <strong>VS Code Connected Terminals ({terminals.length})</strong>
          <small>{connected ? `Synchronized with VS Code · ${status?.endpoint || "127.0.0.1"}` : "VS Code Bridge is disconnected"}</small>
        </div>
      </div>
      <form className="vscode-deck-create" onSubmit={handleCreateTerminal}>
        <input
          placeholder="New terminal name…"
          aria-label="New terminal name"
          value={newTermName}
          maxLength={60}
          onChange={e => setNewTermName(e.target.value)}
        />
        <input
          placeholder="cwd (e.g. .)"
          aria-label="Working directory"
          value={newTermCwd}
          maxLength={120}
          onChange={e => setNewTermCwd(e.target.value)}
        />
        <button type="submit" disabled={creating || !newTermName.trim()}>
          {creating ? "Creating…" : "+ Create Terminal"}
        </button>
      </form>
    </div>

    {actionNotice && <div className="vscode-deck-notice" role="status">{actionNotice}</div>}

    <div className="vscode-workspace-grid">
      {terminals.length === 0 ? <div className="vscode-empty-grid">
        <span className="vscode-deck-mark">⌁</span>
        <strong>No active terminals reported by VS Code</strong>
        <p>Open a terminal in your VS Code editor or create a new managed terminal above.</p>
      </div> : terminals.map(terminal => {
        const isManaged = terminal.ownership === "mission-control-managed";
        return (
          <VSCodeTerminalTile
            key={terminal.id}
            terminal={terminal}
            isManaged={isManaged}
            onSendInput={handleSendInput}
            onFocus={handleFocus}
            onClose={handleClose}
            sendingId={sendingId}
          />
        );
      })}
    </div>
  </div>;
}

/* Tile order for the mosaic. The slot layouts persist which worker sits in
   which pane; the mosaic has no slots, so dragging a tile has to reorder the
   mosaic itself. Like every other layout preference this is device-local — how
   you like the canvas arranged is not a fact about the project — and a stored
   order is untrusted input, re-reconciled against the live session list on
   every read so a worker that no longer exists cannot hold a gap open. */
const MOSAIC_ORDER_PREFIX = "mission-control:mosaic-order:v1:";

/* Terminal sizes for the canvas, in every mode. Each terminal owns its width
   within its row and each row owns its height (see canvasTiles.js). They are
   kept per shape — five tiles over three is a different arrangement from four
   over four, and the slot layouts are kept apart from the packed canvas — so a
   canvas that reflows to another shape starts from even sizes instead of ones
   meant for another grid. Stored values are untrusted and re-fitted to their
   shape on read. */
const CANVAS_TILES_PREFIX = "mission-control:canvas-tiles:v1:";
const TILE_EDGE_NAMES = Object.freeze({ n: "top", s: "bottom", e: "right", w: "left" });

function readCanvasTiles(key) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const shapes = {};
    for (const [shape, entry] of Object.entries(parsed)) {
      const match = /^(slots|packed):(\d+(?:,\d+)*)$/.exec(shape);
      if (!match || !entry || typeof entry !== "object") continue;
      const rows = match[2].split(",").map(Number);
      if (rows.length > 12 || rows.some(count => count < 1 || count > 12)) continue;
      shapes[shape] = normalizeTileSizes(entry, rows);
    }
    return shapes;
  } catch {
    return {};
  }
}

function useCanvasTiles(workspaceKey) {
  const key = `${CANVAS_TILES_PREFIX}${workspaceKey || "default"}`;
  const [shapes, setShapes] = React.useState(() => readCanvasTiles(key));
  React.useEffect(() => { setShapes(readCanvasTiles(key)); }, [key]);
  const write = React.useCallback(next => {
    try { window.localStorage.setItem(key, JSON.stringify(next)); }
    catch { /* Terminal sizes are a convenience and must never block terminal control. */ }
  }, [key]);
  // `set` follows a drag frame by frame; `save` is the value to keep.
  const set = React.useCallback((shape, sizes) => {
    if (!shape || !sizes) return;
    setShapes(current => (current[shape] === sizes ? current : { ...current, [shape]: sizes }));
  }, []);
  const save = React.useCallback((shape, sizes) => {
    if (!shape || !sizes) return;
    setShapes(current => {
      const next = { ...current, [shape]: sizes };
      write(next);
      return next;
    });
  }, [write]);
  return { shapes, set, save };
}

// Keeps the old span rule for a canvas that is not sized per terminal yet (the
// first frame, before the grid has been measured).
function placedTileStyle(order, span, placement) {
  if (order === null && !(span > 1) && !placement) return undefined;
  return {
    ...(order !== null ? { order } : null),
    ...(placement ? { gridColumn: placement.column, gridRow: placement.gridRow } : span > 1 ? { gridColumn: `span ${span}` } : null)
  };
}

function readTrackGeometry(node) {
  const style = window.getComputedStyle(node);
  const sizes = value => (value && value !== "none" ? value.trim().split(/\s+/).map(parseFloat).filter(Number.isFinite) : []);
  const padLeft = parseFloat(style.paddingLeft) || 0;
  const padTop = parseFloat(style.paddingTop) || 0;
  return {
    cols: sizes(style.gridTemplateColumns),
    rows: sizes(style.gridTemplateRows),
    colGap: parseFloat(style.columnGap) || 0,
    rowGap: parseFloat(style.rowGap) || 0,
    padLeft,
    padTop,
    width: Math.max(0, node.clientWidth - padLeft - (parseFloat(style.paddingRight) || 0)),
    height: Math.max(0, node.clientHeight - padTop - (parseFloat(style.paddingBottom) || 0)),
    minHeight: parseFloat(style.getPropertyValue("--pane-min-h")) || 0,
    // The narrow layouts stack every pane full width, and say so through this
    // property; there is nothing beside a terminal to give way when stacked.
    stacked: style.getPropertyValue("--mc-canvas-stacked").trim() === "1",
    overflows: node.scrollHeight > node.clientHeight + 1
  };
}

function useMosaicOrder(workspaceKey, sessions) {
  const key = workspaceKey ? `${MOSAIC_ORDER_PREFIX}${workspaceKey}` : null;
  const [order, setOrder] = React.useState([]);

  React.useEffect(() => {
    let stored = [];
    if (key) {
      try {
        const parsed = JSON.parse(window.localStorage.getItem(key));
        if (Array.isArray(parsed)) stored = parsed.filter(id => typeof id === "string");
      } catch { stored = []; }
    }
    setOrder(stored);
  }, [key]);

  const persist = React.useCallback(next => {
    setOrder(next);
    if (!key) return;
    try { window.localStorage.setItem(key, JSON.stringify(next)); }
    catch { /* Tile order is a convenience and must never block terminal control. */ }
  }, [key]);

  // Arranged ids first, in the order they were put there; anything the engine
  // has reported since keeps its natural place at the end.
  const arrangedIds = React.useMemo(() => {
    const live = new Set(sessions.map(session => session.id));
    const seen = new Set();
    const ids = [];
    for (const id of order) if (live.has(id) && !seen.has(id)) { seen.add(id); ids.push(id); }
    for (const session of sessions) if (!seen.has(session.id)) ids.push(session.id);
    return ids;
  }, [order, sessions]);

  // Where each worker's tile sits. The canvas keeps its DOM in session order
  // and lays the tiles out with `order`, so rearranging never unmounts a
  // terminal: an xterm that is torn down and rebuilt loses its scrollback, and
  // moving a pane is not a reason to lose what it printed.
  const positions = React.useMemo(() => new Map(arrangedIds.map((id, index) => [id, index])), [arrangedIds]);

  // Dropping one tile on another puts it in that position and slides the rest
  // along — the same result as dragging a card within a list, and undone by
  // dragging it back.
  const move = React.useCallback((draggedId, targetId) => {
    if (!draggedId || !targetId || draggedId === targetId) return;
    const ids = [...arrangedIds];
    const from = ids.indexOf(draggedId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    persist(ids);
  }, [arrangedIds, persist]);

  return { positions, move };
}

function WorkspaceView({ needsCount = 0, onReviewNeeds, sessions, workspaceKey, terminalLayout, focusedId, expandedId, inspectorOpen, terminalPreferences, onInspector, onFocus, onExpand, onAction, onStartWorkspace, onStopWorkspace, onRecipes, onMissionGraph, onAddWorker, onReconfigure, onTerminalError, onTerminalRecovered, onAskAI, onDuplicate, onConfirm }) {
  const gridRef = React.useRef(null);
  const [resizing, setResizing] = React.useState(false);
  const [vscodeStatus, setVscodeStatus] = React.useState(null);
  const refreshVSCode = React.useCallback(() => {
    missionApi().request("vscode.status").then(st => setVscodeStatus(st)).catch(() => {});
  }, []);

  React.useEffect(() => {
    let active = true;
    refreshVSCode();
    const unsub = missionApi().subscribe(notification => {
      if (notification?.type === "integration:event" && notification.integration === "vscode" && active) {
        setVscodeStatus(notification.status);
      }
    });
    return () => { active = false; unsub?.(); };
  }, [refreshVSCode]);

  // If the view unmounts mid-drag, the pointer listeners on `window` would leak
  // because their `stop` handler never fires. Hold the teardown and run it on unmount.
  const resizeTeardownRef = React.useRef(null);
  React.useEffect(() => () => { resizeTeardownRef.current?.(); }, []);
  const [activeFolder, setActiveFolder] = React.useState(null);
  // Focus mode collapses everything except the terminal canvas. It is pure
  // presentation: no worker lifecycle or engine state changes with it.
  const [focusMode, setFocusMode] = React.useState(false);
  const [query, setQuery] = React.useState("");
  // Focus mode has to reach past this route: the sidebar and the status bar are
  // rendered by the shell, not by the workspace. It is mirrored onto the
  // document element the same way the theme is, so one stylesheet can collapse
  // the whole frame. Presentation only - no worker or engine state moves.
  React.useEffect(() => {
    const root = document.documentElement;
    if (focusMode) root.dataset.workspaceFocus = "on";
    else delete root.dataset.workspaceFocus;
    return () => { delete root.dataset.workspaceFocus; };
  }, [focusMode]);
  // The native window controls stay on screen in focus mode, and with the
  // status tape gone they were painted over the top-right terminal. The shell
  // keeps a strip exactly as tall as the controls (see surfaces.css), and
  // asks for a shallower one while focus mode is on.
  React.useEffect(() => {
    if (!focusMode) return undefined;
    const chrome = mode => { try { window.missionControl?.setWindowChrome?.(mode)?.catch?.(() => {}); } catch { /* presentation only */ } };
    chrome("focus");
    return () => chrome("standard");
  }, [focusMode]);
  // Alt is the workspace modifier throughout this app (Alt 1-6 focus a pane,
  // Alt L cycles layouts), so focus mode joins it rather than claiming a bare
  // key a terminal would otherwise swallow. A dialog owns the keyboard while
  // it is open.
  React.useEffect(() => {
    const onKey = event => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (String(event.key).toLowerCase() !== "f") return;
      if (document.querySelector("[role='dialog'],[role='alertdialog']")) return;
      event.preventDefault();
      setFocusMode(value => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // The browser view is owned by the main process, so whether a tile is
  // mounted follows the view's own state rather than leading it. That is what
  // lets "open" from the Services panel, from a toast, or from Alt B all land
  // in the same place without any of them knowing about this component.
  const [browserOpen, setBrowserOpen] = React.useState(false);
  // The assistant pane is a tile on the canvas, remembered per project: an
  // operator who works with it open should find it open when they come back.
  const assistantKey = `mission-control:workspace-assistant:v1:${workspaceKey || "default"}`;
  const [assistantOpen, setAssistantOpenState] = React.useState(() => { try { return window.localStorage.getItem(assistantKey) === "open"; } catch { return false; } });
  const setAssistantOpen = React.useCallback(next => {
    setAssistantOpenState(current => {
      const value = typeof next === "function" ? next(current) : next;
      try { window.localStorage.setItem(assistantKey, value ? "open" : "closed"); } catch { /* a preference, not state */ }
      return value;
    });
  }, [assistantKey]);
  React.useEffect(() => {
    const onKey = event => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (String(event.key).toLowerCase() !== "c") return;
      if (document.querySelector("[role='dialog'],[role='alertdialog']")) return;
      event.preventDefault();
      setAssistantOpen(value => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setAssistantOpen]);
  React.useEffect(() => {
    let active = true;
    missionApi().request("workspace.browser.state")
      .then(value => { if (active && value?.open) setBrowserOpen(true); })
      .catch(() => {});
    const unsubscribe = missionApi().subscribe(notification => {
      if (notification?.type !== "workspace:browser" || !active) return;
      if (notification.state?.open) setBrowserOpen(true);
    });
    return () => { active = false; unsubscribe?.(); };
  }, []);
  React.useEffect(() => {
    const onKey = event => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (String(event.key).toLowerCase() !== "b") return;
      if (document.querySelector("[role='dialog'],[role='alertdialog']")) return;
      event.preventDefault();
      setBrowserOpen(value => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const [savingPaneSet, setSavingPaneSet] = React.useState(false);
  const [paneSetName, setPaneSetName] = React.useState("");
  const slots = terminalLayout.sessionIds.map(id => sessions.find(session => session.id === id) || null);
  const folderSessions = activeFolder ? (activeFolder.workerIds || []).map(id => sessions.find(session => session.id === id)).filter(Boolean) : slots;
  const effectiveLayout = activeFolder ? layoutForCount(folderSessions.length) : terminalLayout.layout;
  const folderWorkers = folderSessions.slice(0, effectiveLayout.slots);
  const filteredSlots = activeFolder ? [...folderWorkers, ...(folderWorkers.length < effectiveLayout.slots ? [null] : [])] : slots;
  const visible = filteredSlots;
  // T090 — a layout mounts at most six terminals, so on a real project most
  // workers are off-canvas. Their state is exactly what you would otherwise
  // mount a terminal to discover, so it is reported here instead. No xterm is
  // created: this is the engine's session summary and nothing more.
  const mountedIds = new Set(visible.filter(Boolean).map(item => item.id));
  const backgroundWorkers = sessions.filter(session => !mountedIds.has(session.id));
  // Focus mode is the "everything at once" view the slot layouts cannot give:
  // it mounts every supervised worker and lets the grid pack them, so no worker
  // is left off the canvas. Reserved for the plain canvas - an expanded pane and
  // a folder selection are both explicit narrowings the operator just asked for.
  const mosaicOrder = useMosaicOrder(workspaceKey, sessions);
  const mosaic = focusMode && !activeFolder && !expandedId && sessions.length > 0;
  const canvasWorkers = mosaic ? sessions : visible;
  // Mosaic shape. Tiles stay closest to a readable rectangle when the row count
  // follows the square root of the worker count against the canvas's own
  // proportion, so the column count is derived rather than fixed. It is handed
  // to the stylesheet as the tile's minimum width, which lets a narrow window
  // fall back to fewer, wider columns instead of a line of slivers.
  // The browser is a tile on the canvas, so the canvas packs itself whenever
  // one is open: a preview never costs a terminal its pane, and the two modes
  // share one arrangement rule instead of two.
  const packedCanvas = (mosaic || browserOpen || assistantOpen) && !activeFolder && !expandedId;
  const tileCount = canvasWorkers.length + (browserOpen ? 1 : 0) + (assistantOpen ? 1 : 0);
  const mosaicColumns = packedCanvas
    ? Math.max(1, Math.ceil(tileCount / Math.max(1, Math.ceil(Math.sqrt(tileCount / 2.4)))))
    : 0;
  // `auto-fit` decides the real column count from what the window can hold at
  // a readable tile width, which is not always the balanced count derived
  // above — that fallback is deliberate. Reading the tracks back is the only
  // way to know which one is in force, and the last row can only be made to
  // fill the canvas against the number it actually has to fill.
  const [mosaicTracks, setMosaicTracks] = React.useState(0);
  const [trackGeometry, setTrackGeometry] = React.useState(null);
  const trackProbeRef = React.useRef(null);
  const canvasTiles = useCanvasTiles(workspaceKey);
  // Per-terminal sizing applies to whatever the canvas is showing: the slot
  // layout, a folder, or the packed canvas. The packed canvas has as many
  // columns as auto-fit gave it, so it waits for that to be measured.
  const canvasTileCount = packedCanvas ? tileCount : canvasWorkers.length;
  const tileColumns = packedCanvas ? mosaicTracks : effectiveLayout.cols;
  const tileRowCounts = React.useMemo(() => (tileColumns > 0 ? tileRows(canvasTileCount, tileColumns) : []), [canvasTileCount, tileColumns]);
  const tileShape = tileShapeKey(packedCanvas ? "packed" : "slots", tileRowCounts);
  const tileSource = (tileShape && canvasTiles.shapes[tileShape]) || (!packedCanvas && !activeFolder ? seedFromRatios(terminalLayout.layout.id, terminalLayout.ratios) : null);
  const tileSourceKey = tileSource ? JSON.stringify(tileSource) : "";
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const tileSizes = React.useMemo(() => normalizeTileSizes(tileSource, tileRowCounts), [tileSourceKey, tileRowCounts]);
  const tilesActive = tileRowCounts.length > 0 && canvasTileCount > 1 && !expandedId && Boolean(trackGeometry) && !trackGeometry.stacked;
  const tileLayout = React.useMemo(() => {
    if (!tilesActive) return null;
    const grid = tileGrid(tileSizes, trackGeometry.width, trackGeometry.colGap);
    return grid.valid ? { grid, templates: tileTemplates(tileSizes, grid, packedCanvas ? "var(--pane-min-h)" : "0px") } : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tilesActive, tileSizes, trackGeometry?.width, trackGeometry?.colGap, packedCanvas]);
  const tileTemplateKey = tileLayout ? `${tileLayout.templates.columns}|${tileLayout.templates.rows}` : "";
  const placementAt = position => (tileLayout && Number.isInteger(position) ? tileLayout.grid.placements[position] || null : null);
  React.useEffect(() => {
    const node = gridRef.current;
    if (!node || typeof ResizeObserver === "undefined") { setMosaicTracks(0); setTrackGeometry(null); return undefined; }
    let frame = null;
    const measure = () => {
      frame = null;
      if (packedCanvas) {
        // Sized tracks are explicit, so the grid itself would go on reporting
        // the count they were sized for. The probe keeps the auto-fit rule and
        // says how many columns the window can hold now.
        const probe = trackProbeRef.current;
        const probed = probe ? window.getComputedStyle(probe).gridTemplateColumns : "";
        const fitted = probed && probed !== "none" ? probed.trim().split(/\s+/).filter(token => parseFloat(token) > 0).length : 0;
        const template = window.getComputedStyle(node).gridTemplateColumns;
        setMosaicTracks(fitted || (template && template !== "none" ? template.trim().split(/\s+/).length : 0));
      } else {
        setMosaicTracks(0);
      }
      setTrackGeometry(readTrackGeometry(node));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(measure); };
    const observer = new ResizeObserver(schedule);
    observer.observe(node);
    schedule();
    return () => { if (frame) window.cancelAnimationFrame(frame); observer.disconnect(); };
  }, [packedCanvas, tileCount, tileTemplateKey, expandedId, activeFolder?.isVSCode]);
  // Canvas style: the balanced column share for the packed canvas, the slot
  // layout's ratios otherwise, and the per-terminal tracks once they apply.
  const canvasStyle = (() => {
    const style = packedCanvas ? { "--mosaic-cols": mosaicColumns } : activeFolder ? {} : { ...terminalLayout.style };
    if (tileLayout) {
      style["--mc-canvas-cols"] = tileLayout.templates.columns;
      style["--mc-canvas-rows"] = tileLayout.templates.rows;
    }
    return Object.keys(style).length ? style : undefined;
  })();
  // Seven terminals in four columns left one cell empty. The three tiles on
  // the short row divide the four columns between them instead: floor plus
  // one for the first remainder tiles, which always sums back to the full
  // width whatever the counts are.
  const mosaicSpan = React.useCallback(position => {
    if (!packedCanvas || mosaicTracks < 2 || !Number.isInteger(position)) return 1;
    const lastRowCount = tileCount % mosaicTracks;
    if (lastRowCount === 0) return 1;
    const firstInLastRow = tileCount - lastRowCount;
    if (position < firstInLastRow) return 1;
    const index = position - firstInLastRow;
    return Math.floor(mosaicTracks / lastRowCount) + (index < mosaicTracks % lastRowCount ? 1 : 0);
  }, [mosaicTracks, packedCanvas, tileCount]);
  const focused = sessions.find(item => item.id === focusedId);
  const profile = focused ? workerProfile(focused) : null;
  const roleCounts = sessions.reduce((counts, session) => {
    const role = workerProfile(session).key;
    counts[role] = (counts[role] || 0) + 1;
    return counts;
  }, {});
  // Resizing a terminal works like resizing an image: grab an edge or a corner
  // of the terminal and drag. The tiles beside that edge give way; the opposite
  // edge stays put. Handles belong to one tile at a time — the one under the
  // pointer, else the focused one — and only on edges with a neighbour to push.
  const [hoverTile, setHoverTile] = React.useState(null);
  const [tileResize, setTileResize] = React.useState(null);
  const tileRects = React.useMemo(() => {
    if (!tileLayout || !trackGeometry) return null;
    const { cols, rows, colGap, rowGap, padLeft, padTop } = trackGeometry;
    // Until the grid has been measured with these tracks, it cannot say where
    // a tile is, and a handle drawn from stale tracks would sit on the wrong edge.
    if (cols.length !== tileLayout.grid.tracks.length || rows.length !== tileRowCounts.length) return null;
    const xs = [padLeft];
    cols.forEach((size, index) => xs.push(xs[index] + size + colGap));
    const ys = [padTop];
    rows.forEach((size, index) => ys.push(ys[index] + size + rowGap));
    return tileLayout.grid.placements.map(place => ({ left: xs[place.start], top: ys[place.row], width: xs[place.end] - xs[place.start] - colGap, height: rows[place.row] }));
  }, [tileLayout, trackGeometry, tileRowCounts.length]);
  const tileMetrics = geometry => ({
    width: geometry.width,
    height: geometry.height,
    colGap: geometry.colGap,
    rowGap: geometry.rowGap,
    minWidth: TILE_MIN_WIDTH,
    minHeight: Math.max(TILE_MIN_HEIGHT, packedCanvas ? geometry.minHeight : 0)
  });
  const focusedTile = focusedId ? (mosaic ? mosaicOrder.positions.get(focusedId) : canvasWorkers.findIndex(item => item?.id === focusedId)) : undefined;
  const framePosition = tileResize?.position ?? hoverTile ?? (Number.isInteger(focusedTile) && focusedTile >= 0 ? focusedTile : null);
  const tileFrame = (() => {
    if (!tileRects || !Number.isInteger(framePosition) || !tileRects[framePosition]) return null;
    const address = tileAddress(tileRowCounts, framePosition);
    const grips = tileEdges(tileRowCounts, address, { vertical: !trackGeometry.overflows });
    if (!address || !grips.length) return null;
    const worker = framePosition < canvasWorkers.length
      ? (mosaic ? sessions.find(item => mosaicOrder.positions.get(item.id) === framePosition) : canvasWorkers[framePosition])
      : null;
    const label = worker?.name || (framePosition < canvasWorkers.length ? "this empty pane" : browserOpen && framePosition === canvasWorkers.length ? "the browser" : "the assistant");
    return {
      position: framePosition,
      address,
      grips,
      label,
      rect: tileRects[framePosition],
      width: Math.round(tileSizes.cells[address.row][address.cell] * 100),
      height: Math.round(tileSizes.rows[address.row] * 100)
    };
  })();
  const onCanvasPointerMove = event => {
    if (!tileRects || tileResize || event.target?.closest?.(".tile-resize-frame")) return;
    // A keyboard user resizing with the arrow keys keeps their handles.
    if (document.activeElement?.closest?.(".tile-resize-frame")) return;
    const node = gridRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    const x = event.clientX - box.left - node.clientLeft + node.scrollLeft;
    const y = event.clientY - box.top - node.clientTop + node.scrollTop;
    const index = tileRects.findIndex(rect => x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height);
    // Crossing the gap between two tiles keeps the handles where they were,
    // so reaching for an edge never hands them to the neighbour first.
    if (index >= 0) setHoverTile(index);
  };
  const beginTileResize = (event, frame, grip) => {
    const node = gridRef.current;
    if (!node || !tileShape || event.button > 0) return;
    event.preventDefault();
    event.stopPropagation();
    const metrics = tileMetrics(readTrackGeometry(node));
    const shape = tileShape;
    const rowCounts = tileRowCounts;
    const startSizes = tileSizes;
    const originX = event.clientX;
    const originY = event.clientY;
    const handleNode = event.currentTarget;
    const pointerId = event.pointerId;
    try { handleNode?.setPointerCapture?.(pointerId); } catch { /* the window listeners below still follow the drag */ }
    let latest = null;
    const move = pointerEvent => {
      latest = resizeTile(startSizes, rowCounts, frame.address, grip, pointerEvent.clientX - originX, pointerEvent.clientY - originY, metrics);
      canvasTiles.set(shape, latest);
    };
    const finish = keep => {
      setTileResize(null);
      setResizing(false);
      try { handleNode?.releasePointerCapture?.(pointerId); } catch { /* already released */ }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("keydown", cancel, true);
      resizeTeardownRef.current = null;
      if (keep && latest) canvasTiles.save(shape, latest);
    };
    const stop = () => finish(true);
    // Escape puts the terminal back where the drag started.
    const cancel = keyEvent => {
      if (keyEvent.key !== "Escape") return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      if (latest) canvasTiles.save(shape, startSizes);
      latest = null;
      finish(false);
    };
    resizeTeardownRef.current = stop;
    setResizing(true);
    setTileResize({ position: frame.position, grip });
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
    window.addEventListener("pointercancel", stop, { once: true });
    window.addEventListener("keydown", cancel, true);
  };
  const nudgeTile = (event, frame, grip) => {
    const step = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
    const node = gridRef.current;
    if (!step || !node || !tileShape) return;
    if (grip === "e" || grip === "w" ? !step[0] : !step[1]) return;
    event.preventDefault();
    canvasTiles.save(tileShape, resizeTile(tileSizes, tileRowCounts, frame.address, grip, step[0], step[1], tileMetrics(readTrackGeometry(node))));
  };
  const evenTile = (frame, grip) => {
    if (tileShape) canvasTiles.save(tileShape, evenTileSizes(tileSizes, tileRowCounts, frame.address, grip));
  };
  const liveCount = sessions.filter(item => item.isAlive).length;
  const attentionCount = sessions.filter(item => item.attentionRequired || item.status === "failed").length;
  const focusedSlot = Math.max(0, terminalLayout.sessionIds.indexOf(focusedId));
  const trimmedQuery = query.trim().toLowerCase();
  const matches = trimmedQuery
    ? sessions.filter(item => `${item.name} ${item.command} ${(item.args || []).join(" ")}`.toLowerCase().includes(trimmedQuery)).slice(0, 8)
    : [];
  const showInPane = id => { terminalLayout.setSlotSession(focusedSlot, id); onFocus(id); setQuery(""); };

  const ops = useWorkspaceOps();
  const [opsTab, setOpsTab] = React.useState(null);
  const { toast: workspaceToast } = useToast();
  // The main process owns which terminals are detached, so the placeholder is
  // driven by that list rather than by local state the renderer maintains.
  const detachedWorkers = React.useMemo(
    () => new Map(ops.detached.map(entry => [entry.workerId, entry])),
    [ops.detached]
  );

  const handleRecallWorker = React.useCallback(async workerId => {
    try {
      await missionApi().request("terminal.window.recall", { workerId });
      ops.refresh();
    } catch (error) {
      workspaceToast.danger(error.message || String(error));
    }
  }, [ops, workspaceToast]);

  const handleFocusPopout = React.useCallback(async workerId => {
    try {
      const result = await missionApi().request("terminal.window.focus", { workerId });
      if (result?.focused === false) {
        workspaceToast.warning("That window could not be focused. Recall the terminal to bring it back here.");
      }
    } catch (error) {
      workspaceToast.danger(error.message || String(error));
    }
  }, [workspaceToast]);

  return <div className={`workspace-experience ${inspectorOpen && !focusMode ? "has-inspector" : ""} ${focusMode ? "is-focus-mode" : ""}`}>
    <h1 className="sr-only">Terminal Workspace</h1>
    <div className="workspace-stage">
      {/* One compact operational toolbar. Layout, creation, search, focus mode
          and recipes sit together so the canvas keeps the rest of the window. */}
      <div className="workspace-command-deck workspace-toolbar-v2">
        <div className="workspace-title">
          <span className="section-kicker">TERMINAL WORKSPACE</span>
          <div>
            <span className={`workspace-focus-state status-${focused?.status || "idle"}`}><i/></span>
            <strong>{focused?.name || "Multi-terminal canvas"}</strong>
            <small>{focused ? `${focused.command} · ${runtime(focused)}` : `${sessions.length} supervised workers`}</small>
          </div>
        </div>

        <div className="workspace-toolbar-group workspace-toolbar-layout" role="group" aria-label="Canvas layout">
          <span className="workspace-toolbar-label">CANVAS LAYOUT</span>
          <div className="layout-switcher">{TERMINAL_LAYOUTS.map(option => <button key={option.id} className={terminalLayout.layout.id === option.id ? "is-current" : ""} aria-pressed={terminalLayout.layout.id === option.id} onClick={() => terminalLayout.setLayoutId(option.id)} title={`${option.label} layout · ${option.slots} pane${option.slots === 1 ? "" : "s"}`}><b>{option.glyph}</b><small>{option.label}</small></button>)}</div>
        </div>

        <div className="workspace-toolbar-group workspace-toolbar-find">
          <label className="workspace-worker-search">
            <Icon name="search" size={13}/>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Find a worker…" aria-label="Search workers to show in the focused pane"/>
            {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear worker search">×</button>}
          </label>
          {trimmedQuery && <div className="workspace-search-results" role="listbox" aria-label="Matching workers">
            {matches.length ? matches.map(item => <button key={item.id} type="button" role="option" aria-selected={item.id === focusedId} onClick={() => showInPane(item.id)}>
              <i className={`status-dot status-${item.status}`}/>
              <span><strong>{item.name}</strong><small>{item.command}</small></span>
              <b>{item.isAlive ? "live" : item.status}</b>
            </button>) : <p>No worker matches “{query.trim()}”.</p>}
          </div>}
        </div>

        <div className="workspace-actions">
          <span className="workspace-status-readout" title="Engine-reported worker states">
            <b>{liveCount}</b> live · <b>{sessions.length - liveCount}</b> idle{attentionCount ? <> · <b className="is-attention">{attentionCount}</b> need you</> : null}
          </span>
          <button className="workspace-add-worker" onClick={onAddWorker} title="Add a terminal worker · Ctrl N"><Icon name="plus" size={12}/> <span className="workspace-action-label">Add terminal worker</span></button>
          <button className={`workspace-browser-toggle ${browserOpen ? "is-current" : ""}`} aria-pressed={browserOpen} aria-label="Browser" onClick={() => setBrowserOpen(value => !value)} title="OUTARCH browser · preview a local service beside the terminals · Alt B"><Icon name="globe" size={12}/> <span className="workspace-action-label">Browser</span></button>
          <button className={`workspace-assistant-toggle ${assistantOpen ? "is-current" : ""}`} aria-pressed={assistantOpen} aria-label="Assistant" onClick={() => setAssistantOpen(value => !value)} title="Assistant · ask about or act on your terminals, in a pane beside them · Alt C"><AiGlyph size={14}/> <span className="workspace-action-label">Assistant</span></button>
          <button className="workspace-recipes" onClick={onRecipes} title="Workspace recipes"><Icon name="grid" size={12}/> Recipes</button>
          {focusMode && <NotificationTray needsCount={needsCount} onReviewNeeds={onReviewNeeds}/>}
          {sessions.some(item => !item.isAlive) && <button className="workspace-launch" onClick={onStartWorkspace}><Icon name="play" size={12}/> Start idle</button>}
          {sessions.some(item => item.isAlive) && <button className="workspace-pause" onClick={onStopWorkspace}>Stop all</button>}
          <button className={`workspace-focus-mode ${focusMode ? "is-current" : ""}`} aria-pressed={focusMode} onClick={() => setFocusMode(value => !value)} title={focusMode ? "Leave focus mode · Alt F" : "Focus mode · every terminal, no chrome · Alt F"}><Icon name={focusMode ? "collapse" : "expand"} size={12}/> <span className="workspace-action-label">{focusMode ? "Exit focus" : "Focus"}</span></button>
        </div>
      </div>

      {!focusMode && backgroundWorkers.length > 0 && <section className="workspace-background" aria-label="Workers not shown on the canvas">
        <header>
          <span className="section-kicker">NOT ON THE CANVAS</span>
          {/* One line, so the count leads and the explanation is on the label
              rather than competing with the roster it introduces. */}
          <small title={`${backgroundWorkers.length} worker${backgroundWorkers.length === 1 ? "" : "s"} the engine is still supervising. No terminal is mounted for these.`}>
            {backgroundWorkers.length} not mounted
          </small>
        </header>
        <EdgeScroll className="workspace-background__roster"><ul data-edge-scroller>
          {backgroundWorkers.map(session => (
            <li key={session.id} className={`state-${session.status}${session.attentionRequired ? " needs-you" : ""}`}>
              <button type="button" onClick={() => showInPane(session.id)} title={`Show ${session.name} in the focused pane`}>
                <i className={`status-dot status-${session.status}`}/>
                <span>
                  <strong>{session.name}</strong>
                  <small>{session.attentionRequired ? session.attentionReason || "Needs a decision" : session.isAlive ? runtime(session) : session.status}</small>
                </span>
              </button>
            </li>
          ))}
        </ul></EdgeScroll>
      </section>}

      {!focusMode && <section className={`workspace-intelligence ${profile ? `role-${profile.key}` : "is-empty"}`} aria-label="Workspace operational context">
        <div className="workspace-intelligence__focus"><span>{profile?.label || "WORKSPACE MAP"}</span><strong>{profile?.metric || "Choose a terminal pane"}</strong><small>{profile?.detail || "Select a worker to see role-specific context."}</small></div>
        <div className="workspace-role-map" aria-label="Worker groups by operational role">{Object.entries(roleCounts).map(([role, count]) => <span className={`role-${role}`} key={role} title={sessions.filter(session => workerProfile(session).key === role).map(session => session.name).join(", ")}><i/>{role}<b>{count}</b></span>)}</div>
        <div className="workspace-intelligence__state"><small>ENGINE TRUTH</small><strong>{focused ? `${focused.status} · ${runtime(focused)}` : `${liveCount}/${sessions.length} live`}</strong></div>
      </section>}
      {!focusMode && <WorkerFolders workspaceKey={workspaceKey} sessions={sessions} activeId={activeFolder?.id || null} onSelect={group => { setActiveFolder(group); onExpand(null); if (group?.workerIds?.length) onFocus(group.workerIds[0]); else if (!group?.isVSCode) terminalLayout.setLayoutId(layoutForCount(sessions.length).id); }} vscodeStatus={vscodeStatus}/>}
      {/* T089 — naming an arrangement is a one-field prompt, inline, so it
          never becomes a dialog you have to dismiss to see what you are naming. */}
      {savingPaneSet && <form className="pane-set-save" onSubmit={event => {
        event.preventDefault();
        if (terminalLayout.savePaneSet(paneSetName)) { setPaneSetName(""); setSavingPaneSet(false); }
      }}>
        <label>
          <span>Name this arrangement</span>
          <input autoFocus value={paneSetName} maxLength={40} placeholder="Debugging the API" onChange={event => setPaneSetName(event.target.value)}/>
        </label>
        <div>
          <button type="button" onClick={() => { setSavingPaneSet(false); setPaneSetName(""); }}>Cancel</button>
          <button type="submit" className="primary" disabled={!paneSetName.trim()}>Save arrangement</button>
        </div>
        {terminalLayout.paneSets.length > 0 && <ul className="pane-set-save__existing">
          {terminalLayout.paneSets.map(set => (
            <li key={set.id}>
              <button type="button" onClick={() => { terminalLayout.applyPaneSet(set.id); setSavingPaneSet(false); }}>{set.name}</button>
              <button type="button" className="pane-set-save__delete" aria-label={`Delete ${set.name}`} onClick={() => terminalLayout.deletePaneSet(set.id)}>×</button>
            </li>
          ))}
        </ul>}
      </form>}

      {activeFolder?.isVSCode ? (
        <VSCodeWorkspaceDeck status={vscodeStatus || activeFolder.status} onRefresh={refreshVSCode} onConfirm={onConfirm}/>
      ) : (
        <div ref={gridRef} className={`terminal-grid ${effectiveLayout.className} ${activeFolder ? "has-adaptive-layout" : ""} ${expandedId ? "has-expanded" : ""} ${resizing ? "is-tile-resizing" : ""} ${opsTab ? "has-ops-open" : ""} ${packedCanvas ? "is-mosaic" : ""} ${browserOpen ? "has-browser" : ""} ${assistantOpen ? "has-assistant" : ""}`} style={canvasStyle} data-resize-grip={tileResize?.grip || undefined} onPointerMove={onCanvasPointerMove} onPointerLeave={() => { if (!tileResize) setHoverTile(null); }}>{packedCanvas && <i ref={trackProbeRef} className="canvas-track-probe" aria-hidden="true">{Array.from({ length: tileCount }, (_, index) => <b key={index}/>)}</i>}{tileFrame && <div className={`tile-resize-frame${tileResize ? " is-resizing" : ""}`} style={{ left: `${tileFrame.rect.left}px`, top: `${tileFrame.rect.top}px`, width: `${tileFrame.rect.width}px`, height: `${tileFrame.rect.height}px`, "--tile-gap-x": `${trackGeometry.colGap}px`, "--tile-gap-y": `${trackGeometry.rowGap}px` }}>{tileFrame.grips.map(grip => grip.length === 2 ? <span key={grip} aria-hidden="true" data-tile-grip={grip} className={`tile-resize-grip is-corner is-${grip}`} title="Drag to resize this terminal · Double-click to even out" onPointerDown={event => beginTileResize(event, tileFrame, grip)} onDoubleClick={() => evenTile(tileFrame, grip)}/> : <span key={grip} role="separator" tabIndex={0} data-tile-grip={grip} className={`tile-resize-grip is-edge is-${grip}`} aria-orientation={grip === "e" || grip === "w" ? "vertical" : "horizontal"} aria-valuenow={grip === "e" || grip === "w" ? tileFrame.width : tileFrame.height} aria-valuemin={0} aria-valuemax={100} aria-label={`Resize ${tileFrame.label} from its ${TILE_EDGE_NAMES[grip]} edge. It has ${grip === "e" || grip === "w" ? `${tileFrame.width} percent of its row` : `${tileFrame.height} percent of the canvas height`}.`} title="Drag to resize this terminal · Double-click to even out" onPointerDown={event => beginTileResize(event, tileFrame, grip)} onDoubleClick={() => evenTile(tileFrame, grip)} onKeyDown={event => nudgeTile(event, tileFrame, grip)}/>)}{tileResize && <b className="tile-resize-readout">{tileFrame.width}% × {tileFrame.height}%</b>}</div>}{canvasWorkers.map((session, index) => { const slotIndex = index; const detachedInfo = session ? detachedWorkers.get(session.id) : null; return <TerminalSlot key={`slot-${slotIndex}-${session?.id || "empty"}`} session={session} sessions={sessions} detachedInfo={detachedInfo} active={Boolean(session && focusedId === session.id)} expanded={Boolean(session && expandedId === session.id)} minimized={Boolean(expandedId) && Boolean(session) && session.id !== expandedId} tileOrder={mosaic && session ? (mosaicOrder.positions.get(session.id) ?? slotIndex) : undefined} tileSpan={mosaicSpan(mosaic && session ? (mosaicOrder.positions.get(session.id) ?? slotIndex) : slotIndex)} tilePlacement={placementAt(mosaic && session ? (mosaicOrder.positions.get(session.id) ?? slotIndex) : slotIndex)} canEmpty={!mosaic} shortcut={mosaic ? null : slotIndex < 6 ? slotIndex + 1 : null} terminalPreferences={terminalPreferences} onFocus={() => session && onFocus(session.id)} onExpand={() => session && onExpand(expandedId === session.id ? null : session.id)} onAction={onAction} onSelect={id => { if (mosaic) { if (!id) return; mosaicOrder.move(id, session?.id); onFocus(id); return; } terminalLayout.setSlotSession(slotIndex, id); }} onAddWorker={onAddWorker} onReconfigure={onReconfigure} onTerminalError={onTerminalError} onTerminalRecovered={onTerminalRecovered} onAskAI={onAskAI} onDuplicate={onDuplicate} onRecall={handleRecallWorker} onFocusWindow={handleFocusPopout} />; })}{browserOpen && <WorkspaceBrowser style={(() => { const span = mosaicSpan(canvasWorkers.length); const order = mosaic ? canvasWorkers.length : null; return placedTileStyle(order, span, placementAt(canvasWorkers.length)); })()} onClose={() => setBrowserOpen(false)}/>}{assistantOpen && !expandedId && <WorkspaceAssistant  workspaceKey={workspaceKey}  focusedSession={sessions.find(item => item.id === focusedId) || null}  style={(() => { const position = canvasWorkers.length + (browserOpen ? 1 : 0); const span = mosaicSpan(position); const order = mosaic ? position : null; return placedTileStyle(order, span, placementAt(position)); })()}  onClose={() => setAssistantOpen(false)}  onOpenMissionAI={() => onAskAI?.("")}  onConfirm={onConfirm}/>}</div>
      )}

      {!focusMode && <WorkspaceOps ops={ops} openTab={opsTab} onOpenTab={setOpsTab} onAction={onAction} onConfirm={onConfirm}/>}
    </div>
    {inspectorOpen && !focusMode && <aside className={`context-inspector ${profile ? `role-${profile.key}` : ""}`}>
      <div className="inspector-head"><div><span className="section-kicker">WORKER INTELLIGENCE</span><strong>{focused?.name || "No worker selected"}</strong></div><button onClick={onInspector} aria-label="Close inspector">×</button></div>
      {focused ? <>
        <div className="inspector-role"><small>{profile.label}</small><strong>{profile.metric}</strong><span>{profile.detail}</span></div>
        <div className="inspector-status"><span className={`status-orbit status-${focused.status}`}><i/></span><div><strong>{focused.status}</strong><small>{runtime(focused)} runtime · engine reported</small></div></div>
        <div className="inspector-structured"><span>ENGINE-OWNED FACTS</span>{Object.entries(focused.evidence || {}).length ? Object.entries(focused.evidence).map(([category, evidence]) => <article key={category}><b>{category}</b><strong>{evidenceSummary({ category, evidence })}</strong><small>{timeAgo(evidence.at)} ago · bounded record</small></article>) : <p>No structured integration record yet.</p>}</div>
        <WorkerResourceIntelligence session={focused} sessions={sessions}/>
        <details className="inspector-evidence"><summary>Recent bounded terminal evidence</summary>{(focused.recentLines || []).slice(-4).reverse().map((line, index) => <code key={`${line}-${index}`}>{line}</code>)}{!focused.recentLines?.length && <p>No bounded output evidence has been recorded yet.</p>}</details>
        <details className="inspector-definition"><summary>Worker definition and restore policy</summary><dl><div><dt>Worker type</dt><dd>{profile.kind}</dd></div><div><dt>Command</dt><dd>{focused.command} {(focused.args || []).join(" ")}</dd></div><div><dt>Working directory</dt><dd>{focused.cwd || "."}</dd></div><div><dt>Restore</dt><dd><label className="inspector-autostart-toggle" title="Start this worker when the project opens"><span className={`inspector-autostart-status ${focused.autoStart ? "is-enabled" : "is-disabled"}`}>{focused.autoStart ? "Auto-start" : "Manual"}</span><span className="pm-toggle" onClick={e => e.stopPropagation()}><input type="checkbox" checked={Boolean(focused.autoStart)} onChange={event => onAction("setAutoStart", focused.id, { enabled: event.target.checked })} aria-label={`Start ${focused.name} when the project opens`}/><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span></label></dd></div><div><dt>Last output</dt><dd>{timeAgo(focused.lastOutputAt)} ago</dd></div></dl></details>
        <TrustBoundary
          compact
          title="Observed facts, not inferred failures"
          summary="Lifecycle, process resources, and recovery stay under engine authority."
          facts={[
            { label: "Evidence", value: "Bounded terminal and lifecycle records" },
            { label: "Interpretation", value: "High usage remains an observation" },
            { label: "Action", value: "Worker controls dispatch through EngineAPI" }
          ]}
        />
        <div className="inspector-actions">{focused.attentionRequired && <button onClick={() => onAction("acknowledge", focused.id)}>Acknowledge alert</button>}<button onClick={() => onAction(focused.isAlive ? "restart" : "start", focused.id)}>{focused.isAlive ? "Restart worker" : "Start worker"}</button>{focused.isAlive && <button className="danger" onClick={() => onAction("kill", focused.id)}>Stop worker</button>}</div>
      </> : <EmptyState title="Select a worker" detail="Its live context, evidence and controls will appear here."/>}
    </aside>}
  </div>;
}

const AGENT_DECISION_SOURCES = new Set(["missionSupervisor", "mission", "mcp"]);
const ACTIVE_DECISION_STATUSES = new Set(["pending", "acting", "verifying", "acknowledged"]);

function NeedsView({ decisionRecords = [], decisionsStatus = "loading", decisionSources = [], decisionsComplete = true, onDecisionsRefresh, onResolveDecision, onAcknowledgeDecision, onAction, onFocus, onOpenTerminal, onDismissTerminalAlert, onConfirm, onOpenSource }) {
  const [filter, setFilter] = React.useState("all");
  const [showSnoozed, setShowSnoozed] = React.useState(false);
  const [busyId, setBusyId] = React.useState("");
  const [queueState, setQueueState] = React.useState(() => { try { const value = JSON.parse(localStorage.getItem(DECISION_STATE_KEY) || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; } });
  const persistQueue = update => setQueueState(current => { const next = typeof update === "function" ? update(current) : update; try { localStorage.setItem(DECISION_STATE_KEY, JSON.stringify(next)); } catch { /* Queue presentation state is local best effort. */ } return next; });
  const markSeen = id => persistQueue(current => ({ ...current, [id]: { ...current[id], seen: true } }));
  const snooze = id => persistQueue(current => ({ ...current, [id]: { ...current[id], seen: true, snoozedUntil: Date.now() + 15 * 60 * 1000 } }));
  // Ask "is it snoozed" (not "is it not snoozed"): a record that was never
  // snoozed has no timestamp and `NaN > now` is false, so it stays visible.
  const isSnoozed = record => Number(queueState[record.id]?.snoozedUntil) > Date.now();
  const isAgentDecision = record => record.target?.kind === "agent" || AGENT_DECISION_SOURCES.has(record.source);

  const activeRecords = decisionRecords.filter(record => ACTIVE_DECISION_STATUSES.has(record.status));
  // T068 — what was decided recently, and how. Bounded, newest first, and read
  // only: a resolved row keeps its evidence and gains its outcome, but never
  // offers the actions that would resolve it a second time.
  const resolvedRecords = decisionRecords
    .filter(record => !ACTIVE_DECISION_STATUSES.has(record.status))
    .sort((a, b) => (b.resolution?.at || b.createdAt || 0) - (a.resolution?.at || a.createdAt || 0))
    .slice(0, 25);
  const snoozedRecords = activeRecords.filter(isSnoozed);
  const available = activeRecords.filter(record => showSnoozed || !isSnoozed(record));
  const visible = filter === "resolved"
    ? resolvedRecords
    : available.filter(record => filter === "critical" ? record.severity === "critical" : filter === "agents" ? isAgentDecision(record) : true);
  const showingResolved = filter === "resolved";
  const totalWaiting = available.length;
  const critical = available.filter(record => record.severity === "critical").length;
  const agentWaiting = available.filter(isAgentDecision).length;

  const handleDecisionAction = async (record, actionId) => {
    if (record.source === "terminal") {
      if (actionId === "dismiss") onDismissTerminalAlert(record.target?.id);
      // The alert is that the terminal stream died, so "Open terminal" has to
      // reach the terminal itself, not the worker evidence dialog beside it.
      else onOpenTerminal?.(record.target?.id);
      return;
    }
    if (record.source === "session") {
      if (actionId === "inspect") { markSeen(record.id); onFocus(record.target?.id); return; }
      setBusyId(record.id);
      try {
        await onAction(actionId === "acknowledge" ? "acknowledge" : "restart", record.target?.id);
        markSeen(record.id);
        onDecisionsRefresh?.();
      } finally { setBusyId(""); }
      return;
    }
    // missionSupervisor / mission / mcp / automation / mobile — approve | deny
    const apply = async () => {
      setBusyId(record.id);
      try {
        await onResolveDecision(record, actionId);
        markSeen(record.id);
      } catch (error) {
        onDecisionsRefresh?.();
      } finally { setBusyId(""); }
    };
    const action = record.actions?.find(item => item.id === actionId);
    if (action?.confirm) {
      if (!onConfirm) return;
      onConfirm({
        title: `${action.label || "Approve"} this request?`,
        detail: record.impact || "The requested operation will be sent to its owning service.",
        recovery: record.recovery || "Review History and the target worker after execution.",
        confirmLabel: action.label || "Approve request",
        run: apply
      });
      return;
    }
    await apply();
  };

  const markAllSeen = () => {
    persistQueue(current => {
      const next = { ...current };
      for (const record of activeRecords) next[record.id] = { ...next[record.id], seen: true };
      return next;
    });
    for (const record of activeRecords) onAcknowledgeDecision?.(record);
  };

  return <div className="needs-view needs-decision-room">
    <h1 className="sr-only">Needs You</h1>
    <header className="needs-hero"><div><span className="section-kicker">NEEDS YOU</span><h2>{totalWaiting ? `${decisionsComplete ? "" : "At least "}${totalWaiting} decision${totalWaiting === 1 ? "" : "s"} waiting` : decisionsComplete ? "Your workspace is clear" : "No decisions from the sources that responded"}</h2><p>{totalWaiting ? "Evidence and consequence come before every action." : decisionsComplete ? "OUTARCH will interrupt only when your judgment is required." : "One or more decision sources did not report. The queue below may be incomplete."}</p></div></header>
    <DecisionSourceStrip status={decisionsStatus} sources={decisionSources} onRetry={onDecisionsRefresh}/>
    <div className="decision-room-heading"><div><span className="section-kicker">PRIORITIZED QUEUE</span><strong>{totalWaiting ? "Review impact before acting" : decisionsComplete ? "Nothing requires intervention" : "Waiting for every source to answer"}</strong></div><span>Evidence → action → engine verification</span></div>
    <div className="decision-queue-controls"><FilterGroup label="Filter decisions" value={filter} onChange={setFilter} options={[{ value: "all", label: "All", count: totalWaiting }, { value: "critical", label: "Critical", count: critical }, { value: "agents", label: "Agents", count: agentWaiting }, { value: "resolved", label: "Resolved", count: resolvedRecords.length }]}/><div>{snoozedRecords.length > 0 && <button className={showSnoozed ? "is-current" : ""} onClick={() => setShowSnoozed(value => !value)}>{showSnoozed ? "Hide snoozed" : `Snoozed ${snoozedRecords.length}`}</button>}<button disabled={!totalWaiting} onClick={markAllSeen}>Mark all seen</button></div></div>
    <details className="attention-lifecycle-bar"><summary title="How attention moves through the engine"><Icon name="info" size={13}/><span>Queue lifecycle</span></summary><div><strong>New → Seen → Acting → Verifying → Recovered</strong><small>Notification policy is managed in Settings</small></div></details>
    <div className="needs-list">{visible.length
      ? <DecisionList records={visible} queueState={queueState} busyId={busyId} onAction={handleDecisionAction} onSnooze={showingResolved ? undefined : snooze} onOpenSource={onOpenSource} resolved={showingResolved}/>
      : showingResolved
        ? <EmptyState title="Nothing has been resolved yet" detail="Decisions you act on, and alerts the engine verifies as recovered, are kept here so you can see what happened without leaving the queue."/>
        : filter !== "all"
        ? <EmptyState title={filter === "critical" ? "No critical decisions" : "No agent decisions"} detail={filter === "critical" ? "Failed workers requiring intervention will appear here." : "Agent, Gemini, Mission and MCP approvals will appear here when they need you."}/>
        : snoozedRecords.length && !showSnoozed
          ? <EmptyState title={`${snoozedRecords.length} decision${snoozedRecords.length === 1 ? " is" : "s are"} snoozed`} detail="Nothing else is waiting in the active queue. Reveal snoozed decisions above to review them before the timer expires."/>
          : !decisionsComplete
            ? <EmptyState title="The queue could not be confirmed" detail="Nothing is shown as clear until every decision source answers. Use Retry above; worker alerts are still listed on Groundstation."/>
          : <div className="needs-clear-state"><span className="needs-clear-mark">✓</span><span className="section-kicker">ALL CLEAR</span><h3>No failures, prompts, or approvals</h3><p>The queue will update automatically when a worker or agent needs your judgment.</p></div>}</div>
  </div>;
}

/* T114 — the engine answers "what happened on this project" as ONE model:
   activity events, decisions (open and resolved) and recipe runs, already
   merged and ordered by `history.model`. Each row is projected onto the field
   names the timeline already reads, so the existing rendering, search, actor
   filter and inspector work unchanged over three record sets instead of one.
   `historyTitle` and `historyKind` are the only two fields added. */
function historyRow(row) {
  if (row.kind === "event") {
    return { ...row.event, historyKind: "event", historyTitle: null, historySource: row.source, historyOutcome: row.outcome };
  }
  return {
    sequence: row.id,
    type: row.source,
    timestamp: row.at,
    name: row.actor,
    reason: row.detail,
    status: row.outcome,
    correlationId: row.correlationId,
    historyKind: row.kind,
    historyTitle: row.title,
    historySource: row.source,
    historyOutcome: row.outcome
  };
}

function useHistoryModel(projectKey, eventCount) {
  const [model, setModel] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [retry, setRetry] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    setError(null);
    missionApi().request("history.model", { limit: 200 })
      .then(result => { if (active) { setModel(result && Array.isArray(result.rows) ? result : null); setError(null); } })
      .catch(requestError => { if (active) setError(requestError instanceof Error ? requestError : new Error(String(requestError))); });
    return () => { active = false; };
  }, [projectKey, eventCount, retry]);
  return { model, error, refresh: React.useCallback(() => setRetry(value => value + 1), []) };
}

/* T113 — the export is rendered by the engine, because the redactor lives
   there. This control asks for it, reports what was removed, and hands the
   operator the file. It never assembles the content itself. */
function HistoryExport({ project, filter, query, actorFilter }) {
  const [busy, setBusy] = React.useState("");
  const [result, setResult] = React.useState(null);
  const [copied, setCopied] = React.useState(null); // null = not tried, true/false = outcome
  const [error, setError] = React.useState("");
  const { toast } = useToast();
  const run = async format => {
    setBusy(format);
    setError("");
    setCopied(null);
    try {
      const payload = await missionApi().request("history.export", {
        format,
        project,
        limit: 200,
        filter: { kind: filter, query, actor: actorFilter }
      });
      setResult(payload);
      // The clipboard is a convenience, not the delivery. It fails for reasons
      // that have nothing to do with the export (an unfocused window will do
      // it), and an operator told only "export failed" would have lost a file
      // that was in fact built correctly. The content is shown either way.
      try {
        await copyText(payload.content);
        setCopied(true);
        toast.success(`${payload.rowCount} records copied as ${format === "markdown" ? "Markdown" : "JSON"}${payload.redactions ? ` · ${payload.redactions} redacted` : ""}`);
      } catch {
        setCopied(false);
      }
    } catch (value) {
      setError(value?.message || String(value));
    } finally {
      setBusy("");
    }
  };
  return <div className="history-export">
    <div className="history-export__actions">
      <span className="section-kicker">EXPORT</span>
      <button type="button" disabled={Boolean(busy)} onClick={() => void run("json")}>{busy === "json" ? "Preparing…" : "Copy JSON"}</button>
      <button type="button" disabled={Boolean(busy)} onClick={() => void run("markdown")}>{busy === "markdown" ? "Preparing…" : "Copy Markdown"}</button>
    </div>
    <p className="history-export__note" role="status">
      {error
        ? `Export failed: ${error}`
        : result
          ? `${result.filename} · ${result.rowCount} records · ${result.redactions ? `${result.redactions} secret-shaped value${result.redactions === 1 ? "" : "s"} redacted (${Object.keys(result.found).join(", ")})` : "no secret-shaped values found"}${result.complete ? "" : ` · incomplete: ${result.blindSources.join(", ")} did not report`}${copied === false ? " · clipboard unavailable, select the text below" : ""}`
          : "Exports the filtered records with secrets redacted. Terminal output is never included."}
    </p>
    {result && <details className="history-export__content" open={copied === false}>
      <summary>{copied === false ? "Copy it manually" : "Show what was exported"}</summary>
      <textarea readOnly value={result.content} aria-label={`Exported history, ${result.filename}`} onFocus={event => event.target.select()}/>
    </details>}
  </div>;
}

function HistoryView({ events, onFocus, onAskAI, projectKey = "default" }) {
  const [filter, setFilter] = React.useState("all");
  const [query, setQuery] = React.useState("");
  const [actorFilter, setActorFilter] = React.useState("all");
  const [showAllActors, setShowAllActors] = React.useState(false);
  const [selectedSequence, setSelectedSequence] = React.useState(null);
  const [memory, setMemory] = React.useState(null);
  // Project memory load state is kept explicit: a failed `memory.summary` must not
  // read as "no memory yet". `null` error = not-yet-failed; an Error = show a notice.
  const [memoryError, setMemoryError] = React.useState(null);
  const [memoryRetry, setMemoryRetry] = React.useState(0);
  React.useEffect(() => { let active = true; let afterSequence = 0; try { const cursors = JSON.parse(localStorage.getItem(HISTORY_CURSOR_KEY) || "{}"); afterSequence = Number(cursors?.[projectKey]) || 0; } catch { /* Cursor is optional. */ } setMemoryError(null); missionApi().request("memory.summary", { afterSequence }).then(result => { if (active) { setMemory(result); setMemoryError(null); } }).catch(error => { if (active) setMemoryError(error instanceof Error ? error : new Error(String(error))); }); return () => { active = false; }; }, [events.length, projectKey, memoryRetry]);
  // T114 - one model. `history.model` merges activity, decisions and recipe
  // runs engine-side; the activity prop remains the fallback so the page still
  // reports the truth it already has if that read fails.
  const { model: historyModel, error: historyError, refresh: refreshHistory } = useHistoryModel(projectKey, events.length);
  const ordered = historyModel ? historyModel.rows.map(historyRow) : [...events].reverse();
  const failures = ordered.filter(event => /failed|error|attention|denied|cancelled/i.test(`${event.type} ${event.historyTitle || ""} ${event.status || ""}`));
  const evidenceEvents = ordered.filter(event => event.type === "session:evidence");
  const decisionRows = ordered.filter(event => event.historyKind === "decision");
  const recipeRunRows = ordered.filter(event => event.historyKind === "recipe-run");
  const chapters = memory?.chapters || [];
  const relationshipFor = chapter => memory?.causalLinks?.find(link => link.fromChapterId === chapter.correlationId || link.toChapterId === chapter.correlationId);
  const actorFor = event => event.name || event.id || event.sessionId || event.operation || "Workspace";
  const allActors = [...new Set(ordered.map(actorFor))];
  // T111: show the first eight, then all on demand; always keep the active filter visible.
  const actors = showAllActors
    ? allActors
    : [...new Set([...allActors.slice(0, 8), ...(actorFilter !== "all" ? [actorFilter] : [])])];
  const scoped = filter === "risk" ? failures
    : filter === "workers" ? ordered.filter(event => String(event.type).includes("session"))
    : filter === "evidence" ? evidenceEvents
    : filter === "decisions" ? decisionRows
    : filter === "recipes" ? recipeRunRows
    : ordered;
  const visible = scoped.filter(event => (actorFilter === "all" || actorFor(event) === actorFilter) && `${event.type || ""} ${event.name || ""} ${event.id || ""} ${event.sessionId || ""} ${event.operation || ""} ${event.reason || ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  // T112: the inspector always reflects the current filter — a selection that has
  // been filtered out falls back to the first visible event rather than lingering.
  const selected = visible.find(event => event.sequence === selectedSequence) || visible[0] || null;
  const selectedChapter = selected?.correlationId ? chapters.find(chapter => chapter.correlationId === selected.correlationId) : null;
  const recoveryChapters = chapters.filter(chapter => ["unresolved", "retrying", "recovered"].includes(chapter.state));
  return <div className="history-view">
    <h1 className="sr-only">History</h1>
    <header className="history-hero history-hero-redesigned"><div><span className="section-kicker">PROJECT MEMORY</span><h2>Investigate how the work unfolded</h2><p>A durable timeline of worker changes and verified operational facts. Structured evidence is stored without raw terminal output.</p></div><div className="history-snapshot"><span><small>RECORDED</small><strong>{ordered.length}</strong></span><span className="is-evidence"><small>EVIDENCE</small><strong>{evidenceEvents.length}</strong></span><span><small>RISKS</small><strong>{failures.length}</strong></span><span><small>DECISIONS</small><strong>{decisionRows.length}</strong></span><span><small>RECIPE RUNS</small><strong>{recipeRunRows.length}</strong></span><span><small>ACTORS</small><strong>{actors.length}</strong></span></div></header>
    {historyError && <div className="history-memory-error" role="status"><span>The merged history could not be loaded, so decisions and recipe runs are missing from the timeline below. The worker events shown are still accurate.</span><button type="button" onClick={refreshHistory}>Retry</button></div>}
    {historyModel && !historyModel.complete && <div className="history-memory-error" role="status"><span>Showing history from {historyModel.sources.filter(source => source.availability === "ready").length} of {historyModel.sources.length} sources. {historyModel.sources.filter(source => source.availability !== "ready").map(source => source.id).join(", ")} did not report, so records from {historyModel.sources.filter(source => source.availability !== "ready").length === 1 ? "it are" : "them are"} missing.</span><button type="button" onClick={refreshHistory}>Retry</button></div>}
    {memoryError && <div className="history-memory-error" role="status"><span>Project memory could not be loaded, so the summary, resume points, and run chapters are unavailable right now. The event timeline below is still accurate.</span><button type="button" onClick={() => setMemoryRetry(token => token + 1)}>Retry</button></div>}
    {memory && <section className="memory-briefing"><div className="memory-since"><span className="section-kicker">SINCE YOU LEFT · ENGINE SUMMARY</span><strong>{memory.since.summary}</strong><div><span>{memory.since.eventCount} changes</span><span>{memory.since.riskCount} risks</span><span>{memory.since.evidenceCount} evidence records</span></div></div><div className="memory-why"><span className="section-kicker">WHY IT NEEDS REVIEW</span>{memory.why.length ? memory.why.slice(0,2).map(item => <button key={item.sequence} onClick={() => setSelectedSequence(item.sequence)}><strong>{item.actor}</strong><span>{item.statement}</span><small>{item.correlationId ? "Engine-correlated" : "Recorded fact"}</small></button>) : <p>No recorded failure reason in this review window.</p>}</div></section>}
    {memory?.resumePoints?.length > 0 && <section className="memory-resume"><header><div><span className="section-kicker">RESUME WORK</span><strong>Return with the engine’s last known context</strong></div><small>Worker state and run evidence · no generated progress</small></header><div>{memory.resumePoints.slice(0,4).map(point => <button key={point.workerId} className={`is-${point.state}`} onClick={() => { if (point.sequence) setSelectedSequence(point.sequence); onFocus?.(point.workerId); }}><span><i/></span><span><strong>{point.title}</strong><small>{point.detail}</small></span><b>Open worker</b></button>)}</div></section>}
    {recoveryChapters.length > 0 && <section className="recovery-chains"><header><div><span className="section-kicker">FAILURE → RECOVERY RELATIONSHIPS</span><strong>Evidence-backed run continuity</strong></div><small>Same-worker chronology · success requires verification</small></header><div>{recoveryChapters.slice(0,4).map(chapter => { const relationship = relationshipFor(chapter); return <button key={chapter.correlationId} className={`is-${chapter.state}`} onClick={() => setSelectedSequence(chapter.resumePoint?.sequence || chapter.latestSequence)}><i/><span><strong>{chapter.actor}</strong><small>{relationship?.basis || chapter.failure || chapter.summary}</small></span><b>{chapter.state}</b></button>; })}</div></section>}
    {memory && <section className="memory-state-split"><header><span className="section-kicker">CURRENT ENGINE STATE</span><strong>Now, separate from the historical record below</strong></header><div>{memory.current.map(worker => <article key={worker.id}><i className={`status-${worker.status}`}/><span><strong>{worker.name}</strong><small>{worker.attentionRequired ? "Needs attention now" : worker.isAlive ? "Running now" : "Not running now"}</small></span><b>{worker.status}</b></article>)}</div></section>}
    <section className="history-evidence-strip"><header><div><span className="section-kicker">ENGINE EVIDENCE</span><strong>Verified facts from your workers</strong></div><button className={filter === "evidence" ? "is-current" : ""} onClick={() => setFilter(filter === "evidence" ? "all" : "evidence")}>{filter === "evidence" ? "Show all events" : `View all ${evidenceEvents.length}`}</button></header><div>{evidenceEvents.slice(0, 4).map(event => <button key={event.sequence} onClick={() => { setFilter("evidence"); setSelectedSequence(event.sequence); }}><span>{event.category}</span><strong>{evidenceSummary(event)}</strong><small>{event.name || event.id} · {timeAgo(event.timestamp)} ago</small></button>)}{!evidenceEvents.length && <p>Run tests, a build, Git status, or a service to create durable structured evidence.</p>}</div></section>
    {chapters.length > 0 && <section className="history-chapters"><header><div><span className="section-kicker">RUN CHAPTERS · RESUMABLE MEMORY</span><strong>Compact context for every recorded run</strong></div><small>Correlation-backed · bounded evidence · explicit relationships</small></header><div>{chapters.slice(0, 5).map(chapter => <button key={chapter.correlationId} className={`is-${chapter.state} ${!["active", "completed", "ended"].includes(chapter.state) ? "has-risk" : ""}`} onClick={() => setSelectedSequence(chapter.resumePoint?.sequence || chapter.latestSequence)}><i/><span><strong>{chapter.actor || "Worker run"}</strong><small>{chapter.summary}</small></span><b>{chapter.state}</b></button>)}</div></section>}
    <div className="history-controls"><FilterGroup label="Filter history" value={filter} onChange={setFilter} options={[{ value: "all", label: "All changes" }, { value: "workers", label: "Workers" }, { value: "decisions", label: "Decisions" }, { value: "recipes", label: "Recipe runs" }, { value: "risk", label: "Risks & attention" }]}/><label className="history-search"><Icon name="search" size={13}/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search event, actor, reason…"/><kbd>{visible.length}</kbd></label><HistoryExport project={projectKey} filter={filter} query={query} actorFilter={actorFilter}/></div>
    {actors.length > 1 && <div className="history-actors"><span>ACTOR</span><button className={actorFilter === "all" ? "is-current" : ""} onClick={() => setActorFilter("all")}>Everyone</button>{actors.map(actor => <button className={actorFilter === actor ? "is-current" : ""} key={actor} onClick={() => setActorFilter(actor)}>{actor}</button>)}{allActors.length > 8 && <button className="history-actors__more" onClick={() => setShowAllActors(value => !value)}>{showAllActors ? "Show fewer" : `+${allActors.length - 8} more`}</button>}</div>}
    <div className={`history-investigation ${selected ? "has-selection" : ""}`}><div className="timeline">{visible.length ? visible.map(event => { const dangerous = /failed|error|attention/i.test(String(event.type)); const actor = actorFor(event); const eventKind = dangerous ? "risk" : event.historyKind === "decision" ? "decision" : event.historyKind === "recipe-run" ? "recipe" : /evidence/i.test(String(event.type)) ? "evidence" : /session|worker/i.test(String(event.type)) ? "worker" : "system"; return <article tabIndex="0" role="button" aria-pressed={selected?.sequence === event.sequence} onClick={() => setSelectedSequence(event.sequence)} onKeyDown={keyEvent => { if (keyEvent.key === "Enter" || keyEvent.key === " ") { keyEvent.preventDefault(); setSelectedSequence(event.sequence); } }} className={`timeline-event event-${eventKind} ${dangerous ? "is-danger" : ""} ${selected?.sequence === event.sequence ? "is-selected" : ""}`} key={`${event.sequence}-${event.type}`}><div className="timeline-time"><strong>{timeAgo(event.timestamp)}</strong><span>#{event.sequence}</span></div><div className={`timeline-node event-${eventKind} ${dangerous ? "is-danger" : ""}`}><i/></div><div className="timeline-copy"><span>{actor}</span><strong>{eventTitle(event)}</strong><p>{event.reason || (dangerous ? "Engine evidence marks this moment for review." : String(event.type).includes("session") ? `${actor} changed state through the supervised engine contract.` : "OUTARCH recorded this workspace transition.")}</p>{event.operation && <code>operation · {event.operation}</code>}</div><span className="timeline-kind">{eventKind === "risk" ? "Risk" : eventKind === "decision" ? "Decision" : eventKind === "recipe" ? "Recipe" : eventKind === "evidence" ? "Evidence" : eventKind === "worker" ? "Worker" : "System"}</span></article>; }) : <EmptyState title="No matching history" detail={query || actorFilter !== "all" ? "Try a broader search or another filter." : "Keep working to create new project memory."}/>}</div>
      {selected && <aside className="history-evidence"><header><span className="section-kicker">RECORDED EVIDENCE</span><strong>Event #{selected.sequence}</strong><small>{new Date(selected.timestamp).toLocaleString()}</small></header><div className={`history-evidence__status ${/failed|error|attention/i.test(String(selected.type)) ? "is-risk" : ""}`}><i/><span><small>EVENT TYPE</small><strong>{eventTitle(selected)}</strong></span></div>{selectedChapter && <section className={`history-chapter-context is-${selectedChapter.state}`}><span>RUN CHAPTER · {selectedChapter.state}</span><strong>{selectedChapter.summary}</strong><small>{selectedChapter.relationships?.[0]?.basis || "Events share an engine-issued run correlation."}</small></section>}<dl><div><dt>Actor</dt><dd>{actorFor(selected)}</dd></div>{selected.operation && <div><dt>Operation</dt><dd>{selected.operation}</dd></div>}{selected.reason && <div><dt>Recorded reason</dt><dd>{selected.reason}</dd></div>}{selected.status && <div><dt>State</dt><dd>{selected.status}</dd></div>}{Number.isInteger(selected.exitCode) && <div><dt>Exit code</dt><dd>{selected.exitCode}</dd></div>}<div><dt>Correlation</dt><dd>{selected.correlationId || "Not provided by engine"}</dd></div></dl><p>This panel displays recorded event fields. Cross-run relationships require the same worker and later recorded evidence.</p>{onAskAI && <button type="button" className="history-evidence__ai" onClick={() => onAskAI(`On ${new Date(selected.timestamp).toLocaleString()}, ${actorFor(selected)} — ${eventTitle(selected)}.${selected.reason ? ` Recorded reason: ${selected.reason}.` : ""} What does this mean and what should I check?`)}><span>AI</span> Ask Mission AI about this event</button>}</aside>}
    </div>
  </div>;
}

// T151 - the segmented choice lives in Segmented.jsx now; this stays as the
// name the Settings panels already call, so the consolidation moved the
// implementation without moving every call site.
const SettingChoice = SegmentedChoice;

// T033/T037 — delivery is real now: the main process raises OS notifications
// from engine attention records, and `NotificationPolicy` enforces the severity
// floor and quiet hours the panel below writes. Availability is no longer a
// constant the renderer asserts — it is read from the engine, so a platform
// that genuinely cannot notify still says so truthfully instead of pretending.
function NotificationSettings() {
  const defaults = { minimumSeverity: "info", desktopNotifications: true, sound: true, quietHours: { enabled: false, start: "22:00", end: "07:00" } };
  const [policy, setPolicy] = React.useState(defaults);
  const [error, setError] = React.useState("");
  const [delivery, setDelivery] = React.useState({ loading: true, available: false, running: false, lastError: null });
  const [testResult, setTestResult] = React.useState(null);
  const [testing, setTesting] = React.useState(false);
  const policyRef = React.useRef(policy);
  policyRef.current = policy;
  // Unknown is not the same as unavailable: while the first read is in flight
  // the controls stay inert rather than claiming either answer.
  const disabled = delivery.loading || !delivery.available;
  React.useEffect(() => { missionApi().request("attention.list").then(value => setPolicy({ ...defaults, ...(value?.preferences || {}) })).catch(() => {}); }, []);
  React.useEffect(() => {
    let active = true;
    const read = () => missionApi().request("notification.status")
      .then(value => { if (active) setDelivery({ loading: false, available: value?.available === true, running: value?.running === true, lastError: value?.lastError || null }); })
      .catch(value => { if (active) setDelivery({ loading: false, available: false, running: false, lastError: value?.message || String(value) }); });
    void read();
    return () => { active = false; };
  }, []);
  const sendTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const value = await missionApi().request("notification.test");
      setTestResult(value?.delivered
        ? { ok: true, message: "Test sent. If nothing appeared in Windows, check Settings › System › Notifications for this app, and whether Do not disturb is on." }
        : { ok: false, message: value?.error || "The notification was not delivered." });
    } catch (value) {
      setTestResult({ ok: false, message: value?.message || String(value) });
    } finally {
      setTesting(false);
    }
  };
  // T052: optimistic write with an explicit rollback and a persistent error.
  // The previous policy is restored if the engine rejects the save.
  const persist = async next => {
    setError("");
    const previous = policyRef.current;
    setPolicy(next);
    try {
      await missionApi().request("attention.preferences.save", { preferences: next });
    } catch (value) {
      setPolicy(previous);
      setError(`${value?.message || String(value)} — notification preferences were not changed.`);
    }
  };
  const save = async next => {
    if (disabled) return;
    await persist(next);
  };
  // The chime is played by the app itself, so it works — and can be set —
  // even on a device that cannot show Windows notifications.
  const soundDisabled = delivery.loading;
  return <section className="settings-panel settings-panel-wide notification-settings pm-card"><div className="settings-panel__head"><Icon name="attention"/><div><h3>Notifications</h3><p>Failures, services coming up and decisions waiting for you. While you use OUTARCH they appear at the top right; when you are in another app, Windows shows them.</p></div></div>{delivery.loading && <p className="notification-availability" role="status">Checking whether this device can show desktop notifications…</p>}{!delivery.loading && !delivery.available && <p className="notification-availability" role="status">This device cannot show desktop notifications{delivery.lastError ? ` — ${delivery.lastError}` : ""}. Notifications still appear inside OUTARCH, with their sound. The policy below is saved and will apply if delivery becomes available.</p>}<div className={`attention-policy${disabled ? " is-unavailable" : ""}`}><div className="severity-choice"><span id="notify-from-label">Notify from</span><div role="radiogroup" aria-labelledby="notify-from-label" aria-disabled={disabled || undefined}>{[["info","All"],["warning","Warnings"],["critical","Failures only"]].map(([value,label]) => <button key={value} type="button" role="radio" aria-checked={policy.minimumSeverity === value} disabled={disabled} className={policy.minimumSeverity === value ? "is-current" : ""} onClick={() => void save({ ...policy, minimumSeverity: value })}>{label}</button>)}</div></div><div className="terminal-toggle-card notification-sound"><span><strong>Sound</strong><small>A short chime for each new notification. A failure sounds different from a server coming up, and a burst rings once.</small></span><span className="notification-sound__controls"><button type="button" className="btn-secondary" disabled={soundDisabled} onClick={() => playNotificationSound("alert", { force: true })}>Play</button><label className="pm-toggle"><input type="checkbox" aria-label="Play a sound for notifications" disabled={soundDisabled} checked={policy.sound !== false} onChange={event => void persist({ ...policy, sound: event.target.checked })}/><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></label></span></div><label className="terminal-toggle-card"><span><strong>Windows notifications</strong><small>{disabled ? "Unavailable on this device — notifications still appear inside the app." : "Shown only while you are in another app. When OUTARCH is the window you are using, it tells you itself, so nothing arrives twice."}</small></span><span className="pm-toggle"><input type="checkbox" disabled={disabled} checked={policy.desktopNotifications} onChange={event => void save({ ...policy, desktopNotifications: event.target.checked })}/><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span></label><label className="terminal-toggle-card"><span><strong>Quiet hours</strong><small>No sound and no Windows notifications during this window. Everything still collects in the notification list.</small></span><span className="pm-toggle"><input type="checkbox" disabled={disabled} checked={policy.quietHours.enabled} onChange={event => void save({ ...policy, quietHours: { ...policy.quietHours, enabled: event.target.checked } })}/><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span></label><div className="quiet-hours" role="group" aria-label="Quiet hours window"><label><span>Start</span><input type="time" disabled={disabled} aria-label="Quiet hours start time" value={policy.quietHours.start} onChange={event => setPolicy(current => ({ ...current, quietHours: { ...current.quietHours, start: event.target.value } }))} onBlur={() => void save(policy)}/></label><span aria-hidden="true">to</span><label><span>End</span><input type="time" disabled={disabled} aria-label="Quiet hours end time" value={policy.quietHours.end} onChange={event => setPolicy(current => ({ ...current, quietHours: { ...current.quietHours, end: event.target.value } }))} onBlur={() => void save(policy)}/></label></div>{error && <p className="settings-save-error" role="alert">{error}</p>}<div className="notification-diagnostic"><div><strong>Send a test notification</strong><small>Shows one in the app and in Windows, with its sound, ignoring the settings above — so it answers one question: can this computer show and play a notification.</small></div><button type="button" className="btn-secondary" disabled={disabled || testing} onClick={() => void sendTest()}>{testing ? "Sending…" : "Send test"}</button></div>{testResult && <p className={`notification-test-result${testResult.ok ? " is-ok" : " is-failed"}`} role="status">{testResult.message}</p>}</div></section>;
}

function VSCodeBridgeSettings({ workspace, onConfirm }) {
  const [status, setStatus] = React.useState(null);
  const [busy, setBusy] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [resourceState, setResourceState] = React.useState({ loading: true, error: "", updatedAt: null });
  const [terminalName, setTerminalName] = React.useState("OUTARCH");
  const [terminalCwd, setTerminalCwd] = React.useState(".");
  const [terminalInputs, setTerminalInputs] = React.useState({});
  const refresh = React.useCallback(() => {
    setResourceState(current => ({ ...current, loading: current.updatedAt == null }));
    return missionApi().request("vscode.status").then(value => {
      setStatus(value);
      setResourceState({ loading: false, error: "", updatedAt: Date.now() });
      return value;
    }).catch(error => {
      setResourceState(current => ({ ...current, loading: false, error: error.message || String(error) }));
      return null;
    });
  }, []);
  React.useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    void refresh();
    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (notification?.type === "integration:event" && notification.integration === "vscode" && active) {
          setStatus(notification.status);
          setResourceState({ loading: false, error: "", updatedAt: Date.now() });
        }
      });
    } catch { /* The request above remains the authoritative fallback. */ }
    return () => { active = false; unsubscribe?.(); };
  }, [refresh, workspace?.path]);
  const run = async (operation, method, params = {}, successMessage = "Command confirmed by VS Code.") => {
    setBusy(operation);
    setMessage("");
    try {
      const result = ["vscode.terminal.create", "vscode.terminal.write", "vscode.terminal.close"].includes(method)
        ? await confirmedRequest(method, params)
        : await missionApi().request(method, params);
      if (result?.status) setStatus(result.status);
      else await refresh();
      setMessage(operation === "launch" ? "Secure invitation sent to VS Code. Waiting for the extension handshake." : operation === "disconnect" ? "VS Code Bridge disconnected." : successMessage);
      return true;
    } catch (error) { setMessage(error.message || String(error)); }
    finally { setBusy(""); }
    return false;
  };
  const editor = status?.editor;
  const diagnostics = status?.diagnostics || {};
  const git = status?.git;
  const terminals = status?.terminals || [];
  const managedTerminals = terminals.filter(terminal => terminal.ownership === "mission-control-managed");
  const observedTerminals = terminals.filter(terminal => terminal.ownership !== "mission-control-managed");
  const connected = status?.connected === true;
  const statusKnown = Boolean(status);
  const controlsAvailable = statusKnown && !resourceState.error;
  const unknownValue = resourceState.loading ? "Loading…" : "—";
  const stateLabel = !statusKnown && resourceState.loading ? "Checking status" : !statusKnown && resourceState.error ? "Status unavailable" : resourceState.error ? "Stale status" : connected ? "Connected" : status?.awaitingHandshake ? "Waiting for VS Code" : status?.lastError ? "Needs review" : "Ready to connect";
  return <section className={`settings-panel settings-panel-wide vscode-bridge-settings pm-card pm-card--feat-vscode ${connected ? "is-connected" : ""}`}>
    <header><div className="settings-panel__head"><span className="vscode-mark">⌁</span><div><h3>VS Code Bridge</h3><p>Observe VS Code-owned terminals and explicitly control only OUTARCH-managed terminals.</p></div></div><div className={`vscode-connection ${connected ? "is-live" : status?.awaitingHandshake ? "is-waiting" : ""}`}><i/><span><small>EDITOR CONNECTION</small><strong>{stateLabel}</strong></span></div></header>
    {resourceState.error && <div className="integration-resource-notice" role="status"><span><strong>VS Code Bridge status could not be refreshed.</strong> {statusKnown ? "Showing the last verified editor snapshot; controls are unavailable until it is current." : "Connection state is unknown, so OUTARCH will not claim the bridge is ready or disconnected."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {statusKnown && !connected && <ol className="vscode-setup-steps" aria-label="VS Code Bridge setup"><li className="is-ready"><b>1</b><span><strong>Open a persistent project</strong><small>{workspace?.persistent ? "Ready" : "Choose a project folder first"}</small></span></li><li><b>2</b><span><strong>Install the included extension</strong><small>Use integrations/vscode from this release</small></span></li><li className={status?.awaitingHandshake ? "is-active" : ""}><b>3</b><span><strong>Send a one-time invitation</strong><small>VS Code verifies the same project before connecting</small></span></li></ol>}
    <div className="vscode-bridge-body"><div className="vscode-sync-summary"><div><span>ACTIVE FILE</span><strong title={editor?.relativePath || ""}>{editor?.relativePath || (statusKnown ? "No editor context yet" : unknownValue)}</strong><small>{editor ? `Line ${editor.line}:${editor.column}${editor.dirty ? " · unsaved" : " · saved"}` : statusKnown ? "Project-relative paths only" : "Editor context not verified"}</small></div><div className={diagnostics.errors ? "has-risk" : ""}><span>PROBLEMS</span><strong>{statusKnown ? `${diagnostics.errors || 0} errors · ${diagnostics.warnings || 0} warnings` : unknownValue}</strong><small>{statusKnown ? `${diagnostics.items?.length || 0} bounded records synchronized` : "Diagnostics not verified"}</small></div><div><span>SOURCE CONTROL</span><strong>{git?.branch || (statusKnown ? "Waiting for Git state" : unknownValue)}</strong><small>{git ? `${git.changedPaths} changed · ${git.ahead} ahead · ${git.behind} behind` : statusKnown ? "Aggregate state only" : "Source-control state not verified"}</small></div><div><span>EDITOR TERMINALS</span><strong>{statusKnown ? `${managedTerminals.length} managed · ${observedTerminals.length} observed` : unknownValue}</strong><small>Activity metadata only · raw output never crosses the bridge</small></div></div><TrustBoundary compact title="Editor ownership stays explicit" summary="Observed terminals remain read-only; managed terminal changes require approval." facts={[{ label: "Observe", value: "VS Code-owned terminal metadata" }, { label: "Control", value: "OUTARCH-managed terminals only" }, { label: "Blocked", value: "Secrets, multiline input, and arbitrary paths" }]}/></div>
    {connected && <div className="vscode-terminal-control"><div className="vscode-terminal-create"><div><span>NEW MANAGED TERMINAL</span><small>Created inside this project and labeled as OUTARCH-managed.</small></div><input aria-label="Managed terminal name" value={terminalName} maxLength={80} disabled={!controlsAvailable} onChange={event => setTerminalName(event.target.value)} placeholder="Terminal name"/><input aria-label="Managed terminal working directory" value={terminalCwd} maxLength={240} disabled={!controlsAvailable} onChange={event => setTerminalCwd(event.target.value)} placeholder="Project-relative cwd"/><button className="vscode-connect" disabled={!controlsAvailable || Boolean(busy) || !terminalName.trim() || !onConfirm} onClick={() => onConfirm?.({ title: `Create managed terminal "${terminalName.trim()}"?`, detail: `VS Code will create a controllable terminal in ${terminalCwd.trim() || "."}.`, recovery: "The managed terminal can be closed from this panel.", confirmLabel: "Create terminal", run: () => run("create-terminal", "vscode.terminal.create", { name: terminalName, cwd: terminalCwd }, "Managed terminal created in VS Code.") })}>{busy === "create-terminal" ? "Creating…" : "Approve & create"}</button></div>
      <div className="vscode-terminal-list">{terminals.length === 0 ? <div className="vscode-terminal-empty"><strong>No editor terminals reported</strong><small>Open one in VS Code or create a managed terminal above.</small></div> : terminals.map(terminal => <article key={terminal.id} className={terminal.controllable ? "is-managed" : "is-observed"}><div className="vscode-terminal-main"><span className="vscode-terminal-owner">{terminal.controllable ? "MANAGED" : "VS CODE-OWNED"}</span><strong>{terminal.name}</strong><small>{terminal.currentCommand || (terminal.shellIntegration ? "Shell ready; no active command" : "Shell activity unavailable")}{terminal.cwd ? ` · ${terminal.cwd}` : ""}</small></div><span className={`vscode-terminal-state is-${terminal.commandState || "idle"}`}>{terminal.active ? "ACTIVE · " : ""}{terminal.commandState || "idle"}</span>{terminal.controllable && <div className="vscode-terminal-actions"><button disabled={!controlsAvailable || Boolean(busy)} onClick={() => run(`focus:${terminal.id}`, "vscode.terminal.focus", { terminalId: terminal.id }, "Managed terminal focused in VS Code.")}>Focus</button><input aria-label={`Command for ${terminal.name}`} value={terminalInputs[terminal.id] || ""} maxLength={4096} disabled={!controlsAvailable} onChange={event => setTerminalInputs(current => ({ ...current, [terminal.id]: event.target.value }))} placeholder="One command; secrets blocked"/><button disabled={!controlsAvailable || Boolean(busy) || !(terminalInputs[terminal.id] || "").trim() || !onConfirm} onClick={() => { const input = terminalInputs[terminal.id] || ""; onConfirm?.({ title: `Send command to "${terminal.name}"?`, detail: input, recovery: "Review terminal output immediately; stop the managed terminal if the command behaves unexpectedly.", confirmLabel: "Send command", run: async () => { const sent = await run(`write:${terminal.id}`, "vscode.terminal.write", { terminalId: terminal.id, input }, "Approved command sent to the managed terminal."); if (sent) setTerminalInputs(current => ({ ...current, [terminal.id]: "" })); } }); }}>Approve & send</button><button className="vscode-disconnect" disabled={!controlsAvailable || Boolean(busy) || !onConfirm} onClick={() => onConfirm?.({ title: `Close managed terminal "${terminal.name}"?`, detail: "VS Code will terminate this managed terminal session.", recovery: "Create a new managed terminal from this panel if it is needed again.", confirmLabel: "Close terminal", run: () => run(`close:${terminal.id}`, "vscode.terminal.close", { terminalId: terminal.id }, "Managed terminal closed.") })}>Approve & close</button></div>}</article>)}</div>
    </div>}
    {message && <p className={status?.lastError ? "is-error" : ""} role="status">{message}</p>}
    <footer><span>{!statusKnown ? "VS Code Bridge state has not been verified." : status?.lastSyncAt ? `Last synchronized ${timeAgo(status.lastSyncAt)} ago` : workspace?.persistent ? "Install the included extension, then connect this project." : "Open a persistent project to enable the bridge."}</span><div>{connected && editor && <button disabled={!controlsAvailable || Boolean(busy)} onClick={() => run("file", "vscode.openFile", { relativePath: editor.relativePath, line: editor.line, column: editor.column })}>Open active file</button>}{connected && <button disabled={!controlsAvailable || Boolean(busy)} onClick={() => run("problems", "vscode.openProblems")}>Open Problems</button>}{connected ? <button className="vscode-disconnect" disabled={!controlsAvailable || Boolean(busy)} onClick={() => run("disconnect", "vscode.disconnect")}>{busy === "disconnect" ? "Disconnecting…" : "Disconnect"}</button> : <button className="vscode-connect" disabled={!controlsAvailable || !workspace?.persistent || Boolean(busy)} onClick={() => run("launch", "vscode.launch")}>{busy === "launch" ? "Opening VS Code…" : status?.awaitingHandshake ? "Send new invitation" : "Connect VS Code"}</button>}</div></footer>
  </section>;
}

// T121 - implementation-library links are developer documentation, not a
// preference. They belong beside the other build facts in About, where a reader
// is already asking "what is this made of", rather than in the same column as
// theme and font size where they answer a question nobody was asking.
function ResourceLinks() {
  const open = url => window.missionControl?.openExternal?.(url);
  return <div className="settings-resources-inline"><span className="settings-resources-inline__label">Implementation references</span><Popover.Root><Tooltip.Provider delayDuration={350}><Tooltip.Root><Tooltip.Trigger asChild><Popover.Trigger asChild><button className="resources-trigger">Component resources <span>↗</span></button></Popover.Trigger></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="radix-tooltip" sideOffset={7}>Open implementation references</Tooltip.Content></Tooltip.Portal></Tooltip.Root></Tooltip.Provider><Popover.Portal><Popover.Content className="resources-popover" side="top" align="start" sideOffset={8}><strong>Renderer primitives</strong><button onClick={() => void open("https://github.com/radix-ui/primitives")}>Radix UI Primitives <span>↗</span></button><button onClick={() => void open("https://github.com/pacocoursey/cmdk")}>cmdk <span>↗</span></button><Popover.Arrow className="resources-arrow"/></Popover.Content></Popover.Portal></Popover.Root></div>;
}

// T123 — Restore defaults previews its exact scope before it runs: which
// settings differ from their defaults, and what it explicitly does not touch.
// It is inert when nothing differs, so the control never implies an effect it
// would not have.
function SettingsResetFooter({ preferences, onReset }) {
  const { changed } = describePreferenceReset(preferences);
  const pristine = changed.length === 0;
  return <footer className="settings-footer">
    <div className="settings-reset-scope">
      <span>Preferences are local to this device. Engine configuration, credentials, project state and running PTYs are not affected.</span>
      {pristine
        ? <small id="settings-reset-preview" className="settings-reset-preview is-pristine">Every setting is already at its default.</small>
        : <small id="settings-reset-preview" className="settings-reset-preview">Restoring defaults will change {changed.length} setting{changed.length === 1 ? "" : "s"}: {changed.join(", ")}.</small>}
    </div>
    <button className="btn-ghost" onClick={onReset} disabled={pristine} aria-describedby="settings-reset-preview">Restore defaults</button>
  </footer>;
}

function SettingsView({ preferences, onPreference }) {
  return <div className="settings-view"><div className="settings-grid"><section className="settings-panel pm-card"><div className="settings-panel__head"><Icon name="settings"/><div><h3>Appearance and accessibility</h3><p>Tune typography, density and motion for long development sessions.</p></div></div><SettingChoice label="Text size" detail="Scale interface typography without changing terminal output." value={preferences.typeScale} options={[{value:"compact",label:"Compact"},{value:"comfortable",label:"Default"},{value:"large",label:"Large"}]} onChange={value => onPreference("typeScale", value)}/><SettingChoice label="Interface density" detail="Choose how much breathing room controls and rows use." value={preferences.density} options={[{value:"compact",label:"Compact"},{value:"comfortable",label:"Comfortable"},{value:"spacious",label:"Spacious"}]} onChange={value => onPreference("density", value)}/><SettingChoice label="Motion" detail="Reduce transitions while keeping state changes clear." value={preferences.motion} options={[{value:"full",label:"Full"},{value:"reduced",label:"Reduced"}]} onChange={value => onPreference("motion", value)}/></section></div></div>;
}

function TerminalSettings({ preferences, onPreference }) {
  return <div className="settings-view"><div className="settings-grid"><section className="settings-panel settings-panel-wide pm-card"><div className="settings-panel__head"><Icon name="terminal"/><div><h3>Terminal experience</h3><p>Readable monospace tuned independently from the application UI.</p></div></div><div className="terminal-size-control"><label htmlFor="terminal-font-size-range"><strong>Terminal font size</strong><p>Applied to every mounted terminal pane.</p></label><input id="terminal-font-size-range" type="range" min="11" max="18" step="1" value={preferences.terminalFontSize} aria-label="Terminal font size in pixels" aria-valuetext={`${preferences.terminalFontSize} pixels`} onChange={event => onPreference("terminalFontSize", Number(event.target.value))}/><output htmlFor="terminal-font-size-range" aria-live="polite">{preferences.terminalFontSize}px</output></div><SettingChoice label="Cursor" detail="Choose a visible cursor shape for interactive shells." value={preferences.terminalCursor} options={[{value:"bar",label:"Bar"},{value:"block",label:"Block"},{value:"underline",label:"Underline"}]} onChange={value => onPreference("terminalCursor", value)}/><SettingChoice label="Scrollback" detail="Bounded terminal history retained by each mounted pane." value={preferences.terminalScrollback} options={[{value:1000,label:"1,000"},{value:5000,label:"5,000"},{value:20000,label:"20,000"}]} onChange={value => onPreference("terminalScrollback", value)}/><label className="terminal-toggle-card"><span><strong>Show command hints</strong><small>Display exact CLI and worker commands in operational surfaces.</small></span><span className="pm-toggle"><input type="checkbox" checked={preferences.showCommandHints} onChange={event => onPreference("showCommandHints", event.target.checked)}/><i className="pm-toggle-track"><b className="pm-toggle-thumb"/></i></span></label></section></div></div>;
}

/* T122 — engine-contract and recovery-controller facts are diagnostics, not
   preferences. They answer "is the machine healthy" and change nothing; sitting
   them beside Theme invited a reader to look for a control that does not, and
   should not, exist. */
function DiagnosticsSettings({ state, workspace, recovery }) {
  return <div className="settings-view"><div className="settings-grid"><section className="settings-panel settings-panel-wide pm-card">
    <div className="settings-panel__head"><Icon name="pulse"/><div><h3>Diagnostics</h3><p>Current state from the protected engine boundary. Nothing here is a setting.</p></div></div>
    <div className="settings-rows">
      <div><span>Engine contract</span><strong>Protocol v{state?.contractVersion || "—"}</strong></div>
      <div><span>Workspace mode</span><strong>{workspace?.persistent ? "Persistent" : "In memory"}</strong></div>
      <div><span>Recovery controller</span><strong>{recovery?.phase || "Ready"}</strong></div>
      <div><span>Recovery attempts</span><strong>{Number.isFinite(Number(recovery?.attempts)) ? recovery.attempts : 0}</strong></div>
      <div><span>Keyboard navigation</span><strong>Ctrl K · F1 · Escape</strong></div>
      <div><span>Project file</span><strong title={workspace?.path || ""}>{workspace?.path || "Not persisted"}</strong></div>
    </div>
  </section></div></div>;
}

/* Security and privacy states what is true of this build, sourced from the
   engine and from the preference the operator actually set. Every line is a
   statement about behaviour, not a reassurance: a claim here that the code did
   not keep would be worse than saying nothing at all. */
function SecuritySettings({ workspace }) {
  return <div className="settings-view"><div className="settings-grid"><section className="settings-panel settings-panel-wide pm-card">
    <div className="settings-panel__head"><Icon name="shield"/><div><h3>Security and privacy</h3><p>What leaves this machine, and what cannot.</p></div></div>
    <div className="settings-rows">
      <div><span>Project state</span><strong>{workspace?.persistent ? "Stored in this project folder" : "Held in memory only"}</strong></div>
      <div><span>Credentials</span><strong>OS-encrypted; never written to project files</strong></div>
      <div><span>Terminal output</span><strong>Never sent to a model or an export</strong></div>
      <div><span>Interface preferences</span><strong>This device only</strong></div>
      <div><span>External requests</span><strong>Only the integrations you configure</strong></div>
    </div>
    <p className="settings-note">Mission AI, MCP and Mobile each declare their own boundary before they become active. Run a self-test on any of them in Integrations to see what it can currently reach.</p>
  </section></div></div>;
}

/* Project defaults are engine facts about the open project. They are changed
   where the thing lives — in a worker's own configuration — so this group
   reports them and points there, rather than growing a second place to edit
   them that could disagree with the first. */
function ProjectDefaultSettings({ workspace, sessions = [], onNavigate, onConfigureAutoStart }) {
  const autoStart = sessions.filter(session => session.autoStart).length;
  return <div className="settings-view"><div className="settings-grid"><section className="settings-panel settings-panel-wide pm-card">
    <div className="settings-panel__head"><Icon name="projects"/><div><h3>Project defaults</h3><p>What this project does when it opens.</p></div></div>
    <div className="settings-rows">
      <div><span>Project</span><strong title={workspace?.directory || ""}>{workspace?.name || "No project open"}</strong></div>
      <div><span>Workspace persistence</span><strong>{workspace?.persistent ? "Restored on open" : "Not persisted"}</strong></div>
      <div><span>Starts with the workspace</span><strong>{autoStart} of {sessions.length} worker{sessions.length === 1 ? "" : "s"}</strong></div>
    </div>
    <p className="settings-note">A worker&apos;s restore policy, command and directory belong to that worker. <button type="button" className="settings-inline-link" onClick={() => onNavigate("workspace")}>Open Workspace</button> to change one{onConfigureAutoStart ? <>, or <button type="button" className="settings-inline-link" onClick={onConfigureAutoStart}>choose which terminals start with the workspace</button></> : null}.</p>
  </section></div></div>;
}

function AboutSettings({ state, onConfirm }) {
  return <div className="settings-view"><div className="settings-grid"><section className="settings-panel settings-panel-wide pm-card">
    <div className="settings-panel__head"><Icon name="command"/><div><h3>About</h3><p>What this build is.</p></div></div>
    <div className="about-brand"><BrandIcon large/><div><BrandWordmark/><small>Developer cockpit{PRODUCT_VERSION ? ` · version ${PRODUCT_VERSION}` : ""}</small></div></div>
    <div className="settings-rows">
      <div><span>Application</span><strong>{PRODUCT_NAME}{PRODUCT_VERSION ? ` ${PRODUCT_VERSION}` : ""}</strong></div>
      <div><span>Engine contract</span><strong>Protocol v{state?.contractVersion || "—"}</strong></div>
      <div><span>Runtime</span><strong>Local-first · engine-owned PTYs</strong></div>
      <div><span>Updates</span><strong>Automatic · signed releases, verified before they install</strong></div>
    </div>
    <UpdatesPanel onConfirm={onConfirm}/>
    <ResourceLinks/>
  </section></div></div>;
}

// Settings now holds only application preferences. Every connected-capability
// panel (Mission AI, VS Code, MCP, Automation, Mobile) lives in the
// Integrations tab instead — see IntegrationHubView in IntegrationsView.jsx.
/* T120 — the eight groups, in the order a reader looks for them: the things
   they change every day first, the things they read when something is wrong
   last. A group is a place, not a heading in a scroll: the panel that answers
   "what colour is this" and the panel that answers "what protocol version is
   the engine on" were the same column, and neither was findable.

   The order and the ids are the contract; the panels themselves are the
   existing components, regrouped rather than rewritten. */
const SETTINGS_GROUPS = [
  ["account", "Account & plan"],
  ["appearance", "Appearance & accessibility"],
  ["terminal", "Terminal"],
  ["notifications", "Notifications"],
  ["project", "Project defaults"],
  ["integrations", "Integrations"],
  ["security", "Security & privacy"],
  ["diagnostics", "Diagnostics"],
  ["about", "About"]
];

const SETTINGS_GROUP_KEY = "mission-control.settings-group.v1";

function SettingsHub({ state, workspace, recovery, sessions = [], preferences, onPreference, onReset, onNavigate, onOpenIntegrations, onConfigureAutoStart, onConfirm, focusGroup }) {
  const [group, setGroup] = React.useState(() => {
    try {
      const stored = localStorage.getItem(SETTINGS_GROUP_KEY);
      return SETTINGS_GROUPS.some(([id]) => id === stored) ? stored : "appearance";
    } catch { return "appearance"; }
  });
  const select = id => {
    setGroup(id);
    try { localStorage.setItem(SETTINGS_GROUP_KEY, id); } catch { /* Group memory is local best effort. */ }
  };
  // Integrations is a destination, not a panel: it owns a whole route, and
  // duplicating it here would be the second entry point T249 warns about.
  const choose = id => (id === "integrations" ? onOpenIntegrations() : select(id));
  // Another surface can open a group directly (the sidebar account row opens
  // Account & plan); the request carries a stamp so asking twice works.
  React.useEffect(() => {
    if (focusGroup?.id && SETTINGS_GROUPS.some(([id]) => id === focusGroup.id)) select(focusGroup.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusGroup]);

  // One line under each group name says what is inside it, so the rail can be
  // scanned for a setting rather than opened group by group to find one.
  const hints = {
    account: "Plan, usage and sign-out",
    appearance: "Text size, density and motion",
    terminal: "Font, cursor and scrollback",
    notifications: "What may interrupt you",
    project: "Defaults for this project",
    integrations: "Connected tools live there",
    security: "Credentials and trust",
    diagnostics: "Engine and recovery facts",
    about: "Version and components"
  };
  const icons = {
    account: <><circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 19.5a7.2 7.2 0 0 1 14.4 0"/></>,
    appearance: <><circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/></>,
    terminal: <><rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="m7.5 10 2.5 2-2.5 2"/><path d="M12.5 14.5h4"/></>,
    notifications: <><path d="M18 9.5a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16s-2-1.5-2-6.5Z"/><path d="M13.7 19.5a2 2 0 0 1-3.4 0"/></>,
    project: <path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v7.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z"/>,
    integrations: <><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><path d="M16.5 13.5v6M13.5 16.5h6"/></>,
    security: <><path d="M12 3.5 19 6v5.5c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6Z"/><path d="m9 12 2 2 4-4"/></>,
    diagnostics: <path d="M3.5 12h4l2.5-6 4 12 2.5-6h4"/>,
    about: <><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><path d="M12 7.8h.01"/></>
  };

  return <div className="settings-hub feat-general application-settings-view hub">
    <header className="hub__head"><div className="hub__title"><h1>Settings</h1><p>Preferences for this device. Tools you connect to the project live in Integrations.</p></div></header>
    <div className="hub__body">
    <nav className="hub__rail" aria-label="Settings groups">
      {SETTINGS_GROUPS.map(([id, label]) => <button
        key={id}
        type="button"
        className={`hub__rail-item ${group === id ? "is-current" : ""}`}
        aria-current={group === id ? "page" : undefined}
        onClick={() => choose(id)}
      >
        <span className="hub__rail-icon"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[id]}</svg></span>
        <span className="hub__rail-copy"><strong>{label}</strong><small>{hints[id]}</small></span>
        {id === "integrations" && <b aria-hidden="true">→</b>}
      </button>)}
    </nav>
    <div className="hub__panel">
      <h2 className="sr-only">{SETTINGS_GROUPS.find(([id]) => id === group)?.[1] || "Settings"}</h2>
      {group === "account" && <AccountSettings onConfirm={onConfirm}/>}
      {group === "appearance" && <SettingsView preferences={preferences} onPreference={onPreference}/>}
      {group === "terminal" && <TerminalSettings preferences={preferences} onPreference={onPreference}/>}
      {group === "notifications" && <NotificationSettings/>}
      {group === "project" && <ProjectDefaultSettings workspace={workspace} sessions={sessions} onNavigate={onNavigate} onConfigureAutoStart={onConfigureAutoStart}/>}
      {group === "security" && <SecuritySettings workspace={workspace}/>}
      {group === "diagnostics" && <DiagnosticsSettings state={state} workspace={workspace} recovery={recovery}/>}
      {group === "about" && <AboutSettings state={state} onConfirm={onConfirm}/>}
      {/* Restoring defaults is scoped to the preferences the two preference
          groups own, so it belongs with them and nowhere else. */}
      {(group === "appearance" || group === "terminal") && <SettingsResetFooter preferences={preferences} onReset={onReset}/>}
    </div>
    </div>
  </div>;
}

function AppSidebar({ view, workspace, pendingCount, onNavigate, onProject, onPalette, onMissionAI, onAccount }) {
  // A plan that keeps one project open still lets the first one be chosen;
  // once a project is open, switching wears the crown and explains itself.
  const { status: account } = useAccount();
  const projectLocked = Boolean(workspace?.persistent) && isFeatureLocked(account, "projectSwitching");
  // One letter: two capitals squeezed into the tile read as a code ("FI"), not
  // as the project. Array.from keeps a leading emoji or accent whole.
  const projectMark = (Array.from(String(workspace?.name || "").trim())[0] || "P").toUpperCase();
  const renderNavButton = ([id, label, icon]) => <button key={id} data-nav-id={id} data-tooltip={`${label} · ${NAV_SHORTCUTS[id] || "Open"}`} aria-label={label} aria-current={view === id ? "page" : undefined} className={view === id ? "is-current" : ""} onClick={() => onNavigate(id)} title={`${label} · ${NAV_SHORTCUTS[id]}`}><Icon name={icon} size={17}/><span>{label}</span>{id === "needs" && pendingCount > 0 && <b aria-label={`${pendingCount} items need attention`}>{pendingCount}</b>}</button>;
  return <aside className="app-sidebar" aria-label="Application sidebar">
    <div className="app-sidebar__brand"><button className="top-brand" onClick={() => onNavigate("groundstation")} aria-label="Open Groundstation"><BrandIcon/></button><div><strong><BrandWordmark/></strong><small>Developer cockpit</small></div></div>
    <button className={`top-project${projectLocked ? " is-plan-locked" : ""}`} data-tooltip={`Switch project · ${projectLocked ? "Pro feature" : workspace?.name || "none"}`} onClick={projectLocked ? () => requestUpgrade({ feature: "projectSwitching" }) : onProject} aria-label={projectLocked ? `Project: ${workspace?.name || "none"}. Switching projects needs a paid plan.` : `Switch project. Current project: ${workspace?.name || "none"}`}><span className="top-project__mark" aria-hidden="true">{projectMark}</span><div><small>Project</small><strong>{workspace?.name || "Choose project"}</strong></div><i aria-hidden="true">{projectLocked ? <CrownIcon size={13}/> : <Icon name="selector" size={14}/>}</i></button>
    <nav className="top-navigation" aria-label="OUTARCH navigation">
      {NAVIGATION.slice(0, PRIMARY_NAV_COUNT).map(destination => renderNavButton(destination))}
      <div className="top-navigation__contextual" role="group" aria-label="Configuration">
        {NAVIGATION.slice(PRIMARY_NAV_COUNT).map(destination => renderNavButton(destination))}
      </div>
    </nav>
    <div className="app-sidebar__footer"><SidebarAccountButton onOpen={onAccount}/><button className="top-search" data-tooltip="Mission Command · Ctrl K" onClick={onPalette} aria-label="Search or run a command"><Icon name="search" size={16}/><span>Search commands</span><kbd>Ctrl+K</kbd></button><button className={`top-ai ${view === "mission-ai" ? "is-current" : ""}`} data-tooltip="Mission AI" onClick={onMissionAI} aria-label="Open Mission AI"><span><AiGlyph size={14}/></span><strong>Mission AI</strong></button><span className="app-sidebar__rail-label" aria-hidden="true">OUTARCH</span></div>
  </aside>;
}

function CommandPalette({ open, query, onQuery, items, onChoose, onClose }) {
  const [recentIds, setRecentIds] = React.useState(() => { try { const value = JSON.parse(localStorage.getItem(COMMAND_RECENTS_KEY) || "[]"); return Array.isArray(value) ? value : []; } catch { return []; } });
  const ordered = React.useMemo(() => [...items].sort((left, right) => recentIds.indexOf(left.id) - recentIds.indexOf(right.id)), [items, recentIds]);
  const grouped = React.useMemo(() => {
    const map = new Map();
    for (const item of ordered) {
      const g = item.group || "Other";
      if (!map.has(g)) map.set(g, []);
      map.get(g).push(item);
    }
    return [...map.entries()];
  }, [ordered]);
  const choose = item => { const next = [item.id, ...recentIds.filter(id => id !== item.id)].slice(0,8); setRecentIds(next); try { localStorage.setItem(COMMAND_RECENTS_KEY, JSON.stringify(next)); } catch { /* Command recents are local best effort. */ } onChoose(item); };
  return <Dialog.Root open={open} onOpenChange={value => !value && onClose()}><Dialog.Portal><Dialog.Overlay className="palette-backdrop"/><Dialog.Content className="command-palette" aria-label="Mission Command" aria-describedby={undefined}><Command value={query} onValueChange={onQuery} loop><div className="palette-search"><Icon name="search" size={19}/><Command.Input autoFocus value={query} onValueChange={onQuery} placeholder="Search commands, workers, history, projects…"/><kbd>esc</kbd></div><div className="palette-label">{query ? "BEST MATCHES" : recentIds.length ? "RECENT & AVAILABLE" : "MISSION COMMAND"}</div><Command.List className="palette-results"><Command.Empty className="palette-empty"><strong>No matching command</strong><span>Try a worker name, action, project, or history term.</span></Command.Empty>{grouped.map(([groupName, groupItems]) => <Command.Group key={groupName} heading={groupName} className="palette-group">{groupItems.map(item => <Command.Item key={item.id} value={`${item.label} ${(item.aliases || []).join(" ")} ${item.group}`} onSelect={() => choose(item)}><span className="palette-icon"><Icon name={item.icon || "command"} size={16}/></span><span><strong>{item.label}</strong>{recentIds.includes(item.id) && <small>Recent</small>}</span>{item.shortcut && <kbd>{item.shortcut}</kbd>}</Command.Item>)}</Command.Group>)}</Command.List><footer><span><b>↑↓</b> navigate</span><span><b>↵</b> open</span><span>Fuzzy search · Engine-safe actions only</span></footer></Command></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function ConfirmationDialog({ request, onCancel, onConfirm }) {
  if (!request) return null;
  return <AlertDialog.Root open onOpenChange={value => !value && onCancel()}><AlertDialog.Portal><AlertDialog.Overlay className="palette-backdrop confirmation-backdrop"/><AlertDialog.Content className="confirmation-dialog"><span className="confirmation-mark">!</span><div><span className="section-kicker">CONFIRM OPERATION</span><AlertDialog.Title id="confirmation-title">{request.title}</AlertDialog.Title><AlertDialog.Description id="confirmation-detail">{request.detail}</AlertDialog.Description><small>{request.recovery}</small></div><footer><AlertDialog.Cancel asChild><button>Cancel</button></AlertDialog.Cancel><AlertDialog.Action asChild><button className="danger-confirm" onClick={onConfirm}>{request.confirmLabel}</button></AlertDialog.Action></footer></AlertDialog.Content></AlertDialog.Portal></AlertDialog.Root>;
}

function GroundstationApp() {
  const { state, loading, error, recovery, refresh } = useMissionState();
  const capabilityHandshake = useCapabilities();
  const { toast } = useToast();
  const { status: account } = useAccount();
  const accountRef = React.useRef(account);
  accountRef.current = account;
  const [view, setView] = React.useState("groundstation");
  const [settingsFocus, setSettingsFocus] = React.useState(null);
  const [recoveryBoot, setRecoveryBoot] = React.useState(null);
  React.useEffect(() => {
    let active = true;
    missionApi().request("recovery.inspect")
      .then(report => { if (active && report?.recoveryRequired) setRecoveryBoot(report); })
      .catch(() => {
        // No recovery surface is better than a wrong one; a failure here just
        // means this launch is treated as clean.
      });
    return () => { active = false; };
  }, []);
  const [focusedTerminal, setFocusedTerminal] = React.useState(null);
  const [expandedTerminal, setExpandedTerminal] = React.useState(null);
  const [selectedWorker, setSelectedWorker] = React.useState(null);
  const [workerFocusId, setWorkerFocusId] = React.useState(null);
  const [inspectorOpen, setInspectorOpen] = React.useState(false);
  const setNotice = React.useCallback(value => {
    const message = String(value || "").trim();
    if (!message) return;
    if (/failed|error|unavailable|could not|unable/i.test(message)) toast.danger(message);
    else if (/done|started|added|updated|active|running|acknowledged|copied/i.test(message)) toast.success(message);
    else toast.info(message);
  }, [toast]);
  const [workerDialog, setWorkerDialog] = React.useState(null);
  const [pendingWorkspaceWorker, setPendingWorkspaceWorker] = React.useState(null);
  const [agentAdapters, setAgentAdapters] = React.useState([]);
  const [agentsLoading, setAgentsLoading] = React.useState(false);
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [paletteQuery, setPaletteQuery] = React.useState("");
  const [projects, setProjects] = React.useState(null);
  const [projectsLoading, setProjectsLoading] = React.useState(false);
  const [confirmation, setConfirmation] = React.useState(null);
  const [quickLookId, setQuickLookId] = React.useState(null);
  const [recipesOpen, setRecipesOpen] = React.useState(null); // null | { mode: "create"|"edit"|"duplicate", recipe }
  const [autoStartManagerOpen, setAutoStartManagerOpen] = React.useState(false);
  const [missionGraphOpen, setMissionGraphOpen] = React.useState(false);
  const [missionAiPrompt, setMissionAiPrompt] = React.useState("");
  const missionAiReturnView = React.useRef("groundstation");
  const [helpOpen, setHelpOpen] = React.useState(false);
  const [integrationSection, setIntegrationSection] = React.useState("overview");
  const [terminalAlerts, setTerminalAlerts] = React.useState({});
  const [presetCommands, setPresetCommands] = React.useState([]);
  const initialProjectPrompted = React.useRef(false);
  const mainContentRef = React.useRef(null);
  const previousViewRef = React.useRef(view);
  const [historyCursors, setHistoryCursors] = React.useState(() => { try { const value = JSON.parse(localStorage.getItem(HISTORY_CURSOR_KEY) || "{}"); return value && typeof value === "object" ? value : {}; } catch { return {}; } });
  const sessions = state?.sessions || [];
  const workspace = state?.workspace || null;
  const activity = state?.activity?.events || [];
  const savedCommands = state?.savedCommands || [];
  const reportTerminalAlert = React.useCallback((sessionId, reason) => {
    const id = String(sessionId || "");
    const message = String(reason || "Terminal connection failed").trim().slice(0, 240);
    if (!id || !message) return;
    setTerminalAlerts(current => current[id]?.reason === message ? current : { ...current, [id]: { reason: message, at: Date.now() } });
  }, []);
  const dismissTerminalAlert = React.useCallback(sessionId => {
    setTerminalAlerts(current => {
      if (!current[sessionId]) return current;
      const next = { ...current };
      delete next[sessionId];
      return next;
    });
  }, []);
  const supervisedSessions = React.useMemo(() => sessions.map(session => {
    const alert = terminalAlerts[session.id];
    if (!alert || needsAttention(session)) return session;
    return { ...session, attentionRequired: true, attentionReason: alert.reason, attentionSince: alert.at, rendererAttention: true };
  }), [sessions, terminalAlerts]);
  const attention = supervisedSessions.filter(needsAttention);
  const decisions = useDecisions(terminalAlerts, sessions);
  // The unified decision query is the single source of truth for the count: it
  // excludes no source and never turns a failed load into a zero. Until it first
  // answers, fall back to the always-available session-attention count.
  const pendingCount = decisions.status === "ready" ? decisions.counts.pending : attention.length;
  const selectedSession = supervisedSessions.find(item => item.id === selectedWorker) || null;
  const health = healthFor(supervisedSessions, workspace, decisions);
  const historyProjectKey = workspace?.root || workspace?.name || "default";
  const recipeProjectKey = workspace?.path || workspace?.root || workspace?.name || "default";
  const latestActivitySequence = activity.at(-1)?.sequence || 0;
  const historyCursor = historyCursors[historyProjectKey];
  const unseenActivity = historyCursor === undefined ? [] : activity.filter(event => event.sequence > historyCursor);
  const terminalLayout = useTerminalLayout(workspace, sessions);
  const { preferences, update: updatePreference, reset: resetPreferences } = useInterfacePreferences();
  // T123 — a reset that only restyles applies directly; one that lowers terminal
  // scrollback discards buffered output in every mounted pane, which is the one
  // consequence the user cannot undo, so that case takes the shared ceremony.
  const requestPreferenceReset = React.useCallback(() => {
    const { changed, discardsScrollback } = describePreferenceReset(preferences);
    if (!changed.length) return;
    if (!discardsScrollback) { resetPreferences(); return; }
    setConfirmation({
      title: "Restore default settings?",
      detail: `This changes ${changed.length} setting${changed.length === 1 ? "" : "s"}: ${changed.join(", ")}. Lowering scrollback to ${DEFAULT_INTERFACE_PREFERENCES.terminalScrollback.toLocaleString()} lines discards buffered output already held by mounted terminal panes.`,
      recovery: "Every other setting can be chosen again from this page. Discarded terminal scrollback cannot be recovered.",
      confirmLabel: "Restore defaults",
      run: () => resetPreferences()
    });
  }, [preferences, resetPreferences]);
  const resolveDecision = React.useCallback(async (record, actionId) => {
    const params = { id: record.id, actionId };
    if (record.source === "mission") params.missionId = record.target?.id;
    return ["missionSupervisor", "mission", "mcp", "automation", "mobile"].includes(record.source)
      ? confirmedRequest("decisions.resolve", params)
      : missionApi().request("decisions.resolve", params);
  }, []);
  const missionAiOpen = view === "mission-ai";

  React.useEffect(() => {
    if (!error || !state) return;
    toast.danger(error, { duration: 0 });
  }, [error, state, toast]);
  React.useEffect(() => {
    window.missionControl?.setPendingBadge?.(pendingCount).catch?.(() => {});
  }, [pendingCount]);
  React.useEffect(() => {
    if (!workerDialog || workerDialog.mode === "edit") return;
    let active = true;
    missionApi().request("preset.list").then(value => { if (active) setPresetCommands(Array.isArray(value) ? value : []); }).catch(() => {});
    return () => { active = false; };
  }, [workerDialog]);
  const openMissionAI = React.useCallback((prompt = "") => {
    if (view !== "mission-ai") missionAiReturnView.current = view;
    // Tolerate being used directly as an onClick handler (prompt = the event).
    setMissionAiPrompt(typeof prompt === "string" ? prompt : "");
    setView("mission-ai");
  }, [view]);
  const closeMissionAI = React.useCallback(() => {
    setMissionAiPrompt("");
    setView(missionAiReturnView.current === "mission-ai" ? "groundstation" : missionAiReturnView.current);
  }, []);

  // A selection the operator cleared on purpose (closing the Groundstation
  // inspector, Escape on the manifest) stays cleared; the seed only fills a
  // selection nobody chose yet, so the inspector does not reopen by itself.
  const selectionClearedRef = React.useRef(false);
  const selectWorker = React.useCallback(id => { selectionClearedRef.current = !id; setSelectedWorker(id); }, []);
  React.useEffect(() => { if (!selectedWorker && sessions[0] && !selectionClearedRef.current) setSelectedWorker(sessions[0].id); }, [selectedWorker, sessions]);
  React.useEffect(() => {
    if (previousViewRef.current === view) return undefined;
    previousViewRef.current = view;
    const frame = window.requestAnimationFrame(() => mainContentRef.current?.focus({ preventScroll: true }));
    return () => window.cancelAnimationFrame(frame);
  }, [view]);
  React.useEffect(() => {
    if (!pendingWorkspaceWorker || !sessions.some(session => session.id === pendingWorkspaceWorker)) return;
    const emptySlot = terminalLayout.sessionIds.findIndex(id => !id);
    terminalLayout.setSlotSession(emptySlot >= 0 ? emptySlot : 0, pendingWorkspaceWorker);
    setFocusedTerminal(pendingWorkspaceWorker);
    setSelectedWorker(pendingWorkspaceWorker);
    setView("workspace");
    setPendingWorkspaceWorker(null);
  }, [pendingWorkspaceWorker, sessions, terminalLayout]);
  React.useEffect(() => {
    if (!state || initialProjectPrompted.current) return;
    initialProjectPrompted.current = true;
    if (!workspace?.persistent) setView("projects");
  }, [state, workspace?.persistent]);
  const markHistoryReviewed = React.useCallback(() => { setHistoryCursors(current => { const next = { ...current, [historyProjectKey]: latestActivitySequence }; try { localStorage.setItem(HISTORY_CURSOR_KEY, JSON.stringify(next)); } catch { /* Review cursors are local best effort. */ } return next; }); }, [historyProjectKey, latestActivitySequence]);
  const [broadcastOpen, setBroadcastOpen] = React.useState(false);
  React.useEffect(() => { if (historyCursor === undefined && state) markHistoryReviewed(); }, [historyCursor, markHistoryReviewed, state]);
  React.useEffect(() => { if (view === "history" && historyCursor !== undefined && latestActivitySequence > historyCursor) markHistoryReviewed(); }, [historyCursor, latestActivitySequence, markHistoryReviewed, view]);
  React.useEffect(() => { const onKey = event => { if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "b") { event.preventDefault(); setBroadcastOpen(value => !value); return; } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); if (!missionAiOpen) setPaletteOpen(value => !value); } else if (event.key === "Escape") { if (document.querySelector("[data-radix-popper-content-wrapper],[role='dialog'],[role='alertdialog']")) return; if (broadcastOpen) setBroadcastOpen(false); else if (helpOpen) setHelpOpen(false); else if (paletteOpen) setPaletteOpen(false); else if (missionAiOpen) closeMissionAI(); else if (missionGraphOpen) setMissionGraphOpen(false); else if (workerFocusId) setWorkerFocusId(null); else if (expandedTerminal) setExpandedTerminal(null); else if (inspectorOpen) setInspectorOpen(false); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [broadcastOpen, closeMissionAI, expandedTerminal, helpOpen, inspectorOpen, missionAiOpen, missionGraphOpen, paletteOpen, workerFocusId]);
  React.useEffect(() => { const editable = target => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable; const onKey = event => { if (editable(event.target) || paletteOpen || missionAiOpen || missionGraphOpen) return; if (event.key === "F1" || (event.key === "?" && !event.ctrlKey && !event.metaKey && !event.altKey)) { event.preventDefault(); setHelpOpen(true); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [missionAiOpen, missionGraphOpen, paletteOpen]);
  React.useEffect(() => { const onKey = event => { if (paletteOpen || missionAiOpen || missionGraphOpen || confirmation || workerDialog) return; if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); openCreateWorkerRef.current?.(); return; } if (!event.altKey) return; const destination = { g: "groundstation", w: "workspace", r: "recipes", n: "needs", a: "workspace", h: "history", i: "integrations" }[event.key.toLowerCase()]; if (destination) { event.preventDefault(); if (destination === "integrations") setIntegrationSection("overview"); setView(destination); } }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [confirmation, missionAiOpen, missionGraphOpen, paletteOpen, workerDialog]);
  React.useEffect(() => { const onKey = event => { if (view !== "workspace" || paletteOpen || missionAiOpen || missionGraphOpen || !event.altKey || !/^[1-6]$/.test(event.key)) return; const id = terminalLayout.sessionIds[Number(event.key) - 1]; if (!id || !sessions.some(session => session.id === id)) return; event.preventDefault(); setFocusedTerminal(id); setSelectedWorker(id); }; window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey); }, [missionAiOpen, missionGraphOpen, paletteOpen, sessions, terminalLayout.sessionIds, view]);
  // Directional pane movement and layout cycling. Alt is used throughout the
  // app for navigation, so these compose with the existing Alt 1–6 shortcuts
  // and never collide with terminal input (xterm sees no Alt+Arrow here).
  React.useEffect(() => {
    const onKey = event => {
      if (view !== "workspace" || paletteOpen || missionAiOpen || missionGraphOpen || confirmation || workerDialog || !event.altKey) return;
      const slots = terminalLayout.sessionIds;
      const columns = terminalLayout.layout.cols || 1;
      const current = slots.indexOf(focusedTerminal);
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key];
      if (step !== undefined) {
        const next = (current < 0 ? 0 : current) + step;
        const id = next >= 0 && next < slots.length ? slots[next] : null;
        if (!id || !sessions.some(session => session.id === id)) return;
        event.preventDefault();
        setFocusedTerminal(id);
        setSelectedWorker(id);
        return;
      }
      if (event.key.toLowerCase() === "l") {
        event.preventDefault();
        const order = TERMINAL_LAYOUTS.map(option => option.id);
        const index = order.indexOf(terminalLayout.layout.id);
        terminalLayout.setLayoutId(order[(index + (event.shiftKey ? order.length - 1 : 1)) % order.length]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmation, focusedTerminal, missionAiOpen, missionGraphOpen, paletteOpen, sessions, terminalLayout, view, workerDialog]);
  React.useEffect(() => { const editable = target => target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable; const onDown = event => { if (event.code !== "Space" || event.repeat || editable(event.target) || view !== "groundstation" || paletteOpen || missionAiOpen || missionGraphOpen || confirmation || workerFocusId || !selectedWorker) return; event.preventDefault(); setQuickLookId(selectedWorker); }; const onUp = event => { if (event.code === "Space") setQuickLookId(null); }; window.addEventListener("keydown", onDown); window.addEventListener("keyup", onUp); return () => { window.removeEventListener("keydown", onDown); window.removeEventListener("keyup", onUp); }; }, [confirmation, missionAiOpen, missionGraphOpen, paletteOpen, selectedWorker, view, workerFocusId]);
  React.useEffect(() => { if ((view === "agents" || paletteOpen) && !agentAdapters.length) { setAgentsLoading(true); missionApi().request("agents.list").then(value => setAgentAdapters(Array.isArray(value) ? value : [])).catch(value => setNotice(value.message || String(value))).finally(() => setAgentsLoading(false)); } }, [agentAdapters.length, paletteOpen, view]);
  React.useEffect(() => { if (view !== "projects") return; setProjectsLoading(true); missionApi().request("projects.list").then(setProjects).catch(value => setNotice(value.message || String(value))).finally(() => setProjectsLoading(false)); }, [view]);
  // Per-source pending-count polling and subscriptions were removed here: Needs You
  // now reads one `decisions.list` (see useDecisions) which the engine builds from
  // all of these sources and refreshes on the same events.

  // What you did yourself is confirmed quietly: one compact toast that says
  // which worker, changes in place when the engine answers, never rings and
  // never reaches Windows. It replaced a "Working…" toast followed by a
  // separate "Done" that named nothing.
  const sessionsRef = React.useRef(sessions);
  sessionsRef.current = sessions;
  const focusWorkerRef = React.useRef(null);
  // The problem notices still on screen, by worker. Acknowledging a worker's
  // alert takes them down with it: a toast about an error you have just
  // acknowledged is the same interruption a second time.
  const problemNoticesRef = React.useRef(new Map());
  // An agent's permission questions still on screen, by worker. Typing into
  // that terminal answers them, and the main process says so.
  const promptNoticesRef = React.useRef(new Map());
  React.useEffect(() => {
    let unsubscribe = () => {};
    try {
      unsubscribe = missionApi().subscribe(message => {
        if (message?.type !== "agent:prompt-cleared" || !message.workerId) return;
        for (const noticeId of promptNoticesRef.current.get(message.workerId) || []) toast.dismiss(noticeId);
        promptNoticesRef.current.delete(message.workerId);
      });
    } catch { /* without the bridge there is nothing to observe */ }
    return () => { try { unsubscribe?.(); } catch { /* already torn down */ } };
  }, [toast]);
  const executeAction = React.useCallback(async (type, id, fields = {}) => {
    const name = sessionsRef.current.find(item => item.id === id)?.name || id;
    const words = ACTION_FEEDBACK[type] || null;
    const pending = words ? toast.progress(`${words.pending} ${name}…`) : null;
    try {
      const params = { sessionId: id, action: { type, ...fields } };
      const result = ["kill", "remove"].includes(type) ? await confirmedRequest("action.dispatch", params) : await missionApi().request("action.dispatch", params);
      if (result?.ok === false) throw new Error(result.error || "Action failed");
      if (pending) pending.succeed(`${name} ${words.done}`);
      if (type === "acknowledge") {
        for (const noticeId of problemNoticesRef.current.get(id) || []) toast.dismiss(noticeId);
        problemNoticesRef.current.delete(id);
      }
      await refresh();
    } catch (value) {
      if (value?.code === "PLAN_REQUIRED") { pending?.cancel(); return; }
      const reason = value?.message || String(value);
      if (!pending) { setNotice(reason); return; }
      pending.fail(reason, {
        title: `${name} ${words.failed}`,
        source: name,
        actions: [
          ...(type === "remove" ? [] : [{ label: "Try again", run: () => void executeActionRef.current?.(type, id, fields) }]),
          { label: "Open terminal", run: () => focusWorkerRef.current?.(id) }
        ]
      });
    }
  }, [refresh, toast, setNotice]);
  const executeActionRef = React.useRef(executeAction);
  executeActionRef.current = executeAction;
  const terminalLimit = planLimits(account)?.terminals;
  const openCreateWorker = React.useCallback((extra = {}) => {
    const count = sessionsRef.current.length;
    if (terminalLimit != null && count >= terminalLimit) {
      requestUpgrade({ feature: "terminals", amount: count + 1, message: `Your plan includes ${terminalLimit} terminal${terminalLimit === 1 ? "" : "s"}.` });
      return;
    }
    setWorkerDialog({ mode: "create", ...extra });
  }, [terminalLimit]);
  const openCreateWorkerRef = React.useRef(openCreateWorker);
  openCreateWorkerRef.current = openCreateWorker;
  const dispatch = React.useCallback(async (type, id, fields = {}, confirmOverride = null) => { const target = sessions.find(item => item.id === id); if (["kill", "remove"].includes(type)) { setConfirmation({ title: confirmOverride?.title || (type === "kill" ? `Stop ${target?.name || id}?` : `Remove ${target?.name || id}?`), detail: confirmOverride?.detail || (type === "kill" ? "The engine will stop this worker and its active PTY." : "The worker definition will be removed from this workspace."), recovery: type === "kill" ? "You can start this worker again later." : "Removal may require recreating the worker configuration.", confirmLabel: type === "kill" ? "Stop worker" : "Remove worker", run: () => executeAction(type, id, fields) }); return; } await executeAction(type, id, fields); }, [executeAction, sessions]);
  const executeBulk = React.useCallback(async (type, targets) => {
    if (!targets.length) return;
    const count = `${targets.length} worker${targets.length === 1 ? "" : "s"}`;
    const pending = toast.progress(`${type === "start" ? "Starting" : "Stopping"} ${count}…`);
    const results = await Promise.all(targets.map(async session => {
      try {
        const params = { sessionId: session.id, action: { type } };
        if (type === "kill") await confirmedRequest("action.dispatch", params); else await missionApi().request("action.dispatch", params);
        return null;
      } catch (error) {
        return `${session.name}: ${error.message || String(error)}`;
      }
    }));
    await refresh();
    const failures = results.filter(Boolean);
    if (!failures.length) pending.succeed(`${count} ${type === "start" ? "started" : "stopped"}`);
    else pending.fail(failures.slice(0, 3).join(" · "), { title: `${targets.length - failures.length} of ${targets.length} workers ${type === "start" ? "started" : "stopped"}` });
  }, [refresh, toast]);
  // Each worker's policy is saved on its own, so one refusal must not hide the
  // others' outcome: every result is read, and the notice says how many landed.
  const batchSetAutoStart = React.useCallback(async updates => {
    if (!updates.length) return;
    setNotice(`Saving the launch policy for ${updates.length} worker${updates.length === 1 ? "" : "s"}…`);
    const failures = (await Promise.all(updates.map(async update => {
      try {
        const result = await missionApi().request("action.dispatch", { sessionId: update.id, action: { type: "setAutoStart", enabled: update.enabled } });
        return result?.ok === false ? result.error || "not saved" : null;
      } catch (error) {
        return error.message || String(error);
      }
    }))).filter(Boolean);
    await refresh();
    setNotice(failures.length ? `${updates.length - failures.length} of ${updates.length} saved · ${failures[0]}` : "Launch policy saved");
  }, [refresh]);
  const startWorkspace = React.useCallback(() => executeBulk("start", sessions.filter(session => !session.isAlive)), [executeBulk, sessions]);
  const stopWorkspace = React.useCallback(() => { const running = sessions.filter(session => session.isAlive); if (!running.length) return; setConfirmation({ title: `Stop ${running.length} running workers?`, detail: "OUTARCH will request a clean stop for every active engine-owned PTY in this workspace.", recovery: "Workers remain configured and can be started together again.", confirmLabel: "Stop workspace", run: () => executeBulk("kill", running) }); }, [executeBulk, sessions]);
  // T084 — one mental model: Recipes is a place, and the builder is an action
  // taken there. Previously "Recipes" meant the page from the sidebar and the
  // command palette, but a bare create dialog from Workspace, the mission graph
  // and onboarding — so closing it returned you somewhere unrelated and the
  // saved recipes you had just created were nowhere in sight. Every builder
  // entry now lands on the Recipes page with the dialog on top of it, so
  // dismissing the dialog always leaves you where the recipes are.
  const openRecipeBuilder = React.useCallback((recipe, mode = "create") => {
    // Tolerate being used directly as an onClick handler (recipe would be the event).
    const valid = recipe && typeof recipe === "object" && typeof recipe.id === "string";
    setView("recipes");
    const resolved = valid && (mode === "edit" || mode === "duplicate") ? mode : "create";
    const open = () => setRecipesOpen({ mode: resolved, recipe: valid ? recipe : null });
    // The plan is checked before the builder opens, not after the recipe is
    // written: an ended trial, or a new recipe past the plan's count, explains
    // itself here instead of refusing the save.
    const limits = planLimits(accountRef.current);
    if (!limits) return open();
    const trial = recipeTrial(accountRef.current);
    if (trial.limited && !trial.active) return requestUpgrade({ feature: "recipeTrial" });
    if (resolved === "edit" || limits.recipes == null) return open();
    void missionApi().request("recipe.list").then(list => {
      const count = Array.isArray(list) ? list.length : 0;
      if (count >= limits.recipes) requestUpgrade({ feature: "recipes", amount: count + 1, message: `Your plan includes ${limits.recipes} recipe${limits.recipes === 1 ? "" : "s"}.` });
      else open();
    }).catch(open);
    return undefined;
  }, []);
  // Generic "Recipes" affordances navigate; they do not assume you want to
  // create something. Only an explicitly creational control opens the builder.
  const goToRecipes = React.useCallback(() => setView("recipes"), []);
  const runRecipeAction = React.useCallback(async (method, recipeId) => {
    try { await missionApi().request(method, { recipeId }); await refresh(); }
    catch (error) { setNotice(error.message || String(error)); }
  }, [refresh]);
  const deleteRecipe = React.useCallback(recipe => {
    setConfirmation({
      title: `Delete ${recipe.name}?`,
      detail: "The recipe definition is removed from this project. Workers it references are not affected.",
      recovery: "You will need to rebuild the recipe to launch this setup again.",
      confirmLabel: "Delete recipe",
      run: async () => {
        try { await confirmedRequest("recipe.delete", { recipeId: recipe.id }); await refresh(); setNotice(`${recipe.name} was deleted`); }
        catch (error) { setNotice(error.message || String(error)); }
      }
    });
  }, [refresh]);
  const launchRecipe = React.useCallback(async (recipe, options = {}) => {
    terminalLayout.applyLayout({ layoutId: recipe.layoutId, sessionIds: recipe.sessionIds });
    setRecipesOpen(null);
    setView("workspace");
    setNotice(`Launching ${recipe.name} through the engine…`);
    try { await missionApi().request("recipe.run", { recipeId: recipe.id, recover: options.recover === true }); await refresh(); setNotice(options.recover ? `${recipe.name} recovery run started` : `${recipe.name} is running with parallel readiness gates`); }
    catch (error) { setNotice(error.message || String(error)); }
  }, [refresh, terminalLayout]);
  const focusWorker = React.useCallback(id => { setFocusedTerminal(id); setSelectedWorker(id); if (!terminalLayout.sessionIds.includes(id)) terminalLayout.setSlotSession(0, id); setView("workspace"); }, [terminalLayout]);
  focusWorkerRef.current = focusWorker;
  const inspectWorker = React.useCallback(id => { setSelectedWorker(id); if (id.startsWith("agent-")) { setView("agents"); return; } setWorkerFocusId(id); }, []);
  // T068 — one router for every "take me to the thing this decision is about".
  // The engine supplies the destination on the record, so a new decision source
  // gets working navigation without the renderer learning anything about it.
  // A workspace destination is offered as "Open terminal", so it opens one.
  // Sending it to the evidence dialog instead made the button a second,
  // differently-worded copy of the card's own "Inspect evidence" action: two
  // controls, one destination, and a label that promised something else.
  const openDecisionSource = React.useCallback(record => {
    const link = record?.deepLink;
    if (!link?.view) return;
    if (link.view === "workspace" && link.params?.focus) { focusWorker(link.params.focus); return; }
    if (link.view === "agents" && link.params?.focus) { setSelectedWorker(link.params.focus); setView("agents"); return; }
    if (link.view === "integrations") { setIntegrationSection(link.params?.section || "overview"); setView("integrations"); return; }
    setView(link.view);
  }, [focusWorker]);

  // T036 — a native notification click arrives on the event channel as a deep
  // link. It routes to Needs You and selects the worker it was raised for, so
  // the interruption lands on the decision instead of the last screen you left
  // open. A storm summary carries no session, so it opens the queue itself.
  React.useEffect(() => {
    let unsubscribe = () => {};
    try {
      unsubscribe = missionApi().subscribe(message => {
        if (message?.type !== "notification:activate") return;
        // A Windows toast button finishes its job here: "Open terminal" lands
        // on the terminal, not merely on the window.
        if (message.actionId === "install-update") {
          const updates = window.missionControl?.updates;
          if (updates) void Promise.resolve(updates.status()).then(status => confirmUpdate({ api: updates, status, onConfirm: setConfirmation })).catch(() => {});
          return;
        }
        if (message.actionId === "focus-worker" && message.sessionId) {
          focusWorkerRef.current?.(message.sessionId);
          return;
        }
        setView(message.route === "needs" ? "needs" : message.route || "needs");
        if (message.sessionId) setSelectedWorker(message.sessionId);
      });
    } catch { /* the deep link is a convenience; the queue is still reachable */ }
    return () => { try { unsubscribe?.(); } catch { /* already torn down */ } };
  }, []);
  /* Operational events, in the app.
     The intelligence layer has always detected these — a dev server accepting
     connections, a build failing, an agent finishing a turn — and turned them
     into an OS toast. Inside the app they went nowhere: the address a worker
     had just started serving on was only reachable by opening a collapsed
     panel and reading a row. They are notifications now, and each carries the
     one action worth taking from it.

     Readiness is verified, never claimed: `service.ready` is only published
     after the port actually accepted a connection, so "Open" cannot offer a
     dev server that never came up. The address is re-resolved from the
     registry by `services.open` at click time, which is why the action sends
     the service id rather than the URL it was rendered with. */
  // The subscription below outlives any one render; the latest dispatch is
  // read through a ref so Restart and Stop act on the current worker list
  // without re-subscribing every time a session changes.
  const dispatchRef = React.useRef(dispatch);
  dispatchRef.current = dispatch;
  React.useEffect(() => {
    let unsubscribe = () => {};
    const copyService = async (serviceId, generation) => {
      try {
        const result = await missionApi().request("services.copy", { serviceId, expectedGeneration: generation });
        await copyText(result.url);
        toast.success(`Copied ${result.url}`, { compact: true, duration: 2200 });
      } catch (error) {
        toast.danger(error?.message || "Could not copy that address");
      }
    };
    const whoHoldsPort = async (port, worker) => {
      try {
        const result = await missionApi().request("crashlens.port.inspect", { port });
        const owner = result?.owners?.[0];
        toast.info(result?.summary || `Port ${port} could not be inspected.`, owner?.owned && owner.sessionId
          ? { title: `Who is using port ${port}`, actions: [{ label: `Stop ${owner.sessionName}`, tone: "danger", run: () => void dispatchRef.current("kill", owner.sessionId) }, { label: `Restart ${worker.name}`, run: () => void dispatchRef.current("restart", worker.id) }] }
          : { title: `Who is using port ${port}`, remember: true, duration: 12000 });
      } catch (error) {
        toast.danger(error?.message || `Port ${port} could not be inspected`);
      }
    };
    const openService = async (serviceId, generation) => {
      try {
        await missionApi().request("services.open", { serviceId, expectedGeneration: generation });
        setView("workspace");
      } catch (error) {
        // A worker that restarted since the toast appeared invalidates the
        // address, and the Protocol says so rather than opening the wrong one.
        toast.danger(error?.message || String(error));
      }
    };
    // Each action a notice can carry, run from the toast or from the list.
    const runNoticeAction = (notice, actionId) => {
      const data = notice.data || {};
      if (actionId === "open-service") return void openService(data.serviceId, data.generation);
      if (actionId === "copy-url") return void copyService(data.serviceId, data.generation);
      if (actionId === "restart" && notice.workerId) return void dispatchRef.current("restart", notice.workerId);
      if (actionId === "stop" && notice.workerId) return void dispatchRef.current("kill", notice.workerId);
      if (actionId === "focus-worker" && notice.workerId) return focusWorker(notice.workerId);
      if (actionId === "inspect-port" && data.port) return void whoHoldsPort(data.port, { id: notice.workerId, name: notice.workerName || "the worker" });
      if (actionId === "review") return setView("needs");
      if (actionId === "open-recipes") return setView("recipes");
      if (actionId === "install-update") {
        const updates = window.missionControl?.updates;
        if (updates) void Promise.resolve(updates.status()).then(status => confirmUpdate({ api: updates, status, onConfirm: setConfirmation })).catch(() => {});
        return undefined;
      }
      return undefined;
    };
    const TOAST_TYPE = { critical: "danger", warning: "warning", success: "success", info: "info" };
    // How long a notice stays on screen. A failure stays until it is dealt
    // with; the rest leave on their own, and every one is still in the list.
    const TOAST_DURATION = { critical: 0, warning: 20000, success: 12000, info: 9000 };
    const PROBLEM_KINDS = new Set(["worker.error", "attention.needed", "worker.crashed", "worker.spawnFailed", "build.failed", "port.conflict"]);
    try {
      unsubscribe = missionApi().subscribe(message => {
        if (message?.type !== "notification:new" || !message.notification?.id) return;
        const notice = message.notification;
        const delivery = notice.delivery || {};
        const type = TOAST_TYPE[notice.tone] || "info";
        if (notice.workerId && notice.kind === "agent.awaitingApproval") {
          const ids = promptNoticesRef.current.get(notice.workerId) || new Set();
          ids.add(notice.id);
          if (ids.size > 4) ids.delete(ids.values().next().value);
          promptNoticesRef.current.set(notice.workerId, ids);
        }
        if (notice.workerId && PROBLEM_KINDS.has(notice.kind)) {
          const ids = problemNoticesRef.current.get(notice.workerId) || new Set();
          ids.add(notice.id);
          // Bounded: only the recent ones can still be on screen.
          if (ids.size > 8) ids.delete(ids.values().next().value);
          problemNoticesRef.current.set(notice.workerId, ids);
        }
        const options = {
          id: notice.id,
          title: notice.title,
          source: notice.workerName || "",
          remember: true,
          duration: delivery.test ? 8000 : notice.kind === "agent.awaitingApproval" ? 0 : TOAST_DURATION[notice.tone],
          // The tile says what kind of notice it is: a bell for an agent waiting
          // on an answer, a shield for a verified update.
          icon: notice.kind === "agent.awaitingApproval" ? "bell" : notice.kind === "update.available" ? "shield" : undefined,
          // The center decided whether this rings; a Windows toast plays its
          // own sound, so the app rings only when it is the one showing it.
          sound: delivery.soundBy === "app" ? delivery.sound : null,
          actions: (notice.actions || []).map(action => ({
            label: action.label,
            tone: action.id === "stop" ? "danger" : undefined,
            keepOpen: action.id === "copy-url" || action.id === "inspect-port",
            run: () => runNoticeAction(notice, action.id)
          }))
        };
        // A burst beyond what the stack should show goes straight to the list,
        // and one line says so.
        if (delivery.collapsed) {
          toast.remember(type, notice.body, options);
          toast.info("More notifications arrived. They are in the notification list.", { id: "notification-overflow", compact: true, duration: 6000, remember: false });
          return;
        }
        toast[type](notice.body, options);
      });
    } catch { /* without the bridge there is nothing to observe */ }
    return () => { try { unsubscribe?.(); } catch { /* already torn down */ } };
  }, [focusWorker, toast]);
  // The two-field create is a "Start" button, so it starts the terminal now.
  // The definition's autoStart is only the launch policy — whether it starts
  // again the next time this project opens — and a new terminal is manual by
  // default. A start that fails is reported rather than thrown: the worker
  // exists by then, and a retry from the dialog would create a second one.
  const saveWorker = React.useCallback(async (value, options = {}) => {
    const editing = workerDialog?.mode === "edit";
    const result = await missionApi().request("action.dispatch", { sessionId: editing ? workerDialog.configuration.id : null, action: editing ? { type: "reconfigure", patch: value } : { type: "create", definition: value } });
    if (result?.ok === false) throw new Error(result.error || "Worker save failed");
    let startError = null;
    if (!editing && options.start === true && value.autoStart !== true) {
      try {
        const started = await missionApi().request("action.dispatch", { sessionId: value.id, action: { type: "start" } });
        if (started?.ok === false) startError = started.error || "it could not be started";
      } catch (error) {
        startError = error.message || String(error);
      }
    }
    if (!editing) setPendingWorkspaceWorker(value.id);
    await refresh();
    setNotice(editing ? "Worker updated" : startError ? `${value.name} added to the terminal workspace, but ${startError}` : `${value.name} added to the terminal workspace`);
  }, [refresh, workerDialog]);
  const instantiateSavedCommand = React.useCallback(async commandId => { await missionApi().request("action.dispatch", { sessionId: null, action: { type: "instantiateSavedCommand", commandId } }); await refresh(); }, [refresh]);
  const createAgent = React.useCallback(async adapterId => { let createdSessionId = null; setAgentsLoading(true); setNotice(`Checking ${adapterId} CLI…`); try { const result = await missionApi().request("agent.create", { adapterId }); if (!result?.sessionId) throw new Error("Agent worker was created without a session ID"); createdSessionId = result.sessionId; setSelectedWorker(createdSessionId); setNotice(`Starting ${adapterId}…`); const started = await missionApi().request("action.dispatch", { sessionId: createdSessionId, action: { type: "start" } }); if (started?.ok === false) throw new Error(started.error || "Agent CLI could not be started"); await refresh(); setNotice(`${adapterId} is running under OUTARCH supervision`); } catch (value) { await refresh(); if (createdSessionId) setSelectedWorker(createdSessionId); setNotice(createdSessionId ? `${adapterId} was added but could not start: ${value.message || String(value)}` : value.message || String(value)); } finally { setAgentsLoading(false); } }, [refresh]);
  const executeProjectOpen = React.useCallback(async project => { setProjectsLoading(true); try { await confirmedRequest("project.open", { projectId: project.id }); await refresh(); setView("groundstation"); } catch (value) { setNotice(value.message || String(value)); } finally { setProjectsLoading(false); } }, [refresh]);
  const openProject = React.useCallback(async project => { setConfirmation({ title: `Switch to ${project.name}?`, detail: "OUTARCH will safely stop running workers before changing projects.", recovery: "If the new project cannot open, the project coordinator will attempt recovery.", confirmLabel: "Switch project", run: () => executeProjectOpen(project) }); }, [executeProjectOpen]);
  const chooseProject = React.useCallback(async () => {
    setProjectsLoading(true);
    try {
      const selection = await missionApi().request("project.choose");
      if (selection?.cancelled) return;
      const token = selection.selectionToken;
      const project = selection.project;
      setNotice(`Opening ${project.name}…`);
      if (project.status === "uninitialized") {
        await confirmedRequest("project.initialize", { selectionToken: token, name: project.name });
      } else if (["ready", "warning"].includes(project.status)) {
        await confirmedRequest("project.open", { selectionToken: token });
      } else {
        throw new Error(project.error || "The selected folder cannot be opened as a project");
      }
      await refresh();
      selectionClearedRef.current = false;
      setSelectedWorker(null);
      setFocusedTerminal(null);
      setView("groundstation");
      setNotice(`${project.name} is active · terminals and agents now use this folder`);
    } catch (value) { setNotice(value.message || String(value)); }
    finally { setProjectsLoading(false); }
  }, [refresh]);

  const paletteItems = React.useMemo(() => [
    ...NAVIGATION.map(([id,label,icon]) => ({ id: `nav-${id}`, label, group: "Navigate", icon, aliases: NAV_ALIASES[id] || [], run: () => { if (id === "integrations") setIntegrationSection("overview"); setView(id); } })),
    ...SECONDARY_DESTINATIONS.map(([id,label,icon]) => ({ id: `nav-${id}`, label, group: "Application", icon, aliases: NAV_ALIASES[id] || [], run: () => setView(id) })),
    ...(selectedSession ? [{ id: "context-open", label: selectedSession.id.startsWith("agent-") ? `Review ${selectedSession.name}` : `Inspect ${selectedSession.name}`, group: "Selected worker", icon: selectedSession.id.startsWith("agent-") ? "agents" : "terminal", aliases: ["focus","quick look","details","history","summary"], run: () => inspectWorker(selectedSession.id) }] : []),
    ...(selectedSession?.attentionRequired ? [{ id: "context-acknowledge", label: `Acknowledge ${selectedSession.name} alert`, group: "Selected worker", icon: "attention", run: () => dispatch("acknowledge", selectedSession.id) }] : []),
    { id: "new-worker", label: "Add a new worker", group: "Action", icon: "plus", shortcut: "N", run: () => openCreateWorker() },
    { id: "account-plan", label: "Account and plan", group: "Navigate", icon: "settings", aliases: ["plan", "subscription", "upgrade", "billing", "sign out", "logout", "pro", "ultimate"], run: () => { setSettingsFocus({ id: "account", at: Date.now() }); setView("settings"); } },
    { id: "check-updates", label: "Check for updates", group: "Action", icon: "command", aliases: ["update", "upgrade version", "new version", "release"], run: () => { setSettingsFocus({ id: "about", at: Date.now() }); setView("settings"); void window.missionControl?.updates?.check?.(); } },
    { id: "autostart-manager", label: "Choose which terminals start with the workspace", group: "Workspace action", icon: "grid", aliases: ["autostart","auto-start","startup","boot","launch policy","on open","start with workspace"], run: () => setAutoStartManagerOpen(true) },
    { id: "mission-ai", label: "Open Mission AI", group: "Project intelligence", icon: "agents", aliases: ["gemini","what is happening","what is broken","what needs me","summary"], run: () => openMissionAI() },
    { id: "settings-mcp", label: "Open Secure MCP Gateway", group: "Integrations", icon: "command", aliases: ["claude","chatgpt","external ai","token","gateway"], run: () => { setIntegrationSection("mcp"); setView("integrations"); } },
    { id: "settings-mobile", label: "Open Mobile Companion", group: "Integrations", icon: "attention", aliases: ["android","phone","pairing","lan"], run: () => { setIntegrationSection("companion"); setView("integrations"); } },
    { id: "mission-graph", label: "Open Mission Graph", group: "Workspace action", icon: "grid", aliases: ["dependencies","startup graph","relationships","impact"], run: () => setMissionGraphOpen(true) },
    { id: "workspace-recipes", label: "Open workspace recipes", group: "Workspace action", icon: "grid", aliases: ["saved layout","startup set","launch stack"], run: () => setView("recipes") },
    ...(sessions.some(item => !item.isAlive) ? [{ id: "start-workspace", label: "Start all idle workers", group: "Workspace action", icon: "play", aliases: ["launch","boot","daily workspace"], run: startWorkspace }] : []),
    ...(sessions.some(item => item.isAlive) ? [{ id: "stop-workspace", label: "Stop all running workers", group: "Workspace action", icon: "attention", aliases: ["pause","shutdown","stop workspace"], run: stopWorkspace }] : []),
    ...sessions.filter(item => item.isAlive).map(item => ({ id: `restart-${item.id}`, label: `Restart ${item.name}`, group: "Worker action", icon: "pulse", run: () => dispatch("restart", item.id) })),
    ...sessions.map(item => ({ id: `worker-${item.id}`, label: item.name, group: `${item.status} worker`, icon: "terminal", run: () => focusWorker(item.id) })),
    ...activity.slice(-5).reverse().map(item => ({ id: `event-${item.sequence}`, label: eventTitle(item), group: "Recent history", icon: "history", run: () => setView("history") }))
  ], [activity, dispatch, focusWorker, inspectWorker, openMissionAI, selectedSession, sessions, startWorkspace, stopWorkspace]);

  // The native window controls take the colour the status tape paints, once
  // the shell is on screen and whenever the theme could have changed it.
  const shellReady = Boolean(state);
  React.useEffect(() => {
    if (!shellReady) return undefined;
    const frame = window.requestAnimationFrame(() => syncWindowChrome());
    return () => window.cancelAnimationFrame(frame);
  }, [shellReady, preferences.theme]);
  if (loading && !state) return <div className="boot-screen" role="status"><BrandWordmark large className="boot-wordmark"/><span className="boot-progress" aria-hidden="true"><i/></span><p>Bringing your workspace online</p></div>;
  if (error && !state) return <div className="boot-screen boot-error" role="alert"><BrandWordmark large className="boot-wordmark"/><h1>The workspace engine is not responding</h1><p>{error}</p><button className="primary-button" onClick={refresh}>Reconnect</button></div>;

  const renderView = () => {
    if (view === "groundstation") return <LiveGroundstationView sessions={supervisedSessions} workspace={workspace} activity={activity} unseenActivity={unseenActivity} selectedId={selectedWorker} onSelect={selectWorker} onFocus={inspectWorker} onAction={dispatch} onNavigate={setView} onDismissActivity={markHistoryReviewed} onRecipes={goToRecipes} onCreateRecipe={() => openRecipeBuilder()} onLaunchRecipe={launchRecipe} onAddWorker={() => openCreateWorker()} onAskAI={prompt => openMissionAI(prompt)} onMissionGraph={() => setMissionGraphOpen(true)} onOpenDecisionSource={openDecisionSource} decisionCount={decisions.status === "ready" ? decisions.counts.pending : undefined} decisions={decisions}/>;
    if (view === "mission-ai") return <MissionAIScreen initialPrompt={missionAiPrompt} onConfirm={setConfirmation}/>;
    if (view === "workspace") return <WorkspaceView needsCount={pendingCount} onReviewNeeds={() => setView("needs")} sessions={sessions} workspaceKey={recipeProjectKey} terminalLayout={terminalLayout} focusedId={focusedTerminal} expandedId={expandedTerminal} inspectorOpen={inspectorOpen} terminalPreferences={preferences} onInspector={() => setInspectorOpen(value => !value)} onFocus={setFocusedTerminal} onExpand={setExpandedTerminal} onAction={dispatch} onStartWorkspace={startWorkspace} onStopWorkspace={stopWorkspace} onRecipes={goToRecipes} onMissionGraph={() => setMissionGraphOpen(true)} onAddWorker={() => openCreateWorker()} onReconfigure={session => setWorkerDialog({ mode: "edit", configuration: session })} onDuplicate={session => openCreateWorker({ seed: { ...session, id: `${session.id}-copy`, name: `${session.name} copy` } })} onTerminalError={reportTerminalAlert} onTerminalRecovered={dismissTerminalAlert} onAskAI={prompt => openMissionAI(prompt)} onConfirm={setConfirmation}/>;
    if (view === "recipes") return <RecipesView sessions={sessions} onManage={openRecipeBuilder} onLaunch={launchRecipe} onDelete={deleteRecipe} onRunAction={runRecipeAction} onAskAI={() => openMissionAI("Design a practical OUTARCH recipe (a repeatable workspace launch) for this project. Propose the backend, frontend, tests, Git, database, container, and agent terminals that are useful; define safe startup dependencies and readiness checks. Present the complete recipe design in Markdown and ask for my approval ('Does this recipe design look good?'). Do NOT build, start, or run any recipe or workers yet until I explicitly approve the design.")}/>;
    if (view === "needs") return <NeedsView decisionRecords={decisions.records} decisionsStatus={decisions.status} decisionSources={decisions.sources} decisionsComplete={decisions.complete} onDecisionsRefresh={decisions.refresh} onResolveDecision={resolveDecision} onAcknowledgeDecision={decisions.acknowledge} onAction={dispatch} onFocus={inspectWorker} onOpenTerminal={focusWorker} onDismissTerminalAlert={dismissTerminalAlert} onConfirm={setConfirmation} onOpenSource={openDecisionSource}/>;
    if (view === "agents") return <AgentWorkspace sessions={sessions} activity={activity} adapters={agentAdapters} loading={agentsLoading} selectedId={selectedWorker} onSelect={setSelectedWorker} onCreate={createAgent} onAction={dispatch} onOpenTerminal={focusWorker} onConfirm={setConfirmation} decisionRecords={decisions.records} onOpenDecision={openDecisionSource} onNavigate={setView} onAskAI={prompt => openMissionAI(prompt)}/>;
    if (view === "history") return <HistoryView events={activity} onFocus={inspectWorker} onAskAI={prompt => openMissionAI(prompt)} projectKey={historyProjectKey}/>;
    if (view === "integrations") return <IntegrationHubView workspace={workspace} section={integrationSection} onSection={setIntegrationSection} onAskAI={() => openMissionAI()} capabilityHandshake={capabilityHandshake}>
      {integrationSection === "intelligence" && <MissionAISettings onOpen={() => openMissionAI()} onConfirm={setConfirmation}/>}
      {integrationSection === "vscode" && (isFeatureLocked(account, "vscodeBridge")
        ? <PlanLockPanel feature="vscodeBridge" title="VS Code bridge" description="Bring the file you are editing, its diagnostics and your Git state into OUTARCH, and manage VS Code terminals from here."/>
        : <VSCodeBridgeSettings workspace={workspace} onConfirm={setConfirmation}/>)}
      {integrationSection === "mcp" && (isFeatureLocked(account, "mcp")
        ? <PlanLockPanel feature="mcp" title="Secure MCP gateway" description="Let Claude Code, Codex and other AI tools on this computer read your workspace, workers, history and Needs You through one authenticated local gateway."/>
        : <>{isFeatureLocked(account, "mcpActions") ? <PlanLockPanel feature="mcpActions" title="AI tools can read, not act" description="Your plan gives AI tools read-only access. Starting, stopping and typing into terminals from an AI tool, always with your approval, is part of the next plan."/> : null}<McpGatewaySettings workspace={workspace} onConfirm={setConfirmation}/></>)}
      {integrationSection === "companion" && (isFeatureLocked(account, "mobileCompanion")
        ? <PlanLockPanel feature="mobileCompanion" title="Mobile companion" description="Pair your phone to watch your terminals, answer approvals and ask Mission AI while you are away from your desk. Every message is encrypted end to end."/>
        : <MobileCompanionSettings workspace={workspace} onConfirm={setConfirmation}/>)}
    </IntegrationHubView>;
    if (view === "projects") return <ProjectsView data={projects} loading={projectsLoading} onChoose={chooseProject} onOpen={openProject} onRemove={async project => { await missionApi().request("project.removeRecent", { projectId: project.id }); setProjects(await missionApi().request("projects.list")); }}/>;
    return <SettingsHub state={state} workspace={workspace} recovery={recovery} sessions={supervisedSessions} preferences={preferences} onPreference={updatePreference} onReset={requestPreferenceReset} onNavigate={setView} onOpenIntegrations={() => { setIntegrationSection("overview"); setView("integrations"); }} onConfigureAutoStart={() => setAutoStartManagerOpen(true)} onConfirm={setConfirmation} focusGroup={settingsFocus}/>;
  };

  return <div className={`shell theme-${preferences.theme} type-${preferences.typeScale} density-${preferences.density} motion-${preferences.motion} ${preferences.showCommandHints ? "show-command-hints" : "hide-command-hints"}`}>
      <a className="skip-link" href="#main-content">Skip to workspace content</a>
      <AppSidebar view={view} workspace={workspace} pendingCount={pendingCount} onNavigate={destination => { if (destination === "integrations") setIntegrationSection("overview"); setView(destination); }} onProject={() => setView("projects")} onPalette={() => setPaletteOpen(true)} onMissionAI={() => openMissionAI()} onAccount={() => { setSettingsFocus({ id: "account", at: Date.now() }); setView("settings"); }}/>
      <main ref={mainContentRef} className="main-area" id="main-content" tabIndex="-1">
        <StatusBar state={state} workspace={workspace} sessions={supervisedSessions} activity={activity} health={health} view={view} pendingCount={pendingCount} onHelp={() => setHelpOpen(true)} onReviewNeeds={() => setView("needs")} onConfirm={setConfirmation}/>
        <div className={`experience view-${view}`} aria-live="off">
          {recoveryBoot && (
            <RecoveryReview
              report={recoveryBoot}
              onDismiss={() => setRecoveryBoot(null)}
              onResumed={started => {
                void refresh();
                toast.success(started.length
                  ? `Started ${started.length} worker${started.length === 1 ? "" : "s"}.`
                  : "No worker needed starting.");
              }}
            />
          )}
          <ViewErrorBoundary key={view}>{renderView()}</ViewErrorBoundary>
        </div>
      </main>
      <CommandPalette open={paletteOpen} query={paletteQuery} onQuery={setPaletteQuery} items={paletteItems} onChoose={item => { item.run(); setPaletteOpen(false); setPaletteQuery(""); }} onClose={() => setPaletteOpen(false)}/>
      <HelpOverlay open={helpOpen} onClose={() => setHelpOpen(false)}/>
      <ConfirmationDialog request={confirmation} onCancel={() => setConfirmation(null)} onConfirm={async () => { const request = confirmation; setConfirmation(null); await request?.run(); }}/>
      <UpgradeHost/>
      <WorkerQuickLook session={sessions.find(item => item.id === quickLookId)} activity={activity} onAction={dispatch} onClose={() => setQuickLookId(null)} onOpenTerminal={id => { setQuickLookId(null); focusWorker(id); }}/>
      <WorkerFocusDialog session={sessions.find(item => item.id === workerFocusId)} activity={activity} onClose={() => setWorkerFocusId(null)} onOpenTerminal={id => { setWorkerFocusId(null); focusWorker(id); }}/>
      <MissionGraph open={missionGraphOpen} sessions={sessions} onClose={() => setMissionGraphOpen(false)} onOpenTerminal={id => { setMissionGraphOpen(false); focusWorker(id); }} onOpenRecipes={() => { setMissionGraphOpen(false); goToRecipes(); }}/>
      <WorkspaceRecipes open={Boolean(recipesOpen)} mode={recipesOpen?.mode || "create"} editRecipe={recipesOpen?.recipe || null} projectKey={recipeProjectKey} sessions={sessions} layoutId={terminalLayout.layout.id} sessionIds={terminalLayout.sessionIds} onClose={() => setRecipesOpen(null)} onLaunch={launchRecipe} onAskAI={prompt => { setRecipesOpen(null); openMissionAI(prompt); }}onReload={async () => { const list = await missionApi().request("recipe.list").catch(() => null); const current = (list || []).find(item => item.id === recipesOpen?.recipe?.id); if (current) setRecipesOpen({ mode: "edit", recipe: current }); await refresh(); }} />
      <AutoStartManager
        open={autoStartManagerOpen}
        sessions={sessions}
        onClose={() => setAutoStartManagerOpen(false)}
        onToggleAutoStart={(id, enabled) => dispatch("setAutoStart", id, { enabled })}
        onBatchAutoStart={batchSetAutoStart}
        onAskAI={prompt => openMissionAI(prompt)}
      />
      {workerDialog && <WorkerDialog
        initialMode={workerDialog.mode}
        configuration={workerDialog.configuration || null}
        seed={workerDialog.seed || null}
        projectName={workspace?.name || ""}
        existingIds={sessions.map(item => item.id)}
        savedCommands={presetCommands.length ? presetCommands : savedCommands}
        onClose={() => setWorkerDialog(null)}
        onSave={saveWorker}
        onInstantiate={instantiateSavedCommand}
        onAskAI={prompt => { setWorkerDialog(null); openMissionAI(prompt); }}
      />}
      <BroadcastBar sessions={supervisedSessions} visible={broadcastOpen} onClose={() => setBroadcastOpen(false)} onResult={setNotice} />
    </div>;
}

export default function App() {
  // OUTARCH runs only for a signed-in account: the boundary shows the sign-in
  // screen until the website hands a session back and the workspace is open.
  return <AccountProvider><ToastProvider><AccountBoundary><GroundstationApp/></AccountBoundary></ToastProvider></AccountProvider>;
}
