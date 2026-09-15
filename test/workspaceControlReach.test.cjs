"use strict";

// Four things an operator could not reach, and the fixes that gave them back.
//
//   1. A terminal the engine *observed* running an agent CLI got its own "AI
//      ACTIVITY" panel, so the answer to "which agents are working for me?"
//      was split across two registers. There is one register now.
//   2. Focus mode replaced the slot layouts with a mosaic, and the mosaic had
//      no arrangement gesture at all — dragging a terminal onto another tile
//      did nothing, though it worked in every other layout.
//   3. A narrow pane sheds its lowest-value header controls, which is right;
//      what was wrong is that the shed ones went nowhere. One control now
//      holds them, sitting directly before the two window-like ones.
//   4. Focus mode's floating deck stood on the terminal underneath it the
//      whole time it was on screen.
//
// A fifth thing surfaced while fixing the third: the theme is a class on
// `.shell`, but Radix portals every menu and dialog into <body>, so in Solar
// Light they all resolved the dark defaults. Measured before the fix, the
// document body painted rgb(0,0,0) with the light theme selected.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const RENDERER = path.join(__dirname, "..", "src", "groundstation", "renderer");
const read = name => fs.readFileSync(path.join(RENDERER, name), "utf8");

/* ------------------------------------------------------------------ 1 · crew */

test("every agent lives in one register, however Mission Control came to know about it", () => {
  const app = read("App.jsx");

  // Both routes into "this is an agent", in one predicate the registers share.
  assert.match(
    app,
    /function isAgentSession\(session\) \{[\s\S]{0,240}?session\.id\.startsWith\("agent-"\) \|\| liveAgentClassification\.get\(session\.id\)\?\.isAgent === true;/
  );
  assert.match(app, /const agents = sessions\.filter\(isAgentSession\);/);
  assert.match(app, /const workers = sessions\.filter\(session => !isAgentSession\(session\)\);/);

  // The second register is gone — component, element and stylesheet.
  assert.doesNotMatch(app, /AgentActivityRegister/);
  assert.doesNotMatch(app, /agent-register/);
  assert.doesNotMatch(read("redesign/surfaces.css"), /agent-register/);

  // A detected agent leaves Project operations rather than appearing twice.
  assert.match(app, /className="mc-ref-section mc-gs-register mc-gs-register--operations"/);
  assert.match(app, /<ManifestList workers=\{visibleWorkers\}/);
});

test("the crew row carries the live state the removed panel used to show", () => {
  const app = read("App.jsx");

  // The activity map is derived from the engine's classification, not guessed.
  assert.match(app, /for \(const activity of ops\.agents \|\| \[\]\) if \(activity\?\.isAgent\) map\.set\(activity\.workerId, activity\);/);
  assert.match(app, /<ManifestList workers=\{visibleAgents\} activities=\{agentActivity\} onOpenDecision=\{onOpenDecisionSource\}/);
  assert.match(app, /agent=\{activities\?\.get\(session\.id\) \|\| null\}/);

  // State, the tool it named, and its token cost — the panel's whole payload.
  assert.match(app, /const agentState = agent \? \(AGENT_STATE_COPY\[agent\.state\] \|\| \{ label: agent\.state \|\| "Unknown", tone: "idle" \}\) : null;/);
  assert.match(app, /\{agentDetail \|\| workerActivity\(session\)\}/);
  assert.match(app, /const resourceText = agentTokens \? `\$\{agentTokens\.toLocaleString\(\)\} tok` : machineText;/);

  // An agent waiting on a decision opens the decision, not the terminal.
  assert.match(app, /const reviewAgent = Boolean\(agent && agent\.state === "awaiting_approval" && onOpenDecision\);/);
  assert.match(app, /if \(reviewAgent\) onOpenDecision\(session\.id\);/);
});

test("an agent's state is reported, never inferred, and never wider than its column", () => {
  const app = read("App.jsx");
  const copy = app.slice(app.indexOf("const AGENT_STATE_COPY"), app.indexOf("function agentStateLine"));

  // The state column is 84px. At the row's 11px type that is about twelve
  // characters; a longer label has no wrap and paints over the activity beside
  // it, which is exactly what "Response ready" used to do.
  const labels = [...copy.matchAll(/label: "([^"]+)"/g)].map(match => match[1]);
  assert.ok(labels.length >= 6, `expected every agent state to be named, saw ${labels.length}`);
  for (const label of labels) {
    assert.ok(label.length <= 12, `state label "${label}" is too wide for the 84px state column`);
  }
  // The fuller phrasing is not lost: it moves to the chip's tooltip.
  for (const state of ["idle", "thinking", "executing", "awaiting_approval", "response_ready", "failed"]) {
    assert.match(copy, new RegExp(`${state}: \\{ label: "[^"]+", full: "`), `${state} has no tooltip phrasing`);
  }
  assert.match(app, /label=\{statusText\} title=\{agentState\?\.full\}/);

  // Nothing is asserted about an agent that the CLI did not report.
  const line = app.slice(app.indexOf("function agentStateLine"), app.indexOf("function LiveGroundstationView"));
  assert.match(line, /if \(!activity\) return "";/);
  assert.match(line, /return "";\s*\}/, "an unrecognised state must produce no claim at all");

  // And the chip can never bleed into its neighbour again, whatever the label.
  assert.match(
    read("redesign/surfaces.css"),
    /\.mc-ref-manifest-row \.mc-ref-status \{\s*min-width: 0;\s*overflow: hidden;\s*\}/
  );
});

/* ---------------------------------------------------------------- 2 · mosaic */

test("a mosaic tile can be rearranged, and rearranging it never rebuilds a terminal", () => {
  const app = read("App.jsx");

  // Per-project, device-local, and re-reconciled against the live list on read.
  assert.match(app, /const MOSAIC_ORDER_PREFIX = "mission-control:mosaic-order:v1:";/);
  assert.match(app, /function useMosaicOrder\(workspaceKey, sessions\) \{/);
  assert.match(app, /for \(const id of order\) if \(live\.has\(id\) && !seen\.has\(id\)\) \{ seen\.add\(id\); ids\.push\(id\); \}/);
  assert.match(app, /for \(const session of sessions\) if \(!seen\.has\(session\.id\)\) ids\.push\(session\.id\);/);

  // Dropping on a tile means "put it here" — the same verb every other layout
  // gives the gesture — and it focuses what you just moved.
  assert.match(app, /if \(mosaic\) \{ if \(!id\) return; mosaicOrder\.move\(id, session\?\.id\); onFocus\(id\); return; \}/);

  // Placement is by `order`, so the DOM keeps session order and React never
  // unmounts an xterm to move a pane. An xterm that is torn down loses its
  // scrollback, and moving a pane is not a reason to lose what it printed.
  assert.match(app, /const tileStyle = Number\.isInteger\(tileOrder\) \|\| tileSpan > 1/);
  assert.match(app, /\.\.\.\(Number\.isInteger\(tileOrder\) \? \{ order: tileOrder \} : null\),/);
  assert.match(app, /tileOrder=\{mosaic && session \? \(mosaicOrder\.positions\.get\(session\.id\) \?\? slotIndex\) : undefined\}/);
  assert.doesNotMatch(app, /key=\{`tile-/, "reordering must not be done by changing a pane's key");

  // Placeholder tiles take the same position, or a mosaic with a popped-out
  // worker in it would place that one tile by DOM order alone.
  assert.match(app, /function EmptyTerminalSlot\(\{ sessions, style,/);
  assert.match(app, /function DetachedTerminalSlot\(\{ session, slotInfo, style,/);

  // A uniform grid leaves the last row short whenever the tile count is not a
  // multiple of the column count: measured at 1440x900 with seven terminals,
  // the mosaic packed to four columns and left one cell — a whole terminal of
  // dead canvas — empty in the corner. The short row divides the full width
  // between the tiles it does have instead.
  //
  // The column count has to be measured rather than assumed: `auto-fit` picks
  // it from what the window can hold at a readable tile width, which is not
  // always the balanced count the renderer derived, and that fallback is
  // deliberate. Spanning against the wrong number would push a tile onto a
  // row of its own.
  assert.match(app, /const \[mosaicTracks, setMosaicTracks\] = React\.useState\(0\);/);
  assert.match(app, /window\.getComputedStyle\(node\)\.gridTemplateColumns/);
  assert.match(app, /const mosaicSpan = React\.useCallback\(position => \{/);
  assert.match(app, /const lastRowCount = tileCount % mosaicTracks;/);
  assert.match(app, /return Math\.floor\(mosaicTracks \/ lastRowCount\) \+ \(index < mosaicTracks % lastRowCount \? 1 : 0\);/);
  assert.match(app, /tileSpan=\{mosaicSpan\(mosaic && session \?/);
  assert.match(app, /<WorkspaceBrowser style=\{\(\(\) => \{ const span = mosaicSpan\(canvasWorkers\.length\); const order = mosaic \? canvasWorkers\.length : null;/);
});

test("the pane chooser tells the truth about what it does in a mosaic", () => {
  const app = read("App.jsx");
  const pane = read("TerminalPane.jsx");

  // A mosaic mounts every worker, so no position can be freed.
  assert.match(app, /canEmpty=\{!mosaic\}/);
  assert.match(pane, /\{canEmpty && <button type="button" role="menuitem" onClick=\{\(\) => \{ onSelectSession\(""\); setChooserOpen\(false\); \}\}/);
  assert.match(pane, /\{canEmpty \? "SHOW IN THIS PANE" : "MOVE A TERMINAL HERE"\}/);

  // Alt 1-6 addresses the slot layout, which the mosaic does not use, so a
  // mosaic tile must not wear a shortcut hint the shortcut will not honour.
  assert.match(app, /shortcut=\{mosaic \? null : slotIndex < 6 \? slotIndex \+ 1 : null\}/);
});

/* ------------------------------------------------ 3 · one menu, and a control */

// 2026-09-12. The tray from fix 3 solved the shedding problem and created a
// worse one: the pane then carried two panels, one control apart, offering
// three of the same entries in two different shapes. The ⋯ menu is present at
// every width, so it holds everything now and the tray is gone.
test("the pane offers one menu, not a menu and a panel of the same entries", () => {
  const pane = read("TerminalPane.jsx");

  // The tray, its toggle and the Popover it was built from are all gone.
  assert.doesNotMatch(pane, /terminal-pane-tray|tray-toggle|trayOpen/, "the second panel must not come back");
  assert.doesNotMatch(pane, /@radix-ui\/react-popover/, "nothing in the pane needs a popover any more");
  assert.doesNotMatch(read("redesign/surfaces.css"), /\.terminal-pane-tray/, "its styling went with it");

  // Everything it held is in the menu, in the menu's own grammar.
  assert.match(pane, /<span>Find in output<\/span><kbd>Ctrl F<\/kbd>/);
  assert.match(pane, /<span>Focus terminal<\/span>\{shortcut \? <kbd>Alt \{shortcut\}<\/kbd> : null\}/);
  assert.match(pane, /className="terminal-action-item is-compact terminal-action-drag"[\s\S]{0,200}?draggable/);
  assert.match(pane, /setData\("application\/x-mission-worker", session\.id\); event\.dataTransfer\.setData\("text\/plain", session\.id\); setActionMenuOpen\(false\);/);

  // The direct drag handle stays on the header: burying the mosaic's own
  // arrangement gesture behind a click would undo fix 2 above.
  const actionsStart = pane.indexOf('<div className="terminal-pane__actions">');
  const actions = pane.slice(actionsStart, pane.indexOf("</header>", actionsStart));
  assert.ok(actions.length > 0, "could not find the pane's action cluster");
  assert.ok(actions.indexOf("terminal-drag-handle") < actions.indexOf("terminal-pane__run"), "the direct drag handle stays, and stays first");
  assert.ok(actions.indexOf("terminal-pane__run") < actions.indexOf("terminal-more"), "the run control sits before the menu it was taken out of");
  assert.ok(
    actions.indexOf("terminal-more") < actions.lastIndexOf('name={expanded ? "restore" : "expand"}'),
    "expand stays last"
  );
});

// Running or not running was two levels down a menu whose label had to be read
// to learn which of the two it would do.
test("start and stop is a control on the header, not an entry in the menu", () => {
  const pane = read("TerminalPane.jsx");

  assert.match(pane, /className=\{`icon-button terminal-pane__run \$\{session\.isAlive \? "terminal-pane__run--stop" : "terminal-pane__run--start"\}`\}/);
  assert.match(pane, /onClick=\{\(\) => requestAction\(session\.isAlive \? "kill" : "start"\)\}/);
  assert.match(pane, /name=\{session\.isAlive \? "stop" : "play"\}/);

  // It is not also in the menu — that duplication is what it replaced.
  const menuStart = pane.indexOf('<DropdownMenu.Content className="terminal-action-menu"');
  const menu = pane.slice(menuStart, pane.indexOf("</DropdownMenu.Content>", menuStart));
  assert.ok(menuStart > 0, "could not find the action menu");
  assert.doesNotMatch(menu, /<span>Stop worker<\/span>/, "stop is a control now");
  assert.doesNotMatch(menu, /actionLabel\(session\)/, "start is a control now");
  // Restart is neither start nor stop, and stays where a second thought belongs.
  assert.match(menu, /<span>Restart worker<\/span>/);

  // The modifier is spelled out because `is-start` / `is-stop` are the app-wide
  // danger-button family: measured, a 24px glyph control inherited that family's
  // padded danger treatment through premiumDesign.css.
  assert.match(read("premiumDesign.css"), /\.is-stop\)/, "the colliding family is still there, which is why the name is not reused");
  assert.doesNotMatch(pane, /terminal-pane__run \$\{session\.isAlive \? "is-stop"/);
});

// Measured on a bottom-row pane in a 1440x900 window before the fix: Radix
// offered 459px of room and published it, the menu rendered its full 599px, and
// its first three entries sat above the top of the window where no pointer
// could reach them. Nothing read the property Radix was already publishing.
test("the pane menu fits the room Radix measured for it", () => {
  const surfaces = read("redesign/surfaces.css");
  const block = surfaces.slice(surfaces.indexOf(".terminal-action-menu {"), surfaces.indexOf(".terminal-action-menu .terminal-action-item"));
  assert.match(block, /max-height: var\(--radix-dropdown-menu-content-available-height, none\);/);
  assert.match(block, /overflow-y: auto;/);
  // Radix only publishes that property when it is allowed to avoid collisions.
  assert.match(read("TerminalPane.jsx"), /className="terminal-action-menu" align="end" sideOffset=\{7\} collisionPadding=\{12\}/);
});

// A worker that is not running said so as one grey line printed into an empty
// terminal, and the control that would start it was inside the menu above.
test("an idle pane offers the one thing you want from it", () => {
  const pane = read("TerminalPane.jsx");
  assert.match(pane, /\{!minimized && !session\.isAlive && session\.status !== "failed" && \(/,
    "a failed worker keeps the crash lens instead — it is not idle");
  assert.match(pane, /<div className="terminal-idle">/);
  assert.match(pane, /className="terminal-idle__start" onClick=\{\(\) => requestAction\("start"\)\}/);
  // Engine-reported state only: a worker that never started and one that ran
  // and exited are different situations.
  assert.match(pane, /const idleState = session\.spawnError/);
  assert.match(pane, /title: session\.exitCode === 0 \? "Finished" : "Stopped"/);
  assert.doesNotMatch(pane, /Worker is resting/, "the printed line it replaced must not come back");

  const surfaces = read("redesign/surfaces.css");
  assert.match(surfaces, /\.terminal-pane:has\(> \.terminal-idle\) > \.terminal-host \{/,
    "the empty xterm behind the panel must collapse, not show through it");
});

// xterm ends a key it claims with stopPropagation, and every Mission Control
// shortcut is a window listener. Measured: with focus in a terminal, Ctrl K
// never reached the window and the palette never opened. The Workspace is
// exactly where a terminal always has focus.
test("the app's own shortcuts survive a focused terminal", () => {
  const pane = read("TerminalPane.jsx");
  assert.match(pane, /terminal\.attachCustomKeyEventHandler\(event => \{/);
  // Returning false makes xterm skip the key without cancelling it, so it keeps
  // propagating; true leaves the key with the shell.
  assert.match(pane, /if \(event\.altKey && !accelerator\) return false;/);
  assert.match(pane, /if \(accelerator && !event\.altKey && \(key === "k" \|\| key === "n"\)\) return false;/);
  assert.match(pane, /if \(event\.key === "F1"\) return false;/);
  assert.match(pane, /return true;\s*\n\s*\}\);/);
  // Ctrl F is the pane's own search. Its control has always advertised the
  // chord and nothing was listening for it anywhere.
  assert.match(pane, /if \(accelerator && !event\.shiftKey && !event\.altKey && key === "f"\) \{[\s\S]{0,200}?setFindOpen\(true\);\s*\n\s*return false;/);
  // Escape belongs to the terminal: the app would otherwise eat the one key a
  // shell needs most.
  assert.doesNotMatch(pane, /key === "escape"\) return false/i);
});

/* ------------------------------------------------------------- 4 · focus deck */

test("focus mode's controls stop standing on the terminal underneath them", () => {
  const app = read("App.jsx");
  const surfaces = read("redesign/surfaces.css");

  // Collapsed the deck is the one control that has to stay reachable: the way
  // out. Measured, that took it from 254x36 over a pane to 41x36.
  assert.match(
    surfaces,
    /:root\[data-workspace-focus="on"\][^\n]*\.workspace-toolbar-v2 \.workspace-action-label,\s*\n[^\n]*:is\(\.workspace-add-worker, \.workspace-assistant-toggle\) \{ display: none; \}/
  );
  for (const trigger of [":hover", ":focus-within"]) {
    assert.ok(
      surfaces.includes(`.workspace-toolbar-v2${trigger} :is(.workspace-add-worker, .workspace-assistant-toggle)`),
      `the worker button must come back on ${trigger}`
    );
  }
  // A label that cannot be addressed cannot be collapsed.
  assert.match(app, /<span className="workspace-action-label">Add terminal worker<\/span>/);
  assert.match(app, /<span className="workspace-action-label">\{focusMode \? "Exit focus" : "Focus"\}<\/span>/);
  // And the control that leaves focus mode does not wear the glyph for entering it.
  assert.match(app, /<Icon name=\{focusMode \? "collapse" : "expand"\} size=\{12\}\/>/);
  assert.match(app, /collapse: <><path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"\/><\/>,/);

  // A native browser view cannot be stacked under DOM, so the deck has to end
  // above the tile: 36px tall, 8px off the bottom.
  assert.match(surfaces, /\.is-focus-mode \.terminal-grid\.has-browser \{ margin-bottom: 44px; \}/);
  // The assistant is DOM, but its send button sits exactly where the deck
  // floats, so it gets the same gutter.
  assert.match(surfaces, /\.is-focus-mode \.terminal-grid\.has-assistant \{ margin-bottom: 44px; \}/);

  // Wrapping the labels put them inside the deck's treatment for a bare <span>
  // in a button — a small dim kicker. Measured in Solar Light, the worker
  // button's label came out 8px in --mc-text-dim on the accent fill. The label
  // is the button's own text and has to read as it.
  assert.match(
    surfaces,
    /\.workspace-actions button \.workspace-action-label \{[\s\S]{0,160}?color: inherit;[\s\S]{0,80}?font: inherit;/
  );
});

/* ------------------------------------------------------------------ 5 · theme */

test("portalled surfaces follow the chosen theme", () => {
  const preferences = read("useInterfacePreferences.js");

  // Radix portals into <body>, outside the `.shell` that carries the theme, so
  // every menu, dialog and tooltip resolved the dark defaults. Mirroring the
  // class onto the root defines the same tokens where portals can inherit them.
  assert.match(preferences, /const applied = `theme-\$\{preferences\.theme\}`;/);
  assert.match(preferences, /for \(const name of \["theme-orbital", "theme-solar", "theme-contrast"\]\) \{\s*root\.classList\.toggle\(name, name === applied\);/);
  assert.match(preferences, /return \(\) => root\.classList\.remove\(applied\);/);

  // The theme blocks are plain class selectors, which is why this works with no
  // stylesheet change — and why scoping one to `.shell` would silently undo it.
  for (const file of ["tokens.css", "redesign/tokens-bridge.css"]) {
    const source = read(file);
    for (const name of ["theme-solar", "theme-contrast"]) {
      assert.match(source, new RegExp(`^\\.${name} \\{`, "m"), `${file}: .${name} must stay unscoped`);
    }
  }
  // `.shell` keeps its own class too: applying the same declarations at both
  // levels is what makes the change provably neutral inside the shell.
  assert.match(read("App.jsx"), /className=\{`shell theme-\$\{preferences\.theme\}/);
});
