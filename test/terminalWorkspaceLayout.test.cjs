"use strict";

/* Redesign coverage for the terminal workspace: pane resizing, minimum
   splits, per-axis ratios, layout persistence shape, the exited-worker
   resize guard, and the CSS grid that actually honours the drag ratio. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");

const rendererRoot = path.resolve(__dirname, "../src/groundstation/renderer");
const layoutUrl = pathToFileURL(path.join(rendererRoot, "useTerminalLayout.js")).href;
const tilesUrl = pathToFileURL(path.join(rendererRoot, "canvasTiles.js")).href;
const loadTiles = () => import(`${tilesUrl}?t=${Date.now()}${Math.random()}`);
const read = file => fs.readFileSync(path.join(rendererRoot, file), "utf8");
const load = () => import(`${layoutUrl}?t=${Date.now()}${Math.random()}`);

const sessions = Array.from({ length: 8 }, (_, index) => ({ id: `w${index + 1}` }));

test("layout model exposes one resize handle per split with a stable axis + ratio", async () => {
  const { layoutHandles } = await load();
  assert.deepEqual(layoutHandles("single"), []);
  assert.deepEqual(layoutHandles("horizontal"), [{ id: "col", axis: "x", ratio: "col" }]);
  assert.deepEqual(layoutHandles("vertical"), [{ id: "row", axis: "y", ratio: "row" }]);
  assert.deepEqual(layoutHandles("grid-2x2").map(h => h.id), ["col", "row"]);
  // T096 — 3x2 exposes both column boundaries, so the middle column can be
  // resized without disturbing the first.
  assert.deepEqual(layoutHandles("grid-3x2").map(h => h.id), ["col", "col2", "row"]);
  assert.deepEqual(layoutHandles("grid-3x2").map(h => h.axis), ["x", "x", "y"]);
  // 2x2 and 3x2 resize both a column and a row split.
  assert.deepEqual(layoutHandles("grid-2x2").map(h => h.axis), ["x", "y"]);
});

test("split ratios are clamped to a usable band on every axis", async () => {
  const { normalizeTerminalLayout, setLayoutRatio, MIN_SPLIT, MAX_SPLIT } = await load();
  assert.equal(MIN_SPLIT, 25);
  assert.equal(MAX_SPLIT, 75);

  const tiny = setLayoutRatio({ layoutId: "grid-2x2" }, "col", 4, sessions);
  assert.equal(tiny.ratios.col, MIN_SPLIT, "cannot drag a pane below the minimum");
  const huge = setLayoutRatio({ layoutId: "grid-2x2" }, "row", 999, sessions);
  assert.equal(huge.ratios.row, MAX_SPLIT, "cannot drag a pane past the maximum");

  // Legacy single-ratio payloads still resolve.
  assert.equal(normalizeTerminalLayout({ layoutId: "horizontal", paneRatio: 62 }, sessions).paneRatio, 62);
  assert.equal(normalizeTerminalLayout({ layoutId: "horizontal", paneRatio: 3 }, sessions).paneRatio, 25);
});

test("column and row ratios are independent and survive a round-trip", async () => {
  const { setLayoutRatio, normalizeTerminalLayout } = await load();
  let pref = normalizeTerminalLayout({ layoutId: "grid-2x2" }, sessions);
  pref = setLayoutRatio(pref, "col", 40, sessions);
  pref = setLayoutRatio(pref, "row", 65, sessions);
  // T096 added `col2`; it is inert outside 3x2 but is always present so a
  // stored layout has a complete shape.
  assert.deepEqual(pref.ratios, { col: 40, row: 65, col2: 50 });

  const persisted = JSON.parse(JSON.stringify(pref));
  const restored = normalizeTerminalLayout(persisted, sessions);
  assert.deepEqual(restored.ratios, { col: 40, row: 65, col2: 50 });
  assert.equal(restored.paneRatio, 40, "paneRatio alias tracks the column split");
});

test("each layout remembers its own ratios and 3x2 starts balanced", async () => {
  const { normalizeTerminalLayout, setLayoutRatio } = await load();
  let pref = normalizeTerminalLayout({ layoutId: "grid-3x2" }, sessions);
  assert.deepEqual(pref.ratios, { col: 34, row: 50, col2: 33 }, "three columns start balanced");
  pref = setLayoutRatio(pref, "col", 40, sessions);
  const twoByTwo = normalizeTerminalLayout({ ...pref, layoutId: "grid-2x2" }, sessions);
  assert.deepEqual(twoByTwo.ratios, { col: 50, row: 50, col2: 50 });
  const restored = normalizeTerminalLayout({ ...twoByTwo, layoutId: "grid-3x2" }, sessions);
  assert.equal(restored.ratios.col, 40);
});

// T096 — the middle column is adjustable on its own, and the third can never be
// squeezed out by dragging both handles the same way.
test("the 3x2 middle column resizes independently and always leaves a third column", async () => {
  const { normalizeTerminalLayout, setLayoutRatio, layoutStyle } = await load();
  let pref = normalizeTerminalLayout({ layoutId: "grid-3x2" }, sessions);

  pref = setLayoutRatio(pref, "col2", 44, sessions);
  assert.equal(pref.ratios.col, 34, "moving the second boundary must not move the first");
  assert.equal(pref.ratios.col2, 44);

  // Both handles dragged wide: the pair is bounded so column three survives.
  pref = setLayoutRatio(pref, "col", 44, sessions);
  assert.ok(pref.ratios.col + pref.ratios.col2 <= 78, `columns must leave room for a third (got ${pref.ratios.col + pref.ratios.col2})`);
  assert.ok(pref.ratios.col2 >= 28, "the middle column keeps a usable width");

  // A layout stored before col2 existed still loads, and gains the default.
  const legacy = normalizeTerminalLayout({ layoutId: "grid-3x2", ratios: { col: 34, row: 50 } }, sessions);
  assert.equal(legacy.ratios.col, 34, "a persisted first column is preserved");
  assert.equal(legacy.ratios.col2, 33, "and the missing second column falls back to the balanced default");

  assert.equal(layoutStyle(legacy)["--col2-ratio"], "33%");
});

test("layoutStyle emits the exact custom properties the grid template consumes", async () => {
  const { layoutStyle, normalizeTerminalLayout } = await load();
  const style = layoutStyle(normalizeTerminalLayout({ layoutId: "grid-2x2", ratios: { col: 44, row: 58 } }, sessions));
  assert.equal(style["--col-ratio"], "44%");
  assert.equal(style["--row-ratio"], "58%");
  assert.equal(style["--pane-primary"], "44%");
});

test("slot assignment still swaps workers and never duplicates a pane", async () => {
  const { normalizeTerminalLayout, assignTerminalSlot } = await load();
  const six = normalizeTerminalLayout({ layoutId: "grid-3x2" }, sessions);
  assert.equal(six.sessionIds.length, 6);
  const swapped = assignTerminalSlot(six, 0, six.sessionIds[3], sessions);
  assert.equal(swapped.sessionIds[0], six.sessionIds[3]);
  assert.equal(swapped.sessionIds[3], six.sessionIds[0]);
  assert.equal(new Set(swapped.sessionIds.filter(Boolean)).size, 6);
});

test("layout persistence is keyed per project path", () => {
  const src = read("useTerminalLayout.js");
  assert.match(src, /mission-control:terminal-layout:v1:/);
  assert.match(src, /workspace\?\.path/);
  assert.match(src, /window\.localStorage\.setItem\(key, JSON\.stringify\(preference\)\)/);
});

test("TerminalPane never resizes an exited PTY but still reflows xterm", () => {
  const src = read("TerminalPane.jsx");
  // Guard flag exists and is cleared the moment the engine reports an exit.
  assert.match(src, /aliveRef = React\.useRef/);
  assert.match(src, /aliveRef\.current = false;\s*\n\s*setConnection\("exited"\)/);
  // The resize IPC is gated on the guard; the local fit() is not.
  assert.match(src, /if \(streamId && aliveRef\.current\) \{[\s\S]*terminal\.resize/);
  assert.match(src, /fit\.fit\(\);/);
  // Still the approved Protocol route, and still debounced by rAF.
  assert.match(src, /missionApi\(\)\.request\("terminal\.resize"/);
  assert.match(src, /requestAnimationFrame\(fitAndResize\)/);
  // Layout changes must not recreate / restart / attach the worker.
  assert.doesNotMatch(src, /terminal\.open[\s\S]{0,40}resize/);
});

test("workspace CSS honours the drag ratio and enforces a minimum pane size", () => {
  const css = read("redesign/workspace.css");
  // The template wants the ratio but clamps to an absolute pixel floor.
  assert.match(css, /--pane-min-w:\s*\d{3}px/);
  assert.match(css, /--pane-min-h:\s*\d{3}px/);
  // The canvas template is read through --mc-canvas-cols so the focus-mode
  // mosaic can retune it without a competing rule; the ratio expression the
  // drag handles drive stays the fallback, so it still owns the default canvas.
  assert.match(css, /grid-template-columns: var\(--mc-canvas-cols,\s*\n?\s*minmax\(var\(--pane-min-w\), var\(--col-ratio\)\)/);
  assert.match(css, /minmax\(var\(--pane-min-h\), var\(--row-ratio\)\)/);
  // 3x2 keeps its first column resizable; the other two share the remainder.
  assert.match(css, /layout-grid-3x2[\s\S]*repeat\(2, minmax\(var\(--pane-min-w\), 1fr\)\)/);
  // Narrow fallbacks are measured on the stage, never the viewport: a viewport
  // rule stacked a chosen 2x2 on a 1024px window while the switcher said 2x2.
  assert.doesNotMatch(css, /@media \(max-width: 1100px\)/);
  assert.match(css, /@container workspace-stage \(max-width: 860px\) \{\s*\.shell \.view-workspace \.terminal-grid\.layout-grid-3x2:not\(\.has-expanded\):not\(\.is-mosaic\)[\s\S]*grid-auto-rows: minmax\(var\(--pane-min-h\), 1fr\)/);
});

test("main.jsx loads the authoritative redesign layer last", () => {
  const main = read("main.jsx");
  assert.match(main, /import "\.\/premiumDesign\.css";[\s\S]*import "\.\/redesign\/tokens-bridge\.css";[\s\S]*import "\.\/redesign\/base\.css";[\s\S]*import "\.\/redesign\/workspace\.css";[\s\S]*import "\.\/redesign\/screens\.css";[\s\S]*import "\.\/redesign\/cockpit\.css";[\s\S]*import "\.\/redesign\/surfaces\.css";/);
  assert.doesNotMatch(main, /import "\.\/theme-concept\.css"/);
});

test("terminal headers report role, uptime, ownership and activity from engine facts", () => {
  const src = read("TerminalPane.jsx");
  assert.match(src, /className="terminal-pane__facts"/);
  assert.match(src, /terminal-role-tag role-\$\{profile\.key\}/);
  assert.match(src, /terminal-pane__activity/);

  // Uptime is derived from engine startTime and is absent unless alive.
  assert.match(src, /function uptime\(session\)[\s\S]*if \(!session\?\.isAlive \|\| !Number\.isFinite\(session\?\.startTime\)\) return null/);
  // Ownership names the engine-owned PTY and the real pid, never a guess.
  assert.match(src, /function ownership\(session\)[\s\S]*Engine PTY · pid \$\{session\.pid\}/);
  assert.match(src, /Engine-owned PTY/);
  // Activity uses only reported evidence and falls back to silence.
  assert.match(src, /function activity\(session, connection\)[\s\S]*session\.attentionReason/);
  assert.match(src, /Running · no output reported yet/);
  // No fabricated completion: the pane renders no computed percentage and no
  // width-driven progress bar, only reported text.
  assert.doesNotMatch(src, /style=\{\{\s*width:/);
  assert.doesNotMatch(src, /percentComplete|completionPercent|progressValue/i);
});

test("the uptime clock only runs while the engine reports the worker alive", () => {
  const src = read("TerminalPane.jsx");
  assert.match(src, /if \(!session\?\.isAlive\) return undefined;\s*\n\s*const timer = window\.setInterval/);
  assert.match(src, /return \(\) => window\.clearInterval\(timer\)/);
});

test("terminal overflow menu exposes every required action including reconfigure", () => {
  const src = read("TerminalPane.jsx");
  for (const action of [
    "Focus terminal", "Find in output", "Copy selection", "Clear display",
    "Move to another pane", "Rename", "Reconfigure worker",
    "Start with workspace", "Duplicate worker", "Restart worker", "Delete terminal"
  ]) assert.ok(src.includes(action), `overflow menu is missing "${action}"`);

  // Pop out moved to a header control on 2026-09-15, beside maximise, and left
  // the menu so it is offered once.
  assert.match(src, /className="icon-button terminal-pane__popout"/);
  const menuLines = src.split("\n").filter(line => line.includes("<DropdownMenu.Item"));
  assert.ok(!menuLines.some(line => line.includes("Pop out terminal")), "pop out must not also be a menu entry");

  // Start and stop left this menu on 2026-09-12 for a control on the header,
  // so it no longer carries a verb whose own label has to be read to learn
  // which of the two it would do. Both are still one click away, and closer.
  assert.match(src, /onClick=\{\(\) => requestAction\(session\.isAlive \? "kill" : "start"\)\}/);

  // Destructive entries stay marked and Delete still routes through confirmation.
  assert.match(src, /is-danger" onSelect=\{\(\) => requestAction\("remove"\)\}/);
  assert.doesNotMatch(src, /className="terminal-delete-button"/);
});

test("reconfigure opens the existing worker dialog in edit mode, not a new API", () => {
  const app = read("App.jsx");
  assert.match(app, /onReconfigure=\{session => setWorkerDialog\(\{ mode: "edit", configuration: session \}\)\}/);
  assert.match(app, /onReconfigure=\{onReconfigure\}/);
  const pane = read("TerminalPane.jsx");
  assert.match(pane, /onReconfigure\(session\)/);
});

test("workspace toolbar carries layout, creation, search, focus mode and recipes", () => {
  const app = read("App.jsx");
  assert.match(app, /workspace-toolbar-v2/);
  assert.match(app, /TERMINAL WORKSPACE/);
  assert.match(app, /CANVAS LAYOUT/);
  assert.match(app, /Add terminal worker/);
  assert.match(app, /workspace-worker-search/);
  assert.match(app, /workspace-focus-mode/);
  assert.match(app, /className="workspace-recipes"/);
  // Focus mode is presentation only — it must not dispatch worker actions.
  assert.match(app, /setFocusMode\(value => !value\)/);
  assert.match(app, /\{!focusMode && <WorkerFolders/);
  assert.match(app, /inspectorOpen && !focusMode && <aside/);
});

test("worker search assigns a match into the focused pane without restarting it", () => {
  const app = read("App.jsx");
  assert.match(app, /const focusedSlot = Math\.max\(0, terminalLayout\.sessionIds\.indexOf\(focusedId\)\)/);
  assert.match(app, /const showInPane = id => \{ terminalLayout\.setSlotSession\(focusedSlot, id\); onFocus\(id\); setQuery\(""\); \}/);
  // Showing a worker in a pane must never dispatch start/restart/attach.
  assert.doesNotMatch(app, /showInPane = id => \{[^}]*onAction/);
});

test("workspace keyboard shortcuts move pane focus and cycle layouts", () => {
  const app = read("App.jsx");
  assert.match(app, /ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns/);
  assert.match(app, /const columns = terminalLayout\.layout\.cols \|\| 1/);
  assert.match(app, /event\.key\.toLowerCase\(\) === "l"/);
  // Shortcuts stay inert while a dialog, palette or confirmation owns focus.
  assert.match(app, /if \(view !== "workspace" \|\| paletteOpen \|\| missionAiOpen \|\| missionGraphOpen \|\| confirmation \|\| workerDialog \|\| !event\.altKey\) return/);
});

test("every terminal layout declares the column count the shortcuts rely on", async () => {
  const { TERMINAL_LAYOUTS } = await load();
  for (const layout of TERMINAL_LAYOUTS) {
    assert.equal(Number.isInteger(layout.cols) && layout.cols > 0, true, `${layout.id} has no cols`);
    assert.equal(Number.isInteger(layout.rows) && layout.rows > 0, true, `${layout.id} has no rows`);
    assert.equal(layout.cols * layout.rows, layout.slots, `${layout.id} cols×rows must equal slots`);
  }
});

test("filtered worker groups adapt to their population without changing the selected canvas layout", () => {
  const app = read("App.jsx");
  assert.match(app, /function layoutForCount\(count\)/);
  assert.match(app, /count <= 1 \? "single" : count === 2 \? "horizontal" : count <= 4 \? "grid-2x2" : "grid-3x2"/);
  assert.match(app, /const effectiveLayout = activeFolder \? layoutForCount\(folderSessions\.length\) : terminalLayout\.layout/);
  assert.match(app, /folderWorkers\.length < effectiveLayout\.slots \? \[null\] : \[\]/);
  assert.match(app, /terminal-grid \$\{effectiveLayout\.className\}/);
  assert.match(app, /terminalLayout\.layout\.id === option\.id/,
    "the persisted canvas selection must remain highlighted while a filter is active");
  assert.doesNotMatch(app, /activeFolder[\s\S]{0,220}Array\.from\(\{ length: Math\.max\(0, terminalLayout\.layout\.slots/);
});

test("expanded terminals synchronize peers into mounted minimized strips", () => {
  const app = read("App.jsx");
  const pane = read("TerminalPane.jsx");
  const css = read("redesign/workspace.css");

  assert.match(app, /const visible = filteredSlots/);
  assert.match(app, /minimized=\{Boolean\(expandedId\) && Boolean\(session\) && session\.id !== expandedId\}/);
  assert.match(pane, /minimizedRef = React\.useRef\(Boolean\(minimized\)\)/);
  assert.match(pane, /if \(disposed \|\| !host\.isConnected \|\| minimizedRef\.current\) return/);
  assert.match(pane, /terminal-pane__header--minimized/);
  assert.match(pane, /<div className="terminal-host" ref=\{hostRef\} aria-hidden=\{minimized \|\| undefined\} inert=\{minimized \? "" : undefined\}/,
    "the xterm host must remain mounted when its strip is minimized");
  assert.match(css, /terminal-grid\.has-expanded[\s\S]*terminal-pane\.is-expanded[\s\S]*terminal-pane\.is-minimized/);
  assert.match(css, /terminal-pane\.is-minimized \.terminal-host[\s\S]*width: 1px;[\s\S]*opacity: 0/);
});

test("workspace increment 2 keeps dialog, status and menu polish in the authoritative token layer", () => {
  const base = read("redesign/base.css");
  const surfaces = read("redesign/surfaces.css");
  const workspace = read("redesign/workspace.css");
  const pane = read("TerminalPane.jsx");

  assert.match(workspace, /\.view-workspace \.workspace-intelligence \{ display: none !important; \}/);
  assert.match(workspace, /\.workspace-title \{[\s\S]{0,100}min-width: 200px/);
  assert.match(base, /status-bar-premium__indicator[\s\S]*background: var\(--mc-ok-soft\)/);
  assert.match(base, /status-bar-premium__crumb[\s\S]*border-left: 1px solid var\(--mc-hairline\)/);
  assert.match(surfaces, /worker-template-card code[\s\S]*white-space: nowrap;[\s\S]*text-overflow: ellipsis/);
  assert.match(surfaces, /worker-dialog-guide[\s\S]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  // Two now, not three: the run entries that needed a group of their own left
  // this menu for the control beside it on the header.
  assert.equal((pane.match(/DropdownMenu\.Separator className="terminal-action-separator"/g) || []).length, 2);
  assert.doesNotMatch(pane, /[⠿↗⊡]|•••/);
  assert.match(pane, /function PaneIcon/);
});

test("folder filters cannot move the workspace chrome with terminal intrinsic height", () => {
  const base = read("redesign/base.css");
  const css = read("redesign/workspace.css");
  assert.match(base, /html body #root \.shell > \.main-area \{[\s\S]*grid-template-rows: var\(--mc-topbar-h, 42px\) minmax\(0, 1fr\) !important;/,
    "the loaded-last shell must match premiumV3 specificity and beat its obsolete bottom-status grid");
  assert.match(base, /html body #root \.shell > \.main-area > \.mission-status-bar \{ grid-row: 1; \}/);
  assert.match(base, /html body #root \.shell > \.main-area > \.experience \{ grid-row: 2; \}/,
    "all screens, including Needs You, must occupy the bounded second shell row");
  assert.match(base, /html body #root \.shell > \.main-area > \.experience\.view-workspace \{[\s\S]*overflow: hidden !important;/);
  assert.match(css, /\.view-workspace \.terminal-grid \{[\s\S]*flex: 1 1 0 !important;/);
  assert.match(css, /\.workspace-experience \{[\s\S]*display: flex !important;[\s\S]*overflow: hidden;/);
  assert.match(css, /\.workspace-stage \{[\s\S]*flex: 1 1 0;[\s\S]*justify-content: flex-start !important;[\s\S]*overflow: hidden;/);
  assert.match(css, /\.workspace-stage > \.workspace-toolbar-v2 \{ order: 1; flex: 0 0 auto; \}/);
  assert.match(css, /\.workspace-stage > \.worker-folders \{ order: 2; flex: 0 0 auto; \}/);
  assert.match(css, /\.workspace-stage > \.terminal-grid \{ order: 3; \}/);
});

test("pane-resize window listeners are torn down if the view unmounts mid-drag (T095)", () => {
  const app = read("App.jsx");
  assert.match(app, /const resizeTeardownRef = React\.useRef\(null\);/);
  assert.match(app, /React\.useEffect\(\(\) => \(\) => \{ resizeTeardownRef\.current\?\.\(\); \}, \[\]\);/);
  assert.match(app, /resizeTeardownRef\.current = stop;/);
  assert.match(app, /resizeTeardownRef\.current = null;.*removeEventListener\("pointermove"|removeEventListener\("pointermove"[\s\S]{0,200}resizeTeardownRef\.current = null/);
});

test("xterm is created with screen-reader support and its limitation is documented (T097)", () => {
  const pane = read("TerminalPane.jsx");
  assert.match(pane, /screenReaderMode: true/);
  assert.match(pane, /NVDA[\s\S]{0,40}VoiceOver/i);
  assert.match(pane, /not[\s\S]{0,20}scrollback review/);
});

test("the terminal session chooser has a complete keyboard + dismissal contract (T092)", () => {
  const pane = read("TerminalPane.jsx");
  assert.match(pane, /const chooserRef = React\.useRef\(null\);/);
  assert.match(pane, /const chooserTriggerRef = React\.useRef\(null\);/);
  // Escape / Tab close and restore focus to the trigger.
  assert.match(pane, /event\.key === "Escape".*restore\(\)|restore = \(\) => \{ setChooserOpen\(false\); chooserTriggerRef\.current\?\.focus\(\); \}/);
  // Arrow / Home / End roam the menu items.
  assert.match(pane, /event\.key === "ArrowDown" \|\| event\.key === "ArrowUp" \|\| event\.key === "Home" \|\| event\.key === "End"/);
  // An outside pointer closes it.
  assert.match(pane, /document\.addEventListener\("pointerdown", onPointerDown, true\)/);
  assert.match(pane, /<div ref=\{chooserRef\} className="terminal-session-menu" role="menu"/);
  assert.match(pane, /ref=\{chooserTriggerRef\}/);
});

// T088/T091 — the mounted-terminal ceiling is the reason hibernation is not
// needed. If someone raises it, this test is where they find out that the
// deferred-mounting work in T091 becomes a prerequisite rather than a nicety.
test("no layout mounts more than six live terminals", async () => {
  const { TERMINAL_LAYOUTS } = await load();
  const largest = Math.max(...TERMINAL_LAYOUTS.map(layout => layout.slots));
  assert.ok(largest <= 6, `a layout offers ${largest} panes; hibernation (T091) must land before exceeding six`);
  assert.deepEqual(TERMINAL_LAYOUTS.map(layout => layout.slots), [1, 2, 2, 4, 6]);
});

// T089 — an arrangement you built is worth keeping, per project and bounded.
test("named pane sets are normalised, bounded, and scoped to their project", async () => {
  const source = read("useTerminalLayout.js");
  assert.match(source, /const PANE_SET_PREFIX = "mission-control:pane-sets:v1:";/);
  assert.match(source, /const MAX_PANE_SETS = 12;/);
  // The stored value is untrusted: it outlives releases and can name workers
  // that no longer exist, so it is re-normalised on read.
  assert.match(source, /function normalizePaneSets\(value\)/);
  assert.match(source, /if \(sets\.length >= MAX_PANE_SETS\) break;/);
  // Saving over a name replaces rather than accumulating duplicates.
  assert.match(source, /paneSets\.filter\(item => item\.name\.toLowerCase\(\) !== label\.toLowerCase\(\)\)/);
  // Applying a set goes back through the same normaliser as any other layout
  // change, so a set naming a removed worker cannot corrupt the canvas.
  assert.match(source, /applyPaneSet[\s\S]{0,320}normalizeTerminalLayout\(\{ \.\.\.current, layoutId: entry\.layoutId, sessionIds: entry\.sessionIds \}, sessions\)/);
});

test("a terminal is resized from its own edges and corners; only the tiles it pushes give way", async () => {
  const { tileRows, normalizeTileSizes, resizeTile, tileGrid, tileEdges, evenTileSizes } = await loadTiles();
  const rows = tileRows(8, 5);
  assert.deepEqual(rows, [5, 3], "full rows of the column count, then the remainder");
  const even = normalizeTileSizes(null, rows);
  const metrics = { width: 1400, height: 800, colGap: 6, rowGap: 6 };
  const px = (fraction, count) => fraction * (metrics.width - (count - 1) * metrics.colGap);

  // Dragging the bottom-right corner of the second terminal 200px right and
  // 100px down: it grows by exactly that, the tiles to its right share the
  // loss, the tile to its left and the whole row below keep their widths.
  const grown = resizeTile(even, rows, { row: 0, cell: 1 }, "se", 200, 100, metrics);
  assert.ok(Math.abs(px(grown.cells[0][1], 5) - (px(0.2, 5) + 200)) < 0.5);
  assert.ok(Math.abs(grown.cells[0][0] - 0.2) < 1e-9, "the edge that was not dragged stays put");
  assert.deepEqual(grown.cells[1], even.cells[1], "another row is not bent to fit");
  assert.ok(Math.abs(grown.cells[0][2] - grown.cells[0][4]) < 1e-9);
  assert.ok(Math.abs(grown.rows[0] * (metrics.height - metrics.rowGap) - (0.5 * (metrics.height - metrics.rowGap) + 100)) < 0.5);

  // A drag past what the neighbours can give stops at their floor.
  const clamped = resizeTile(even, rows, { row: 0, cell: 4 }, "w", 5000, 0, metrics);
  assert.ok(px(clamped.cells[0][4], 5) >= 199.5, "a terminal never shrinks below the floor");

  // The canvas is one flat grid in which every tile is exactly as wide as its
  // row says, however the rows differ.
  const grid = tileGrid(grown, metrics.width, metrics.colGap);
  assert.equal(grid.valid, true);
  const lines = [0];
  grid.tracks.forEach((size, index) => lines.push(lines[index] + size + metrics.colGap));
  grid.placements.forEach(place => {
    const width = lines[place.end] - lines[place.start] - metrics.colGap;
    assert.ok(Math.abs(width - px(grown.cells[place.row][place.cell], rows[place.row])) < 0.5, `tile ${place.row}:${place.cell} is ${width}px`);
  });

  // Only edges with a neighbour to push are offered.
  assert.deepEqual(tileEdges(rows, { row: 0, cell: 0 }), ["e", "s", "se"]);
  assert.deepEqual(tileEdges(rows, { row: 1, cell: 2 }), ["nw", "n", "w"]);
  assert.deepEqual(tileEdges(rows, { row: 0, cell: 2 }, { vertical: false }), ["w", "e"]);
  assert.deepEqual(tileEdges([1], { row: 0, cell: 0 }), []);

  // Double-click evens out what the grip moves.
  const evened = evenTileSizes(grown, rows, { row: 0, cell: 1 }, "e");
  assert.deepEqual(evened.cells[0], even.cells[0]);
  assert.deepEqual(evened.rows, grown.rows);
});

test("a stored arrangement is untrusted and is re-fitted to the canvas it is read for", async () => {
  const { normalizeTileSizes, seedFromRatios, tileShapeKey } = await loadTiles();
  assert.deepEqual(normalizeTileSizes({ rows: [1, "x"], cells: [[1, -2, 3]] }, [3, 3]), {
    rows: [0.5, 0.5],
    cells: [[1 / 3, 1 / 3, 1 / 3], [1 / 3, 1 / 3, 1 / 3]]
  });
  assert.deepEqual(normalizeTileSizes({ cells: [[3, 1]] }, [2]).cells[0], [0.75, 0.25]);
  // The slot layouts' old per-axis splits seed the tiles, so a split someone
  // dragged before survives the change of model.
  const seeded = normalizeTileSizes(seedFromRatios("grid-3x2", { col: 34, col2: 33, row: 60 }), [3, 3]);
  assert.deepEqual(seeded.rows.map(value => Math.round(value * 100)), [60, 40]);
  assert.deepEqual(seeded.cells[1].map(value => Math.round(value * 100)), [34, 33, 33]);
  assert.equal(tileShapeKey("packed", [4, 3]), "packed:4,3");
  assert.equal(tileShapeKey("slots", []), "");
});

test("every canvas mode resizes per terminal, focus mode or not", () => {
  const app = read("App.jsx");
  const workspace = read("redesign/workspace.css");
  const surfaces = read("redesign/surfaces.css");
  // One model for the slot layouts, folders and the packed canvas.
  assert.match(app, /const tileRowCounts = React\.useMemo\(\(\) => \(tileColumns > 0 \? tileRows\(canvasTileCount, tileColumns\) : \[\]\)/);
  assert.match(app, /const tileColumns = packedCanvas \? mosaicTracks : effectiveLayout\.cols;/);
  assert.match(app, /const tileShape = tileShapeKey\(packedCanvas \? "packed" : "slots", tileRowCounts\);/);
  // The shared boundary splitters are gone.
  assert.doesNotMatch(app, /terminalLayout\.handles\.map|canvasTrackHandles|beginCanvasTrackResize|beginPaneResize/);
  // Each tile is placed between its own two lines; nothing is reparented.
  assert.match(app, /tilePlacement=\{placementAt\(mosaic && session \? \(mosaicOrder\.positions\.get\(session\.id\) \?\? slotIndex\) : slotIndex\)\}/);
  assert.match(app, /\.\.\.\(tilePlacement \? \{ gridColumn: tilePlacement\.column, gridRow: tilePlacement\.gridRow \}/);
  assert.match(app, /style\["--mc-canvas-cols"\] = tileLayout\.templates\.columns;/);
  // Sizes are persisted per project and per shape, and validated on read.
  assert.match(app, /const CANVAS_TILES_PREFIX = "mission-control:canvas-tiles:v1:";/);
  assert.match(app, /shapes\[shape\] = normalizeTileSizes\(entry, rows\);/);
  // The auto-fit column count still comes from the probe.
  assert.match(app, /className="canvas-track-probe"/);
  assert.match(surfaces, /\.terminal-grid > \.canvas-track-probe \{[^}]*grid-template-columns: repeat\(auto-fit/);
  // Handles: one tile at a time, edges are keyboard separators, double-click
  // evens out, Escape puts the drag back.
  assert.match(app, /const framePosition = tileResize\?\.position \?\? hoverTile \?\?/);
  assert.match(app, /role="separator" tabIndex=\{0\} data-tile-grip=\{grip\}/);
  assert.match(app, /onDoubleClick=\{\(\) => evenTile\(tileFrame, grip\)\}/);
  assert.match(app, /onKeyDown=\{event => nudgeTile\(event, tileFrame, grip\)\}/);
  assert.match(app, /if \(keyEvent\.key !== "Escape"\) return;/);
  // A stacked narrow canvas has nothing beside a terminal to give way.
  assert.match(app, /stacked: style\.getPropertyValue\("--mc-canvas-stacked"\)\.trim\(\) === "1"/);
  assert.equal((workspace.match(/--mc-canvas-stacked: 1;/g) || []).length, 2);
  assert.match(workspace, /\.terminal-grid \.tile-resize-grip\.is-se \{[^}]*cursor: nwse-resize;/);
  assert.match(workspace, /\.terminal-grid\.is-tile-resizing \.terminal-host \{ pointer-events: none; \}/);
});
