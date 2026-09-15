"use strict";

const path = require("node:path");
const { sanitizeContextValue } = require("./contextSanitizer.cjs");

const MISSION_CONTEXT_VERSION = 1;
const MAX_CONTEXT_BYTES = 256 * 1024;
const MAX_CONTEXT_WORKERS = 50;
const MAX_CONTEXT_ATTENTION = 50;
const MAX_CONTEXT_ACTIVITY = 50;
const MAX_CONTEXT_MISSIONS = 20;
const MAX_CONTEXT_RECIPES = 20;
const MAX_CONTEXT_OUTPUT_WORKERS = 10;
const MAX_CONTEXT_OUTPUT_LINES = 12;
const MAX_CONTEXT_OUTPUT_LINE_LENGTH = 500;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function validateOptions(options) {
  if (!isPlainObject(options)) throw new TypeError("Mission Context options must be an object");
  const allowed = new Set(["afterSequence", "includeOutput", "workerIds"]);
  const unsupported = Object.keys(options).find(key => !allowed.has(key));
  if (unsupported) throw new TypeError(`unsupported Mission Context option: ${unsupported}`);
  if (options.afterSequence !== undefined && (!Number.isInteger(options.afterSequence) || options.afterSequence < 0)) {
    throw new TypeError("afterSequence must be a non-negative integer");
  }
  if (options.includeOutput !== undefined && typeof options.includeOutput !== "boolean") {
    throw new TypeError("includeOutput must be a boolean");
  }
  if (options.workerIds !== undefined && (!Array.isArray(options.workerIds) || options.workerIds.some(id => typeof id !== "string" || !id))) {
    throw new TypeError("workerIds must be an array of non-empty strings");
  }
  return {
    afterSequence: options.afterSequence || 0,
    includeOutput: options.includeOutput === true,
    workerIds: [...new Set(options.workerIds || [])].slice(0, MAX_CONTEXT_OUTPUT_WORKERS)
  };
}

function workspaceRelativePath(workspace, value) {
  if (!workspace?.directory || typeof value !== "string" || !value) return null;
  const relative = path.relative(workspace.directory, value);
  if (!relative || relative === ".") return ".";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/").slice(0, 1024);
}

function workerRole(session) {
  if (String(session.id || "").startsWith("agent-")) return "ai-agent";
  const evidence = session.evidence || {};
  if (evidence.database) return "database";
  if (evidence.tests) return "tests";
  if (evidence.build) return "build";
  if (evidence.container) return "container";
  const identity = `${session.id || ""} ${session.name || ""} ${session.command || ""} ${(session.args || []).join(" ")}`.toLowerCase();
  if (/\b(frontend|front-end|client|web|ui|vite|next|react|angular|vue)\b/.test(identity)) return "frontend";
  if (/\b(backend|back-end|server|api|gateway)\b/.test(identity)) return "backend";
  if (/\b(database|postgres|mysql|mongo|redis|sqlite|db)\b/.test(identity)) return "database";
  if (/\b(test|tests|spec|jest|vitest|playwright|cypress)\b/.test(identity)) return "tests";
  if (/\b(git|source control)\b/.test(identity)) return "git";
  if (/\b(build|bundle|compile|webpack|rollup|esbuild)\b/.test(identity)) return "build";
  if (evidence.service) return "service";
  return "terminal";
}

function workerKind(session) {
  return workerRole(session);
}

function currentActivity(session) {
  if (session.status === "failed") return "Failed; awaiting operator review";
  if (session.attentionRequired) return "Waiting for operator input";
  if (session.status === "starting") return "Starting process";
  if (session.activity === "progress") return "Producing progress output";
  if (session.activity === "claim") return "Reported a claim requiring verification";
  if (session.isAlive && session.lastOutputAt) return "Running; recent terminal activity";
  if (session.isAlive) return "Running; no recent output";
  if (session.status === "exited" && session.exitCode === 0) return "Completed successfully";
  return "Stopped";
}

function workerState(session) {
  if (session.status === "failed") return "failed";
  if (session.attentionRequired) return "needs-you";
  if (session.status === "starting") return "starting";
  if (session.isAlive && session.activity === "progress") return "working";
  if (session.isAlive && session.activity === "claim") return "waiting";
  if (session.isAlive) return "running";
  if (session.status === "exited" && session.exitCode === 0) return "completed";
  return "stopped";
}

function summarizeWorkers(workers) {
  const counts = {
    total: workers.length,
    running: 0,
    working: 0,
    starting: 0,
    waiting: 0,
    failed: 0,
    needsYou: 0,
    completed: 0,
    stopped: 0
  };
  for (const worker of workers) {
    const key = worker.state === "needs-you"
      ? "needsYou"
      : worker.state.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    if (Object.hasOwn(counts, key)) counts[key]++;
  }
  const pressure = workers.filter(worker => worker.health?.tone === "pressure").length;
  const active = counts.running + counts.working + counts.starting;
  const status = counts.failed || counts.needsYou
    ? "needs-attention"
    : pressure
      ? "degraded"
      : counts.running + counts.working + counts.starting > 0
        ? "healthy"
        : "idle";
  const statement = status === "needs-attention"
    ? `${counts.failed + counts.needsYou} worker${counts.failed + counts.needsYou === 1 ? " requires" : "s require"} attention.`
    : status === "degraded"
      ? `${pressure} worker${pressure === 1 ? " is" : "s are"} under resource pressure.`
      : status === "healthy"
        ? `${active} worker${active === 1 ? " is" : "s are"} active without an engine-recorded failure.`
        : "No worker is currently running.";
  return { status, statement, counts, resourcePressureCount: pressure };
}

function safeWorker(session, workspace) {
  return {
    id: session.id,
    name: session.name,
    kind: workerKind(session),
    role: workerRole(session),
    ownership: "MISSION_CONTROL_OWNED",
    source: "EngineAPI",
    state: workerState(session),
    lifecycle: session.status,
    isAlive: session.isAlive === true,
    activity: session.activity || null,
    currentActivity: currentActivity(session),
    command: session.command || null,
    cwd: workspaceRelativePath(workspace, session.cwd),
    environmentKeyCount: Array.isArray(session.envKeys) ? session.envKeys.length : 0,
    runtimeMs: Number(session.runtimeMs) || 0,
    startedAt: session.startTime || null,
    lastOutputAt: session.lastOutputAt || null,
    exitCode: Number.isInteger(session.exitCode) ? session.exitCode : null,
    attention: session.attentionRequired ? {
      required: true,
      reason: session.attentionReason || "Operator review is required.",
      since: session.attentionSince || null
    } : { required: false, reason: null, since: null },
    health: session.health ? clone(session.health) : null,
    resources: session.resources ? clone(session.resources) : null,
    dependencyImpact: session.dependencyImpact ? clone(session.dependencyImpact) : null,
    evidence: session.evidence ? clone(session.evidence) : {}
  };
}

function outputWorkerIds(options, workers) {
  if (!options.includeOutput) return [];
  if (options.workerIds.length) {
    const known = new Set(workers.map(worker => worker.id));
    return options.workerIds.filter(id => known.has(id));
  }
  return [...workers]
    .filter(worker => worker.state === "failed" || worker.state === "needs-you" || worker.isAlive)
    .sort((left, right) => {
      const priority = worker => worker.state === "failed" ? 3 : worker.state === "needs-you" ? 2 : 1;
      return priority(right) - priority(left) || (Number(right.lastOutputAt) || 0) - (Number(left.lastOutputAt) || 0);
    })
    .slice(0, MAX_CONTEXT_OUTPUT_WORKERS)
    .map(worker => worker.id);
}

function boundedOutput(snapshot) {
  const lines = Array.isArray(snapshot?.recentLines) ? snapshot.recentLines : [];
  return lines.slice(-MAX_CONTEXT_OUTPUT_LINES).map(line => String(line).slice(0, MAX_CONTEXT_OUTPUT_LINE_LENGTH));
}

function boundedInput(snapshot) {
  const events = Array.isArray(snapshot?.inputEvidence) ? snapshot.inputEvidence : [];
  return events.slice(-6).map(event => ({
    sequence: Number.isInteger(event.sequence) ? event.sequence : null,
    at: Number(event.at) || null,
    source: event.source || "groundstation",
    kind: event.kind || "command",
    preview: String(event.preview || "").slice(0, 180),
    redacted: event.redacted === true,
    byteLength: Number(event.byteLength) || 0
  }));
}

function vscodeContext(status) {
  if (!status) return null;
  return {
    connected: status.connected === true,
    service: status.service || "unavailable",
    connection: status.connection ? {
      extensionVersion: status.connection.extensionVersion || null,
      connectedAt: status.connection.connectedAt || null,
      capabilities: Array.isArray(status.connection.capabilities) ? status.connection.capabilities.slice(0, 20) : []
    } : null,
    editor: status.editor ? clone(status.editor) : null,
    diagnostics: status.diagnostics ? clone(status.diagnostics) : null,
    git: status.git ? clone(status.git) : null,
    tasks: Array.isArray(status.tasks) ? status.tasks.slice(0, 20).map(clone) : [],
    terminals: Array.isArray(status.terminals) ? status.terminals.slice(0, 32).map(terminal => ({
      id: terminal.id || null,
      name: terminal.name,
      state: terminal.state,
      ownership: terminal.ownership || "vscode-owned",
      controllable: terminal.controllable === true,
      active: terminal.active === true,
      shellIntegration: terminal.shellIntegration === true,
      currentCommand: terminal.currentCommand || null,
      commandState: terminal.commandState || "idle",
      cwd: terminal.cwd || null,
      source: "vscode",
      observability: terminal.shellIntegration ? "bounded-activity-metadata" : "identity-only"
    })) : [],
    lastSyncAt: status.lastSyncAt || null,
    lastError: status.lastError || null
  };
}

function enforceBudget(context) {
  if (serializedBytes(context) <= MAX_CONTEXT_BYTES) return context;
  context.budget.truncated = true;
  for (const worker of context.workers) delete worker.recentOutput;
  context.visibility.terminalOutput = "omitted-by-budget";
  context.activity = context.activity.slice(-20);
  if (serializedBytes(context) <= MAX_CONTEXT_BYTES) return context;
  context.projectMemory.chapters = context.projectMemory.chapters.slice(0, 10).map(chapter => ({ ...chapter, events: [] }));
  if (context.integrations.vscode?.diagnostics) context.integrations.vscode.diagnostics.items = [];
  if (serializedBytes(context) <= MAX_CONTEXT_BYTES) return context;
  context.workers = context.workers.slice(0, 25);
  context.attention = context.attention.slice(0, 20);
  context.missions = context.missions.slice(0, 10);
  context.recipes = context.recipes.slice(0, 10);
  if (serializedBytes(context) <= MAX_CONTEXT_BYTES) return context;
  context.projectMemory = {
    generatedAt: context.projectMemory.generatedAt,
    latestSequence: context.projectMemory.latestSequence,
    since: context.projectMemory.since,
    why: context.projectMemory.why,
    chapters: [],
    causalLinks: [],
    resumePoints: context.projectMemory.resumePoints?.slice(0, 5) || [],
    current: []
  };
  return context;
}

class MissionContextService {
  constructor(options = {}) {
    if (typeof options.getEngineApi !== "function") throw new TypeError("MissionContextService requires getEngineApi");
    this.getEngineApi = options.getEngineApi;
    this.getVSCodeStatus = typeof options.getVSCodeStatus === "function" ? options.getVSCodeStatus : () => null;
    this.now = options.now || Date.now;
  }

  snapshot(rawOptions = {}) {
    const options = validateOptions(rawOptions);
    const engineApi = this.getEngineApi();
    if (!engineApi) throw new Error("Mission Context engine is unavailable");
    const workspace = engineApi.getWorkspace();
    const allSessions = engineApi.list();
    const sessions = allSessions.slice(0, MAX_CONTEXT_WORKERS);
    const workers = sessions.map(session => safeWorker(session, workspace));
    const includedOutputIds = outputWorkerIds(options, workers);
    for (const worker of workers) {
      if (!includedOutputIds.includes(worker.id)) continue;
      const snapshot = engineApi.getSnapshot(worker.id);
      worker.recentOutput = boundedOutput(snapshot);
      worker.terminalEvidence = {
        source: "EngineAPI",
        observedAt: Math.max(Number(snapshot?.lastOutputAt) || 0, Number(snapshot?.lastInputAt) || 0) || null,
        output: worker.recentOutput.map((line, index) => ({
          at: Number(snapshot?.lastOutputAt) || null,
          source: "pty",
          ordinal: index + 1,
          text: line
        })),
        input: boundedInput(snapshot)
      };
    }
    const attentionState = engineApi.listAttention?.() || { records: [] };
    const memory = engineApi.getProjectMemory({ afterSequence: options.afterSequence });
    const activity = engineApi.getActivity({ afterSequence: options.afterSequence, limit: MAX_CONTEXT_ACTIVITY });
    const context = {
      contextVersion: MISSION_CONTEXT_VERSION,
      generatedAt: this.now(),
      project: {
        name: workspace.name,
        persistent: workspace.persistent === true,
        workerCount: workers.length,
        loadErrorCount: Number(workspace.loadErrorCount) || 0
      },
      overall: summarizeWorkers(workers),
      workers,
      attention: Array.isArray(attentionState.records)
        ? attentionState.records
            .filter(record => record && record.state !== "recovered" && record.state !== "resolved" && record.state !== "dismissed")
            .slice(0, MAX_CONTEXT_ATTENTION)
            .map(clone)
        : [],
      missions: (engineApi.listMissions?.() || []).slice(0, MAX_CONTEXT_MISSIONS).map(clone),
      projectMemory: clone(memory),
      recipes: (engineApi.listRecipes?.() || []).slice(0, MAX_CONTEXT_RECIPES).map(clone),
      activity: Array.isArray(activity.events) ? activity.events.slice(-MAX_CONTEXT_ACTIVITY).map(clone) : [],
      integrations: { vscode: vscodeContext(this.getVSCodeStatus()) },
      sources: {
        lifecycle: "EngineAPI",
        metrics: "EngineAPI Worker Intelligence",
        dependencies: "Workspace Recipes",
        memory: "Project Memory 2",
        attention: "Needs You",
        editor: "VS Code Bridge"
      },
      visibility: {
        terminalOutput: includedOutputIds.length ? "sanitized-bounded" : "omitted",
        terminalInput: includedOutputIds.length ? "sanitized-bounded-command-evidence" : "omitted",
        sourceCode: "omitted",
        environmentValues: "omitted",
        sensitiveData: "redacted"
      },
      budget: {
        maxBytes: MAX_CONTEXT_BYTES,
        maxWorkers: MAX_CONTEXT_WORKERS,
        maxOutputWorkers: MAX_CONTEXT_OUTPUT_WORKERS,
        maxOutputLinesPerWorker: MAX_CONTEXT_OUTPUT_LINES,
        truncated: allSessions.length > MAX_CONTEXT_WORKERS
      }
    };
    const sanitized = sanitizeContextValue(context, {
      maxArrayItems: 100,
      maxObjectKeys: 120,
      maxStringLength: 2000
    });
    const bounded = enforceBudget(sanitized.value);
    bounded.privacy = {
      redactionCount: sanitized.redactions,
      truncationCount: sanitized.truncations,
      policy: "structured-bounded-redacted"
    };
    bounded.budget.bytes = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const measured = serializedBytes(bounded);
      if (bounded.budget.bytes === measured) break;
      bounded.budget.bytes = measured;
    }
    if (bounded.budget.bytes > MAX_CONTEXT_BYTES) {
      throw new Error("Mission Context exceeded its hard serialization budget");
    }
    return bounded;
  }
}

module.exports = {
  MAX_CONTEXT_ACTIVITY,
  MAX_CONTEXT_ATTENTION,
  MAX_CONTEXT_BYTES,
  MAX_CONTEXT_MISSIONS,
  MAX_CONTEXT_OUTPUT_LINES,
  MAX_CONTEXT_OUTPUT_WORKERS,
  MAX_CONTEXT_RECIPES,
  MAX_CONTEXT_WORKERS,
  MISSION_CONTEXT_VERSION,
  MissionContextService,
  serializedBytes,
  validateOptions,
  workerKind,
  workerRole,
  workerState
};
