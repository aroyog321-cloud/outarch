import React from "react";
import NotificationTray from "./NotificationTray.jsx";
import { PlanTapeChip, UpdateTapeChip } from "./AccountSettings.jsx";

function age(timestamp) {
  if (!Number.isFinite(timestamp)) return "no events yet";
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 45) return "just now";
  if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

const VIEW_LABELS = {
  groundstation: "Groundstation",
  workspace: "Workspace",
  needs: "Needs You",
  agents: "Agents",
  integrations: "Integrations",
  recipes: "Recipes",
  history: "History",
  projects: "Projects",
  settings: "Settings",
  "mission-ai": "Mission AI"
};

export default function StatusBar({ state, workspace, sessions, activity, health, view, pendingCount = 0, onHelp, onReviewNeeds, onConfirm }) {
  const last = activity.at(-1);
  const tone = health?.tone === "danger" ? "is-danger" : health?.tone === "warning" ? "is-warning" : "";
  return <header className="mission-status-bar status-bar-premium instrument-tape" aria-label="OUTARCH status">
    <div className="status-bar-premium__left">
      <span className="status-bar-premium__project" title={workspace?.directory || workspace?.path || ""}><i className={`status-bar-premium__dot ${tone}`}/>{workspace?.name || "No project"}</span>
      <span className={`status-bar-premium__indicator is-connected ${tone}`}><i/>{health?.label || "Engine ready"}</span>
      <span className="status-bar-premium__crumb"><b>{VIEW_LABELS[view] || "OUTARCH"}</b></span>
    </div>
    <div className="status-bar-premium__right">
      <UpdateTapeChip onConfirm={onConfirm}/>
      <PlanTapeChip/>
      <span className="status-bar-premium__meta status-bar-pill status-bar-pill--protocol">Protocol v{state?.contractVersion || "—"}</span>
      <span className="status-bar-premium__meta status-bar-pill status-bar-pill--signal"><i className="signal-dot"/>Last signal {age(last?.timestamp)}</span>
      <span className={`status-bar-premium__meta status-bar-pill status-bar-pill--needs ${pendingCount ? "is-warn" : ""}`}><b>Needs you</b>{pendingCount || "—"}</span>
      {/* Every notification, on every screen — not only where its toast appeared. */}
      <NotificationTray variant="tape" needsCount={pendingCount} onReviewNeeds={onReviewNeeds}/>
      <button className="status-bar-premium__help" onClick={onHelp} aria-label="Open keyboard help">Help <kbd>F1</kbd></button>
    </div>
  </header>;
}
