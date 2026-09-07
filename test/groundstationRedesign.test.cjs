"use strict";

/* Redesign coverage for Groundstation: the sticky status bar, the attention
   inbox, the unified manifest (evidence badges, filters, search, pinning),
   the selected-worker inspector and the keyboard model. These assert the
   contract that keeps the surface honest — every fact shown is a reported
   engine fact, and no new lifecycle route was invented for the redesign. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const rendererRoot = path.resolve(__dirname, "../src/groundstation/renderer");
const read = file => fs.readFileSync(path.join(rendererRoot, file), "utf8");

test("the live surface is the redesigned one and still separates agents from workers", () => {
  const app = read("App.jsx");
  assert.match(app, /view === "groundstation"\) return <LiveGroundstationView/);
  assert.match(app, /const workers = sessions\.filter\(session => !session\.id\.startsWith\("agent-"\)\)/);
  assert.match(app, /workers\.map\(\(session, index\) => <ReferenceManifestRow/);
  // One scene: status bar, attention inbox, manifest, lower panels, inspector.
  for (const part of ["<GroundstationStatusBar", "<AttentionInbox", "<ManifestToolbar", "<ManifestList", "<WorkerInspector", "<ActivityWaterline"]) {
    assert.ok(app.includes(part), `LiveGroundstationView is missing ${part}`);
  }
  // The KPI wall and the oversized hero are gone from the live path.
  assert.doesNotMatch(app, /<section className="mc-ref-readout"/);
  assert.doesNotMatch(app, /className=\{`mc-ref-hero tone-\$\{health\.tone\}`\}/);
});

test("the status bar is a sticky labelled region with counts that filter, not act", () => {
  const app = read("App.jsx");
  assert.match(app, /function GroundstationStatusBar/);
  assert.match(app, /role="region" aria-label="Project status"/);
  assert.match(app, /className=\{`mc-gs-statusbar tone-\$\{health\.tone\}`\}/);
  // Counts drive the manifest filter or navigation; they never dispatch.
  assert.match(app, /onClick=\{\(\) => onFilter\(filter === "live" \? "all" : "live"\)\}/);
  assert.match(app, /onClick=\{\(\) => onFilter\(filter === "idle" \? "all" : "idle"\)\}/);
  assert.match(app, /className=\{`mc-gs-needs \$\{attentionCount \? "has-attention" : ""\}`\} onClick=\{\(\) => onNavigate\("needs"\)\}/);

  const css = read("redesign/screens.css");
  assert.match(css, /\.mc-gs-statusbar \{[\s\S]{0,200}position: sticky;/);
  assert.match(css, /\.mc-gs-statusbar \{[\s\S]{0,400}grid-template-columns: minmax\(0, 1fr\) auto auto;/);
});

test("the attention inbox leads with failures, hides at zero and discloses the rest", () => {
  const app = read("App.jsx");
  assert.match(app, /function needsAttention\(session\) \{[\s\S]{0,120}Boolean\(session\?\.attentionRequired\) \|\| session\?\.status === "failed"/);
  assert.equal((app.match(/sessions\.filter\(needsAttention\)/g) || []).length, 1,
    "the live inbox must use the shared attention predicate without retaining a dead duplicate surface");
  assert.match(app, /const attention = supervisedSessions\.filter\(needsAttention\)/,
    "Needs You must use the same predicate after renderer alerts are merged");
  assert.match(app, /function AttentionInbox/);
  // Hidden only when there is genuinely nothing — worker attention AND the unified count are zero.
  assert.match(app, /if \(!attention\.length && !total\) return null;/);
  assert.match(app, /role="region" aria-label=\{`Attention queue; \$\{total\} decisions waiting`\}/);
  // The header count is the unified decision total; integration approvals are disclosed, not hidden.
  assert.match(app, /const external = Math\.max\(0, total - attention\.length\)/);
  assert.match(app, /integration approval\{external === 1 \? "" : "s"\} in Needs You/);
  // Failures outrank decisions; ties break on the oldest reported evidence.
  assert.match(app, /const severity = \(a\.status === "failed" \? 0 : 1\) - \(b\.status === "failed" \? 0 : 1\)/);
  assert.match(app, /const shown = expanded \? ordered : ordered\.slice\(0, 3\)/);
  // It reuses the shared decision model rather than inventing a second one.
  assert.match(app, /const decision = decisionFor\(session\)/);
  assert.match(app, /onAction\("restart", session\.id\)/);
  assert.match(app, /onAction\("acknowledge", session\.id\)/);
});

test("Needs You removes duplicate counters and keeps lifecycle help compact", () => {
  const app = read("App.jsx");
  const css = read("redesign/screens.css");
  assert.doesNotMatch(app, /needs-queue-summary/);
  assert.match(app, /<details className="attention-lifecycle-bar">/);
  // T151 - the four filters are one `FilterGroup` now, so the zero-state rule
  // lives once in the primitive instead of once per button. The behaviour it
  // exists for is unchanged: a count of zero must not read as an urgent number.
  const segmented = fs.readFileSync(path.join(rendererRoot, "Segmented.jsx"), "utf8");
  assert.match(segmented, /\$\{option\.count === 0 \? "is-zero" : ""\}/);
  assert.match(app, /<FilterGroup label="Filter decisions" value=\{filter\} onChange=\{setFilter\}/);
  assert.match(app, /\{ value: "critical", label: "Critical", count: critical \}/);
  assert.match(app, /\{ value: "agents", label: "Agents", count: agentWaiting \}/);
  assert.match(css, /decision-queue-controls button\.is-zero b \{[\s\S]{0,140}color: var\(--mc-ok\) !important;[\s\S]{0,140}background: var\(--mc-ok-soft\) !important;/);
  assert.match(css, /attention-lifecycle-bar > summary \{[\s\S]{0,300}min-height: 28px/);
  assert.match(css, /attention-lifecycle-bar > div \{[\s\S]{0,120}position: absolute;/);
});

test("terminal transport errors enter Needs You without impersonating engine failures", () => {
  const app = read("App.jsx");
  const pane = read("TerminalPane.jsx");
  const css = read("redesign/surfaces.css");
  assert.match(app, /const \[terminalAlerts, setTerminalAlerts\] = React\.useState\(\{\}\)/);
  assert.match(app, /rendererAttention: true/);
  assert.match(app, /kind: "Terminal connection"/);
  // The renderer/engine boundary copy now lives on the unified decision row.
  assert.match(
    read("DecisionList.jsx"),
    /Dismissing clears only the renderer alert; engine-owned worker state is unchanged/
  );
  assert.match(read("useDecisions.js"), /origin: "renderer"/);
  assert.match(app, /onDismissTerminalAlert=\{dismissTerminalAlert\}/);
  assert.match(pane, /onTerminalErrorRef\.current\?\.\(session\.id, reason\)/);
  assert.match(pane, /onTerminalRecoveredRef\.current\?\.\(session\.id\)/);
  assert.match(pane, /reportOperationalError\("Output exceeded the desktop stream buffer/);
  assert.match(css, /decision-item\.is-terminal-alert[\s\S]{0,160}var\(--mc-warning\)/);
});

test("evidence badges come only from structured engine evidence", () => {
  const app = read("App.jsx");
  assert.match(app, /function evidenceBadges\(session\)[\s\S]{0,120}const structured = session\?\.evidence \|\| \{\};/);
  for (const category of ["tests", "git", "service", "build", "database", "container"]) {
    assert.match(app, new RegExp(`if \\(structured\\.${category}\\)`), `no badge branch for ${category} evidence`);
  }
  // A badge is never produced from raw terminal text, and the row stays legible.
  assert.match(app, /return badges\.slice\(0, 3\);/);
  const badgeBlock = app.slice(app.indexOf("function evidenceBadges"), app.indexOf("function workerActivity"));
  assert.doesNotMatch(badgeBlock, /lastLine|recentLines|match\(/);
});

test("the activity line reports silence instead of implying progress", () => {
  const app = read("App.jsx");
  assert.match(app, /function workerActivity\(session\)/);
  assert.match(app, /Running · no output reported yet/);
  assert.match(app, /Number\.isFinite\(session\.exitCode\) \? `Exited with code \$\{session\.exitCode\}`/);
  // No computed completion percentage and no width-driven progress bar.
  assert.doesNotMatch(app, /percentComplete|completionPercent|progressValue/i);
});

test("filtering and search are presentation only and never dispatch an action", () => {
  const app = read("App.jsx");
  assert.match(app, /function matchesFilter\(session, filter\)/);
  assert.match(app, /const visibleWorkers = orderManifest\(workers\.filter\(matches\), favorites\)/);
  assert.match(app, /const visibleAgents = orderManifest\(agents\.filter\(matches\), favorites\)/);
  // Search covers the name and the real command line, not just the label.
  assert.match(app, /`\$\{session\.name\} \$\{session\.command \|\| ""\} \$\{\(session\.args \|\| \[\]\)\.join\(" "\)\}`\.toLowerCase\(\)\.includes\(term\)/);
  const filterBlock = app.slice(app.indexOf("function matchesFilter"), app.indexOf("function LiveGroundstationView"));
  assert.doesNotMatch(filterBlock, /onAction|missionApi/);
});

test("pinned workers are a per-project view preference, not engine state", () => {
  const app = read("App.jsx");
  assert.match(app, /GS_FAVORITES_KEY = "mission-control\.groundstation-favorites\.v1"/);
  assert.match(app, /const key = `\$\{GS_FAVORITES_KEY\}:\$\{projectPath \|\| "default"\}`/);
  assert.match(app, /window\.localStorage\.setItem\(key, JSON\.stringify\(\[\.\.\.next\]\)\)/);
  assert.match(app, /const \[favorites, toggleFavorite\] = useFavoriteWorkers\(workspace\?\.path\)/);
  // Pinning reorders the manifest; it never starts, stops or reconfigures.
  assert.match(app, /const rank = session => \(favorites\.has\(session\.id\) \? 0 : 1\) \* 10/);
  const favouriteBlock = app.slice(app.indexOf("function useFavoriteWorkers"), app.indexOf("function GroundstationStatusBar"));
  assert.doesNotMatch(favouriteBlock, /missionApi|action\.dispatch/);
});

test("the manifest keyboard model selects, filters and reuses existing actions", () => {
  const app = read("App.jsx");
  // Ctrl F focuses search; typing never swallows the rest of the shortcuts.
  assert.match(app, /event\.key\.toLowerCase\(\) === "f"\) \{\s*\n\s*event\.preventDefault\(\);\s*\n\s*searchRef\.current\?\.focus\(\)/);
  assert.match(app, /if \(editable\(event\.target\) \|\| event\.altKey\) return;/);
  // Arrow keys walk the visible rows, Enter opens, Escape clears the selection.
  assert.match(app, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp"/);
  assert.match(app, /const step = event\.key === "ArrowDown" \? 1 : -1/);
  assert.match(app, /if \(event\.key === "Enter" && selectedId && navigable\.includes\(selectedId\)\)/);
  assert.match(app, /if \(event\.key === "Escape" && selectedId && !document\.querySelector\("\[role='dialog'\],\[role='alertdialog'\]"\)\) onSelect\(null\)/);
  // Ctrl+Shift R/S/F map to the actions the row already exposes.
  assert.match(app, /if \(key === "f"\) toggleFavorite\(selected\.id\)/);
  assert.match(app, /else if \(key === "r"\) onAction\(selected\.isAlive \? "restart" : "start", selected\.id\)/);
  assert.match(app, /else if \(selected\.isAlive\) onAction\("kill", selected\.id\)/);
  // A keyboard stop is still a confirmed stop: dispatch owns the gate.
  assert.match(app, /if \(\["kill", "remove"\]\.includes\(type\)\) \{ setConfirmation\(/);
});

test("the inspector renders only for a selection and reports engine facts", () => {
  const app = read("App.jsx");
  assert.match(app, /function WorkerInspector[\s\S]{0,120}if \(!session\) return null;/);
  assert.match(app, /role="complementary" aria-label="Selected worker details"/);
  assert.match(app, /<dl className="mc-gs-inspector-facts">/);
  // Ownership names the engine PTY and real pid, or says there is none.
  assert.match(app, /session\.isAlive && session\.pid \? `Engine PTY · pid \$\{session\.pid\}` : "No engine PTY"/);
  assert.match(app, /Number\.isFinite\(session\.lastOutputAt\) \? `\$\{timeAgo\(session\.lastOutputAt\)\} ago` : "Not reported"/);
  assert.match(app, /<WorkerInspector session=\{selected\}/);
  // The rail only claims layout width when something is actually selected.
  assert.match(app, /className=\{`mc-ref-groundstation \$\{selected \? "has-inspector" : ""\}`\}/);
});

test("the worker inspector clears the sticky Groundstation actions while scrolling", () => {
  const css = read("redesign/screens.css");
  // The overlay starts below the app tape and the Groundstation toolbar, and
  // stays under the toolbar's z-index so those actions remain reachable.
  //
  // T101 — this used to be `position: fixed` with a `bottom` inset. It could
  // not be: `.mc-ref-groundstation` (`container-type: inline-size`) and
  // `.experience` (`contain: layout paint`) both establish a containing block
  // for fixed descendants, so the insets resolved against the whole scrolling
  // page. The panel measured 1305px tall in an 816px window and scrolled away
  // with the register. Sticky honours the same clearance and actually holds.
  assert.match(css, /\.mc-gs-inspector \{[\s\S]{0,220}top: calc\(var\(--mc-gs-toolbar-clearance, 78px\) \+ 8px\);/);
  assert.match(css, /\.mc-gs-inspector \{[\s\S]{0,520}z-index: 5;/);
  assert.match(css, /\.mc-gs-statusbar \{[\s\S]{0,100}z-index: 6;/);
  // Wrapped toolbar layouts reserve more vertical space for the overlay.
  assert.match(css, /@container groundstation \(max-width: 1160px\)[\s\S]{0,140}--mc-gs-toolbar-clearance: 124px;/);
  assert.match(css, /@container groundstation \(max-width: 820px\)[\s\S]{0,140}--mc-gs-toolbar-clearance: 172px;/);
});

test("the activity waterline announces politely and drills into the worker", () => {
  const app = read("App.jsx");
  assert.match(app, /function ActivityWaterline/);
  assert.match(app, /className="mc-gs-feed" aria-live="polite"/);
  assert.match(app, /onClick=\{\(\) => event\.sessionId && onSelect\(event\.sessionId\)\}/);
});

test("one state classifier serves the row, the inspector and the graph", () => {
  const app = read("App.jsx");
  assert.match(app, /function manifestState\(session\)[\s\S]{0,260}return "idle";/);
  assert.match(app, /className=\{`mc-gs-inspector state-\$\{state\}`\}/);
  assert.match(app, /<i className=\{manifestState\(session\)\}\/>/);
  // Failures still open evidence before any lifecycle mutation.
  assert.match(app, /session\.status === "failed" \|\| session\.attentionRequired \? "focus"/);
});

test("the manifest grid fits its columns and collapses deliberately when narrow", () => {
  const css = read("redesign/screens.css");
  // Every flexible column is minmax(0, …) so long names cannot push the row wide.
  assert.match(css, /grid-template-columns: 3px 22px minmax\(0, 1\.8fr\) minmax\(0, 104px\) 84px minmax\(0, 1\.25fr\) 92px auto !important;/);
  // The inspector only takes a column once a worker is selected.
  assert.match(css, /\.mc-ref-groundstation\.has-inspector \.mc-gs-body \{ grid-template-columns: minmax\(0, 1fr\) minmax\(300px, 350px\); \}/);
  assert.match(css, /\.mc-gs-inspector \{[\s\S]{0,200}position: sticky;/);
  // One deliberate narrow fallback that keeps name, activity and the action.
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*grid-template-areas: "bar star name action" "\. \. activity activity";/);
  // Truncation is explicit rather than accidental overflow.
  assert.match(css, /\.mc-gs-name-line strong \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis; white-space: nowrap;[^}]*\}/);
});

test("narrow layouts collapse before the lowered production window (T138/T139)", () => {
  const cockpit = read("redesign/cockpit.css");
  const screens = read("redesign/screens.css");
  const workspace = read("redesign/workspace.css");
  const main = fs.readFileSync(path.resolve(__dirname, "../src/groundstation/main/index.cjs"), "utf8");

  // T139 — the smallest production window drops from 1040 to 800.
  assert.match(main, /minWidth: visualCapture \? 640 : Math\.min\(800, width\)/);

  // T138 — the Recipes route is not inside the `groundstation` container, so a
  // viewport fallback collapses the 2-col guide split and the 3-col recipe row.
  assert.match(cockpit, /@media \(max-width: 900px\) \{[\s\S]*\.recipes-page-layout \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(cockpit, /@media \(max-width: 900px\) \{[\s\S]*\.recipe-row \{ grid-template-columns: minmax\(0, 1fr\); gap:/);
  // The fixed 4-column attention/notification policy stacks too.
  assert.match(cockpit, /@media \(max-width: 900px\) \{[\s\S]*\.attention-policy \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  // Visual-matrix regressions: a legacy column header distributed History
  // across the viewport, agent rows shrank until their summaries overlapped,
  // and the workspace overflow icon wrapped above its label.
  assert.match(cockpit, /\.history-hero-redesigned \{\s*flex-direction: row !important;\s*justify-content: flex-start !important;/);
  assert.match(screens, /\.agent-roster-list > button \{\s*flex: 0 0 auto;/);
  assert.match(workspace, /\.workspace-more \{\s*display: inline-flex;\s*align-items: center;/);
  // T138 — the manifest status chip can now actually be hidden by the narrow
  // rules (its `display` no longer carries a priority flag).
  const statusRule = screens.slice(
    screens.indexOf("#root#root .shell .mc-ref-manifest-row .mc-ref-status {"),
    screens.indexOf("#root#root .shell .mc-ref-manifest-row .mc-ref-status.tone-running")
  );
  assert.ok(statusRule.length > 0, ".mc-ref-status base rule not found");
  assert.match(statusRule, /\r?\n {2}display: inline-flex;\r?\n/);
  assert.doesNotMatch(statusRule, /display: inline-flex !important/);
});

test("the Groundstation recipe panel never reports a failed load as an empty list", () => {
  const app = read("App.jsx");
  // `null` is "not loaded"; only a real empty array renders the empty state.
  assert.match(app, /const \[recipes, setRecipes\] = React\.useState\(null\);/);
  assert.match(app, /\.catch\(value => \{ if \(active\) setError\(value\?\.message \|\| String\(value\)\); \}\)/);
  assert.match(app, /recipes === null \? <RegisterSkeleton rows=\{3\} label="Loading recipes"\/>/);
  assert.match(app, /recipes\.length === 0 \? <div className="mc-gs-recipe-note">/);
  assert.match(app, /<strong>Recipes could not be loaded<\/strong>/);
  // A failed load is recoverable without leaving the surface.
  assert.match(app, /onClick=\{\(\) => setReloadToken\(value => value \+ 1\)\}>Try again<\/button>/);
  assert.match(app, /\}, \[reloadToken\]\);/);
});

test("Edit graph opens a real edit of the selected recipe (Create / Edit / Duplicate)", () => {
  const app = read("App.jsx");
  const builder = read("WorkspaceRecipes.jsx");
  const page = read("RecipesView.jsx");

  // T072/T073: the builder is passed the selected recipe and a mode.
  assert.match(builder, /export default function WorkspaceRecipes\(\{ open, mode = "create", editRecipe = null/);
  assert.match(builder, /function draftFromRecipe\(recipe, sessions\)/);
  // Edit reuses the persisted id (recipe.save is an upsert); create/duplicate get a fresh one.
  assert.match(builder, /const editingId = mode === "edit" && editRecipe && !runLocked \? editRecipe\.id : null;/);
  assert.match(builder, /id: editingId \|\| globalThis\.crypto\?\.randomUUID/);
  // T075: a recipe with a live run is saved as a new recipe, not mutated in place.
  assert.match(builder, /const runLocked = mode === "edit" && RUN_LOCKED;/);
  assert.match(builder, /Changes are saved as a new recipe so the active run is not disturbed/);
  // T078/T079: a plain-language summary of what launching the recipe does.
  assert.match(builder, /const planSummary = steps\.length/);
  assert.match(builder, /never a duplicate PTY/);
  assert.match(builder, /mode === "duplicate" && editRecipe \? `\$\{editRecipe\.name\} copy`/);

  // T074: unsaved-change protection before the dialog closes.
  assert.match(builder, /const \[dirty, setDirty\] = React\.useState\(false\)/);
  assert.match(builder, /const requestClose = \(\) => \{\s*if \(dirty\) \{ setDiscardOpen\(true\); return; \}/);
  assert.match(builder, /onEscapeKeyDown=\{event => \{ event\.preventDefault\(\); requestClose\(\); \}\}/);

  // Wiring: the page hands the recipe + mode up; App carries it into the builder.
  assert.match(page, /onClick=\{\(\) => onManage\(recipe, "edit"\)\}>Edit graph/);
  assert.match(app, /const openRecipeBuilder = React\.useCallback\(\(recipe, mode = "create"\)/);
  assert.match(app, /<WorkspaceRecipes open=\{Boolean\(recipesOpen\)\} mode=\{recipesOpen\?\.mode \|\| "create"\} editRecipe=\{recipesOpen\?\.recipe \|\| null\}/);

  // T040: deleting a recipe goes through the shared confirmation service.
  assert.match(app, /const deleteRecipe = React\.useCallback\(recipe => \{\s*setConfirmation\(\{/);
  assert.match(app, /confirmLabel: "Delete recipe"/);
});

test("a recipe reports the run phase the engine owns, not an inferred one", () => {
  const app = read("App.jsx");
  assert.match(app, /function recipeStatus\(recipe, knownIds\)/);
  // Every phase the engine can publish has an explicit branch.
  for (const phase of ["running", "paused", "cancelling", "failed", "cancelled", "completed"]) {
    assert.match(app, new RegExp(`phase === "${phase}"`), `recipeStatus does not handle the "${phase}" phase`);
  }
  // A running recipe shows progress and cannot be launched again.
  assert.match(app, /label: `Running · \$\{run\.completed\?\.length \|\| 0\}\/\$\{total\} started`/);
  // A failed run offers recovery and names the first reported failure.
  assert.match(app, /action: "Recover",\s*\n\s*canRun: true,\s*\n\s*recover: true,/);
  assert.match(app, /reason: failures\[0\]\?\.reason \? `First failure: \$\{failures\[0\]\.reason\}`/);
  assert.match(app, /onLaunch\(recipe, \{ recover: status\.recover === true \}\)/);
});

test("a recipe whose workers were deleted says so instead of failing at launch", () => {
  const app = read("App.jsx");
  assert.match(app, /const missing = workerIds\.filter\(id => !knownIds\.has\(id\)\)/);
  assert.match(app, /label: `\$\{missing\.length\} of \$\{total\} worker\$\{total === 1 \? "" : "s"\} missing`/);
  assert.match(app, /canRun: false,\s*\n\s*reason: `This recipe references/);
  // The dependency chain is truncated visibly, with the full order in the title.
  assert.match(app, /\{chain\}\{steps\.length > 3 \? ` \+\$\{steps\.length - 3\}` : ""\}/);
  assert.match(app, /title=\{steps\.map\(step => stepName\(step\.workerId\)\)\.join\(" → "\)\}/);
  // Recipes beyond the first three are disclosed rather than silently dropped.
  assert.match(app, /recipes\.length > 3 && <footer className="mc-gs-recipe-more">/);
});

test("elevation is a token carrying a top light-edge, and separators stay weaker than borders", () => {
  const tokens = read("redesign/tokens-bridge.css");
  // On a true-black canvas a cast shadow has nothing to darken, so elevation is
  // stated by the 1px lit edge alone and every raise token carries it. The
  // alpha is the palette's to choose; what must not regress is that a raise
  // resolves through --mc-edge rather than inventing its own highlight.
  assert.match(tokens, /--mc-edge: inset 0 1px 0 rgba\(255, 255, 255, [.\d]+\);/);
  assert.match(tokens, /--mc-raise-1:[^;]*var\(--mc-edge\);/);
  assert.match(tokens, /--mc-raise-2:[^;]*var\(--mc-edge\);/);

  // Internal separators are deliberately weaker than a surface's outer edge.
  // Compared, not pinned, so the relationship survives the next palette move.
  const alpha = name => {
    const found = tokens.match(new RegExp(`${name}: rgba\\(255, 255, 255, ([.\\d]+)\\)`));
    assert.ok(found, `${name} must be a white wash so the two can be compared`);
    return Number(found[1]);
  };
  assert.ok(alpha("--mc-hairline") < alpha("--mc-border"),
    "the internal hairline must be weaker than the outer border, or a row reads as a surface edge");

  const css = read("redesign/screens.css");
  for (const surface of [".mc-ref-manifest", ".mc-gs-inspector", ".mc-gs-attention"]) {
    assert.match(css, new RegExp(`\\${surface} \\{[^}]*box-shadow: var\\(--mc-raise-2\\)`), `${surface} is not raised with the shared elevation token`);
  }
  // Manifest rows separate on the hairline, not on the outer border colour.
  assert.match(css, /\.mc-ref-manifest-row \{[^}]*border-bottom: 1px solid var\(--mc-hairline\) !important;/);
});

test("motion is short, scoped and fully removable", () => {
  const css = read("redesign/screens.css");
  // Only colour and elevation animate — never layout, so nothing reflows.
  assert.match(css, /\.mc-ref-groundstation :where\(button, \[role="row"\], input\) \{\s*\n\s*transition:\s*\n\s*background-color var\(--mc-motion-fast\)/);
  assert.doesNotMatch(css, /transition:[^;]*\b(width|height|margin|padding|top|left)\b/);
  // T154 — this component no longer carries its own copy. One layer owns
  // reduced motion, for both the OS preference and the in-app setting, and
  // stilling the duration tokens is what stops every token-driven transition
  // including the one asserted above.
  const owner = read("redesign/surfaces.css");
  assert.match(owner, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(owner, /\.shell\.motion-reduced,/);
  assert.match(owner, /--mc-duration-fast: 0ms;/);
  // Focus is a ring, never an outline that shifts the row.
  assert.match(css, /:focus-visible \{\s*\n\s*outline: 0;\s*\n\s*box-shadow: var\(--mc-focus-ring\);/);
});

test("numbers that change are tabular so the manifest does not jitter", () => {
  const css = read("redesign/screens.css");
  for (const selector of [".mc-gs-counts b", ".mc-ref-manifest-row .mc-ref-resource", ".mc-gs-evidence", ".mc-gs-feed time"]) {
    assert.match(css, new RegExp(`\\${selector} \\{[^}]*font-variant-numeric: tabular-nums`), `${selector} does not use tabular numerals`);
  }
});

test("the redesign layer still loads last so it wins without escalating specificity", () => {
  const main = read("main.jsx");
  assert.match(main, /import "\.\/redesign\/screens\.css";/);
  const css = read("redesign/screens.css");
  // Groundstation rules are scoped, not blanket !important overrides.
  const groundstation = css.slice(css.indexOf("Groundstation + Needs hierarchy"));
  assert.ok(groundstation.includes("#root#root .shell .mc-gs-statusbar"), "status bar is not scoped to the shell");
  assert.doesNotMatch(groundstation, /^\s*\*\s*\{/m, "the redesign layer must not introduce a universal selector");
});

test("History actor filter scales past eight and the inspector follows the active filter (T111/T112)", () => {
  const app = read("App.jsx");
  // T111 — first eight actors, then "show all" on demand; the active filter stays visible.
  assert.match(app, /const \[showAllActors, setShowAllActors\] = React\.useState\(false\);/);
  assert.match(app, /const allActors = \[\.\.\.new Set\(ordered\.map\(actorFor\)\)\];/);
  assert.match(app, /allActors\.length > 8 && <button className="history-actors__more"/);
  assert.match(app, /showAllActors \? "Show fewer" : `\+\$\{allActors\.length - 8\} more`/);
  // T112 — a selection filtered out of view falls back to the first visible event.
  assert.match(app, /const selected = visible\.find\(event => event\.sequence === selectedSequence\) \|\| visible\[0\] \|\| null;/);
});

test("Groundstation inspector never shows a worker filtered out of the register (T105)", () => {
  const app = read("App.jsx");
  assert.match(app, /const selectedInView = \[\.\.\.visibleWorkers, \.\.\.visibleAgents\]\.some\(session => session\.id === selectedId\);/);
  assert.match(app, /const selected = \(selectedInView && sessions\.find\(session => session\.id === selectedId\)\) \|\| null;/);
});

test("the Groundstation worker register is a complete, keyboard-navigable grid (T129/T130)", () => {
  const app = read("App.jsx");
  // T129 — a real grid: container role, column headers, gridcell children, rowindex.
  assert.match(app, /className="mc-ref-manifest" role="grid" aria-label=\{label\} aria-rowcount=\{workers\.length \+ 1\}/);
  assert.match(app, /<span role="columnheader">Worker<\/span>/);
  assert.doesNotMatch(app, /role="cell"/);
  assert.match(app, /className="mc-ref-worker-name" role="gridcell"/);
  assert.match(app, /aria-rowindex=\{rowIndex\}/);
  // The wrapping sections are regions, not nested tables.
  assert.doesNotMatch(app, /role="table" aria-label="Supervised workers"/);
  assert.match(app, /role="region" aria-label="Supervised workers"/);
  // T130 — Arrow / Home / End move DOM focus onto the newly selected row.
  assert.match(app, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp" \|\| event\.key === "Home" \|\| event\.key === "End"/);
  assert.match(app, /focusSelectedRowRef\.current = true;/);
  assert.match(app, /row\?\.focus\(\{ preventScroll: true \}\);/);
});

test("contextual Ask Mission AI reaches the worker inspector and History event inspector (T119)", () => {
  const app = read("App.jsx");
  assert.match(app, /function WorkerInspector\(\{ session, activity, favorite, onClose, onFocus, onAction, onFavorite, onAskAI \}\)/);
  assert.match(app, /className="mc-gs-inspector-ai" onClick=\{\(\) => onAskAI\(/);
  assert.match(app, /function HistoryView\(\{ events, onFocus, onAskAI, projectKey = "default" \}\)/);
  assert.match(app, /className="history-evidence__ai" onClick=\{\(\) => onAskAI\(/);
  assert.match(app, /<HistoryView events=\{activity\} onFocus=\{inspectWorker\} onAskAI=\{prompt => openMissionAI\(prompt\)\}/);
  // openMissionAI tolerates being handed a click event instead of a string.
  assert.match(app, /setMissionAiPrompt\(typeof prompt === "string" \? prompt : ""\)/);
});

test("the one hand-built menu (terminal session chooser) has the full Radix-equivalent contract (T131)", () => {
  const pane = read("TerminalPane.jsx");
  // Every other menu in the renderer is a Radix DropdownMenu; only this one is hand-built.
  assert.equal((pane.match(/role="menu"/g) || []).length, 1);
  assert.match(pane, /document\.addEventListener\("pointerdown", onPointerDown, true\)/); // outside click
  assert.match(pane, /if \(event\.key === "Escape"\) \{ event\.preventDefault\(\); restore\(\); return; \}/); // Escape + focus return
  assert.match(pane, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp" \|\| event\.key === "Home" \|\| event\.key === "End"/); // arrow roam
});

test("renderer-inferred worker roles are labelled as inferred, not presented as engine facts (T071)", () => {
  const app = read("App.jsx");
  const pane = read("TerminalPane.jsx");
  // workerKind is a regex over name/command — every place it renders says so.
  assert.match(app, /function workerKind\(session\) \{[\s\S]{0,120}\.toLowerCase\(\)/);
  assert.match(app, /className="mc-ref-role is-inferred"[\s\S]{0,80}title="Role inferred from the command/);
  assert.match(app, /\{workerKind\(session\)\} · inferred/);
  assert.match(pane, /terminal-role-tag role-\$\{profile\?\.key \|\| "terminal"\}`\} title="Role inferred from the command/);
  assert.match(read("redesign/screens.css"), /\.mc-ref-role\.is-inferred,[\s\S]{0,80}text-decoration: underline dotted/);
});
