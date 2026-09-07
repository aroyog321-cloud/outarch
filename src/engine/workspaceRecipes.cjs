"use strict";

const RECIPE_LIMIT = 20;
// T077 — how many finished runs are kept per recipe. Bounded like every other
// history in the engine; enough to see a recovery and what it recovered from.
const RECIPE_RUN_HISTORY_LIMIT = 10;
const MAX_RECIPE_STEPS = 50;
const MAX_RECIPE_PARALLELISM = 8;
const MAX_RECIPE_RETRIES = 3;
const RECIPE_LAYOUTS = new Set(["single", "horizontal", "vertical", "grid-2x2", "grid-3x2"]);
const READINESS_GATES = Object.freeze([
  "running",
  "service",
  "tests",
  "healthy",
  "build",
  "database",
  "container",
  "git-clean",
  "exited-zero"
]);

function boundedInteger(value, fallback, minimum, maximum) {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}

function dependencyCycle(steps) {
  const remaining = new Map(steps.map(step => [step.workerId, new Set(step.dependsOn)]));
  const ready = [...remaining].filter(([, dependencies]) => dependencies.size === 0).map(([workerId]) => workerId);
  let visited = 0;
  while (ready.length) {
    const workerId = ready.shift();
    if (!remaining.has(workerId)) continue;
    remaining.delete(workerId);
    visited++;
    for (const [candidate, dependencies] of remaining) {
      dependencies.delete(workerId);
      if (dependencies.size === 0) ready.push(candidate);
    }
  }
  return visited === steps.length ? [] : [...remaining.keys()];
}

function normalizeRecipe(value, sessionIds) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("recipe must be an object");
  const id = String(value.id || "").trim();
  const name = String(value.name || "").trim();
  if (!id || !/^[A-Za-z0-9._-]{1,80}$/.test(id)) throw new TypeError("recipe id is invalid");
  if (!name || name.length > 60) throw new TypeError("recipe name is invalid");
  const readinessTimeoutMs = boundedInteger(value.readinessTimeoutMs, 10000, 1000, 60000);
  if (value.failurePolicy !== undefined && !["stop", "continue"].includes(value.failurePolicy)) throw new TypeError("recipe failure policy is invalid");
  if (value.recoveryPolicy !== undefined && !["keep-running", "rollback-started"].includes(value.recoveryPolicy)) throw new TypeError("recipe recovery policy is invalid");
  if (value.restartPolicy !== undefined && !["reuse-running", "restart-running"].includes(value.restartPolicy)) throw new TypeError("recipe restart policy is invalid");
  const suppliedSteps = Array.isArray(value.steps)
    ? value.steps
    : (value.workerIds || []).map((workerId, index, list) => ({ workerId, dependsOn: index ? [list[index - 1]] : [] }));
  if (!suppliedSteps.length || suppliedSteps.length > MAX_RECIPE_STEPS) throw new TypeError(`recipe must contain 1 to ${MAX_RECIPE_STEPS} steps`);
  const steps = suppliedSteps.map(step => {
    const workerId = String(step?.workerId || "");
    if (!sessionIds.has(workerId)) throw new TypeError(`recipe worker is missing: ${workerId}`);
    const dependsOn = Array.isArray(step.dependsOn) ? [...new Set(step.dependsOn.map(String))] : [];
    if (dependsOn.includes(workerId) || dependsOn.some(dependency => !sessionIds.has(dependency))) {
      throw new TypeError(`recipe dependencies are invalid for: ${workerId}`);
    }
    if (step.readiness !== undefined && !READINESS_GATES.includes(step.readiness)) throw new TypeError(`recipe readiness gate is invalid for: ${workerId}`);
    return {
      workerId,
      dependsOn,
      readiness: READINESS_GATES.includes(step.readiness) ? step.readiness : "running",
      timeoutMs: boundedInteger(step.timeoutMs, readinessTimeoutMs, 1000, 60000)
    };
  });
  const workerIds = steps.map(step => step.workerId);
  if (new Set(workerIds).size !== workerIds.length) throw new TypeError("recipe workers must be unique");
  for (const step of steps) {
    if (step.dependsOn.some(dependency => !workerIds.includes(dependency))) {
      throw new TypeError(`dependency is not part of recipe: ${step.workerId}`);
    }
  }
  const cyclicIds = dependencyCycle(steps);
  if (cyclicIds.length) throw new TypeError(`recipe dependency cycle: ${cyclicIds.join(", ")}`);
  const layoutId = RECIPE_LAYOUTS.has(value.layoutId) ? value.layoutId : "grid-2x2";
  const layoutSessionIds = [];
  for (const candidate of Array.isArray(value.sessionIds) ? value.sessionIds.slice(0, 6) : []) {
    if (candidate === null || candidate === undefined) { layoutSessionIds.push(null); continue; }
    const workerId = String(candidate);
    layoutSessionIds.push(sessionIds.has(workerId) && !layoutSessionIds.includes(workerId) ? workerId : null);
  }
  return {
    recipeVersion: 2,
    id,
    name,
    steps,
    workerIds,
    layoutId,
    sessionIds: layoutSessionIds,
    failurePolicy: value.failurePolicy === "continue" ? "continue" : "stop",
    recoveryPolicy: value.recoveryPolicy === "rollback-started" ? "rollback-started" : "keep-running",
    restartPolicy: value.restartPolicy === "restart-running" ? "restart-running" : "reuse-running",
    maxParallel: boundedInteger(value.maxParallel, 1, 1, MAX_RECIPE_PARALLELISM),
    retryAttempts: boundedInteger(value.retryAttempts, 0, 0, MAX_RECIPE_RETRIES),
    retryDelayMs: boundedInteger(value.retryDelayMs, 500, 100, 10000),
    readinessTimeoutMs,
    // T076 — `recipeVersion` is the schema; `revision` is this recipe's own
    // edit counter, and it is what conflict detection compares. It is carried
    // forward from the caller only so `saveRecipe` can bump it — a client
    // cannot choose its own revision.
    revision: Number.isInteger(value.revision) && value.revision > 0 ? value.revision : 1,
    updatedAt: Date.now()
  };
}

function cloneRun(run) {
  if (!run) return null;
  return {
    ...run,
    completed: [...run.completed],
    failures: run.failures.map(failure => ({ ...failure })),
    runningWorkerIds: [...run.runningWorkerIds],
    startedWorkerIds: [...run.startedWorkerIds],
    rollback: run.rollback ? { ...run.rollback, workerIds: [...run.rollback.workerIds] } : null,
    stepStates: Object.fromEntries(Object.entries(run.stepStates).map(([workerId, state]) => [workerId, { ...state }]))
  };
}

module.exports = {
  RECIPE_RUN_HISTORY_LIMIT,
  MAX_RECIPE_PARALLELISM,
  MAX_RECIPE_RETRIES,
  MAX_RECIPE_STEPS,
  READINESS_GATES,
  RECIPE_LIMIT,
  cloneRun,
  dependencyCycle,
  normalizeRecipe
};
