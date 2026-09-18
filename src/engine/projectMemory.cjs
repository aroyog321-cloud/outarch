const MAX_MEMORY_CHAPTERS = 20;
const MAX_CHAPTER_EVENTS = 30;
const MAX_CAUSAL_LINKS = 20;
const MAX_RESUME_POINTS = 5;

function sessionIdFor(event) {
  return event?.id || event?.sessionId || null;
}

function actorFor(event, sessionById) {
  const id = sessionIdFor(event);
  return event?.name || sessionById.get(id)?.name || id || event?.operation || "Workspace";
}

function isFailureEvent(event) {
  const evidence = event?.evidence || {};
  return /failed|error|spawn-error/i.test(String(event?.type)) ||
    event?.status === "failed" ||
    evidence.status === "failed" ||
    evidence.connection === "failed" ||
    evidence.health === "failed" ||
    evidence.healthy === false ||
    Number(evidence.failed) > 0 ||
    Number(evidence.suitesFailed) > 0 ||
    (event?.type === "session:exit" && Number.isInteger(event.exitCode) && event.exitCode !== 0 && event.intentional !== true);
}

function isVerifiedSuccessEvent(event) {
  const evidence = event?.evidence || {};
  if (event?.type === "session:exit" && event.exitCode === 0 && event.intentional !== true) return true;
  if (event?.type !== "session:evidence") return false;
  if (event.category === "tests") return evidence.status === "passed" || (Number(evidence.passed) > 0 && Number(evidence.failed) === 0 && Number(evidence.suitesFailed || 0) === 0);
  if (event.category === "build") return evidence.status === "completed";
  if (event.category === "service") return evidence.ready === true || evidence.health === "confirmed";
  if (event.category === "database") return evidence.connected === true || evidence.connection === "confirmed";
  if (event.category === "container") return evidence.healthy === true;
  return false;
}

function evidenceStatement(event) {
  const evidence = event?.evidence || {};
  if (event?.category === "tests") { const passed = Number(evidence.passed) || 0; return `${passed} test${passed === 1 ? "" : "s"} passed${Number(evidence.failed) ? ` and ${Number(evidence.failed)} failed` : ""}`; }
  if (event?.category === "build") return evidence.status === "completed" ? "the build completed" : `the build reported ${evidence.status || "an update"}`;
  if (event?.category === "service") return evidence.ready ? "the service reported ready" : `service health was ${evidence.health || "recorded"}`;
  if (event?.category === "database") return evidence.connected ? "the database connection was confirmed" : `database connectivity was ${evidence.connection || "recorded"}`;
  if (event?.category === "container") return evidence.healthy ? "container health was confirmed" : `the container reported ${evidence.state || "an update"}`;
  if (event?.type === "session:exit" && event.exitCode === 0) return "the run exited successfully";
  return String(event?.type || "engine evidence").replaceAll(":", " ");
}

function failureStatement(event) {
  const evidence = event?.evidence || {};
  if (event?.reason) return String(event.reason).slice(0, 240);
  if (event?.type === "session:spawn-error") return "the worker could not start";
  if (event?.type === "session:exit" && Number.isInteger(event.exitCode)) return `the process exited with code ${event.exitCode}`;
  if (event?.category === "tests") {
    const tests = Number(evidence.failed);
    if (tests) return `${tests} test${tests === 1 ? "" : "s"} failed`;
    const suites = Number(evidence.suitesFailed);
    if (suites) return `${suites} test suite${suites === 1 ? "" : "s"} failed`;
    return "a test run failed";
  }
  if (event?.category === "build") return "the build failed";
  if (event?.category === "service") return "service health failed";
  if (event?.category === "database") return "database connectivity failed";
  if (event?.category === "container") return "container health failed";
  return "the engine recorded a failed worker state";
}

function compactEvent(event) {
  return {
    sequence: event.sequence,
    type: event.type,
    timestamp: event.timestamp,
    status: event.status || null,
    category: event.category || null,
    reason: event.reason ? String(event.reason).slice(0, 240) : null,
    exitCode: Number.isInteger(event.exitCode) ? event.exitCode : null,
    evidence: event.evidence ? JSON.parse(JSON.stringify(event.evidence)) : null
  };
}

function buildChapter(group) {
  const ordered = [...group.events].sort((left, right) => left.sequence - right.sequence);
  const failures = ordered.filter(isFailureEvent);
  const firstFailure = failures[0] || null;
  const verified = ordered.filter(isVerifiedSuccessEvent).filter(event => !firstFailure || event.sequence > firstFailure.sequence).at(-1) || null;
  const lastStatus = [...ordered].reverse().find(event => event.type === "session:status")?.status || null;
  const lastExit = [...ordered].reverse().find(event => event.type === "session:exit") || null;
  const lastEvidence = [...ordered].reverse().find(event => event.type === "session:evidence") || null;
  let state = failures.length ? "unresolved" : lastExit?.exitCode === 0 ? "completed" : lastStatus === "running" ? "active" : "ended";
  if (firstFailure && verified) state = "recovered";
  const failure = firstFailure ? failureStatement(firstFailure) : null;
  const verification = verified ? evidenceStatement(verified) : null;
  const summary = state === "recovered"
    ? `${group.actor} recovered after ${failure}; ${verification}.`
    : state === "unresolved"
      ? `${group.actor} needs review because ${failure}.`
      : state === "completed"
        ? `${group.actor} completed; ${evidenceStatement(lastEvidence || lastExit)}.`
        : state === "active"
          ? `${group.actor} is running${lastEvidence ? `; latest evidence says ${evidenceStatement(lastEvidence)}` : " under engine supervision"}.`
          : `${group.actor} ended without a recorded failure.`;
  const latest = ordered.at(-1);
  const resumePoint = {
    title: state === "unresolved" ? `Review ${group.actor}` : state === "active" ? `Return to ${group.actor}` : `Review ${group.actor} run`,
    detail: summary,
    sequence: (firstFailure || latest)?.sequence || null,
    action: "inspect-worker"
  };
  return {
    correlationId: group.correlationId,
    sessionId: group.sessionId,
    actor: group.actor,
    state,
    startedAt: ordered[0]?.timestamp || null,
    endedAt: lastExit?.timestamp || null,
    failedAt: firstFailure?.timestamp || null,
    recoveredAt: verified?.timestamp || null,
    latestAt: latest?.timestamp || null,
    latestSequence: latest?.sequence || null,
    eventCount: ordered.length,
    evidenceCount: ordered.filter(event => event.type === "session:evidence").length,
    summary,
    failure,
    verification,
    resumePoint,
    relationships: [],
    events: ordered.slice(-MAX_CHAPTER_EVENTS).map(compactEvent),
    _hasFailure: Boolean(firstFailure),
    _hasVerifiedSuccess: Boolean(verified),
    _hasRunningState: ordered.some(event => event.type === "session:status" && event.status === "running"),
    _verifiedSequence: verified?.sequence || null
  };
}

function buildProjectMemory(events = [], sessions = [], options = {}) {
  const safeEvents = Array.isArray(events) ? events : [];
  const safeSessions = Array.isArray(sessions) ? sessions : [];
  const sessionById = new Map(safeSessions.map(session => [session.id, session]));
  const afterSequence = Number.isInteger(options.afterSequence) && options.afterSequence >= 0 ? options.afterSequence : 0;
  const groups = new Map();

  for (const event of safeEvents) {
    if (!event?.correlationId) continue;
    const sessionId = sessionIdFor(event);
    const group = groups.get(event.correlationId) || {
      correlationId: event.correlationId,
      sessionId,
      actor: actorFor(event, sessionById),
      events: []
    };
    group.events.push(event);
    groups.set(event.correlationId, group);
  }

  const allChapters = [...groups.values()].map(buildChapter);
  const bySession = new Map();
  for (const chapter of allChapters) {
    const list = bySession.get(chapter.sessionId) || [];
    list.push(chapter);
    bySession.set(chapter.sessionId, list);
  }

  const causalLinks = [];
  for (const [sessionId, chapters] of bySession.entries()) {
    if (!sessionId) continue;
    chapters.sort((left, right) => (left.startedAt || 0) - (right.startedAt || 0));
    let unresolved = null;
    for (let index = 0; index < chapters.length; index++) {
      const chapter = chapters[index];
      const previous = chapters[index - 1] || null;
      if (previous) chapter.relationships.push({ type: "follows", chapterId: previous.correlationId, basis: "same-worker chronology" });
      if (unresolved && chapter !== unresolved) {
        const recovered = chapter._hasVerifiedSuccess;
        const link = {
          type: recovered ? "recovery" : "retry",
          fromChapterId: unresolved.correlationId,
          toChapterId: chapter.correlationId,
          sessionId: chapter.sessionId,
          basis: recovered ? "same worker plus later verified evidence" : "same worker plus later run",
          verifiedBySequence: recovered ? chapter._verifiedSequence : null
        };
        causalLinks.push(link);
        chapter.relationships.push({ type: recovered ? "recovers" : "retries", chapterId: unresolved.correlationId, basis: link.basis });
        if (recovered) {
          unresolved.state = "recovered";
          unresolved.recoveredAt = chapter.recoveredAt || chapter.latestAt;
          unresolved.recoveryChapterId = chapter.correlationId;
          unresolved.summary = `${unresolved.actor} recovered in a later run; ${chapter.verification}.`;
          unresolved = null;
        } else if (chapter._hasRunningState && !chapter._hasFailure) {
          unresolved.state = "retrying";
          unresolved.retryChapterId = chapter.correlationId;
          unresolved.summary = `${unresolved.actor} is retrying after ${unresolved.failure}; verification has not been recorded.`;
        }
      }
      if (chapter._hasFailure && !chapter._hasVerifiedSuccess) unresolved = chapter;
    }
  }

  const chapters = allChapters
    .sort((left, right) => (right.latestAt || 0) - (left.latestAt || 0))
    .slice(0, MAX_MEMORY_CHAPTERS)
    .map(chapter => {
      const { _hasFailure, _hasVerifiedSuccess, _hasRunningState, _verifiedSequence, ...publicChapter } = chapter;
      return publicChapter;
    });
  const visibleChapterIds = new Set(chapters.map(chapter => chapter.correlationId));
  const links = causalLinks
    .filter(link => visibleChapterIds.has(link.fromChapterId) && visibleChapterIds.has(link.toChapterId))
    .slice(-MAX_CAUSAL_LINKS)
    .map(link => ({ ...link }));

  const since = safeEvents.filter(event => event.sequence > afterSequence);
  const risks = since.filter(isFailureEvent);
  const evidence = since.filter(event => event.type === "session:evidence");
  const actors = new Set(since.map(event => actorFor(event, sessionById)).filter(Boolean));
  const unresolvedCount = chapters.filter(chapter => ["unresolved", "retrying"].includes(chapter.state)).length;
  const recoveredCount = chapters.filter(chapter => chapter.state === "recovered").length;
  const why = chapters
    .filter(chapter => ["unresolved", "retrying", "recovered"].includes(chapter.state))
    .slice(0, 5)
    .map(chapter => ({
      sequence: chapter.resumePoint?.sequence || chapter.latestSequence,
      actor: chapter.actor,
      statement: chapter.summary,
      correlationId: chapter.correlationId,
      state: chapter.state,
      recoveryChapterId: chapter.recoveryChapterId || null
    }));

  const chapterById = new Map(chapters.map(chapter => [chapter.correlationId, chapter]));
  const resumePoints = safeSessions
    .map(session => {
      const chapter = session.correlationId ? chapterById.get(session.correlationId) : chapters.find(item => item.sessionId === session.id);
      const priority = session.status === "failed" ? 0 : session.attentionRequired ? 1 : session.isAlive ? 2 : 3;
      return {
        workerId: session.id,
        workerName: session.name,
        priority,
        state: session.status === "failed" ? "failed" : session.attentionRequired ? "attention" : session.isAlive ? "running" : "idle",
        title: session.status === "failed" || session.attentionRequired ? `Review ${session.name}` : session.isAlive ? `Resume ${session.name}` : `Return to ${session.name}`,
        detail: chapter?.summary || (session.isAlive ? "The worker is running under engine supervision." : "The worker is configured and ready."),
        chapterId: chapter?.correlationId || null,
        sequence: chapter?.resumePoint?.sequence || null,
        lastOutputAt: session.lastOutputAt || null
      };
    })
    .sort((left, right) => left.priority - right.priority || Number(right.lastOutputAt || 0) - Number(left.lastOutputAt || 0))
    .slice(0, MAX_RESUME_POINTS)
    .map(({ priority, ...point }) => point);

  return {
    generatedAt: Date.now(),
    afterSequence,
    latestSequence: Number(options.latestSequence) || safeEvents.at(-1)?.sequence || 0,
    since: {
      eventCount: since.length,
      riskCount: risks.length,
      evidenceCount: evidence.length,
      actorCount: actors.size,
      unresolvedCount,
      recoveredCount,
      summary: since.length
        ? `Since your last review: ${since.length} recorded changes across ${actors.size || 1} actor${actors.size === 1 ? "" : "s"}. ${unresolvedCount ? `${unresolvedCount} run${unresolvedCount === 1 ? " remains" : "s remain"} unresolved.` : "No run remains unresolved."}${recoveredCount ? ` ${recoveredCount} recovery ${recoveredCount === 1 ? "was" : "were"} verified.` : ""}`
        : "No engine-recorded changes since your last review."
    },
    why,
    chapters,
    causalLinks: links,
    resumePoints,
    current: safeSessions.map(session => ({
      id: session.id,
      name: session.name,
      status: session.status,
      isAlive: session.isAlive,
      attentionRequired: session.attentionRequired,
      lastOutputAt: session.lastOutputAt,
      chapterId: session.correlationId || null,
      health: session.health ? { tone: session.health.tone, label: session.health.label } : null
    }))
  };
}

module.exports = {
  MAX_CAUSAL_LINKS,
  MAX_CHAPTER_EVENTS,
  MAX_MEMORY_CHAPTERS,
  MAX_RESUME_POINTS,
  buildProjectMemory,
  isFailureEvent,
  isVerifiedSuccessEvent
};
