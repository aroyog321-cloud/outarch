"use strict";

// Phase 6 - the measured accessibility tasks (T136, T137, T140).
//
// All three were measured with `scripts/visual/probe-metrics.cjs` against the
// BUILT renderer, offscreen, over 8 routes:
//
//   T137  contrast, 3 themes: 131 distinct failures -> 0. Orbital and
//         High-contrast went 15 -> 0 each; Solar Light 101 -> 0.
//   T136  announcement order: every route now has exactly one h1 and no
//         skipped heading level. Workspace previously announced a single
//         alert and no structure at all.
//   T140  keyboard reach at 800x680, the production minimum: 0 unreachable
//         controls on every route, and History no longer overflows a
//         container that cannot be scrolled to reach it.
//
// These tests lock the CAUSES so the numbers cannot quietly come back.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const rendererRoot = path.join(__dirname, "..", "src", "groundstation", "renderer");
const read = (...parts) => fs.readFileSync(path.join(rendererRoot, ...parts), "utf8");

test("T137 - no live rule paints a status role with a hand-written palette entry", () => {
  // These six literals WERE the dark theme, written out by hand. Each is a role
  // that a theme has to be able to move; none of them followed one.
  const banned = ["#77e1b3", "#9bcaff", "#7faedc", "#efaaa4", "#ef9189", "#8795a9", "#3ecf8e"];
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith(".css")) continue;
      const source = fs.readFileSync(full, "utf8");
      // A palette file IS the palette, and so is the terminal-surface block:
      // the terminal keeps its own ink because it keeps its own theme. What
      // this forbids is a COMPONENT rule naming a colour a theme cannot move.
      if (entry.name === "tokens-bridge.css" || entry.name === "tokens.css") continue;
      const withoutTerminalPalette = source.replace(/--mc-term-[a-z]+: #[0-9a-f]{3,8};/gi, "");
      for (const literal of banned) {
        if (new RegExp(literal, "i").test(withoutTerminalPalette)) offenders.push(`${entry.name}: ${literal}`);
      }
    }
  };
  walk(rendererRoot);
  assert.deepEqual(offenders, [], `status roles must read a token, not a palette entry:\n${offenders.join("\n")}`);
});

test("T137 - the Solar palette carries the measured values, not the pretty ones", () => {
  const tokens = read("redesign", "tokens-bridge.css");
  const solar = tokens.slice(tokens.indexOf(".theme-solar {"), tokens.indexOf(".theme-contrast {"));

  // Each was solved as the lightest tone still clearing 4.5:1 against every
  // Solar surface it lands on. `--mc-text-dim` at #626c7a measured 4.45 -
  // readable-looking, and failing on 45 elements.
  assert.match(solar, /--mc-text-dim: #59626f;/);
  assert.match(solar, /--mc-ok: #026733;/);
  assert.match(solar, /--mc-warning: #8c5400;/);
  assert.match(solar, /--mc-danger: #b52833;/);
  assert.match(solar, /--mc-accent: #2161c2;/);
  assert.match(solar, /measured values, not chosen ones/);
});

test("T137 - the frozen accent primitives follow the theme", () => {
  const cockpit = read("redesign", "cockpit.css");
  // `--red: var(--accent-danger)` made this the winning alias block, and
  // `--accent-danger` pointed at a fixed dark primitive - so History's "why it
  // needs review" heading stayed dark-theme red on a white card at 2.63:1.
  assert.match(cockpit, /--accent-warning: var\(--mc-warning\);/);
  assert.match(cockpit, /--accent-danger: var\(--mc-danger\);/);
  assert.match(cockpit, /--accent-attention: var\(--mc-warning\);/);
  assert.doesNotMatch(cockpit, /--accent-danger: var\(--red-300\);/);
});

test("T137 - the terminal surface has its own status ink", () => {
  const workspace = read("redesign", "workspace.css");
  // The pane stays dark whatever the page theme is, so the page's status inks
  // are wrong over it: Solar's warning is a dark brown and it landed on a
  // near-black pane at 2.32:1.
  assert.match(workspace, /--mc-term-ok:/);
  assert.match(workspace, /--mc-term-warning:/);
  assert.match(workspace, /--mc-term-danger:/);
  assert.match(workspace, /\.terminal-pane__activity\.is-attention \{ color: var\(--mc-term-warning\)/);
  assert.match(workspace, /\.terminal-pane__activity\.is-failed \{ color: var\(--mc-term-danger\)/);
  assert.match(workspace, /\.terminal-pane \.terminal-warning \{/);
});

test("T137 - the nav's current destination and the attention badge are readable in every theme", () => {
  const base = read("redesign", "base.css");
  // `color: #fff` on `--mc-accent-soft`, which is a LIGHT wash in Solar: the
  // destination a reader most needs measured 1.38:1 against its own background.
  assert.match(base, /\.top-navigation button\.is-current \{\s*\n\s*color: var\(--mc-text\) !important;/);
  assert.doesNotMatch(base, /\.top-navigation button\.is-current \{[\s\S]{0,120}color: #fff/);
  // White on the danger fill measured 3.03:1 for 9.5px bold text.
  assert.match(base, /color: var\(--mc-text-ink\) !important;\s*\n\s*background: var\(--mc-danger\) !important;/);
});

test("T136 - `.sr-only` is defined, and clips rather than hiding", () => {
  const base = read("redesign", "base.css");
  const rule = base.slice(base.indexOf(".sr-only,"), base.indexOf(".sr-only:focus-visible"));
  assert.match(rule, /clip-path: inset\(50%\)/);
  // display:none and visibility:hidden take the node out of the accessibility
  // tree too, which is the opposite of what an sr-only label needs.
  assert.doesNotMatch(rule, /display: none|visibility: hidden/);
  assert.match(base, /\.sr-only:focus-visible/, "a focusable sr-only control must come back on focus");

  // It was used in three places and defined in none, so those labels rendered
  // as visible stray text.
  assert.match(read("LoadingSkeleton.jsx"), /className="sr-only"/);
  assert.match(read("ProjectsView.jsx"), /className="sr-only"/);
});

test("T136 - every route names itself with exactly one h1, and Workspace has landmarks", () => {
  const app = read("App.jsx");
  for (const heading of ["Groundstation", "Needs You", "History", "Terminal Workspace"]) {
    assert.ok(app.includes(`<h1 className="sr-only">${heading}</h1>`), `${heading} has no page heading`);
  }
  // The Workspace announced one alert and nothing else; the folder rail is a
  // navigation region, not an anonymous div.
  assert.match(app, /<nav className="worker-folders" aria-label="Worker folders">/);

  // Agents had two h1 elements: the page and the selected agent.
  const agents = read("AgentWorkspace.jsx");
  assert.match(agents, /<h1>Supervised agents<\/h1>/);
  assert.match(agents, /<h2>\{agentName\(selected\)\}<\/h2>/);
  assert.equal((agents.match(/<h1>/g) || []).length, 1);
  // The rules that styled it follow the tag change.
  assert.match(read("redesign", "cockpit.css"), /\.agent-detail-title :is\(h1, h2\)/);
  assert.match(read("uiFoundation.css"), /\.agent-detail-title :is\(h1, h2\)/);

  // Settings jumped h1 -> h3; the active group is the missing level and also
  // tells a reader which of the eight they are in.
  assert.match(app, /<h2 className="sr-only">\{SETTINGS_GROUPS\.find\(\(\[id\]\) => id === group\)\?\.\[1\] \|\| "Settings"\}<\/h2>/);
});

test("T140 - History wraps at the production floor instead of running off the side", () => {
  const screens = read("redesign", "screens.css");
  const block = screens.slice(screens.indexOf("History at the production floor (T140)"));
  assert.ok(block.length > 0, "the fix must record what was measured");
  assert.match(block, /scrollWidth 831 in a 542px track/);
  assert.match(block, /\.history-controls \{[\s\S]{0,120}flex-wrap: wrap;/);
  assert.match(block, /\.history-actors \{ flex-wrap: wrap;/);
  assert.match(block, /\.history-export \{ flex: 1 0 100%; \}/);
  // The two-column splits collapse rather than forcing the page wider.
  assert.match(block, /@media \(max-width: 900px\)/);
  assert.match(block, /\.memory-briefing \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test("T140 - the measurement harness reports what a screenshot cannot", () => {
  const probe = fs.readFileSync(path.join(__dirname, "..", "scripts", "visual", "probes", "metrics.js"), "utf8");
  for (const section of ["fold:", "scrollNesting:", "contrast:", "focusOrder:", "announceOrder:", "horizontal:", "scale:"]) {
    assert.ok(probe.includes(section), `the probe lost its ${section} section`);
  }
  // Three honesty rules the probe needs or it reports ghosts: a gradient
  // backdrop cannot be resolved, xterm's mirror layer is invisible by design,
  // and a roving-tabindex member IS keyboard reachable.
  assert.match(probe, /if \(style\.backgroundImage && style\.backgroundImage !== "none"\) return null;/);
  assert.match(probe, /function inTerminalCanvas\(node\)/);
  assert.match(probe, /var roving = function \(el\) \{ return Boolean\(el\.closest\(ROVING\)\); \};/);
  // And it must not be filtered by paint when the question is announcement.
  assert.match(probe, /Announced, not painted/);
});
