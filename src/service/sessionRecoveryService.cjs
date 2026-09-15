"use strict";

// Session Recovery Service for Mission Control.
// Reconciles interrupted workers after unexpected crashes or unclean shutdowns.
// Formulates reviewed recovery proposals without automatic unauthorized execution.

const { sessionJournal } = require("./sessionJournal.cjs");

class SessionRecoveryService {
  #journal;

  constructor(journal = sessionJournal) {
    this.#journal = journal;
  }

  inspectRecovery(projectId, currentSessions = []) {
    const prior = this.#journal.inspectPriorSession(projectId);
    const existingSessionIds = new Set(currentSessions.map(s => s.id));

    const reconciledWorkers = prior.priorRuns.map(run => {
      const isCurrentlyAlive = currentSessions.some(s => s.id === run.workerId && s.isAlive);
      let state = "interrupted";
      let detail = "Session ended abruptly without clean termination record";

      if (isCurrentlyAlive) {
        state = "running-reconnectable";
        detail = "Process is currently alive and active under Mission Control";
      } else if (run.status === "exited") {
        state = "exited";
        detail = `Worker previously exited with code ${run.exitCode ?? 0}`;
      } else if (existingSessionIds.has(run.workerId)) {
        state = "ready-to-restart";
        detail = "Configured in workspace, ready for reviewed restart";
      }

      return {
        workerId: run.workerId,
        workerRunId: run.workerRunId,
        pid: run.pid,
        previousStatus: run.status,
        recoveryState: state,
        detail,
        startedAt: run.startedAt,
        eligibleForRestart: state === "ready-to-restart" || state === "interrupted"
      };
    });

    return {
      projectId,
      cleanShutdown: prior.wasClean,
      recoveryRequired: prior.reconciliationNeeded,
      uncleanWorkerCount: reconciledWorkers.filter(w => w.recoveryState === "interrupted" || w.recoveryState === "ready-to-restart").length,
      workers: reconciledWorkers
    };
  }

  proposeRecoveryPlan(projectId, selectedWorkerIds = [], workspaceSessions = []) {
    const recoveryReport = this.inspectRecovery(projectId, workspaceSessions);
    const targets = selectedWorkerIds.length > 0
      ? recoveryReport.workers.filter(w => selectedWorkerIds.includes(w.workerId))
      : recoveryReport.workers.filter(w => w.eligibleForRestart);

    if (targets.length === 0) {
      return {
        summary: "No interrupted workers require recovery.",
        actions: []
      };
    }

    const actions = targets.map(worker => ({
      type: "start",
      workerId: worker.workerId,
      reason: `Recover interrupted worker ${worker.workerId} from previous crash`
    }));

    return {
      summary: `Restart ${actions.length} interrupted worker${actions.length === 1 ? "" : "s"} from previous session.`,
      targetWorkerIds: targets.map(t => t.workerId),
      actions
    };
  }

  inspect(projectId = "default", currentSessions = []) {
    return this.inspectRecovery(projectId, currentSessions);
  }

  propose(projectId = "default", selectedWorkerIds = [], workspaceSessions = []) {
    return this.proposeRecoveryPlan(projectId, selectedWorkerIds, workspaceSessions);
  }
}

const sessionRecoveryService = new SessionRecoveryService();

module.exports = {
  SessionRecoveryService,
  sessionRecoveryService
};
