"use strict";

// The unboxed Workspace chrome (2026-09-19): the off-canvas roster, the
// command deck and the folder row sit on the canvas without bands of their
// own; the folders are told apart by per-role glyph ink; the sidebar plan card
// states a paid plan quietly; the search row stays on one line. Every claim
// below was measured in the offscreen harness first.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const renderer = path.resolve(__dirname, "../src/groundstation/renderer");
const read = rel => fs.readFileSync(path.join(renderer, rel), "utf8").replace(/\r\n/g, "\n");

test("the command deck has no band of its own, except where it floats in focus mode", () => {
  // Both forced faces read a property that defaults to transparent, so the
  // band is gone without spending a new override.
  const cockpit = read("redesign/cockpit.css");
  assert.match(cockpit, /\.view-workspace \.workspace-command-deck \{[\s\S]{0,300}?background: var\(--mc-deck-fill, transparent\) !important;\n  border: 1px solid var\(--mc-deck-edge, transparent\) !important;/);
  const workspace = read("redesign/workspace.css");
  assert.match(workspace, /#root#root \.shell \.workspace-toolbar-v2 \{\n  display: grid !important;[\s\S]{0,260}?background: var\(--mc-deck-fill, transparent\) !important;/);
  // Floating over terminal output, the deck must keep a backdrop.
  assert.match(workspace, /\.is-focus-mode \.workspace-toolbar-v2 \{[\s\S]{0,120}?--mc-deck-fill: var\(--mc-surface\);\n  --mc-deck-edge: var\(--mc-border\);/);
});

test("the roster and folder rows sit on the canvas, and only the chosen folder has a face", () => {
  const surfaces = read("redesign/surfaces.css");
  // Transparent edges, not removed ones, so no row changes height or width.
  assert.match(surfaces, /#root#root#root \.shell \.workspace-background \{[\s\S]{0,260}?background: transparent;\n  border-color: transparent;/);
  assert.match(surfaces, /#root#root#root \.shell \.worker-folders \{ background: transparent; \}/);
  assert.match(surfaces, /#root#root#root \.shell \.worker-folder-list > button,\n#root#root#root \.shell \.worker-folder-item \{\n  background: transparent;\n  border-color: transparent;/);
  assert.match(surfaces, /\.worker-folder-item\.is-current \{\n  color: var\(--mc-text\);\n  background: var\(--mc-accent-soft\);/);
});

test("each automatic folder carries its role's glyph and ink", () => {
  const app = read("App.jsx");
  assert.match(app, /const FOLDER_ICONS = \{ agent: "agents", terminal: "terminal", service: "server", container: "box", database: "database", test: "flask", git: "branch", build: "layers" \};/);
  assert.match(app, /data-role=\{group\.automatic \? group\.role : "custom"\}/);
  assert.match(app, /<Icon name=\{group\.automatic \? FOLDER_ICONS\[group\.role\] \|\| "terminal" : "projects"\} size=\{12\}\/>/);
  for (const name of ["server", "database", "flask", "branch", "box", "layers"]) {
    assert.match(app, new RegExp(`\\n  ${name}: <>`), `ICON_PATHS is missing ${name}`);
  }
  const surfaces = read("redesign/surfaces.css");
  for (const role of ["terminal", "agent", "service", "container", "database", "test", "git", "build"]) {
    assert.match(surfaces, new RegExp(`\\.worker-folder-item\\[data-role="${role}"\\] \\{ --mc-folder-ink: `), `no ink for ${role}`);
  }
  assert.match(surfaces, /\.worker-folder-select > \.icon \{ color: var\(--mc-folder-ink\); \}/);
});

test("a paid plan is stated in the mark's ink, not a solid gold tile", () => {
  const account = read("redesign/account.css");
  assert.match(account, /\.top-account:not\(\.top-account--free\) \.top-account__mark \{\n  color: var\(--mc-premium\);\n  background: var\(--mc-premium-soft\);\n  border-color: var\(--mc-premium-line\);/);
  assert.doesNotMatch(account, /\.app-sidebar__footer \.top-account:not\(\.top-account--free\) \.top-account__mark \{[^}]*--mc-premium-fill/);
  // A long email ends in an ellipsis inside the card instead of past its edge.
  assert.match(account, /\.app-sidebar__footer \.top-account > div \{\n  display: flex;\n  min-width: 0;\n  justify-self: stretch;/);
});

test("the sidebar search row stays on one line", () => {
  const base = read("redesign/base.css");
  assert.match(base, /\.top-search span,\n#root#root \.shell \.app-sidebar__footer \.top-ai strong \{\n  min-width: 0;\n  max-width: 100%;\n  overflow: hidden;[\s\S]{0,80}?text-overflow: ellipsis;\n  white-space: nowrap;/);
  assert.match(base, /#root#root \.shell \.app-sidebar__footer \.top-search span \{ font-size: 11px; \}/);
});
