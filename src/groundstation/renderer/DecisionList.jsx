import React from "react";
import { DecisionItem } from "./DecisionItem.jsx";

/**
 * Renders the one normalised decision set (see useDecisions) with the shared
 * DecisionItem grammar. Every source uses the same row; there is no bulk action
 * and no per-source component. Routing of each action back to its owning
 * resolver is the caller's job via `onAction(record, actionId)`.
 */

const PREFIX = {
  session: "W",
  terminal: "T",
  missionSupervisor: "S",
  mission: "A",
  mcp: "M",
  automation: "R",
  mobile: "P",
  plugin: "G"
};

const SOURCE_LABEL = {
  session: "Worker",
  terminal: "Terminal alert",
  missionSupervisor: "Mission Supervisor",
  mission: "Agent mission",
  mcp: "MCP request",
  automation: "Automation",
  mobile: "Mobile request",
  plugin: "Plugin request"
};

function timeAgo(timestamp) {
  const minutes = Math.max(0, Math.round((Date.now() - Number(timestamp || 0)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

function expiryLabel(record) {
  if (!record.expiresAt) return `Opened ${timeAgo(record.createdAt)}`;
  const seconds = Math.round((record.expiresAt - Date.now()) / 1000);
  if (seconds <= 0) return "Expired";
  if (seconds < 90) return `Expires in ${seconds}s`;
  return `Expires in ${Math.round(seconds / 60)}m`;
}

// T068 — every record already carries the engine's own deep link back to the
// worker, agent or integration it came from. Surfacing it means a decision is
// never a dead end: whatever you are asked to judge, you can go and look at it.
const DEEP_LINK_LABEL = {
  workspace: "Open terminal",
  agents: "Open agent",
  integrations: "Open integration",
  history: "Open in History",
  needs: "Show source"
};

// One naming of a decision's origin and its way back, shared with every surface
// that previews the same records (Groundstation's inbox, Needs You). A second
// copy of these maps is how two views come to disagree about what a source is
// called — T151.
export function decisionSourceLabel(record) {
  return SOURCE_LABEL[record?.source] || record?.source || "Decision";
}

export function decisionDeepLinkLabel(record) {
  return DEEP_LINK_LABEL[record?.deepLink?.view] || "Show source";
}

// What happened, and when — the two things a resolved row exists to record.
function resolutionLabel(record) {
  const decision = record.resolution?.decision;
  const at = record.resolution?.at;
  const who = record.resolution?.by === "engine" ? "verified by the engine" : record.resolution?.by === "user" ? "by you" : null;
  if (!decision) return `Closed ${timeAgo(at || record.createdAt)}`;
  return `${String(decision).replace(/^./, character => character.toUpperCase())} ${who ? `${who} ` : ""}${timeAgo(at || record.createdAt)}`;
}

// A record can carry both an action and a deep link that mean the same thing —
// a terminal alert offers "Open terminal" as its own action and again as the
// engine's way back to the same worker. Two identical buttons side by side make
// an operator hesitate over which one is the real control, so the link yields to
// the action it duplicates. Only the wording is compared: the actions come from
// the engine and the link labels from the map above, and a match in wording is
// exactly what an operator sees as a repeat.
function duplicatesAnAction(record) {
  const link = DEEP_LINK_LABEL[record?.deepLink?.view] || "Show source";
  return (record?.actions || []).some(action => String(action.label || "").toLowerCase() === link.toLowerCase());
}

export function DecisionList({ records, queueState = {}, busyId = "", onAction, onSnooze, onOpenSource, resolved = false }) {
  return records.map((record, index) => {
    const seen = Boolean(queueState[record.id]?.seen);
    const lifecycle = !["pending"].includes(record.status)
      ? record.status
      : seen ? "seen" : "new";
    const busy = busyId === record.id;
    // Resolved rows render no actions at all, so nothing is left to duplicate.
    const repeatsAnAction = !resolved && duplicatesAnAction(record);
    return (
      <DecisionItem
        key={record.id}
        prefix={PREFIX[record.source] || "D"}
        index={index}
        className={record.origin === "renderer" ? "is-terminal-alert" : ""}
        decision={{
          id: record.id,
          source: SOURCE_LABEL[record.source] || record.source,
          title: record.title,
          severity: record.severity,
          lifecycle,
          evidence: record.evidence,
          impact: record.impact,
          recommendedAction: "Review the evidence and consequence before acting.",
          expiry: resolved ? resolutionLabel(record) : expiryLabel(record),
          recovery: record.origin === "renderer"
            ? "Dismissing clears only the renderer alert; engine-owned worker state is unchanged."
            : record.source === "session"
              ? "Recovery appears only after the engine verifies the alert cleared."
              : "Denying performs no action."
        }}
        actions={
          <>
            {!resolved && record.actions.map(action => (
              <button
                key={action.id}
                className={action.tone === "primary" ? "primary" : action.tone === "danger" ? "recommended" : ""}
                disabled={busy}
                onClick={() => onAction(record, action.id)}
              >
                {busy && action.resolves ? "Working…" : action.label}
              </button>
            ))}
            {onSnooze && record.origin === "engine" && record.source === "session" && (
              <button disabled={busy} onClick={() => onSnooze(record.id)}>Snooze 15m</button>
            )}
            {onOpenSource && record.deepLink?.view && !repeatsAnAction && (
              <button type="button" className="decision-deep-link" onClick={() => onOpenSource(record)}>
                {DEEP_LINK_LABEL[record.deepLink.view] || "Show source"}
              </button>
            )}
          </>
        }
      >
        {Array.isArray(record.steps) && record.steps.length > 0 && (
          <ol className="decision-item__steps">
            {record.steps.map((step, stepIndex) => (
              <li key={`${record.id}-step-${stepIndex}`}>
                <b>{String(stepIndex + 1).padStart(2, "0")}</b>
                <span>
                  <strong>{step.label}</strong>
                  {step.reason && <small>{step.reason}</small>}
                  {step.code && <code>{step.code}</code>}
                </span>
              </li>
            ))}
          </ol>
        )}
      </DecisionItem>
    );
  });
}
