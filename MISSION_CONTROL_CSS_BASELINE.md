# CSS baseline before cleanup (T013)

Snapshot of the renderer stylesheet system as it stands **before** any consolidation
or cascade rework. `test/cssBaseline.test.cjs` pins the ceilings below so later cleanup
can only shrink them and nobody silently regrows the `!important` or raw-colour count.

Captured 2026-09-03 from `src/groundstation/renderer/`.

## Import graph

No `@import` exists in any renderer stylesheet. The entire cascade order is the
`main.jsx` import sequence, top to bottom:

```
@fontsource-variable/inter, @fontsource-variable/jetbrains-mono, @xterm/xterm   (vendor)
tokens.css                     design tokens (:root custom properties)
styles.css                     base shell + legacy route styling        2217 lines
uiFoundation.css                shared primitives (legacy)                345
groundstation21.css             Groundstation route                       500
missionGraph.css   projectMemory.css   vscodeBridge.css   mcpGateway.css
agentSupervision.css   automationWorkflows.css   mobileCompanion.css
pluginPlatform.css   missionAi.css   workspaceRecipes2.css                 per-route feature CSS
premiumDesign.css               prior visual direction, still loaded     1085
premiumV3.css                   prior visual direction, still loaded      810
redesign/tokens-bridge.css  ─┐
redesign/base.css            │  AUTHORITATIVE redesign layer — loaded
redesign/workspace.css       │  last, token-driven, wins by source order
redesign/screens.css         │  + #root#root specificity + !important
redesign/cockpit.css         │  weight over everything above it.
redesign/surfaces.css       ─┘  See redesign/README.md.
```

Also bundled but route-split by Vite: `@xterm/xterm/css/xterm.css` → the
`workspace-terminal-*.css` chunk, not the main bundle.

## Size

| | value |
|---|---|
| Renderer `.css` files | **22** (0 orphaned — every file is imported by `main.jsx`) |
| Total source lines | **14,492** |
| Total source bytes | **827,559 (808.2 kB)** |
| Bundled `assets/index-*.css` | **689.7 kB** (111.8 kB gzip) |
| Bundled `assets/workspace-terminal-*.css` | 5.24 kB (1.92 kB gzip) |

Raw → bundled is ~0.85:1. The source is already hand-tight; there is almost no
minification headroom. Size reduction has to come from **deleting duplicate rules**,
not from the build.

## `!important` — 1,660 total

| count | file |
|---:|---|
| 454 | `premiumV3.css` |
| 313 | `redesign/cockpit.css` |
| 257 | `redesign/base.css` |
| 227 | `premiumDesign.css` |
| 187 | `redesign/screens.css` |
| 98 | `redesign/workspace.css` |
| 58 | `redesign/surfaces.css` |
| 25 | `styles.css` |
| 20 | `uiFoundation.css` |
| 10 | `groundstation21.css` |
| 7 | `workspaceRecipes2.css` |
| 1 each | `vscodeBridge.css`, `missionGraph.css`, `mcpGateway.css`, `agentSupervision.css` |
| 0 | `tokens.css`, `redesign/tokens-bridge.css`, `projectMemory.css`, `pluginPlatform.css`, `mobileCompanion.css`, `missionAi.css`, `automationWorkflows.css` |

**By layer:** redesign layer **913 (55%)**, premium files **681 (41%)**, base shell 55, feature files 11.

96% of all `!important` is the redesign layer and the two `premium*` files fighting
each other. The redesign README documents this as deliberate — the redesign layer
loads last and uses `!important` + `#root#root` to reliably beat `premium*` and
`styles.css` beneath it. **Retiring `premiumDesign.css` + `premiumV3.css` (T198,
needs visual sign-off) would remove 681 `!important` outright and let the redesign
layer drop most of its own defensive `!important`.**

## Raw colours — 2,177 total

`888` hex literals + `1,289` `rgb()/hsl()/rgba()/hsla()` calls, against ~60 named
tokens in `tokens.css` + `redesign/tokens-bridge.css`.

| where | raw colours |
|---|---:|
| `styles.css` | 1,135 (437 hex + 698 fn) |
| `premiumDesign.css` / `premiumV3.css` | 101 + 108 |
| `mobileCompanion.css` | 144 |
| `missionAi.css` | 104 |
| redesign layer (6 files) | ~148 total, most in `tokens-bridge.css` (122, by design) |

The redesign layer is token-disciplined; `styles.css` and the two premium files hold
the overwhelming majority of un-tokenised colour and are the cleanup targets.

## Selector ownership

| layer | files | ~classes | role |
|---|---|---:|---|
| Tokens | `tokens.css`, `redesign/tokens-bridge.css` | ~6 + custom props | `:root` design tokens |
| Base shell (legacy) | `styles.css`, `uiFoundation.css`, `groundstation21.css` | ~700 | app frame, nav, legacy route styling |
| Prior visual direction | `premiumDesign.css`, `premiumV3.css` | ~410 | "feature-complete route styling retained below the shell layer" |
| Feature route CSS | `missionGraph`, `mcpGateway`, `mobileCompanion`, `missionAi`, `pluginPlatform`, `automationWorkflows`, `agentSupervision`, `vscodeBridge`, `projectMemory`, `workspaceRecipes2` | ~330 | one route's components each |
| **Authoritative redesign** | `redesign/{base,workspace,screens,cockpit,surfaces}.css` | ~720 | shell, nav, responsive geometry, decks, surfaces, primitives |

## Orphan status

- **Files:** 0 orphaned. All 22 are imported by `main.jsx`. (Nine dead stylesheets —
  `redesign-v4`, `reference-final`, `reference-v5`, `experience27`–`30`,
  `prototype2026`, `theme-concept` — were deleted earlier in this remediation with
  zero bundle-size change.)
- **Selectors:** a literal-class scan (class token absent from all renderer JS) flags
  a high unreferenced ratio in `styles.css` (~52%), `premiumDesign.css` (~44%),
  `groundstation21.css` (~52%). This is an **upper bound** — dynamically composed
  classes (`is-active`, `tone-${x}`, `has-*`, state modifiers) and descendant/pseudo
  helpers are not spelled literally in JSX, so true dead-selector count is lower and
  needs per-file review during cleanup, not a blind delete.

## Cleanup ceilings (enforced by `test/cssBaseline.test.cjs`)

| metric | ceiling | cleanup goal |
|---|---:|---|
| renderer `.css` files | 22 | fewer |
| `!important` total | 1,660 | far fewer once `premium*` retires |
| raw colour literals | 2,177 | far fewer, tokenised |
| `@import` statements | 0 | stays 0 |
| orphan `.css` files | 0 | stays 0 |

Order invariant also locked: the `redesign/` layer imports must come **after**
`styles.css` and both `premium*` files in `main.jsx`.
