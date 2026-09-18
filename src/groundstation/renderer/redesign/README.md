# Redesign layer

The renderer historically accumulated a chain of full-page redesign attempts.
OUTARCH 2.19 no longer imports `experience27–30`, `redesign-v4`,
`reference-v5`, `reference-final`, `prototype2026`, or `theme-concept`. Their
files remain as dormant implementation history, but they do not enter the Vite
bundle or participate in the cascade. `premiumV3.css` remains below this layer
for route-specific surfaces such as Mission AI; it does not own shell geometry.

This directory is the **single authoritative layer**, imported last from
`main.jsx`:

| File | Responsibility |
|---|---|
| `tokens-bridge.css` | One semantic token system (deep graphite + one blue accent, green = success only). Repoints every legacy alias — `--void`, `--surface`, `--accent`, `--mc-*`, `--slate-*`, `--surface-raised` … — at the same values. Change palette **here**. |
| `base.css` | One `.shell` grid, labeled responsive sidebar, compact global status strip, type scale, focus ring, motion budget, and scrollbars. |
| `surfaces.css` | Shared primitives: panels, buttons, badges, status dots, menus, overlays, dialogs. |
| `workspace.css` | Terminal canvas geometry, per-layout split persistence, content-width container queries, balanced 3x2 sizing, and compact pane controls. |
| `screens.css` | Structural per-screen fixes plus the dense Groundstation register, prominent recipe action, asymmetric supporting panels, and safe inspector drawer/rail behavior. |
| `cockpit.css` | The reading grammar shared by every route: one-row page headers, meter strips, section headers, accent discipline, empty states, Workspace deck + terminal pane density, the Recipes register, the command palette, and the theme fix below. Loaded last. |

## Theme correctness

Both older token layers declare their aliases inside a `:root` block — `--base:
var(--mc-canvas)` in `tokens-bridge.css`, and a second `--theme-*` /
`--surface-*` / `--text-*` family in `premiumDesign.css`. A custom property's
`var()` is substituted **at the element where it is declared**, so every one of
those aliases froze against the dark palette on `<html>`. `.theme-solar` and
`.theme-contrast` redefine the `--mc-*` scale on `.shell`, one level below, and
therefore never reached them: Solar Light lit the panels but left the page
canvas near-black and several headings white on white.

`cockpit.css` re-declares both families verbatim on `.shell`, the element that
actually carries the theme class, so each alias resolves against whichever
palette is active. Only the declaration site moves, so the dark theme computes
exactly as before.

**If you add a token that other rules consume, declare it on `.shell`, not on
`:root`** — a `:root` declaration cannot follow the theme.

Selectors are scoped just tightly enough (`.shell .view-workspace …`,
`html body #root .shell`) to win over the historical `!important` rules without
escalating further. New rules should prefer tokens and avoid `!important` unless
overriding a legacy `!important` declaration.

## Change rule

New full-page styling belongs in this directory. Do not re-import a dormant
redesign file to solve one screen; move a genuinely route-specific rule into
the relevant feature stylesheet and keep shell, Workspace, and Groundstation
geometry authoritative here.
