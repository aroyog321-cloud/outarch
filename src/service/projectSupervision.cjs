"use strict";

const { sanitizeContextValue } = require("./contextSanitizer.cjs");

const PROJECT_SUPERVISION_VERSION = 1;
const MAX_SUPERVISION_BYTES = 192 * 1024;
const MAX_SUPERVISION_WORKERS = 50;
const MAX_SUPERVISION_ITEMS = 20;
const MAX_EVIDENCE_INDEX = 160;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function safeIdPart(value, fallback) {
  const normalized = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  return (normalized || fallback).slice(0, 96);
}

function evidenceId(type, value, fallback) {
  return `${type}:${safeIdPart(value, fallback)}`;
}

function observedAt(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function activityLabel(event) {
  return String(event?.type || "workspace-event").replaceAll(":", " · ").replaceAll("-", " ").slice(0, 180);
}

function runningSummary(workers) {
  const active = workers.filter(worker => ["starting", "working", "running", "waiting"].includes(worker.state));
  if (!active.length) return "No OUTARCH worker is currently active.";
  const working = active.filter(worker => worker.state === "working").length;
  return `${active.length} worker${active.length === 1 ? " is" : "s are"} active${working ? `; ${working} ${working === 1 ? "has" : "have"} recent progress evidence` : ""}.`;
}

function changedSummary(items) {
  if (!items.length) return "No bounded lifecycle change was recorded in this snapshot window.";
  return `${items.length} recent engine event${items.length === 1 ? " is" : "s are"} available for review.`;
}

function attentionSummary(items) {
  if (!items.length) return "No engine or integration item currently requires operator attention.";
  return `${items.length} item${items.length === 1 ? " requires" : "s require"} operator review.`;
}

function enforceBudget(snapshot) {
  if (serializedBytes(snapshot) <= MAX_SUPERVISION_BYTES) return snapshot;
  snapshot.budget.truncated = true;
  for (const worker of snapshot.facts.workers) {
    delete worker.terminalEvidence;
    if (worker.evidence && Object.keys(worker.evidence).length > 4) worker.evidence = {};
  }
  snapshot.visibility.terminalEvidence = "omitted-by-budget";
  snapshot.evidenceIndex = snapshot.evidenceIndex.slice(0, 80);
  if (serializedBytes(snapshot) <= MAX_SUPERVISION_BYTES) return snapshot;
  snapshot.facts.history = snapshot.facts.history.slice(0, 8);
  snapshot.facts.recipes = snapshot.facts.recipes.slice(0, 8);
  snapshot.facts.workers = snapshot.facts.workers.slice(0, 25);
  snapshot.evidenceIndex = snapshot.evidenceIndex.slice(0, 50);
  if (serializedBytes(snapshot) <= MAX_SUPERVISION_BYTES) return snapshot;
  snapshot.facts.workers = snapshot.facts.workers.map(worker => ({
    evidenceId: worker.evidenceId,
    id: worker.id,
    name: worker.name,
    role: worker.role,
    ownership: worker.ownership,
    state: worker.state,
    lifecycle: worker.lifecycle,
    currentActivity: worker.currentActivity,
    attention: worker.attention
  }));
  return snapshot;
}

class ProjectSupervisionService {
  constructor(options = {}) {
    if (!options.missionContext || typeof options.missionContext.snapshot !== "function") {
      throw new TypeError("ProjectSupervisionService requires Mission Context");
    }
    this.missionContext = options.missionContext;
    this.now = options.now || Date.now;
  }

  snapshot(options = {}) {
    const context = this.missionContext.snapshot(options);
    const evidenceIndex = [{
      id: "supervision:overview",
      kind: "fact",
      source: "Project Supervision",
      observedAt: observedAt(context.generatedAt),
      label: context.overall?.statement || context.overall?.status || "Current bounded project overview"
    }];
    const workers = (context.workers || []).slice(0, MAX_SUPERVISION_WORKERS).map((worker, index) => {
      const id = evidenceId("worker", worker.id, `worker-${index + 1}`);
      evidenceIndex.push({ id, kind: "fact", source: worker.source || "EngineAPI", observedAt: observedAt(worker.lastOutputAt || worker.startedAt), label: `${worker.name || worker.id}: ${worker.currentActivity || worker.state}` });
      return { evidenceId: id, ...clone(worker) };
    });
    const running = workers.filter(worker => ["starting", "working", "running", "waiting"].includes(worker.state)).slice(0, MAX_SUPERVISION_ITEMS).map(worker => ({
      evidenceId: worker.evidenceId,
      workerId: worker.id,
      name: worker.name,
      role: worker.role,
      state: worker.state,
      activity: worker.currentActivity,
      observedAt: worker.lastOutputAt || worker.startedAt || null
    }));
    const history = [...(context.activity || [])].slice(-MAX_SUPERVISION_ITEMS).reverse().map((event, index) => {
      const id = evidenceId("activity", event.sequence ?? event.id, `recent-${index + 1}`);
      evidenceIndex.push({ id, kind: "fact", source: "EngineAPI activity", observedAt: observedAt(event.timestamp || event.at), label: activityLabel(event) });
      return { evidenceId: id, sequence: Number.isInteger(event.sequence) ? event.sequence : null, type: event.type || "workspace:event", actor: event.name || event.id || event.sessionId || "workspace", reason: event.reason || null, at: event.timestamp || event.at || null };
    });
    const attention = (context.attention || []).slice(0, MAX_SUPERVISION_ITEMS).map((item, index) => {
      const target = item.id || item.workerId || item.sessionId || index + 1;
      const id = evidenceId("attention", target, `item-${index + 1}`);
      evidenceIndex.push({ id, kind: "fact", source: "Needs You", observedAt: observedAt(item.timestamp || item.at || item.since), label: item.reason || item.title || `Attention for ${target}` });
      return { evidenceId: id, ...clone(item) };
    });
    const knownAttentionWorkers = new Set(attention.map(item => item.workerId || item.sessionId || item.id).filter(Boolean));
    for (const worker of workers) {
      if (!worker.attention?.required || knownAttentionWorkers.has(worker.id) || attention.length >= MAX_SUPERVISION_ITEMS) continue;
      const id = evidenceId("attention", worker.id, worker.id);
      evidenceIndex.push({ id, kind: "fact", source: "EngineAPI worker", observedAt: observedAt(worker.attention.since), label: worker.attention.reason || `${worker.name} requires review` });
      attention.push({ evidenceId: id, workerId: worker.id, title: `${worker.name} requires review`, reason: worker.attention.reason, since: worker.attention.since });
    }
    const recipes = (context.recipes || []).slice(0, MAX_SUPERVISION_ITEMS).map((recipe, index) => {
      const id = evidenceId("recipe", recipe.id, `recipe-${index + 1}`);
      evidenceIndex.push({ id, kind: "fact", source: "Workspace Recipes", observedAt: observedAt(recipe.updatedAt || recipe.lastRunAt), label: recipe.name || recipe.id });
      return { evidenceId: id, ...clone(recipe) };
    });
    const vscode = clone(context.integrations?.vscode || null);
    if (vscode) {
      evidenceIndex.push({ id: "vscode:connection", kind: "fact", source: "VS Code Bridge", observedAt: observedAt(vscode.lastSyncAt), label: vscode.connected ? "VS Code connected" : "VS Code disconnected" });
      if (vscode.diagnostics) evidenceIndex.push({ id: "vscode:diagnostics", kind: "fact", source: "VS Code diagnostics", observedAt: observedAt(vscode.lastSyncAt), label: `${vscode.diagnostics.errors || 0} errors and ${vscode.diagnostics.warnings || 0} warnings` });
      if (vscode.git) evidenceIndex.push({ id: "vscode:git", kind: "fact", source: "VS Code Git", observedAt: observedAt(vscode.lastSyncAt), label: `${vscode.git.branch || "unknown branch"}; ${vscode.git.changedPaths || 0} changed paths` });
      for (const terminal of vscode.terminals || []) {
        evidenceIndex.push({ id: evidenceId("vscode-terminal", terminal.id, terminal.name || "terminal"), kind: "fact", source: "VS Code Bridge", observedAt: observedAt(vscode.lastSyncAt), label: `${terminal.name}: ${terminal.commandState || terminal.state || "open"} (${terminal.ownership || "vscode-owned"})` });
      }
    }
    const failedIds = workers.filter(worker => worker.state === "failed").map(worker => worker.evidenceId);
    const inference = failedIds.length ? {
      id: "inference:delivery-risk",
      kind: "inference",
      label: "Delivery may be blocked by failed workers.",
      confidence: "high",
      basedOn: failedIds,
      limitation: "This is an operational-risk inference, not a completion estimate."
    } : {
      id: "inference:no-recorded-blocker",
      kind: "inference",
      label: "No engine-recorded worker failure is visible in this snapshot.",
      confidence: "medium",
      basedOn: workers.filter(worker => ["running", "working", "completed"].includes(worker.state)).map(worker => worker.evidenceId).slice(0, 10),
      limitation: "Unreported product, code, and external blockers may still exist."
    };
    const snapshot = {
      supervisionVersion: PROJECT_SUPERVISION_VERSION,
      contextVersion: context.contextVersion,
      generatedAt: this.now(),
      project: clone(context.project),
      overview: {
        state: context.overall?.status || "unknown",
        whatIsRunning: { summary: runningSummary(workers), items: running },
        whatChanged: { summary: changedSummary(history), items: history.slice(0, 12) },
        whatNeedsYou: { summary: attentionSummary(attention), items: attention.slice(0, 12) }
      },
      facts: {
        overall: clone(context.overall),
        workers,
        attention,
        history,
        recipes,
        missions: clone((context.missions || []).slice(0, MAX_SUPERVISION_ITEMS)),
        projectMemory: clone(context.projectMemory),
        vscode
      },
      inferences: [inference, {
        id: "inference:time-estimate",
        kind: "inference",
        label: "A delivery range requires a declared scope plus comparable completion evidence.",
        confidence: "low",
        basedOn: history.slice(0, 5).map(item => item.evidenceId),
        limitation: "OUTARCH will ask Gemini for a range with assumptions; it will not invent a percentage or deadline."
      }],
      evidenceIndex: evidenceIndex.slice(0, MAX_EVIDENCE_INDEX),
      visibility: {
        terminalEvidence: context.visibility?.terminalOutput || "omitted",
        terminalInput: context.visibility?.terminalInput || "omitted",
        sourceCode: "omitted",
        environmentValues: "omitted",
        factsAndInferencesSeparated: true
      },
      privacy: clone(context.privacy),
      budget: { maxBytes: MAX_SUPERVISION_BYTES, truncated: false, bytes: 0 }
    };
    const sanitized = sanitizeContextValue(snapshot, { maxArrayItems: 180, maxObjectKeys: 140, maxStringLength: 2000 });
    const bounded = enforceBudget(sanitized.value);
    bounded.privacy = { ...(bounded.privacy || {}), supervisionRedactionCount: sanitized.redactions, supervisionTruncationCount: sanitized.truncations };
    for (let attempt = 0; attempt < 3; attempt++) {
      const measured = serializedBytes(bounded);
      if (bounded.budget.bytes === measured) break;
      bounded.budget.bytes = measured;
    }
    if (bounded.budget.bytes > MAX_SUPERVISION_BYTES) throw new Error("Project supervision exceeded its hard serialization budget");
    return bounded;
  }
}

module.exports = {
  MAX_EVIDENCE_INDEX,
  MAX_SUPERVISION_BYTES,
  MAX_SUPERVISION_ITEMS,
  MAX_SUPERVISION_WORKERS,
  PROJECT_SUPERVISION_VERSION,
  ProjectSupervisionService,
  serializedBytes
};
