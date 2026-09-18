"use strict";

// Phase 5 - Agents (T106, T108, T109, T110).
//
// T108 was measured, not guessed: at 1440x900 the route reported 18px of PAGE
// overflow with `.agent-detail-scroll` nested one level inside it, so the
// operator had two scrollbars for one pane. After the fix the route reports
// 0px of page overflow and exactly one scroller at nesting depth 0, at 1440x900,
// 1024x768 and 800x680.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
const read = (...parts) => fs.readFileSync(path.join(rendererRoot, ...parts), "utf8");

test("T106 - a failed mission load is an explicit recoverable error, and the last good list survives it", () => {
  const agents = read("AgentWorkspace.jsx");

  // The catch keeps `missions` untouched. Clobbering to [] is the defect: it
  // reads as "no mission assigned", which is a different and false claim.
  const refresh = agents.slice(agents.indexOf("const refreshMissions"), agents.indexOf("React.useEffect(() => { void refreshMissions();"));
  assert.match(refresh, /catch \{ setMissionsError\(true\); \}/);
  assert.doesNotMatch(refresh, /catch[\s\S]{0,60}setMissions\(\[\]\)/, "a failed load must not clear the last-known-good list");

  // The error is stated, scoped to what is actually stale, and recoverable.
  assert.match(agents, /missionsError && <div className="agent-missions-stale" role="status">/);
  assert.match(agents, /Mission contracts could not be refreshed\./);
  assert.match(agents, /Agent identity and lifecycle are current; the mission detail below may be out of date\./);
  assert.match(agents, /<button type="button" onClick=\{\(\) => void refreshMissions\(\)\}>Retry<\/button>/);
});

test("T108 - the Agents route is a fixed frame, so nothing scrolls inside a page that also scrolls", () => {
  const screens = read("redesign", "screens.css");

  // The route fills its own height as a flex child. `height: 100%` could not:
  // `.agent-operations` carries an 18px top margin from styles.css, so a
  // full-height child began below the content box and overflowed the route.
  assert.match(screens, /#root#root \.shell \.experience\.view-agents \{\s*\n\s*display: flex;\s*\n\s*flex-direction: column;\s*\n\s*min-height: 0;\s*\n\}/);

  const frame = screens.slice(screens.indexOf(".agent-operations.agent-operations-v2 {"));
  const block = frame.slice(0, frame.indexOf("}"));
  assert.match(block, /flex: 1 1 auto;/);
  assert.match(block, /height: auto;/);
  assert.match(block, /min-height: 0;/);
  assert.match(block, /margin-top: 0;/, "the inherited 18px top margin is what pushed the frame past the route");
  assert.doesNotMatch(block, /height: 100%;/);

  // styles.css still declares that margin; the assertion above is only
  // meaningful while it does, so pin the thing being corrected.
  assert.match(read("styles.css"), /\.agent-operations \{ margin-top: 18px; \}/);
});

test("T109 - decisions about the selected agent surface in the agent's own zone", () => {
  const agents = read("AgentWorkspace.jsx");

  assert.match(agents, /function decisionsForAgent\(records, agent, missions\)/);
  // Only active records, and only two honest ways to relate one to an agent:
  // the target IS the agent session, or the target is a mission this agent owns.
  const matcher = agents.slice(agents.indexOf("function decisionsForAgent"), agents.indexOf("export default function AgentWorkspace"));
  assert.match(matcher, /ACTIVE_DECISION_STATUSES\.has\(record\.status\)/);
  assert.match(matcher, /record\.target\?\.kind === "agent"\) return record\.target\.id === agent\.id/);
  assert.match(matcher, /missions\.some\(item => item\.id === record\.target\.id && item\.agentId === agent\.id\)/);
  assert.doesNotMatch(matcher, /startsWith|includes\(agent\.name\)/, "relate by id, never by name or prefix");

  // Rendered as a strip that routes to the queue that owns the authority; the
  // agent zone never resolves a decision itself.
  assert.match(agents, /className="agent-decision-strip" role="region"/);
  assert.match(agents, /onClick=\{\(\) => onNavigate\("needs"\)\}>Decide<\/button>/);
  assert.doesNotMatch(agents, /decisions\.resolve|onResolveDecision/, "resolution authority stays in Needs You");

  // Terminal access, mission actions and Ask Mission AI share the one header.
  assert.match(agents, /className="agent-detail-ai"/);
  assert.match(agents, /onClick=\{\(\) => onOpenTerminal\(selected\.id\)\}>Open terminal<\/button>/);

  const app = read("App.jsx");
  assert.match(app, /<AgentWorkspace[^>]*decisionRecords=\{decisions\.records\}/);
  assert.match(app, /<AgentWorkspace[^>]*onOpenDecision=\{openDecisionSource\}/);
});

test("T110 - agent progress stays evidence-only and an unreported action says so", () => {
  const agents = read("AgentWorkspace.jsx");

  // Progress is a count of verified checkpoints against the total, never a
  // percentage and never a time estimate.
  assert.match(agents, /\{mission\?\.progress\?\.verified \|\| 0\}\/\{mission\?\.progress\?\.total \|\| 0\}/);
  assert.match(agents, /Progress is a count of verified checkpoints, never an estimated percentage\./);

  // The current action is whatever the engine observed, with its source named,
  // and "unreported" when nothing was observed.
  assert.match(agents, /\{mission\?\.currentAction\?\.kind \|\| "unreported"\}/);
  assert.match(agents, /No mission action has been observed\./);
  assert.match(agents, /Observed from \{String\(mission\.currentAction\.source\)/);
  assert.match(agents, /High-level observable state only\. OUTARCH never displays or infers private reasoning\./);

  // Nothing in the agent view invents a percentage or an ETA.
  assert.doesNotMatch(agents, /percentComplete|estimatedCompletion|Math\.round\([^)]*\/[^)]*\* 100\)/);
});

test("T169 - agent activity and missions are pre-indexed rather than linearly scanned on every render", () => {
  const agents = read("AgentWorkspace.jsx");

  // Pre-indexing functions must be present
  assert.match(agents, /function buildActivityIndex\(activity\)/);
  assert.match(agents, /function eventsForAgent\(index, agent\)/);
  assert.match(agents, /function indexMissionsByAgent\(missions\)/);

  // Memoized selectors inside AgentWorkspace
  assert.match(agents, /const activityIndex = React\.useMemo\(\(\) => buildActivityIndex\(activity\), \[activity\]\);/);
  assert.match(agents, /const missionsByAgent = React\.useMemo\(\(\) => indexMissionsByAgent\(missions\), \[missions\]\);/);
  assert.match(agents, /const relatedActivity = React\.useMemo\(\(\) => \{\s*if \(!selected\) return \[\];\s*return eventsForAgent\(activityIndex, selected\)\.slice\(-12\)\.reverse\(\);\s*\}, \[activityIndex, selected\]\);/);
  assert.match(agents, /const agentBriefs = React\.useMemo\(\(\) => new Map\(agents\.map\(agent => \{/);

  // Functional verification of indexing logic
  const fnExtract = agents.slice(
    agents.indexOf("function buildActivityIndex"),
    agents.indexOf("const ACTIVE_DECISION_STATUSES")
  );
  const context = { Map, Set, Array };
  const evalIndexers = new Function(
    "context",
    `with(context) { ${fnExtract}; return { buildActivityIndex, eventsForAgent, indexMissionsByAgent }; }`
  );
  const { buildActivityIndex, eventsForAgent, indexMissionsByAgent } = evalIndexers(context);

  const sampleActivity = [
    { id: "agent-1", type: "agent:start", sequence: 1 },
    { sessionId: "agent-1", type: "agent:exec", sequence: 2 },
    { name: "Researcher", type: "agent:output", sequence: 3 },
    { id: "agent-2", type: "agent:start", sequence: 4 }
  ];

  const index = buildActivityIndex(sampleActivity);
  assert.equal(index instanceof Map, true);

  const agent1Events = eventsForAgent(index, { id: "agent-1", name: "Researcher" });
  assert.equal(agent1Events.length, 3, "should find events by id, sessionId, and name");
  assert.equal(agent1Events[0].sequence, 1);
  assert.equal(agent1Events[1].sequence, 2);
  assert.equal(agent1Events[2].sequence, 3);

  const agent2Events = eventsForAgent(index, { id: "agent-2", name: "Analyst" });
  assert.equal(agent2Events.length, 1);
  assert.equal(agent2Events[0].id, "agent-2");

  const sampleMissions = [
    { id: "m1", agentId: "agent-1", status: "completed" },
    { id: "m2", agentId: "agent-1", status: "active" },
    { id: "m3", agentId: "agent-1", status: "completed" },
    { id: "m4", agentId: "agent-2", status: "draft" },
    { id: "m5", agentId: "agent-2", status: "completed" }
  ];

  const missionIndex = indexMissionsByAgent(sampleMissions);
  assert.equal(missionIndex.get("agent-1").id, "m2", "active mission must take precedence over newer completed mission");
  assert.equal(missionIndex.get("agent-2").id, "m5", "latest mission must be selected when no active mission exists");
});

test("T248 - Agents interaction contract: inspection and supervision model without raw terminal injection or duplicate approval authority", () => {
  const agents = read("AgentWorkspace.jsx");

  // Inspection and checkpoint supervision model
  assert.match(agents, /className="agent-detail-header"/);
  assert.match(agents, /className="agent-detail-ai"/);
  assert.match(agents, /onClick=\{\(\) => onOpenTerminal\(selected\.id\)\}>Open terminal<\/button>/);

  // Approval authority strictly resides in Needs You
  assert.match(agents, /onClick=\{\(\) => onNavigate\("needs"\)\}>Decide<\/button>/);
  assert.doesNotMatch(agents, /decisions\.resolve|onResolveDecision/, "resolution authority stays in Needs You");

  // No unmonitored raw terminal input or fabricated chat composer in the supervision panel
  assert.doesNotMatch(agents, /<textarea\b[^>]*\b(terminal-inject|raw-input)/i);
  assert.doesNotMatch(agents, /className="[^"]*chat-composer-raw/i);
});


