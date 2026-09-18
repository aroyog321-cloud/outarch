import React from "react";
import { missionApi } from "./missionApi.js";

const SURFACE_LABELS = {
  "settings.summary": "Plugin summaries",
  "context.resource": "Resource context",
  "health.status": "Health contributions",
  "cockpit.banner": "Cockpit intelligence",
  "worker.detail": "Worker diagnostics",
  "mission.overview": "Mission intelligence"
};
// Mirrors pluginPlatformStore.cjs, which vets patterns when a manifest is installed.
const MAX_RULE_TEXT = 256;
function isSafePluginPattern(pattern) {
  const source = String(pattern ?? "");
  if (!source || source.length > 64) return false;
  if (/\\[1-9]/.test(source)) return false;
  if (/\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{?]/.test(source)) return false;
  try { new RegExp(source, "i"); } catch { return false; }
  return true;
}
const SURFACE_PERMISSIONS = {
  "context.resource": "context.read",
  "health.status": "health.read",
  "worker.detail": "health.read"
};

function extractMetricValue(snapshot, metricPath) {
  if (!snapshot || !metricPath) return undefined;
  if (metricPath === "workers.total" || metricPath === "workers.total.count") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.length : 0;
  }
  if (metricPath === "workers.failed.count" || metricPath === "workers.failed") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.status === "failed" || w.health === "critical" || w.health === "failed").length : 0;
  }
  if (metricPath === "workers.failed.names") {
    if (!Array.isArray(snapshot.workers)) return "none";
    const failed = snapshot.workers.filter(w => w.status === "failed" || w.health === "critical" || w.health === "failed");
    return failed.length ? failed.map(w => w.name || w.id).join(", ") : "none";
  }
  if (metricPath === "workers.failed.first.id" || metricPath === "workers.failed.first.name") {
    const first = Array.isArray(snapshot.workers) ? snapshot.workers.find(w => w.status === "failed" || w.health === "critical" || w.health === "failed") : null;
    return first ? String(metricPath.endsWith(".id") ? first.id : first.name || first.id) : "";
  }
  if (metricPath === "workers.running.first.id") {
    const first = Array.isArray(snapshot.workers) ? snapshot.workers.find(w => w.status === "running") : null;
    return first ? String(first.id) : "";
  }
  if (metricPath === "workers.running.count" || metricPath === "workers.running") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.status === "running").length : 0;
  }
  if (metricPath === "workers.running.names") {
    if (!Array.isArray(snapshot.workers)) return "none";
    const running = snapshot.workers.filter(w => w.status === "running");
    return running.length ? running.map(w => w.name || w.id).join(", ") : "none";
  }
  if (metricPath === "workers.idle.count" || metricPath === "workers.idle") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.status === "idle").length : 0;
  }
  if (metricPath === "workers.critical.count") {
    return Array.isArray(snapshot.workers) ? snapshot.workers.filter(w => w.health === "critical" || w.status === "critical").length : 0;
  }
  if (metricPath === "attention.count" || metricPath === "attention.pending.count") {
    return Array.isArray(snapshot.attention) ? snapshot.attention.length : 0;
  }
  if (metricPath === "attention.first.title" || metricPath === "attention.first.reason") {
    return Array.isArray(snapshot.attention) && snapshot.attention[0] ? (snapshot.attention[0].title || snapshot.attention[0].reason || "Attention required") : "None";
  }
  if (metricPath === "overall.status") {
    return snapshot.overall?.status || "unknown";
  }
  if (metricPath === "recipes.count" || metricPath === "recipes.total") {
    return Array.isArray(snapshot.recipes) ? snapshot.recipes.length : 0;
  }
  if (metricPath === "recipes.running.count") {
    return Array.isArray(snapshot.recipes) ? snapshot.recipes.filter(r => r.run?.status === "running").length : 0;
  }
  if (metricPath === "recipes.failed.count") {
    return Array.isArray(snapshot.recipes) ? snapshot.recipes.filter(r => r.run?.status === "failed").length : 0;
  }
  if (metricPath === "missions.count" || metricPath === "missions.total") {
    return Array.isArray(snapshot.missions) ? snapshot.missions.length : 0;
  }
  if (metricPath === "missions.active.count") {
    return Array.isArray(snapshot.missions) ? snapshot.missions.filter(m => m.status === "in_progress" || m.status === "active").length : 0;
  }
  if (metricPath === "project.name") {
    return snapshot.project?.name || "Project";
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

function matchCondition(metricValue, operator, operand) {
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
    case "contains":
      if (Array.isArray(metricValue)) return metricValue.includes(operand);
      if (typeof metricValue === "string") return metricValue.toLowerCase().includes(String(operand).toLowerCase());
      return false;
    case "regex":
    case "matches":
      if (!isSafePluginPattern(operand)) return false;
      try {
        const re = new RegExp(String(operand), "i");
        return re.test(String(metricValue ?? "").slice(0, MAX_RULE_TEXT));
      } catch {
        return false;
      }
    case "between":
      if (Array.isArray(operand) && operand.length === 2 && typeof metricValue === "number") {
        return metricValue >= Number(operand[0]) && metricValue <= Number(operand[1]);
      }
      return false;
    default:
      return false;
  }
}

function matchRuleNode(rule, snapshot) {
  if (!rule || typeof rule !== "object") return false;
  if (Array.isArray(rule.all) && rule.all.length > 0) {
    return rule.all.every(sub => matchRuleNode(sub, snapshot));
  }
  if (Array.isArray(rule.any) && rule.any.length > 0) {
    return rule.any.some(sub => matchRuleNode(sub, snapshot));
  }
  if (rule.metric !== undefined) {
    const metricVal = extractMetricValue(snapshot, rule.metric);
    return matchCondition(metricVal, rule.operator || "eq", rule.operand);
  }
  return false;
}

function formatTemplate(template, metricValue, snapshot) {
  if (typeof template !== "string") return template;
  let text = template
    .replace(/\{metric\}/g, String(metricValue ?? ""))
    .replace(/\{count\}/g, String(metricValue ?? ""))
    .replace(/\{value\}/g, String(metricValue ?? ""));
  if (snapshot && text.includes("{")) {
    text = text.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, path) => {
      if (path === "metric" || path === "count" || path === "value") return match;
      const extracted = extractMetricValue(snapshot, path);
      return extracted !== undefined ? String(extracted) : match;
    });
  }
  return text;
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
    actionId: contribution.actionId || null,
    actionLabel: contribution.actionLabel || null,
    target: contribution.target || null,
    pluginId: contribution.pluginId || "plugin",
    pluginName: contribution.pluginName || "Plugin"
  };

  if (!Array.isArray(contribution.rules) || !contribution.rules.length || !snapshot) {
    return {
      ...base,
      title: formatTemplate(base.title, undefined, snapshot),
      value: formatTemplate(base.value, undefined, snapshot),
      detail: formatTemplate(base.detail, undefined, snapshot),
      target: formatTemplate(base.target, undefined, snapshot)
    };
  }

  for (const rule of contribution.rules) {
    if (matchRuleNode(rule, snapshot)) {
      const metricVal = rule.metric ? extractMetricValue(snapshot, rule.metric) : undefined;
      return {
        ...base,
        title: rule.title !== undefined ? formatTemplate(rule.title, metricVal, snapshot) : formatTemplate(base.title, metricVal, snapshot),
        value: rule.value !== undefined ? formatTemplate(rule.value, metricVal, snapshot) : formatTemplate(base.value, metricVal, snapshot),
        detail: rule.detail !== undefined ? formatTemplate(rule.detail, metricVal, snapshot) : formatTemplate(base.detail, metricVal, snapshot),
        tone: rule.tone || base.tone,
        actionId: rule.actionId !== undefined ? rule.actionId : base.actionId,
        actionLabel: rule.actionLabel !== undefined ? rule.actionLabel : base.actionLabel,
        target: formatTemplate(rule.target !== undefined ? rule.target : base.target, metricVal, snapshot)
      };
    }
  }

  return {
    ...base,
    title: formatTemplate(base.title, undefined, snapshot),
    value: formatTemplate(base.value, undefined, snapshot),
    detail: formatTemplate(base.detail, undefined, snapshot),
    target: formatTemplate(base.target, undefined, snapshot)
  };
}

export function enabledContributions(plugins, surface, snapshot) {
  return (Array.isArray(plugins) ? plugins : []).flatMap(plugin => {
    if (!plugin?.enabled || !plugin.manifest?.surfaces?.includes(surface)) return [];
    const requiredPermission = SURFACE_PERMISSIONS[surface];
    if (requiredPermission && !plugin.grantedPermissions?.includes(requiredPermission)) return [];
    return (plugin.manifest.contributions || [])
      .filter(item => item.surface === surface)
      .map(item => evaluateContribution({ ...item, pluginId: plugin.manifest.id, pluginName: plugin.manifest.name }, snapshot))
      // A card can only ask for an action its manifest declares; the first
      // declared operation is the one it requests.
      .map(item => {
        const action = item?.actionId ? (plugin.manifest.actions || []).find(entry => entry.id === item.actionId) : null;
        return item ? { ...item, actionOperation: action?.operations?.[0] || null, target: item.target || null } : item;
      })
      .filter(Boolean);
  });
}

function hasContributions(plugins, surface) {
  return (Array.isArray(plugins) ? plugins : []).some(plugin => plugin?.enabled && plugin.manifest?.surfaces?.includes(surface)
    && (plugin.manifest.contributions || []).some(item => item.surface === surface));
}

// Snapshots are refreshed at most this often, and only for a slot that has
// something to show: every slot on a screen used to fetch a full context
// snapshot on every engine event, plugins installed or not.
const SNAPSHOT_REFRESH_MS = 1500;
const FEEDBACK_MS = 5000;

export default function PluginContributionSlot({ surface, plugins: suppliedPlugins, snapshot: suppliedSnapshot, className = "" }) {
  const [loadedPlugins, setLoadedPlugins] = React.useState([]);
  const [loadedSnapshot, setLoadedSnapshot] = React.useState(null);
  const [failed, setFailed] = React.useState(false);
  const [busyAction, setBusyAction] = React.useState(null);
  const [actionFeedback, setActionFeedback] = React.useState({});
  const feedbackTimers = React.useRef(new Map());
  const plugins = suppliedPlugins || loadedPlugins;
  const relevant = hasContributions(plugins, surface);

  React.useEffect(() => () => {
    for (const timer of feedbackTimers.current.values()) clearTimeout(timer);
    feedbackTimers.current.clear();
  }, []);

  React.useEffect(() => {
    if (suppliedPlugins) return undefined;
    let active = true;
    let unsubscribe = () => {};
    const refresh = () => missionApi().request("plugin.list")
      .then(value => { if (active) { setLoadedPlugins(Array.isArray(value) ? value : []); setFailed(false); } })
      .catch(() => { if (active) setFailed(true); });
    refresh();
    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (notification?.type === "integration:event" && notification.integration === "plugins") refresh();
      });
    } catch {}
    return () => { active = false; unsubscribe?.(); };
  }, [suppliedPlugins]);

  React.useEffect(() => {
    if (suppliedSnapshot || !relevant) return undefined;
    let active = true;
    let unsubscribe = () => {};
    let timer = null;
    let lastFetch = 0;
    const fetchSnapshot = () => {
      timer = null;
      lastFetch = Date.now();
      missionApi().request("context.snapshot", { includeOutput: false })
        .then(value => { if (active) setLoadedSnapshot(value); })
        .catch(() => {});
    };
    const schedule = () => {
      if (timer) return;
      timer = setTimeout(fetchSnapshot, Math.max(0, SNAPSHOT_REFRESH_MS - (Date.now() - lastFetch)));
    };
    fetchSnapshot();
    try {
      unsubscribe = missionApi().subscribe(notification => {
        if (notification?.type === "engine:event" || notification?.type === "state:change") schedule();
      });
    } catch {}
    return () => { active = false; if (timer) clearTimeout(timer); unsubscribe?.(); };
  }, [suppliedSnapshot, relevant]);

  const showFeedback = (key, message) => {
    setActionFeedback(prev => ({ ...prev, [key]: message }));
    clearTimeout(feedbackTimers.current.get(key));
    feedbackTimers.current.set(key, setTimeout(() => {
      feedbackTimers.current.delete(key);
      setActionFeedback(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }, FEEDBACK_MS));
  };

  // The request is only a request: the platform checks the plugin's grant and
  // the declared operation, then queues an approval in Needs You.
  const handleTriggerAction = async item => {
    const key = `${item.pluginId}:${item.id}`;
    setBusyAction(key);
    try {
      await missionApi().request("plugin.action.request", {
        pluginId: item.pluginId,
        request: {
          actionId: item.actionId,
          operation: item.actionOperation,
          target: item.target,
          reason: `Requested from the plugin card "${item.title}"`
        }
      });
      showFeedback(key, { tone: "ok", text: "Approval waiting in Needs You" });
    } catch (err) {
      showFeedback(key, { tone: "error", text: err?.message || "The request could not be made" });
    } finally {
      setBusyAction(null);
    }
  };

  const activeSnapshot = suppliedSnapshot || loadedSnapshot;
  const contributions = enabledContributions(plugins, surface, activeSnapshot);
  if (!contributions.length) return null;
  return <section className={`plugin-contribution-slot surface-${surface.replace(".", "-")} ${className}`.trim()} aria-label={SURFACE_LABELS[surface] || "Plugin contributions"}>
    <header><span>{SURFACE_LABELS[surface] || surface}</span><small>{contributions.length} renderer-owned item{contributions.length === 1 ? "" : "s"}{failed ? " · refresh unavailable" : ""}</small></header>
    <div>{contributions.map(item => {
      const actionKey = `${item.pluginId}:${item.id}`;
      const feedback = actionFeedback[actionKey];
      return <article key={actionKey} className={`tone-${item.tone}`}>
        <span className="plugin-contribution-slot__source">{item.pluginName}</span>
        <strong>{item.title}</strong>
        <b>{item.value}</b>
        {item.detail && <p title={item.detail}>{item.detail}</p>}
        {item.actionId && item.target && item.actionOperation && <div className="plugin-contribution-action-row">
          <button type="button" className="plugin-contribution-action-btn" disabled={busyAction === actionKey} onClick={() => void handleTriggerAction(item)}>
            {busyAction === actionKey ? "Requesting…" : (item.actionLabel || "Request action")}
          </button>
          {feedback && <span className={`plugin-contribution-action-feedback is-${feedback.tone}`} role="status">{feedback.text}</span>}
        </div>}
      </article>;
    })}</div>
  </section>;
}
