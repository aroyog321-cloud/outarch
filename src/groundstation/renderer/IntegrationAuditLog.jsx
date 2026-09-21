import React from "react";
import { missionApi } from "./missionApi.js";
import { RegisterSkeleton } from "./LoadingSkeleton.jsx";

function relativeTime(timestamp) {
  if (!timestamp) return "unknown time";
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
  return minutes < 1 ? "now" : minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h`;
}

export default function IntegrationAuditLog() {
  const [sourceRecords, setSourceRecords] = React.useState(null);
  const [sourceErrors, setSourceErrors] = React.useState([]);
  const [sourceUpdatedAt, setSourceUpdatedAt] = React.useState({});
  const refresh = React.useCallback(async () => {
    // T115 - all six, not the three that happened to have a list method.
    // Mission AI, VS Code and Automation now answer the same question, so a
    // reader can no longer mistake "this bridge keeps no record" for "this
    // bridge did nothing".
    const sources = [
      ["Mission AI", "missionAi.audit.list"],
      ["VS Code", "vscode.audit.list"],
      ["MCP", "mcp.audit.list"],
      ["Automation", "automation.audit.list"],
      ["Mobile", "mobile.audit.list"]
    ];
    const results = await Promise.allSettled(sources.map(([, method]) => missionApi().request(method, { limit: 8 })));
    const now = Date.now();
    setSourceRecords(current => {
      const next = { ...(current || {}) };
      results.forEach((result, index) => {
        if (result.status === "fulfilled") next[sources[index][0]] = Array.isArray(result.value) ? result.value : [];
      });
      return next;
    });
    setSourceUpdatedAt(current => {
      const next = { ...current };
      results.forEach((result, index) => { if (result.status === "fulfilled") next[sources[index][0]] = now; });
      return next;
    });
    setSourceErrors(results.flatMap((result, index) => result.status === "rejected" ? [sources[index][0]] : []));
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const records = sourceRecords === null ? null : Object.entries(sourceRecords).flatMap(([source, values]) => values.map(item => ({ ...item, source }))).sort((left, right) => Number(right.at || 0) - Number(left.at || 0)).slice(0, 18);
  const verifiedSources = Object.keys(sourceUpdatedAt);
  const failedSources = sourceErrors.join(", ");

  return <section className="integration-audit-register">
    <header><div><span className="section-kicker">UNIFIED AUDIT</span><strong>Activity across every connected capability</strong></div><button type="button" onClick={() => void refresh()}>Refresh</button></header>
    {sourceErrors.length > 0 && <div className="integration-resource-notice" role="status"><span><strong>Audit history is incomplete.</strong> {failedSources} could not be refreshed; {verifiedSources.length ? `showing last verified data from ${verifiedSources.join(", ")}.` : "no source has returned verified data."}</span><button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {records === null ? <RegisterSkeleton rows={3} label="Loading integration audit records"/> : records.length ? <div>
      {records.map((record, index) => <article key={`${record.source}-${record.id || index}`}>
        <span className="status-chip tone-neutral"><i/>{record.source}</span>
        <strong>{record.kind || "activity"} · {record.outcome || "recorded"}</strong>
        <small>{record.capability || record.target || record.client || record.deviceId || record.automationId || record.model || "metadata only"}</small>
        <time dateTime={record.at ? new Date(record.at).toISOString() : undefined}>{relativeTime(record.at)}</time>
      </article>)}
    </div> : sourceErrors.length ? <p>No audit records are available from the sources that responded.</p> : <p>No integration audit activity has been recorded.</p>}
  </section>;
}
