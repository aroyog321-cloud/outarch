"use strict";

// Explicit attribution mapping for Usage Records.
// Links telemetry, direct Gemini requests, and CLI records to project/worker/mission identities.

class UsageAttribution {
  /** @type {Map<string, object>} session mappings */
  #sessionBindings = new Map();

  bindSession(agentSessionId, context = {}) {
    if (!agentSessionId) return;
    this.#sessionBindings.set(agentSessionId, {
      projectId: context.projectId || null,
      workerId: context.workerId || null,
      workerRunId: context.workerRunId || null,
      missionId: context.missionId || null,
      recipeRunId: context.recipeRunId || null,
      boundAt: Date.now()
    });
  }

  resolveAttribution(record = {}) {
    if (record.agentSessionId && this.#sessionBindings.has(record.agentSessionId)) {
      const binding = this.#sessionBindings.get(record.agentSessionId);
      return {
        projectId: record.projectId || binding.projectId,
        workerId: record.workerId || binding.workerId,
        workerRunId: record.workerRunId || binding.workerRunId,
        missionId: record.missionId || binding.missionId,
        recipeRunId: record.recipeRunId || binding.recipeRunId,
        attribution: "session-match"
      };
    }

    if (record.projectId || record.workerId || record.missionId) {
      return {
        projectId: record.projectId || null,
        workerId: record.workerId || null,
        workerRunId: record.workerRunId || null,
        missionId: record.missionId || null,
        recipeRunId: record.recipeRunId || null,
        attribution: "explicit"
      };
    }

    return {
      projectId: null,
      workerId: null,
      workerRunId: null,
      missionId: null,
      recipeRunId: null,
      attribution: "unassigned"
    };
  }

  clearProject(projectId) {
    for (const [id, binding] of this.#sessionBindings) {
      if (binding.projectId === projectId) {
        this.#sessionBindings.delete(id);
      }
    }
  }
}

const usageAttribution = new UsageAttribution();

module.exports = {
  UsageAttribution,
  usageAttribution
};
