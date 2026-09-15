import React from "react";
import { missionApi } from "./missionApi.js";

const SURFACE_LABELS = {
  "settings.summary": "Plugin summaries",
  "context.resource": "Resource context",
  "health.status": "Health contributions"
};
const SURFACE_PERMISSIONS = {
  "context.resource": "context.read",
  "health.status": "health.read"
};

function extractMetricValue(snapshot, metricPath) {
  if (!snapshot || !metricPath) return undefined;
  if (metricPath === "workers.total" || metricPath === "workers.total.count") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.length : 0;
  }
  if (metricPath === "workers.failed.count" || metricPath === "workers.failed") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.status === "failed" || w.health === "critical" || w.health === "failed").length : 0;
  }
  if (metricPath === "workers.running.count" || metricPath === "workers.running") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.status === "running").length : 0;
  }
  if (metricPath === "workers.idle.count" || metricPath === "workers.idle") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.status === "idle").length : 0;
  }
  if (metricPath === "attention.count" || metricPath === "attention.pending.count") {
    return Array.isArray(snapshot.attention) ? snapshot.attention.length : 0;
  }
  if (metricPath === "overall.status") {
    return snapshot.overall?.status || "unknown";
  }
  if (metricPath === "recipes.count") {
    return Array.isArray(snapshot.recipes) ? snapshot.recipes.length : 0;
  }
  if (metricPath === "missions.count") {
    return Array.isArray(snapshot.missions) ? snapshot.missions.length : 0;
  }
  const parts = String(metricPath).split(".").filter(Boolean);
  let current = snapshot;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    if (part === "__proto__" || part === "constructor" || part === "prototype") return undefined;
    current = current[part];
  }
  return current;
}

function matchRule(metricValue, operator, operand) {
  switch (operator) {
    case "eq":
      return metricValue === operand;
    case "neq":
      return metricValue !== operand;
    case "gt":
      return typeof metricValue === "number" && metricValue > Number(operand);
    case "gte":
      return typeof metricValue === "number" && metricValue >= Number(operand);
    case "lt":
      return typeof metricValue === "number" && metricValue < Number(operand);
    case "lte":
      return typeof metricValue === "number" && metricValue <= Number(operand);
    case "truthy":
      return Boolean(metricValue);
    case "falsy":
      return !metricValue;
    case "in":
      return Array.isArray(operand) ? operand.includes(metricValue) : false;
    default:
      return false;
  }
}

function formatTemplate(template, metricValue) {
  if (typeof template !== "string") return template;
  return template
    .replace(/\{metric\}/g, String(metricValue ?? ""))
    .replace(/\{count\}/g, String(metricValue ?? ""))
    .replace(/\{value\}/g, String(metricValue ?? ""));
}

export function evaluateContribution(contribution, snapshot) {
  if (!contribution) return null;
  const base = {
    id: contribution.id || "contribution",
    surface: contribution.surface || "",
    title: contribution.title || "",
    value: contribution.value || "",
    detail: contribution.detail || "",
    tone: contribution.tone || "neutral",
    pluginId: contribution.pluginId || "plugin",
    pluginName: contribution.pluginName || "Plugin"
  };

  if (!Array.isArray(contribution.rules) || !contribution.rules.length || !snapshot) {
    return base;
  }

  for (const rule of contribution.rules) {
    if (!rule || typeof rule !== "object") continue;
    const metricVal = extractMetricValue(snapshot, rule.metric);
    if (matchRule(metricVal, rule.operator, rule.operand)) {
      return {
        ...base,
        title: rule.title !== undefined ? formatTemplate(rule.title, metricVal) : base.title,
        value: rule.value !== undefined ? formatTemplate(rule.value, metricVal) : base.value,
        detail: rule.detail !== undefined ? formatTemplate(rule.detail, metricVal) : base.detail,
        tone: rule.tone || base.tone
      };
    }
  }

  return base;
}

export function enabledContributions(plugins, surface, snapshot) {
  return (Array.isArray(plugins) ? plugins : []).flatMap(plugin => {
    if (!plugin?.enabled || !plugin.manifest?.surfaces?.includes(surface)) return [];
    const requiredPermission = SURFACE_PERMISSIONS[surface];
    if (requiredPermission && !plugin.grantedPermissions?.includes(requiredPermission)) return [];
    return (plugin.manifest.contributions || [])
      .filter(item => item.surface === surface)
      .map(item => evaluateContribution({ ...item, pluginId: plugin.manifest.id, pluginName: plugin.manifest.name }, snapshot));
  });
}

export default function PluginContributionSlot({ surface, plugins: suppliedPlugins, snapshot: suppliedSnapshot, className = "" }) {
  const [loadedPlugins, setLoadedPlugins] = React.useState([]);
  const [loadedSnapshot, setLoadedSnapshot] = React.useState(null);
  const [failed, setFailed] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    let unsubscribe = () => {};
    const refresh = () => {
      if (!suppliedPlugins) {
        missionApi().request("plugin.list")
          .then(value => { if (active) { setLoadedPlugins(Array.isArray(value) ? value : []); setFailed(false); } })
          .catch(() => { if (active) setFailed(true); });
      }
      if (!suppliedSnapshot) {
        missionApi().request("context.snapshot", { includeOutput: false })
          .then(value => { if (active) setLoadedSnapshot(value); })
          .catch(() => {});
      }
    };
    refresh();
    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (notification?.type === "integration:event" && notification.integration === "plugins") refresh();
        if (notification?.type === "engine:event" || notification?.type === "state:change") {
          if (!suppliedSnapshot && active) {
            missionApi().request("context.snapshot", { includeOutput: false })
              .then(value => { if (active) setLoadedSnapshot(value); })
              .catch(() => {});
          }
        }
      });
    } catch {}
    return () => { active = false; unsubscribe?.(); };
  }, [suppliedPlugins, suppliedSnapshot, surface]);

  const activeSnapshot = suppliedSnapshot || loadedSnapshot;
  const contributions = enabledContributions(suppliedPlugins || loadedPlugins, surface, activeSnapshot);
  if (!contributions.length) return null;
  return <section className={`plugin-contribution-slot surface-${surface.replace(".", "-")} ${className}`.trim()} aria-label={SURFACE_LABELS[surface] || "Plugin contributions"}>
    <header><span>{SURFACE_LABELS[surface] || surface}</span><small>{contributions.length} renderer-owned item{contributions.length === 1 ? "" : "s"}{failed ? " · refresh unavailable" : ""}</small></header>
    <div>{contributions.map(item => <article key={`${item.pluginId}:${item.id}`} className={`tone-${item.tone}`}>
      <span className="plugin-contribution-slot__source">{item.pluginName}</span>
      <strong>{item.title}</strong>
      <b>{item.value}</b>
      {item.detail && <p title={item.detail}>{item.detail}</p>}
    </article>)}</div>
  </section>;
}
