"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { test } = require("node:test");
const { SessionJournal } = require("../src/service/sessionJournal.cjs");
const { SessionRecoveryService } = require("../src/service/sessionRecoveryService.cjs");

test("SessionJournal tracks clean shutdown vs abrupt crashes", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-journal-test-"));
  const journal = new SessionJournal(tmpDir);

  journal.startSession("test-proj");
  journal.recordConfirmedRun("test-proj", "worker-1", "run-1", 12345);

  const check1 = journal.inspectPriorSession("test-proj");
  assert.equal(check1.wasClean, false);
  assert.equal(check1.reconciliationNeeded, true);
  assert.equal(check1.priorRuns.length, 1);

  journal.markCleanShutdown("test-proj");
  const check2 = journal.inspectPriorSession("test-proj");
  assert.equal(check2.wasClean, true);
  assert.equal(check2.reconciliationNeeded, false);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("SessionRecoveryService formulates recovery proposal for interrupted workers", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mc-journal-test-"));
  const journal = new SessionJournal(tmpDir);
  const recoveryService = new SessionRecoveryService(journal);

  journal.startSession("test-proj");
  journal.recordConfirmedRun("test-proj", "web", "run-1", 1001);
  journal.recordConfirmedRun("test-proj", "api", "run-2", 1002);

  const report = recoveryService.inspectRecovery("test-proj", [{ id: "web" }, { id: "api" }]);
  assert.equal(report.recoveryRequired, true);
  assert.equal(report.uncleanWorkerCount, 2);

  const plan = recoveryService.proposeRecoveryPlan("test-proj", [], [{ id: "web" }, { id: "api" }]);
  assert.equal(plan.actions.length, 2);
  assert.equal(plan.actions[0].workerId, "web");
  assert.equal(plan.actions[1].workerId, "api");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
