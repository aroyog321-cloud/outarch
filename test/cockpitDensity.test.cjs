const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
const read = (...parts) => fs.readFileSync(path.join(rendererRoot, ...parts), "utf8");

test("the primary sidebar keeps the six operator destinations in scan order", () => {
  const app = read("App.jsx");
  const navigation = app.slice(app.indexOf("const NAVIGATION"), app.indexOf("const PRIMARY_NAV_COUNT"));
  const ids = [...navigation.matchAll(/\["([a-z-]+)", "/g)].map(match => match[1]);

  // Agents is no longer a destination: being an AI agent is something a terminal
  // *is*, detected from its output, so it shows as a Workspace folder and a
  // Groundstation register rather than a separate place to visit.
  assert.deepEqual(
    ids.slice(0, 6),
    ["groundstation", "workspace", "needs", "recipes", "history", "settings"],
    "the primary six must stay in this order"
  );
  assert.equal(ids.includes("agents"), false, "Agents must not return as a sidebar destination");
  // Recipes is a daily verb, so it holds a slot rather than living only in a
  // dialog. Integrations stays reachable but trails the six.
  assert.equal(ids[3], "recipes");
  assert.equal(ids[6], "integrations");
  assert.match(app, /const PRIMARY_NAV_COUNT = 6;/);
});

test("Integrations renders as a contextual group below the primary seven", () => {
  const app = read("App.jsx");
  const cockpit = read("redesign", "cockpit.css");

  assert.match(app, /NAVIGATION\.slice\(0, PRIMARY_NAV_COUNT\)/);
  assert.match(app, /NAVIGATION\.slice\(PRIMARY_NAV_COUNT\)/);
  assert.match(app, /className="top-navigation__contextual" role="group" aria-label="Configuration"/);
  // The nav landmark itself is locked by productFoundation.test.cjs; the group
  // must sit inside it rather than becoming a second landmark.
  assert.match(app, /<nav className="top-navigation" aria-label="Mission Control navigation">/);
  assert.match(cockpit, /\.top-navigation__contextual \{[\s\S]*border-top: 1px solid var\(--mc-border\)/);

  // Every route into Recipes that existed before the promotion still exists.
  assert.match(app, /recipes: "Alt R"/);
  assert.match(app, /id: "workspace-recipes", label: "Open workspace recipes"/);
  assert.match(app, /<RecipesView/);
});

test("the consolidated surfaces layer loads after cockpit and preserves the shared reading grammar", () => {
  const main = read("main.jsx");
  const cockpit = read("redesign", "cockpit.css");
  const surfaces = read("redesign", "surfaces.css");

  // Order matters: this layer only works because it resolves after the
  // historical stylesheets it corrects.
  assert.match(main, /import "\.\/redesign\/screens\.css";[\s\S]*import "\.\/redesign\/cockpit\.css";[\s\S]*import "\.\/redesign\/surfaces\.css";/);
  assert.equal(
    main.trimEnd().split("\n").filter(line => line.startsWith("import ")).pop(),
    'import "./redesign/surfaces.css";',
    "surfaces.css must remain the final shared-component stylesheet import"
  );
  assert.match(surfaces, /--mc-type-caption: \.75rem/);

  // One page-header row instead of a per-route hero slab.
  assert.match(cockpit, /\.pm-page-hero, \.page-command-header, \.settings-hero/);
  assert.match(cockpit, /font-size: 15px !important;/);
  // Statistics read as a register, not a billboard.
  assert.match(cockpit, /\.agent-overview, \.integration-score, \.history-snapshot/);
});

test("themes resolve because the legacy token layers are re-sited onto .shell", () => {
  const cockpit = read("redesign", "cockpit.css");

  // The bug this guards: aliases declared in a `:root` block substitute their
  // var() at :root, so they froze against the dark palette and never followed
  // `.theme-solar` / `.theme-contrast`, which are declared on `.shell`.
  assert.match(cockpit, /15 · Theme correctness/);
  for (const alias of ["--void: var(--mc-void);", "--base: var(--mc-canvas);", "--text: var(--mc-text);"]) {
    assert.ok(cockpit.includes(alias), `${alias} must be re-declared on .shell`);
  }
  // premiumDesign.css ships a second token layer rooted in --orbital-*.
  for (const alias of ["--theme-text-strong: var(--orbital-text);", "--text-strong: var(--theme-text-strong);"]) {
    assert.ok(cockpit.includes(alias), `${alias} must be re-declared on .shell`);
  }
  // Its four hardcoded colours must follow the palette rather than a literal.
  assert.match(cockpit, /--theme-text-default: var\(--mc-text-soft\);/);
  assert.match(cockpit, /--theme-accent-ink: var\(--mc-text-ink\);/);
  assert.doesNotMatch(cockpit, /--theme-text-muted: #/);

  // Every route canvas follows the palette instead of a hardcoded hex + glow.
  assert.match(cockpit, /\.experience \{\s*background: var\(--mc-canvas\) !important;\s*background-image: none !important;/);
});

test("one accent leads: the primary verb keeps a fill when its gradient is removed", () => {
  const cockpit = read("redesign", "cockpit.css");

  // Suppressing premiumDesign's colour-stop-free gradient without restating the
  // fill left "Run recipe" transparent with near-black ink.
  const primary = cockpit.slice(cockpit.indexOf(".btn-primary, .primary-button, .primary, .workspace-launch"));
  assert.match(primary, /background: var\(--mc-accent\) !important;/);
  assert.match(primary, /background-image: none !important;/);
  assert.match(primary, /color: var\(--mc-text-ink\) !important;/);
  // A recommended action sits one step below, so no row shows two loud buttons.
  assert.match(cockpit, /\.recommended \{[\s\S]*background: var\(--mc-accent-soft\) !important;/);
  // Six role-coloured pane rails collapse to one active edge.
  assert.match(cockpit, /\.terminal-pane__header \{[\s\S]*border-top: 0 !important;/);
});

test("Recipes and the command palette have real layout rules", () => {
  const cockpit = read("redesign", "cockpit.css");

  // Recipes shipped with no rules in any imported stylesheet and fell back to
  // block flow; it is a primary destination now, so it needs a register.
  for (const selector of [".recipes-status-strip", ".recipes-page-layout", ".recipe-flow", ".recipes-guide"]) {
    assert.ok(cockpit.includes(selector), `${selector} must be styled by the cockpit layer`);
  }
  // The palette is portalled outside .shell, so it is addressed directly, and
  // its rows must stack the label above its group rather than running together.
  assert.match(cockpit, /\.command-palette \[cmdk-item\] > span:not\(\.palette-icon\) \{\s*display: grid;/);
});

test("narrow terminal panes shed duplicated chrome before the worker name", () => {
  const cockpit = read("redesign", "cockpit.css");

  assert.match(cockpit, /container: pane-head \/ inline-size;/);
  // Priority order: the working directory goes first, the role tag last.
  const cwd = cockpit.indexOf("@container pane-head (max-width: 1000px)");
  const role = cockpit.indexOf("@container pane-head (max-width: 350px)");
  assert.ok(cwd > 0 && role > cwd, "facts must drop from lowest to highest value");
  // Everything shed here survives elsewhere, so no capability is lost.
  const pane = read("TerminalPane.jsx");
  assert.match(pane, /Focus pane · Alt \$\{shortcut\}/);
  assert.match(pane, /<span>Find in output<\/span>/);
});

test("a chosen multi-pane canvas survives an ordinary narrow window", () => {
  const workspace = read("redesign", "workspace.css");
  // Collapsing at 900px threw away a 2x2 layout on a 1024px window, where two
  // ~390px panes still show a usable width.
  assert.match(workspace, /@container workspace-stage \(max-width: 680px\) \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) !important;/);
  const toolbar = workspace.indexOf("@container workspace-stage (max-width: 900px)");
  const grid = workspace.indexOf("@container workspace-stage (max-width: 680px)");
  assert.ok(toolbar > 0 && grid > toolbar, "the toolbar must stack before the canvas collapses");
});

// T086/T087 — the pane header sheds detail as panes narrow, and the state
// readout is the one thing that never goes.
test("the terminal header discloses progressively and keeps state last", () => {
  const pane = read("TerminalPane.jsx");
  const workspace = read("redesign", "workspace.css");

  // The pane is its own container, so what survives follows the pane's real
  // width rather than the window's.
  assert.match(workspace, /#root#root \.shell \.terminal-pane \{\s*container: terminal-pane \/ inline-size;/);

  // Always present: name, state, and the overflow menu.
  assert.match(pane, /<em className="terminal-pane__state">\{session\.status\}<\/em>/);
  assert.match(pane, /className="icon-button terminal-more"/);

  // Ownership and cwd left the always-on strip; they are on the identity
  // tooltip instead, so nothing was deleted.
  const facts = pane.slice(pane.indexOf('<span className="terminal-pane__facts">'), pane.indexOf("</span>", pane.indexOf('<span className="terminal-pane__facts">')));
  assert.doesNotMatch(facts, /ownership\(session\)/, "ownership must not compete with state in six panes at once");
  assert.doesNotMatch(facts, /terminal-pane__cwd/, "cwd must not compete with state in six panes at once");
  assert.match(pane, /title=\{`\$\{session\.name\} · \$\{session\.command\}[\s\S]{0,60}ownership\(session\)/);

  // Then the disclosure order, widest breakpoint first.
  const uptimeAt = workspace.indexOf("terminal-pane__uptime");
  const shortcutAt = workspace.indexOf(".terminal-shortcut,\n  #root#root .shell .terminal-pane__header .worker-metric-strip");
  const roleAt = workspace.lastIndexOf(".terminal-role-tag { display: none; }");
  assert.ok(uptimeAt > -1 && shortcutAt > -1 && roleAt > -1, "each disclosure step must exist");
  assert.ok(uptimeAt < shortcutAt && shortcutAt < roleAt, "detail must drop from least to most useful");
});

// T090 — a worker that is not on the canvas still has a state worth seeing,
// and seeing it must not cost a terminal.
test("workers off the canvas report their state without mounting a terminal", () => {
  const app = read("App.jsx");
  assert.match(app, /const mountedIds = new Set\(visible\.filter\(Boolean\)\.map\(item => item\.id\)\);/);
  assert.match(app, /const backgroundWorkers = sessions\.filter\(session => !mountedIds\.has\(session\.id\)\);/);
  assert.match(app, /className="workspace-background"/);
  assert.match(app, /No terminal is mounted for these\./);
  // It is a summary, not a pane: no TerminalPane is rendered for these.
  const strip = app.slice(app.indexOf('className="workspace-background"'), app.indexOf("</section>}", app.indexOf('className="workspace-background"')));
  assert.doesNotMatch(strip, /TerminalPane|TerminalSlot/, "the background strip must never mount a terminal");
  // Clicking one routes through the same pane assignment the search uses.
  assert.match(strip, /onClick=\{\(\) => showInPane\(session\.id\)\}/);
  // A worker needing a decision is the reason to look at this list at all.
  assert.match(strip, /session\.attentionRequired \? session\.attentionReason/);
});

// T093/T094 — renaming a label and duplicating a worker are distinct from
// reconfiguring a process.
test("Rename and Duplicate are label-level actions beside engine Reconfigure", () => {
  const pane = read("TerminalPane.jsx");
  const app = read("App.jsx");

  // Rename dispatches the router's `safe` rename action; it never touches the
  // command, cwd or PTY.
  assert.match(pane, /<span>Rename<\/span><small>Change the display label only/);
  assert.match(pane, /onAction\?\.\("rename", session\.id, \{ name: next \}\)/);
  assert.match(pane, /<span>Reconfigure worker<\/span>/, "Reconfigure must remain");

  // Duplicate stops at the form: a second copy of a process is not created
  // until the command and directory have been reviewed.
  assert.match(pane, /<span>Duplicate worker<\/span><small>Opens a new worker pre-filled from this one/);
  assert.match(app, /onDuplicate=\{session => setWorkerDialog\(\{ mode: "create", seed:/);
  const dialog = read("WorkerDialog.jsx");
  assert.match(dialog, /initialWorkerDraft\(configuration \|\| seed\)/);
  assert.match(dialog, /if \(!configuration && seed\) initial\.id = nextAvailableWorkerId\(initial\.id, existingIds\);/,
    "a duplicate must get a duplicate-safe id");
  // A duplicate carries a real command, so it gets the full form and the full
  // builder rather than the two-field create path.
  assert.match(dialog, /const advanced = editing \|\| Boolean\(seed\);/,
    "a duplicate must show the command it is copying");
});
