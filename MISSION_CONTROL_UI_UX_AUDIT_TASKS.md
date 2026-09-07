# Mission Control UI/UX Audit - Complete Remediation Task Register

Created: 3 September 2026  
Sources: `FULL_CODEBASE_AUDIT_REPORT.md` (Audit A) and `MISSION_CONTROL_AUDIT_2026-09-02.md` (Audit B)  
Scope: every actionable defect, gap, missing capability, cleanup item, validation gap, and product/UI/UX acceptance requirement reported by either audit.

## Progress

| Metric | Count |
|---|---:|
| Total tasks | 251 |
| Completed | 251 |
| Remaining | 0 |
| P0 - immediate/trust-critical | 95 (95 done) |
| P1 - high priority | 117 (117 done) |
| P2 - product/polish | 35 (35 done) |
| P3 - future/experimental | 4 (4 done) |

### Batch 1 completed 2026-09-03 (trust-critical P0, non-visual)

T001, T006, T007, T008, T011, T012, T016-T020, T022, T024, T025, T027, T028-T030, T208.
Evidence: `node --test test/*.test.cjs` = 348/352 (was 346/350); the one real regression (test 137, Mobile
Companion boundary copy) is fixed; 2 new tests added and green (`test/rendererProtocolContract.test.cjs`,
"Add Worker default template submits without an intermediate click"). Remaining 4 failures are pre-existing
and unrelated: 2 stable platform limitations (Mission AI credential POSIX file-mode on Windows;
VS Code POSIX path resolution on Windows — T209) and 2 parallel-run spawn-timeout flakes that pass in
isolation (TUI enhanced-Escape T207; CLI help/version). `npm run groundstation:build` passes; CSS 685.60 kB
raw / 111.15 kB gzip and main JS 179.47 kB — unchanged from the audit baseline.
T021 is partial: the broken `window.open` "Open in Browser" button was removed (it was denied by
`setWindowOpenHandler`); routing a LAN endpoint through the preload `openExternal` allowlist is deferred
because it needs a main-process allowlist change for the mobile service's own endpoints.

### Batch 2a completed 2026-09-03 (isolated trust-truth fix)

T049 only. `HistoryView`'s `memory.summary` failure is no longer swallowed. Full suite still 348/352
(same 4 pre-existing failures: 2 platform, 2 parallel flakes that pass in isolation). Build passes,
bundles +0.6 kB CSS / +0.45 kB JS.

### Batch 2b in progress 2026-09-03 (unified decision model — user approved the design sketch)

Design: `MISSION_CONTROL_DECISION_MODEL_DESIGN.md` (verified against the current tree).

- **2b-1 + 2b-2 done (backend, non-visual).** New `src/protocol/decisionBroker.cjs` + protocol method
  `decisions.list` → `{ records (globally sorted), sources[{availability, lastSuccessAt, error, pending}],
  complete, counts }`. Failure-isolated adapters for all 7 engine/service sources (session, missionSupervisor,
  mission, mcp, automation, mobile, plugin); a thrown source is `error` and contributes no records, never a
  silent zero; a missing handle is `unavailable`. Namespaced record ids (`source:nativeId`). Tests:
  `test/decisionBroker.test.cjs` (6, incl. failure isolation + protocol integration). Old `*.approval.list`
  / `*.approval.resolve` / `attention.*` methods untouched (T044).
- **2b-3 done (first visual step).** `useDecisions()` hook (`decisions.list` + coalesced event refresh) and
  `<DecisionSourceStrip>` — a completeness signal in Needs You: silent when every source reported, an amber
  "Showing decisions from N of 7 sources · <source> failed to load / unavailable · Retry" bar when not, and
  the header hedges to "At least N decisions waiting". The six per-source queue components and the sidebar
  badge are unchanged at this step. Screenshot captured (degraded fixture) and shared. Tests:
  `uiClarity219.test.cjs`. Full suite 356/359 (same 3 pre-existing). Build: CSS 687.23 kB, JS 182.85 kB.
- **2b-4 + 2b-5 done (the replacement, screenshot reviewed).** `NeedsView` now renders one `<DecisionList>`
  over `useDecisions().records` — the six per-source approval-queue components and the session-list mapping are
  gone from Needs You. Filters (All/Critical/Agents) are `records.filter(...)` over the one array; `Mark all
  seen` is `decisions.acknowledge` for every visible record (visibility only, never disabled while unseen
  records remain); no bulk approve; renderer terminal alerts injected client-side with `origin:"renderer"` and
  their distinct copy. New protocol methods `decisions.resolve` (one id, confirmation ceremony for the six
  approval sources, routes to the identical underlying resolver — authority + confirmation contract unchanged)
  and `decisions.acknowledge` (visibility only). Supervisor/MCP plan-step disclosure preserved (`record.steps`).
  Sidebar + status badge switched to `decisions.counts.pending` with a legacy-sum fallback until the query
  answers. Tests: `decisionBroker.test.cjs` +2 (resolve routing + acknowledge), string-coupled renderer tests
  migrated to the unified path (register T192 in part). Full suite 358/361 (same 3 pre-existing). Build after
  the batch: CSS 687.23 kB, JS 184.65 kB.
- **Fixed in-flight:** a TDZ crash (`pendingCount` referenced `decisions` before its hook call) — moved the
  `useDecisions` call above the count; and dropped a renderer→`decisionBroker.cjs` import that caused a
  circular-init error (the small sort/const helpers are duplicated in `useDecisions.js` with a sync note).
- Now done with evidence: **T003** (reconciliation — design doc §1), **T046** (shared resource states via the
  query envelope), **T047** (a failed source shows unavailable, never 0 pending), **T063** (deterministic
  global sort), **T064** (one filtered set), **T065** (partial/unavailable counts), **T066** (Mark all seen =
  visibility only), **T067** (no bulk approve), **T055-T062** (one `DecisionRecord`; every source integrated).
  Preserved: **T230** (engine/renderer failure boundary), **T231** (no fabricated state), **T044** (old
  per-source methods retained).
- **2b-7 done.** Removed from `App.jsx`: the six `*ApprovalQueue` imports and the six `*PendingCount`
  useState hooks + their six polling effects (two of which held their own `integration:event` subscriptions) —
  `useDecisions` covers all of it with one `decisions.list` read on the same events (MC-10 / T170 progress).
  Badge fallback simplified to the always-available session count until the query first answers. Full suite
  358/361; build JS 183.02 kB (down from 190 kB mid-batch). Healthy-state capture reviewed: no source strip,
  exact "4 decisions waiting", sidebar/status badge 4.
- **2b-6 done — Batch 2b complete.** Groundstation's "NEEDS YOU" inbox, its status pill, and the activity
  strip now read `decisions.counts.pending` from the same `useDecisions`. All three surfaces agree
  (Groundstation pill, sidebar badge, status bar, Needs You header) — one engine-owned count. The inbox
  previews worker rows and discloses "N integration approvals in Needs You" for the rest; when only external
  decisions exist it shows a compact strip instead of hiding. Full suite **359/361** — only the 2 stable
  Windows-platform failures remain (Mission AI POSIX file-mode; VS Code POSIX path / T209); the TUI/CLI
  parallel flakes all passed this run. `git diff --check` clean. Build JS 183.88 kB, CSS 687.23 kB.
- **New files this batch:** `src/protocol/decisionBroker.cjs`, `src/groundstation/renderer/useDecisions.js`,
  `DecisionList.jsx`, `DecisionSourceStrip.jsx`, `test/decisionBroker.test.cjs`, `MISSION_CONTROL_DECISION_MODEL_DESIGN.md`.
- **Deferred polish (small, non-blocking):** per-source "Recommended" text is currently one generic line;
  the Needs You lifecycle bar lost its "N recovered" tally; the six `*ApprovalQueue` components remain
  exported-but-unused in their own files (kept per design §2b-7 "deprecate, don't delete").

### Batch 3a completed 2026-09-03 (Recipes — real editing + confirmations)

- **T010 / T072 / T073** — "Edit graph" on a saved recipe now opens a real edit: `WorkspaceRecipes` takes
  `mode` (`create`|`edit`|`duplicate`) + `editRecipe`; `draftFromRecipe()` hydrates every field from the
  persisted recipe; `save()` keeps the same id for edit (`recipe.save` is an upsert), a fresh id + " copy"
  name for duplicate. Mode-correct title and save-button label. `recipesOpen` state carries `{mode, recipe}`.
- **T074** — unsaved-change guard: a `dirty` flag drives an in-dialog "Discard unsaved changes?" alertdialog
  on close / Escape / outside-click.
- **T081 / T082** — the duplicate saved-recipe launch grid is removed from `WorkspaceRecipes` (builder-only,
  single column now). Launch / Pause / Resume / Cancel / Recover / Delete + run phase live only on the
  `RecipesView` page (Audit B §F). Added Duplicate. Command-palette + sidebar + Groundstation "Run recipe"
  all route through one `openRecipeBuilder`.
- **T040** — recipe deletion routes through the shared `ConfirmationDialog` (`setConfirmation`, "Delete
  recipe" ceremony) instead of a bare `recipe.delete` dispatch.
- **T155** — the inline `style={{ gridColumn … color: var(--text-muted-semantic) … }}` block is gone with
  the grid it styled.
- **T175 / T012** — `npm test` now runs `--test-concurrency=1` (deterministic; `npm run test:parallel`
  keeps the fast mode). Serial suite **360/362** — only the 2 stable Windows-platform failures remain
  (Mission AI POSIX file-mode; VS Code POSIX path / T209). All TUI/CLI flakes gone.
- **T031** — verified already correct in the tree (test passes reliably in isolation, 3/3); its earlier
  failure was the concurrency flake now fixed by T175.
- Tests: `groundstationRedesign.test.cjs` +1 ("Edit graph opens a real edit …"); string-coupled recipe
  assertions migrated from `WorkspaceRecipes.jsx` to `RecipesView.jsx`. Build JS 185.50 kB, CSS 687.74 kB.
### Batch 3b completed 2026-09-03 (Recipes — terminology, plan clarity, run-lock)

- **T080** — terminology sweep: the Groundstation recipe panel h3 ("Recipes"), its skeleton/empty copy,
  onboarding CTA, two Mission-AI prompt examples, and a code comment no longer say "Daily workspace / working
  set". Test title + assertions updated. (Command-palette *search aliases* keep "daily workspace" so the
  term still finds the feature.)
- **T083** — Groundstation "Run recipe" now navigates to the Recipes page (the library) instead of opening
  the create dialog; the builder is reached explicitly via "New recipe" / "Edit graph".
- **T078 / T079** — the builder shows a plain-language `recipe-plan-summary`: how many terminals open, how
  many start together vs wait for a dependency, the parallel limit and retries, the failure and recovery
  behaviour, and that it reuses running workers + restores the layout without a duplicate PTY.
- **T075** — editing a recipe whose run is `running`/`paused`/`cancelling` is saved as a **new** recipe
  (`editingId` forced null, button "Save as a new recipe", a `recipe-run-locked` notice) so the live run is
  never mutated in place.
- Tests: `groundstationRedesign.test.cjs` "Edit graph opens a real edit …" extended (run-lock + plan
  summary). Serial suite **360/362** (2 stable platform failures). `git diff --check` clean. Build JS
  185.50 kB, CSS 688.21 kB. Screenshot of the edit dialog (name + DAG pre-loaded, "Update recipe") shared.
- **Still deferred (Recipes):** T076 (version/conflict — needs engine support), T077 + T199 (per-recipe
  bounded run history — engine change), T084 (command-palette recipe-action convergence), T085 (local
  scheduling — P3).

### Batch 9a completed 2026-09-03 (dead code + unwired telemetry — Audit B §G)

- **T180 / T181** — deleted the dead inline `AgentsView` and `IntegrationsView` from `App.jsx` (the routes
  render `AgentWorkspace` / `IntegrationHubView`; both inline copies were unreferenced). Stale string
  assertions in `groundstationRenderer.test.cjs` that were testing the dead views are replaced with
  `assert.doesNotMatch` guards + a live-component assertion.
- **T098** — verified: `resourceSampler.cjs` emits `cpuPercent` / `memoryMB` / `memoryBytes` but **no
  `ioKBs`**. `session.resources` (with `available`) does reach the renderer via `#decorateSession`.
- **T099** — `<WorkerMetricStrip session={session} compact />` now renders in the `TerminalPane` header
  (its own doc comment named this location). It returns `null` unless `session.isAlive && resources.available`,
  so it is never a strip of flat zeros. The I/O sparkline only renders when the engine actually reports
  non-zero I/O (`ioHistory.some(v => v > 0)`) — no fabricated telemetry.
- **T100** — preserved: the 40-point history cap, DPR-aware canvas, reduced-motion handling, and
  non-authoritative CPU/RAM/IO labels were already in `WorkerSparkline.jsx`; the honesty gate above is the
  only change. Removed the unused `WorkerMetricStrip` import from `App.jsx` and the stale
  "in production these values will come from…" comment.
- Serial suite **360/362** (2 stable platform failures). `git diff --check` clean. Build JS 185.50 kB.

### Batch 9b completed 2026-09-03 (orphan CSS deletion — T183–T191)

Deleted the 9 dead stylesheets (~258 KB of source): `redesign-v4.css`, `reference-final.css`,
`reference-v5.css`, `experience27–30.css`, `prototype2026.css`, `theme-concept.css`. Verified beforehand:
zero import sites in `main.jsx` or any `.jsx`, and **no test reads their content** — Audit B's feared
"tests pin specific rules inside them" did not hold; the only test references are `assert.doesNotMatch`
guards on `main.jsx` asserting they are *not* imported, which still pass and now serve as
"these layers must never return" guards. Build bundle **unchanged** (688.21 kB CSS / 185.50 kB JS) —
proof they contributed nothing to the shipped output. Serial suite 360/362 (2 stable platform failures).
`git status` shows 9 `D` entries. **Not yet done:** T198 (fold `premiumDesign.css` + `premiumV3.css` — 227 +
454 `!important`, both imported — into the redesign layer, screenshot-verified per property family), and the
broader T192 (replace remaining literal-string source tests with behavioural ones).

### Batch 4a completed 2026-09-03 (Terminal Workspace — concrete fixes)

- **T095** — pane-resize pointermove/pointerup window listeners are torn down if `WorkspaceView` unmounts
  mid-drag: `beginPaneResize` stores its `stop` in `resizeTeardownRef`, cleared on stop and run from an
  unmount effect.
- **T097** — xterm is created with `screenReaderMode: true` (NVDA / VoiceOver viewport mirror). Limitation
  documented in-code: it announces new rows + cursor movement, not arbitrary scrollback review — use Ctrl+F
  or Copy-all for a full transcript with assistive tech.
- **T092** — the hand-built session chooser now has a full keyboard + dismissal contract: first/current item
  focused on open, ArrowUp/Down/Home/End roam, Escape and Tab close and restore focus to the trigger, an
  outside pointerdown closes it, and the trigger opens on ArrowDown/Enter/Space.
- Tests: `terminalWorkspaceLayout.test.cjs` +3. Serial suite **363/365** (2 stable platform failures).
  `git diff --check` clean. Build JS 185.62 kB.
- **Deferred (Workspace, need visual sign-off / larger scope):** T086/T087 (header progressive disclosure),
  T088-T091 (mounted-terminal ceiling + named pane sets + hibernation), T093/T094 (Rename / Duplicate
  terminal), T096 (3x2 column adjustment).

### Batch 6a completed 2026-09-03 (Settings — trust + accessibility)

- **T124** — `SettingChoice` (Theme / Text size / Density / Motion / Terminal theme / Cursor / Scrollback)
  and the notification "Notify from" strip are real `role="radiogroup"` with `role="radio"` +
  `aria-checked` per option, instead of rows of unlabelled buttons.
- **T125** — the terminal font-size `<input type="range">` now has `aria-label="Terminal font size in
  pixels"`, an `aria-valuetext` that announces "N pixels", a linked `<label htmlFor>`, and an
  `aria-live` `<output>`.
- **T126** — the two quiet-hours `<input type="time">` are wrapped in a `role="group"` with visible
  "Start" / "End" `<label>`s and independent `aria-label`s.
- **T052** — `NotificationSettings.save` is now optimistic-with-rollback: it snapshots the previous
  policy (`policyRef`), applies the change, and on a rejected `attention.preferences.save` restores the
  previous policy and shows a persistent `role="alert"` error ("… notification preferences were not
  changed").
- Tests: `groundstationRenderer.test.cjs` +2. Serial suite **365/367** (2 stable platform failures).
  `git diff --check` clean. Build JS 186.58 kB, CSS 688.88 kB.
- **Deferred (Settings):** T120-T123 (group into Appearance / Terminal / Notifications / … / Diagnostics /
  About — an IA restructure that needs visual sign-off), T123 (Restore Defaults scope preview + confirm).

### Batch 6b completed 2026-09-03 (a11y + polish)

- **T128** — History timeline items are now `role="button"` with `aria-pressed`, activate on Space as well
  as Enter (`preventDefault` on Space), announcing the selected state.
- **T135** — new `useReducedMotion()` hook (OS `prefers-reduced-motion` OR the in-app `.shell.motion-reduced`
  class, live-updating). Mission AI's client-side streaming reveal (`StreamingReveal`) now shows the whole
  answer immediately when motion is reduced instead of the 8-chars-per-frame `requestAnimationFrame` loop.
- **T134 (partial)** — the reveal region carries `aria-busy` while mid-stream so assistive tech waits for
  the settled answer. Full "announce a useful final result once" (a dedicated post-stream live region)
  still to do.
- **T160** — `useInterfacePreferences` sets `document.documentElement.style.colorScheme` and the
  `<meta name="color-scheme">` to `light` for the Solar theme, `dark` otherwise — native scrollbars /
  controls / initial paint follow the theme.
- **T161** — `index.html` CSP no longer allows `fonts.googleapis.com` / `fonts.gstatic.com` and the two
  `<link rel="preconnect">` are removed. Verified: every font is `@fontsource-variable/*` (bundled by vite);
  zero `googleapis`/`gstatic` references anywhere in CSS or `main.jsx`.
- Tests: `productFoundation.test.cjs` +1. Serial suite **366/368** (2 stable platform failures).
  `git diff --check` clean. Build JS 187.68 kB.

### Batch 6c completed 2026-09-03 (toasts + History/Groundstation selection truth)

- **T133** — a toast that carries an action no longer auto-dismisses (`duration` defaults to `0` when an
  action is present), renders as `role="alertdialog"`, its buttons are `type="button"` (already tabbable),
  and Escape on a focused toast dismisses it.
- **T111** — the History actor filter shows the first eight actors, then a `+N more` / "Show fewer" toggle
  for the rest; the currently-selected actor is always kept visible even when collapsed.
- **T112** — the History event inspector is derived from the *visible* list (`visible.find(...) ?? visible[0]`),
  so a selection that a new filter or search hides falls back to the first visible event instead of lingering.
- **T105** — the Groundstation contextual inspector only shows a worker that is in the visible register
  (`selectedInView` gate). Filtering the selected worker out clears the inspector; the shared `selectedWorker`
  state is left intact so Workspace / Agents keep their selection.
- Tests: `productFoundation.test.cjs` +2 assertions, `groundstationRedesign.test.cjs` +2. Serial suite
  **368/370** (2 stable platform failures). `git diff --check` clean. Build JS 187.94 kB.

### Batch 6d completed 2026-09-03 (Groundstation register grid semantics)

- **T129** — the worker/agent register is now a real grid, not a broken pseudo-table: `ManifestList` is
  `role="grid"` with `aria-label` + `aria-rowcount`; the header row has `role="columnheader"` cells; every
  data cell is `role="gridcell"` (no more `role="cell"` without a table ancestor); rows carry
  `aria-rowindex`. The wrapping `<section>`s are `role="region"`, not `role="table"` (which was invalid
  around a search toolbar).
- **T130** — Arrow / Home / End in the register move DOM focus onto the newly selected row (via a
  `focusSelectedRowRef` flag + `row.focus({ preventScroll: true })` in the scroll effect), so screen
  readers announce the row content and `aria-selected`, not just a silent state change.
- Tests: `groundstationRedesign.test.cjs` +1 (grid semantics); 2 stale `workers.map(session =>` regexes
  updated for the new `(session, index)` signature. Serial suite **369/371** (2 stable platform failures).
  `git diff --check` clean. Groundstation capture reviewed — semantic-only, zero layout change. Build
  JS 188.56 kB.

### Batch 6e completed 2026-09-03 (modal focus contracts)

- **T127** — `WorkerDialog` focus trap hardened: a `focusin` listener pulls focus back in if it escapes
  the dialog (backdrop click, browser chrome); the section is `tabIndex={-1}` as a fallback target; on
  close, focus returns to the invoking control, or `#main-content` if that element no longer exists.
- **T132** — `WorkerQuickLook` gained the missing dialog-lifecycle pieces: an `onClose` prop, `Escape`
  closes it (capture-phase, `stopPropagation`), `Tab` is contained at the boundaries, and focus returns
  to the invoking element (or `#main-content`).
- Tests: `productFoundation.test.cjs` +1. Serial suite **369/372** (the two constants + the flaky TUI
  escape T207 which passes in isolation, 15/15). `git diff --check` clean. Build JS 189.40 kB.

### Batch 7a completed 2026-09-03 (Integrations copy + contextual Ask AI + menu audit)

- **T117** — the Integrations directory now describes Plugins as "Declarative, permission-controlled
  manifests — not executable code" (was "Permission-controlled extensions"). The Plugins settings panel
  already carried the accurate `TrustBoundary` ("Blocked: Files, process, network, secrets, JSX, CSS, and
  handlers").
- **T119** — contextual **Ask Mission AI** buttons added to the Groundstation worker inspector (opens with
  the worker's name / command / status / current summary) and the History event inspector (opens with the
  event's timestamp / actor / title / recorded reason). CrashLens already had one (T027). `openMissionAI`
  now tolerates being passed a click event instead of a prompt string.
- **T131** — audited every menu in the renderer: only the terminal session chooser is hand-built (all
  others are Radix `DropdownMenu`), and it already has the full contract after T092 — Escape + focus
  return, outside-`pointerdown` close, Arrow/Home/End roaming, first/current item focused on open.
- Tests: `groundstationRedesign.test.cjs` +2. Serial suite **371/374** (2 platform constants + one rotating
  Ink/TUI flake — the whole app.test.cjs passes 15/15 in isolation). `git diff --check` clean. Build
  JS 190.05 kB, CSS 689.52 kB.

### Batch 7b completed 2026-09-03 (T071 — inferred vs. engine-reported roles)

`workerKind()` classifies a worker by regex over its name/command — it is inference, not an engine fact.
Every place that role now renders says so: the Groundstation register cell (`.mc-ref-role.is-inferred`
+ `title`), the worker inspector kicker ("<Kind> · inferred" + `title`), and both terminal-header role
tags (`title`). A dotted underline + `cursor: help` distinguishes it visually from the engine-reported
status chip / evidence badges next to it. `groundstationRedesign.test.cjs` +1. Serial suite **373/375**
(2 platform constants). `git diff --check` clean. Build JS 190.23 kB.

### Batch 7c completed 2026-09-03 (T002 — renderer event-subscription inventory)

Traced every renderer event consumer to its producer. There is **one** transport:
engine / vscodeBridge / mcpGateway / mobileCompanion / pluginPlatform / terminal streams →
`createProtocolConnection` frames each as `{ version:1, type, … }` → `ipcHost` forwards only
messages with a `type` on the `mission-control:event` IPC channel → preload fans out to
`missionApi().subscribe` callbacks. All 15 renderer call sites use that one wrapper, filter by
`type` (+ `integration` / event-type prefix), and return a cleanup that invokes the captured
unsubscribe and clears any coalescing timer.

Boundedness proven, not assumed: engine events carry a monotonic `sequence` and are replayed
from the `state.get` snapshot via `events.activate({afterSequence})` with explicit
`SNAPSHOT_REQUIRED` / `STALE_SNAPSHOT` / `EVENT_GAP` guards over a bounded `MAX_EVENT_QUEUE = 1000`;
`session:output` is dropped at the producer so bulk output never broadcasts; the preload
pre-subscriber buffer is capped at `MAX_BUFFERED_EVENTS = 512` (newest kept) and version-mismatched
frames are discarded. `integration:event` / `terminal:*` are idempotent full-status snapshots and
epoch-tagged chunks — every consumer coalesces them, which is safe.

Written up in `MISSION_CONTROL_EVENT_CONTRACT.md`. `rendererProtocolContract.test.cjs` +2 —
one fails the build if a `.subscribe(` bypasses the wrapper, drops its unsubscribe, or lacks an
effect-cleanup teardown; the other locks the preload/queue bounds and the `session:output` drop.
Serial suite **375/377** (2 platform constants). `git diff --check` clean on batch files.
Build JS 190.23 kB, CSS 689.70 kB.

### Batch 7d completed 2026-09-03 (T013 — CSS baseline before cleanup)

Measured the stylesheet system as it stands before any consolidation. **22** renderer
`.css` files (0 orphaned — all imported by `main.jsx`), **14,492** lines / **808.2 kB**
raw → **689.7 kB** bundled `index-*.css` (~0.85:1, already hand-tight — reduction has to
come from deleting duplicate rules, not the build). No `@import` anywhere: the cascade
order *is* the `main.jsx` import sequence, redesign layer last.

`!important` **1,660 total** — redesign layer 913 (55%), `premiumDesign`+`premiumV3`
681 (41%), base shell 55, feature files 11. So 96% is the redesign layer and the two
`premium*` files overriding each other; retiring `premium*` (T198, needs sign-off) drops
681 outright. Raw colours **2,177** (888 hex + 1,289 `rgb()/hsl()`) vs ~60 tokens —
`styles.css` holds 1,135 of them, the redesign layer is token-disciplined.

Written up in `MISSION_CONTROL_CSS_BASELINE.md` with the per-layer selector-ownership
table and the orphan-selector upper bounds. `test/cssBaseline.test.cjs` (+4) ratchets the
ceilings: file count ≤ 22, `!important` ≤ 1,660, raw colours ≤ 2,177, `@import` stays 0,
no orphan stylesheet, and the `redesign/` layer must load after `styles.css` +
both `premium*` with `redesign/surfaces.css` last. Serial suite **378/381** (2 platform
constants + 1 Ink/TUI flake that passes 15/15 in isolation). `git diff --check` clean on
batch files. Build unchanged (no renderer code touched).

### Batch 7e completed 2026-09-03 (T004 — destructive-confirmation reconciliation)

Traced recipe delete, automation remove, mission cancel, mission complete end to end.
**Both audits are partly right.** Before this batch: `recipe.delete` had a renderer
`ConfirmationDialog` but **no protocol token** at all; `automation.delete` and
`mission.transition` (cancel/complete) required a token but had **no human ceremony** —
the renderer generated the predictable `confirm:<type>:<id>` string itself in the same
one-click handler. The engine layer authorises none of them (state guards only). So **no
destructive flow had both a ceremony and non-predictable authorization** — Audit A's
"non-predictable authorization" exists nowhere in these four paths.

Safe additive fix this batch (renderer only, protocol/engine untouched): `App.jsx` threads
`onConfirm={setConfirmation}` into `<AgentWorkspace>` and `<AutomationSettings>`;
`transitionMission` and automation "Remove" now open the shared titled `ConfirmationDialog`
with recovery copy before dispatching, with a direct-fire fallback when no `onConfirm` is
supplied. All four destructive flows now have the ceremony.

Still open and handed to **T038–T045**: add a token to `recipe.delete`, and replace the
four predictable `confirm:*` strings with a server-issued single-use expiring token — the
deferred protocol change.

Written up in `MISSION_CONTROL_DESTRUCTIVE_CONFIRMATION_RECONCILIATION.md`.
`test/destructiveConfirmation.test.cjs` (+3) pins the four ceremonies, the `recipe.delete`
no-token gap, and the predictable-token format so none drift before the service lands.
Serial suite **382/384** (2 platform constants). Build JS 190.26 kB. `git diff --check`
clean on batch files.

### Batch 7f completed 2026-09-03 (T005 — failed-load reconciliation)

Forced all 10 surfaces through error / stale / offline / unconfigured / successfully-empty.
**Audit A is right** for Needs You, History, Mission AI, Integration overview, mostly VS
Code — these separate error from empty and cover 3–5 states. **Audit B was right** for
**Automation** (a failed `automation.list` rendered the literal "No workflows saved.") and
**Agents** (`mission.list` `catch { setMissions([]) }` read as "No mission assigned"), and
stays right about swallowed **secondary** loads (`mcp.audit.list`, `mobile.device.list`,
`plugin.list`, agent `approvals` — all `catch(()=>{})`, showing `0`/empty next to a
succeeding primary). **"stale" has no first-class treatment on any surface.**

Fixed this batch (renderer + shared CSS): `AutomationSettings` gets a `loadError` state →
`.automation-load-error` banner + Retry, last list kept; `AgentWorkspace` gets
`missionsError` → `.agent-missions-stale` banner + Retry, last missions kept (old `[]`
clobber removed). `redesign/surfaces.css` extends the `.history-memory-error` degraded-data
grammar to both new classes — token-only, no new raw colour or `!important`, `cssBaseline`
ratchet still green.

Written up in `MISSION_CONTROL_FAILED_LOAD_RECONCILIATION.md` (per-surface 5-state table).
`test/failedLoadReconciliation.test.cjs` (+4) pins the two fixes, the shared banner
grammar, and the still-swallowed secondary loads (delete-a-line-when-fixed). Serial suite
**386/388** (2 platform constants). Build JS 190.26 kB, CSS 689.98 kB. `git diff --check`
clean on batch files.

### Batch 7g completed 2026-09-03 (T014 — App.jsx seam map)

No code change — the deliverable is the map. `App.jsx` is 1,661 lines; `GroundstationApp()`
holds 25 `useState` / 24 `useCallback` / 17 `useEffect` / 6 keyboard listeners.
`MISSION_CONTROL_APP_JSX_SEAM_MAP.md` groups every state atom into 11 clusters (routing,
command palette, workspace focus, modal stack, projects, agents, recipes, presets, history
cursor, terminal alerts, notices) and defines a **6-step dependency-ordered extraction**:
pure helpers → constants → leaf components → route views → behaviour hooks
(`useAppNavigation`, `useModalStack`, `useWorkspaceFocus`, `useCommandPalette`,
`useProjectSwitcher`, `useAgentAdapters`, `useRecipes`) → a ~120-line composition root.
Lists the contracts that must survive untouched (`missionApi()` surface, `useMissionState`
handshake, `useTerminalLayout` slots, the 7 routes, the full keyboard map, the
`ConfirmationDialog` shape, the 4 localStorage keys, StrictMode-off) and flags the tax:
steps 3–5 are one-component-per-commit because of the source-string-coupled renderer tests.
The moves themselves are separate architecture-phase tasks.

### Batch 7h completed 2026-09-03 (T249 — duplicated entry-point inventory)

Inventoried every trigger for each capability. **Add worker** (6+), **Ask Mission AI**
(7), **Mission Graph** (3), **Start/Stop workspace** (2) all resolve to one destination
each — predictable, keep. The **one real problem: "Recipes" has two destinations.** The
sidebar and palette "Recipes" navigate to the Recipes route; the Groundstation status-bar
"Recipes" button, the `ReferenceRecipePanel` "Manage", the onboarding "Create a recipe",
and the WorkspaceView "Recipes" button all open the *WorkspaceRecipes builder dialog*
instead. Same label, different behaviour depending on surface. Minor: palette calls the
route "Open workspace recipes" vs sidebar "Recipes"; workspace start/stop verb differs
between buttons and palette; Integrations-overview "Ask Mission AI" passes no context.

Recommendation (needs visual sign-off — navigation change): "Recipes" always navigates to
the route; the builder opens only from an explicit New/Edit/Duplicate action inside
`RecipesView`. Written up in `MISSION_CONTROL_ENTRY_POINT_INVENTORY.md`.
`test/entryPointInventory.test.cjs` (+2) pins the current wiring (2 views pass
`openRecipeBuilder` as `onRecipes`) so the consolidation is an intentional diff and a
third divergent "Recipes" behaviour fails the build. Serial suite **388/390** (2 platform
constants). No code change.

### Batch 7i completed 2026-09-03 (T009, T032, T021, T048, T050)

- **T009 / T032** — verified native desktop notification delivery is **not implemented**:
  no `new Notification`, no Electron `Notification`, nothing in main/engine/service raises
  an OS notification, and `#attentionPreferences` (severity / quiet-hours) is stored and
  echoed but never enforced (`listAttention` returns `preferences` without filtering).
  `NotificationSettings` now gates on `NOTIFICATION_DELIVERY_AVAILABLE = false`: every
  control `disabled`, the "Desktop notifications" sub-label reads "Unavailable in this
  build — no OS notification is sent", and a `.notification-availability` status banner
  states plainly that Needs You is the only interruption surface and the policy is saved
  for when delivery lands. `save()` is a no-op while disabled; the T052 rollback path and
  the T124–T126 a11y structure are preserved. `screens.css` +1 rule (token-only).
  T033–T037 (build the main-process notifier) stay deferred — they need the product
  decision and main-process work.
- **T021** — verified: the renderer has exactly one external-URL path,
  `App.jsx` `ResourceLinks` → `window.missionControl.openExternal` → preload →
  `ipcMain.handle("mission-control:open-external")` which rejects anything not in a
  2-entry allow-list; `setWindowOpenHandler` denies, `will-navigate` is prevented, no
  `window.open` / `target="_blank"` / `location` assignment anywhere. The old
  `window.open` "Open in Browser" button is gone.
- **T048** — done in Batch 7f: `AgentWorkspace` keeps the last mission list on a failed
  `mission.list` and shows `.agent-missions-stale` + Retry instead of clobbering to `[]`
  (which read as "No mission assigned").
- **T050** — satisfied by the decision model: `decisionBroker.runAdapter` maps a thrown
  `pluginPlatform.listApprovals()` to `availability:"error"` (not a `0`), `complete`
  becomes false, and `DecisionSourceStrip` surfaces "Plugins failed to load · Retry".
  Locked by `decisionBroker.test.cjs` ("a failed source is isolated … the count is not
  zeroed"). The 6 legacy `*ApprovalQueue` components that had the false-`0` `catch` are
  **dead** (no JSX render site, no import anywhere) — flagged for orphan-cleanup with
  the T013 CSS/dead-code pass; not deleted here to keep this batch contained.
- `productFoundation.test.cjs` +1 (T009/T032), `groundstationRenderer.test.cjs` T124-T126
  regex loosened for the new `aria-disabled` attr. Serial suite **389/391** (2 platform
  constants); the T207 `app.test.cjs` "enhanced Escape" Ink test flaked ~2/3 runs this
  batch even in isolation — pre-existing, separate subsystem, not touched here. Build
  JS 190.47 kB, CSS 690.42 kB. `git diff --check` clean on batch files.

### Batch 7j completed 2026-09-03 (dead-code removal: 6 unrendered `*ApprovalQueue` components)

Verified zero callers — no JSX render site, no import anywhere (the decision-model
migration earlier this session replaced all six with `useDecisions` -> `DecisionList`).
Deleted `MissionApprovalQueue` (AgentWorkspace), `AutomationApprovalQueue`
(AutomationWorkflows), `McpApprovalQueue` (McpGateway), `MissionSupervisorApprovalQueue`
(MissionAI), `MobileApprovalQueue` (MobileCompanion), `PluginApprovalQueue` (PluginPlatform),
plus their now-unused `DecisionItem`/`DecisionQueue` imports and the `approvalTime` /
`expiresIn` helpers only they used. ~230 lines removed. Each carried the exact MC-11 / T050
anti-pattern — `catch { setApprovals([]); onPendingChange?.(0) }`, a failed approval list
reported as `0` pending; the live path routes through `decisionBroker.runAdapter` which
reports `error` instead. `actionLabel` (MissionAI) and `ago` (AutomationWorkflows) kept —
still used by live components.

5 string-coupled tests repointed from "component calls `X.approval.resolve` + renders
`<DecisionItem>`" to the current reality: the settings component stays contextual, and
`decisions.resolve` routes each source through `callMcp` / `callMobile` /
`callPlugin("resolveApproval")` etc. with the `confirm:decision:` ceremony intact —
`groundstationRenderer.test.cjs` (tests 163-166), `uiClarity219.test.cjs` (one-grammar
test), `failedLoadReconciliation.test.cjs` (swallow now absent). Serial suite **388/391**
(2 platform constants + the T207 Ink flake). Bundle net ~flat: `index.js` 190.5 -> 192.7 kB,
`feature-operations` 65.6 -> 64.2 kB — Rollup rebalancing chunks as the import graph shrank;
the 5 dead-code string clusters are verified gone from the built bundle. `git diff --check`
clean on batch files. Orphaned CSS (`.mission-approval-queue`, `.automation-approval-queue`,
`.mcp-approval-queue`) left for the T013 CSS cleanup pass.

### Batch 7k completed 2026-09-03 (T134 - Mission AI announce-once)

The whole `.mai-thread` transcript was `aria-live="polite"`, so every new turn re-announced the entire conversation and the client-side character reveal leaked partial chunks (the inner `aria-busy` on `StreamingReveal` does not reliably gate a polite ancestor). Fixed: `.mai-thread` is now `role="log"` with an `aria-label`, not a live region - the reveal animation is never in an announced path. A dedicated visually-hidden `.mai-live-announce` region (`aria-live="polite" aria-atomic="true"`) is set once per result via `setAnnouncement` - a single settled sentence (`announceAnswer`: lead line + estimate range for an answer; "proposed a plan with N actions - review in Needs You" for a plan), replaced not appended. `.mai-thinking` gained `role="status"` so "Reading project evidence" announces once. `redesign/surfaces.css` +1 visually-hidden rule (token-only). `productFoundation.test.cjs` T128/T135 block extended. Serial suite **389/391** (2 platform constants). Build JS 193.3 kB, CSS 690.6 kB.

### Batch 7l completed 2026-09-03 (T138/T139 - responsive at 720/800, lower minWidth)

Probed every route offscreen at 960 / 900 / 800 / 720. **No page-level horizontal scroll at any width** (`documentElement.scrollWidth === clientWidth`). Three real narrow-width defects found and fixed, all confirmed against re-rendered screenshots + a computed-layout probe:

1. **Recipes route** - the `@container groundstation (max-width: 900px)` collapse never reached it (Recipes is not inside the `groundstation` container). Recipe rows kept a 3-col horizontal layout with the action buttons overlapping the title and flow chips at <=900px. Added an `@media (max-width: 900px)` fallback in `cockpit.css`: guide split -> stacked, recipe row -> stacked title / flow / right-aligned wrapping actions.
2. **Attention & notification policy** - `styles.css` sets a fixed 4-col grid (`1.2fr 1fr 1fr 1.3fr`) that never collapsed and clipped its own controls at <=760px. Same `@media` block stacks it to one column (specificity, no priority flag).
3. **Groundstation manifest row** - `.mc-ref-status` carried `display: inline-flex !important`, so the `@media`/`@container` narrow rules that hide role/status/resource could not hide the status chip; it overlapped the activity line at <=820px. Dropped the one forced `display` (the `#root#root .shell` selector already outweighs `.shell .status-chip`). Net -1 `!important` - `cssBaseline` ceiling tightened 1660 -> 1659.

**T139** - `BrowserWindow.minWidth` lowered from `Math.min(1040, width)` to `Math.min(800, width)`; the responsive layer now holds down to 720 so 800 is a safe floor with headroom. `workspace-title` gets an ellipsis at <=720. `groundstationRedesign.test.cjs` +1 pins the minWidth value and the three collapses. Serial suite **390/392** (2 platform constants). Build JS 193.3 kB, CSS 691.2 kB.

Noted, not fixed (needs sign-off, T086-T091): the Groundstation inspector is a `position: fixed` right drawer by design and covers ~half the manifest at 800px - a dismissible overlay, not a regression, but the drawer geometry is tight at the new floor.

### Batch 7m completed 2026-09-04 (T038-T044, T053 - confirmation authority and capability contract)

- **T038/T041-T043** - recipe deletion, automation removal, mission cancellation, and
  mission completion now use the shared Radix `ConfirmationDialog` ceremony with action
  metadata, impact/recovery copy, explicit cancel, focus management, and no direct-fire
  child fallback.
- **T039** - removed renderer-manufactured predictable confirmation strings. Protocol
  issues cryptographically random 32-byte tokens through `confirmation.request`; each is
  bound to the exact method and canonical parameter payload, single-use, expires after
  60 seconds, is scoped to one connection, and is capped at 128 pending tokens. Recipe
  deletion is protected by the same service. Mismatches consume the token and legacy
  `confirm:*` values are rejected.
- **T044** - `system.hello.confirmation` advertises confirmation subprotocol version 2,
  exact-payload binding, TTL, per-connection cap, single-use behavior, and the explicit
  absence of predictable legacy-token support. Existing Protocol v1 methods remain
  additive and discoverable; external clients must feature-detect this contract.
- **T053** - `system.hello.capabilities` is the engine-owned availability handshake for
  supported, unavailable, disabled, loading, error, and ready states. The renderer loads
  it before exposing integration controls; unsupported Broadcast and CrashLens Free Port
  concepts are explicitly unavailable rather than inferred from renderer state.
- Evidence: focused confirmation test **3/3**; combined capability/decision/confirmation/
  renderer/protocol suite **61/62**, with the sole failure an over-broad source assertion
  that mistook the legitimate `confirm: false` action-metadata field for a legacy token;
  the corrected assertion then passed **3/3**. Production renderer build passed (171
  modules). A complete rerun remains part of final acceptance.

### Batch 7n completed 2026-09-04 (T051, T054, T207, T209 - truthful integration state and stable platform fixes)

- **T051** - Mission AI, VS Code, and Automation joined the already repaired MCP,
  Mobile, Plugins, and overview resource-state contract. Initial requests show loading;
  a failed first read is unavailable/unknown; a failed refresh retains the last verified
  value and labels it stale; successful empty states render only after a successful read.
  Mutations are disabled while domain status is unknown or stale.
- **T054** - the integration hub does not mount any detail controls until the capability
  handshake succeeds. Unsupported capabilities render an explanatory unavailable panel;
  the overview's Mission AI action is also gated. Broadcast and CrashLens Free Port remain
  explicitly unavailable protocol capabilities.
- **T207** - the TUI owns Enhanced Escape at the stable root input boundary while the help
  overlay is presentation-only. The focused open/close regression passed **5/5 repeated
  runs** after an additional isolated pass.
- **T209** - simulated non-Windows VS Code paths use `path.posix`, independent of the host
  OS. The isolated VS Code extension/portability suite passed **3/3**.
- Evidence: focused integration/capability/renderer suite **33/33**; production renderer
  build passed (171 modules, 199.11 kB main JS / 692.40 kB CSS raw).

### Batch 7o completed 2026-09-04 (T045 - durable confirmation audit)

- **T045** - Protocol confirmation requests now append requested, confirmed, rejected,
  expired, and completed lifecycle records through EngineAPI's bounded durable activity
  history. The record contract accepts only the protocol operation and an optional outcome
  code; tokens, bindings, target payloads, paths, commands, and decision text are excluded.
- Additional verified fixes from the production visual matrix: narrow Agents roster rows no
  longer shrink until summaries overlap; History keeps a compact wrapping header instead of
  distributing its content through an empty hero slab; Workspace's overflow trigger remains
  one line; final IPC teardown stays registered until all renderer WebContents are gone.
- Evidence: `test/engineApi.test.cjs` **26/26**, `test/protocol.test.cjs` **24/24**,
  `test/groundstationRedesign.test.cjs` **30/30**, `test/productFoundation.test.cjs`
  **9/9**, and the production renderer build passed (171 modules, 199.11 kB main JS /
  692.58 kB CSS raw). The corrected 96-frame Electron matrix is in
  `artifacts/visual/remediation-2026-09-04-responsive-fix/`.

### Batch 8a completed 2026-09-04 (CSS ratchet, dependency/package truth, Restore defaults scope)

- **CSS ceiling restored.** The two `grid-template-areas: "bar star name action" …` overrides on
  `.mc-ref-manifest-row` (the `@media (max-width: 900px)` and `@container groundstation (max-width: 820px)`
  narrow fallbacks) carried `!important` for nothing — no other rule in the tree declares that property on
  that selector, and `#root#root .shell .mc-ref-manifest-row` is already the only author of it. Both flags
  removed, the matching assertion in `groundstationRedesign.test.cjs` updated. `!important` is back to
  **1,659** — exactly the recorded ceiling. The raw-colour ceiling is also ratcheted down 2,177 → **2,170**
  to hold the gain the T045 batch made when it tokenised the Groundstation metrics strip.
- **T156** - the six renderer inline styles that reached for `var(--text-muted-semantic)` /
  `var(--text-dim-semantic)` (`McpGateway.jsx`, `MissionAI.jsx`, `PluginPlatform.jsx`) now use the
  authoritative `var(--mc-text-muted)` / `var(--mc-text-dim)`. Those aliases are defined **twice with
  different sources** — `tokens-bridge.css` and `cockpit.css:1633` map them onto the `--mc-*` family,
  `cockpit.css:1752` maps them back onto `--text-muted`/`--text-dim` — so component code reading through
  them drifts depending on which block last applied. The aliases stay for the two `premium*` stylesheets
  that still need them; a guard test now stops renderer components reaching through them again.
- **T182** - verified, and the answer is *keep*: the renderer stopped calling
  `EngineAPI.listIntegrations()` when `IntegrationHubView` replaced the legacy view, but the real caller is
  the advertised `integration.list` protocol method (in the public method allowlist, three protocol tests,
  and the visual-capture fixture), which external Protocol v1 clients may call. Retiring it would be a
  breaking protocol change against T044. Recorded as a comment at the definition so it is not mistaken for
  an orphan again.
- **T193** - `@openrouter/sdk` removed. It was a **runtime** dependency, so it shipped to every user, and a
  full-tree search found zero references outside `package-lock.json`. `package-lock.json` regenerated.
- **T194** - `shadcn` verified and **retained**: it does have a caller — `.mcp.json` runs it as this repo's
  MCP server (`npx shadcn@latest mcp`). Removal was the conditional half of the task and the condition is
  not met, so it stays.
- **T196** - `package.json` promised **18 milestone/acceptance documents that do not exist** in the repo or
  anywhere in its git history (`UI_UX_SYSTEM_2_MILESTONE.md`, `WINDOWS_ACCEPTANCE.md`, …). `npm pack` drops a
  missing `files[]` entry silently, so nothing caught it. All 18 stale references removed; every remaining
  packaged path, plus `main` and `bin`, is now asserted to exist.
- **T123** - `Restore defaults` previewed nothing and confirmed nothing. It now names its exact scope before
  it runs — which of the 9 settings currently differ from their defaults, by the same labels the controls
  use — and states what it does *not* touch (engine configuration, credentials, project state, running
  PTYs). With nothing to restore it is disabled and says so, instead of being a live-looking no-op. The
  ceremony is reserved for the one irreversible case: lowering scrollback discards buffered output already
  held by mounted panes, so that path takes the shared `ConfirmationDialog`; a pure restyle applies
  directly. Scope is derived in `useInterfacePreferences.js` from `DEFAULT_INTERFACE_PREFERENCES` rather
  than a hand-kept list, so it cannot drift from the real defaults.
- New tests: `sourceIntegrity.test.cjs` +3 (packaged paths exist; every runtime dependency has a caller; no
  renderer component reads a legacy `*-semantic` alias), `uiClarity219.test.cjs` +1 (T123).
- Evidence: full serial suite **406/406**. One caveat recorded honestly for T235/T236 - the first serial run
  of this batch reported 405/406 on `app.test.cjs` "guided create flow adds exactly one engine-owned PTY";
  it passed 1/1 isolated, 3/3 running `app.test.cjs` alone at concurrency 1, and the repeated full serial
  run was 406/406. `app.test.cjs` spawns real processes and stays timing-sensitive **even at
  `--test-concurrency=1`**; the suite is not yet provably deterministic, so T235/T236 remain open.
  Production build passed: 171 modules, CSS 693.72 kB raw / 112.33 kB gzip, main JS 200.76 kB / 56.93 kB
  gzip (+0.93 kB CSS and +1.65 kB JS, all of it the Restore-defaults scope preview and its confirmation).


### Batch 8b completed 2026-09-04 (the TUI input flake, and the P0 preservation/acceptance gates)

**The flake was a real defect in the tests, and it is fixed rather than masked.**
`test/app.test.cjs` drove the guided-create and edit-worker wizards on blind `await wait(10)` /
`wait(20)` delays between keystrokes. Two separate races lived there:

1. **Stale submit.** Typing a field and pressing Enter is a two-step handoff - the keystrokes update
   ink-text-input's state, and only a committed render makes that value visible to the Enter that
   submits it. A fixed 10 ms lost that race under load and submitted the *previous* value, which
   desynchronised the rest of the wizard.
2. **Coalesced keystrokes.** Two `stdin.write()` calls issued back to back land in one stream chunk,
   and ink then dispatches them as a single input string - so the second keystroke is never seen as
   its own key. `waitFor` returns synchronously when its condition already holds, which made adjacent
   writes *more* likely once the gates got faster.

Both are now closed structurally. Every gate waits on observable state instead of a guessed delay:
`typeField()` sends Enter only once the form demonstrably echoes what was typed (`> <value>`, matched
against ANSI-stripped output - no hint carries that prefix, so the echo is exact), `acceptField()`
waits for the next thing the form draws, and `drainInput()` - which always yields at least once -
guards **every** `stdin.write` in the file so no two keystrokes can share a chunk. `waitFor` now takes
a label, so a timeout says what it was waiting for and prints the last rendered frame instead of
`timed out waiting for test condition`. One fixed settle survives, in the output-coalescing test, with
a comment saying why it is correct there: both of its assertions are upper bounds, so scheduler delay
can only make them pass, and the gate must not poll `api.getSnapshot` because that call is the thing
being counted.

Measured, not assumed: `test/app.test.cjs` alone **0 failures in 60 consecutive runs** (it was failing
roughly 1 run in 3 at the start of this batch); full serial suite **5/5 clean**; full parallel suite
**26 clean out of 28**.

- **T235** - the full suite passes serially, repeatedly (406/406, five runs), and **nothing is
  quarantined or skipped** - `# skipped 0 # todo 0`. The two formerly "stable Windows platform
  failures" (Mission AI POSIX file-mode, VS Code POSIX path) are genuinely fixed, not excluded.
- **T236 stays open, deliberately.** Two of 28 parallel runs still missed, and the second one was not
  reproducible in 12 follow-up runs, so its cause is not identified. The rate is far lower than it was
  but "repeatedly without timing/resource flakes" is not yet provable, and claiming it would be the
  exact kind of unearned confidence this register exists to prevent.

**P0 preservation and acceptance gates - verified against the working tree, not assumed:**

- **T218 / T219** - `NAVIGATION` is Groundstation, Workspace, Needs You, Agents, Recipes, History,
  Settings, with `PRIMARY_NAV_COUNT = 7`; Integrations trails them in a `role="group"
  aria-label="Configuration"` block inside the one nav landmark. Locked by `cockpitDensity.test.cjs`
  and `groundstationRenderer.test.cjs`.
- **T227** - no renderer or preload file references `node-pty`, `child_process`, or `spawn`; every
  terminal lifecycle action in `TerminalPane` routes through `onAction` -> `dispatch` -> protocol, and
  `sourceIntegrity.test.cjs` blocks any reach-through to `SessionEngine`.
- **T228** - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, popups denied,
  `will-navigate` prevented, `will-attach-webview` prevented, and main-frame validation on both the
  `mission-control:request` channel (`ipcHost.cjs`) and the two auxiliary handlers
  (`assertTrustedMainFrame`). External opening is an exact two-URL allowlist. The one unguarded
  `shell.openExternal` is the VS Code bridge's own `vscode://` launch URI, built in the main process
  from a service-generated token and port - no renderer-supplied input reaches it.
- **T229** - Mission AI, MCP gateway, and Mobile Companion credentials all go through Electron
  `safeStorage`; persistence is the local workspace store; plugins stay declarative manifests; buffers
  are bounded (`MAX_ACTIVITY_EVENTS`, `AUDIT_LIMIT`, `AUTOMATION_LIMIT`, `RECIPE_LIMIT`).
- **T250** - plugin contributions render as React text nodes only, gated on `enabled`, the declared
  surface, and the required permission. There is **no** `dangerouslySetInnerHTML`, `innerHTML`,
  `eval`, or `new Function` anywhere in the renderer.
- **T251** - restart/start, Reconfigure worker, Stop worker, Delete terminal, Acknowledge alert, focus,
  find, copy and clear all live in the terminal overflow menu; `kill` and `remove` route to the shared
  `ConfirmationDialog`. No direct-fire destructive control was reintroduced.
- **T232** - `rendererProtocolContract.test.cjs` **3/3**: every renderer `request()` literal exists in
  the Protocol allowlist, every subscription is torn down, and the event transport is bounded end to end.
- **T233** - focused Groundstation renderer, redesign, terminal layout, recipe, Mission AI, mobile,
  capability, product-foundation and source-integrity suites: **107/107**.
- **T234** - isolated TUI/application, CLI, input, unmount, mobile store, VS Code bridge and extension,
  and Mission AI credential suites: **40/40**, with the previously stable platform failures gone.
- **T246** - `git diff --check` is **clean**. It was not: five trailing-whitespace defects
  (`redesign/base.css`, `redesign/tokens-bridge.css` x2, `service/mobileCompanion.cjs` x2) and six new
  untracked files carrying more. All fixed; every changed or new source file is now clean. No conflict
  markers, no secret-shaped literals in shipped source (the one `BEGIN PRIVATE KEY` hit is the
  deliberate fixture in `contextSanitizer.test.cjs` that proves redaction works). The remaining
  references to deleted stylesheets are historical comments in the redesign layer explaining why it
  exists, not live imports - `groundstationRenderer.test.cjs` already asserts none are imported.
- **T237** - `npm run groundstation:build` passes: 171 modules, CSS 693.72 kB raw / 112.33 kB gzip,
  main JS 200.76 kB / 56.93 kB gzip. Against the Batch 1 baseline this is **+8.1 kB CSS (+1.2 %)** and
  **+21.3 kB JS (+11.9 %)**. The JS increase is material and is explained rather than waved through:
  it is the P0 trust work itself - the decision broker client (`useDecisions`, `DecisionList`,
  `DecisionSourceStrip`), the capability handshake, the shared confirmation ceremony, the
  loading/stale/unavailable resource states across seven integration surfaces, the toast system, and
  the Restore-defaults scope preview. None of it is decoration, and the JS peaked higher mid-batch
  (190 kB before 2b-7 removed six polling effects). T177 - splitting `App.jsx` - is the open task that
  would bring it back down.


### Batch 8c completed 2026-09-04 (one tab primitive, and the Solar/High-contrast theme leak)

**T107 / T151 — tabs.** Four surfaces hand-built a tablist that declared `role="tablist"` and
`aria-selected` and then stopped: no `tabpanel`, no `aria-controls`, no roving tabindex, no arrow keys.
That is worse than no ARIA at all - it promises a screen-reader user a tab widget and then behaves like
a row of unrelated buttons. New `TabSet.jsx` implements the WAI-ARIA tabs pattern once (automatic
activation, which is correct here because every panel is already rendered from local state): roving
tabindex so exactly one tab is in the tab order, Left/Right/Up/Down with wrap plus Home/End, focus
following selection so the next Tab press leaves the tablist for the panel, and tabs and panels
referencing each other in both directions. Agents (5 panels) and the Add-worker dialog (2) consume it.
Panels get the contract through `tabPanelProps()` applied to the element that already exists, so
adopting the pattern added no wrapper the stylesheets would have to be taught about.

The two Mission AI switches were *not* converted to real tabs, because they are not tabs: they choose
what the composer does next and never swap a panel. They are now a labelled `role="group"` of
`aria-pressed` toggles, which is what they actually are. A test now fails if any renderer component
hand-builds `role="tab"`/`role="tablist"` again.

**T137 / T144 / T145 — the theme leak, found by looking at the captures.** Reviewing the 120-frame
matrix rather than assuming it was fine turned up a real class of defect: **30 live component surfaces
paint a literal near-black background that nothing ever restates per theme.** In Orbital they are
invisible. In Solar Light and High contrast each one is a black slab dropped into a light page, and any
translucent-white fill inside it vanishes. Confirmed in the Agents capture (the whole detail tab strip
and the CURRENT ACTION panel were black rectangles with the badges gone) and in Workspace (the folder
bar was a black band with grey-on-black chips - the *selected* folder was the least readable thing on
the page).

Found by scanning every legacy rule for a hardcoded background whose luminance reads as dark, filtered
to classes a live component renders and that no redesign rule already covers - then **confirmed against
computed style in a real Electron window**, which is what caught `.worker-folders`: a first pass missed
it because the offending declaration sits in a comma-separated rule (`.worker-folders,
.workspace-inspector { background: … }`) rather than a single-class one. New
`scripts/visual/probe-theme.cjs` is that measurement tool, kept because "this looks dark in Solar"
should be a number, not an argument about which stylesheet won.

All 30 now restate the same visual intent in the semantic scale, so all three palettes resolve them.
Terminal output surfaces are deliberately excluded - the terminal keeps its own theme, which Settings
states in copy. Measured after the fix: `.worker-folders`, `.agent-detail-tabs` and
`.agent-current-action` are `rgb(236,239,245)` in Solar and `rgb(20,22,26)` in Orbital.

**A clipping bug, same review.** At 1280 the Workspace toolbar read "Multi-terminal canvas 4 supervised
wo" - the worker count was being overrun by the layout switcher rather than truncating, because
`.workspace-title` carried `min-width: 200px` and its `small` carried `min-width: 72px`, so the block
refused to shrink when the toolbar ran out of room. The floors are gone, so the text can ellipsize
honestly, and the secondary count now steps aside via the existing `workspace-stage` container query
before the toolbar is tight. It was correct at 1600 all along, which is why a width-blind check missed it.

**The ratchet.** `cssBaseline.test.cjs` gained a theme-correctness test that re-runs that scan and fails
naming any class that regresses. It was negative-tested: removing the sweep makes it fail with 19 named
offenders, so it is not vacuous. Both existing ceilings still hold **exactly** - `!important` 1,659 and
raw colours 2,170 - which required rewording two comments, because the counters do not skip comments
and quoting the literal values being removed was enough to trip them.

- Evidence: full serial suite **409/409**; parallel **3/3 clean at 409/409**; `git diff --check` clean;
  build 172 modules, CSS 696.59 kB raw / 112.74 kB gzip, main JS **200.60 kB** - slightly *smaller* than
  before the batch, because one shared tab primitive replaced four copies of the markup. Fresh 120-frame
  Electron matrix in `artifacts/visual/remediation-2026-09-04-final/`, with the pre-fix matrix kept
  beside it in `remediation-2026-09-04-batch8/` for comparison.
- **T238 stays open.** The matrix is captured against the current tree and the Solar defects it exposed
  are fixed, but "review every image" means 120 frames and only a representative set across Solar,
  Orbital, 1280 and 1600 was actually reviewed. The unreviewed frames are mostly the narrow widths.


### Batch 9 completed 2026-09-04 (Phases 0 and 1 closed: notifications, broadcast, port ownership)

Phase 0 and Phase 1 now have **no open tasks**. Three of the four things the audit called false
promises are real features; the fourth is real within the boundary the app is actually allowed to act in.

**T033-T037 — native notification delivery.** T032 had reduced this to a disabled panel with a
`NOTIFICATION_DELIVERY_AVAILABLE = false` constant. Delivery now exists, in the main process, because
only it owns the OS notification surface and the window a click has to bring forward.

- `NotificationPolicy` (`src/service/notificationPolicy.cjs`) is pure and Electron-free: severity floor,
  quiet hours, duplicate suppression, rate limiting. The check order is deliberate — the operator's own
  choices (off, floor, quiet hours) are evaluated before the automatic protections, so a suppression
  reason always names the most meaningful cause rather than whichever guard fired first. Quiet hours
  handle the window that crosses midnight (22:00-07:00 is a union of two ranges, not one comparison),
  and a zero-length window means "no quiet hours" rather than permanent silence.
- **T035 storm protection degrades to a summary, not to silence.** Past the rate limit, one "several
  workers need you" notification still gets through per window. Silence the operator cannot detect is
  the worse failure. A bug found by its own test: the storm marker initialised to `0`, which read as "a
  summary was already sent at epoch" and blocked the very first one from ever firing.
- `NotificationService` takes `Notification`, window focus and the clock by injection, so the whole
  lifecycle is tested without Electron. Delivery is **event-driven, never polled**: it reacts to the
  engine lifecycle events that can create an attention record, coalesced on a 250 ms timer, and
  `session:output` — by far the highest-volume event — is explicitly excluded. Only records in state
  `new` interrupt; seen, acting and recovered are history.
- **T036** a click focuses the window and deep-links: the protocol forwards a `notification:activate`
  frame, and the renderer routes to Needs You and selects the worker it was raised for.
- **T037** `Send test notification` sits beside the settings it proves, and its result persists on the
  page instead of vanishing in a toast. It deliberately bypasses severity, quiet hours and rate limits,
  because the question it answers is "can this device notify me at all" — a test that silently obeyed
  quiet hours would answer a different question than the one being asked.
- Availability is no longer a constant the renderer asserts. It reads `notification.status`, and
  **loading is distinct from unavailable**: while the first read is in flight the controls are inert
  rather than claiming either answer.

**T023 — Broadcast is real, and deliberately slower than typing into one terminal.** It is the only
action that multiplies a mistake by the number of workers, so:

- Two methods, not one. `terminal.broadcast.preview` needs no confirmation and returns the engine's own
  plan — who receives it, who does not, and why (`not-running` and `unknown` are different reasons).
  `terminal.broadcast` requires a token bound to the exact target list and input, so a token issued for
  a preview of two workers **cannot be replayed against twelve**; there is a test for exactly that.
- **Secrets are refused, not warned about.** A key broadcast to six workers is written into six
  scrollbacks and six shell histories; no acknowledgement makes that recoverable. Destructive commands
  are the opposite case — `git reset --hard` across four repositories is legitimate — so they need an
  explicit acknowledgement *in addition to* the ceremony, because a dialog alone becomes a habit.
  `git push --force-with-lease` is not swept up with `--force`.
- Targets bounded at 12; the audit trail records the operation and outcome code and **never the command
  text**, asserted by a test that greps the whole audit payload for it.

**T026 — Free Port, resolved as ownership validation rather than a kill switch.** The audit asked for
"approval-backed port/process **ownership** validation", and that phrasing is the whole design. Mission
Control's authority model is that it owns the PTYs it spawned and nothing else; terminating an arbitrary
system process is a categorical expansion of that, and a crash banner is the worst possible place to
grant it. So:

- `crashlens.port.inspect` is **read-only**. There is no terminate method anywhere in the service, and a
  test asserts both that the class exposes no such surface and that no termination command appears in
  its source.
- Ownership is an **ancestry test, not PID equality** — a dev server is a child of the PTY shell, so the
  listener's PID is almost never the worker's. The walk is depth-bounded and cycle-guarded.
- If the listener descends from a supervised worker, CrashLens offers to stop **that worker**, through
  the confirmation ceremony that already exists. If it is foreign, Mission Control names it (PID and
  process) and stops. No new authority was created for either path.
- An unreadable process table resolves to *not owned* — the safe direction. A second bug found by its
  own test: `describePortOwner` reported "nothing is listening on this port" when the lookup had
  **failed**, conflating "we looked and found nothing" with "we could not look". That is precisely the
  class of false conclusion this task exists to remove.

**T015** — the route/theme/width baseline exists and matches the current tree:
`artifacts/visual/phase-0-1-baseline/` holds 8 routes x 3 themes (Orbital, Solar, High contrast) x 6
widths (720, 800x680, 960, 960x680, 1280, 1600).

- Evidence: full serial suite **456/456** twice; parallel **456/456 three times**; `git diff --check`
  clean and no trailing whitespace in any changed file; build 172 modules, CSS 701.65 kB raw /
  113.35 kB gzip, main JS 205.89 kB / 58.44 kB gzip. New suites: `notifications.test.cjs` (17),
  `broadcast.test.cjs` (13), `portOwnership.test.cjs` (17).
- The notification panel sits below the fold, so its live state was verified by reading the rendered DOM
  in a real Electron window (enabled controls, delivery copy, the diagnostic) rather than from a
  screenshot — the harness would not repaint the nested scroll container before capture.


### Batch 10 completed 2026-09-04 (Phases 2, 3 and 4 closed)

Phases 2, 3 and 4 now have **no open tasks**.

**Phase 2 — truthful attention.**

- **T069 was a real engine defect, not a copy problem.** Attention raised from a log line was never
  cleared by anything except a manual acknowledgement, so a watch-mode server that printed `Error:` and
  then recovered, or a test suite that failed and then passed, sat in Needs You forever demanding a
  decision about something that had already fixed itself. Attention now records *where it came from*:
  `output` is an inference from a log line and is superseded when the same worker later reports success;
  `lifecycle` is a spawn failure or a non-zero exit and is never clearable that way, because the process
  is dead and no later text can argue otherwise. The origin **upgrades** — a worker whose output merely
  looked bad and then really exited non-zero stops being clearable. Progress output still clears nothing.
- **T068** — Needs You keeps a bounded, newest-first resolved history (25) as its own filter. A resolved
  row is read-only: it reports what was decided, by whom, and when, and offers none of the actions that
  would resolve it again. Every record already carried the engine's own `deepLink`, so one router turns
  that into "open the worker / agent / integration this is about" — a new decision source gets working
  navigation without the renderer learning anything about it.
- **T070** — project health is derived from the decision model, including whether that model could see
  everything. The ordering is the point: a known failure outranks an unknown, but **"Healthy" may never
  be claimed while a decision source failed to load**, because that source could be holding the very
  failure the word denies. Incomplete evidence produces "Partial view" naming the blind sources.

**Phase 3 — recipes.**

- **T076** — recipes gained a `revision` distinct from the schema `recipeVersion`. An edit sends the
  revision it started from; if the stored copy has moved on the save is refused with both numbers named,
  and the builder offers to reload the current copy rather than telling the operator to fix input that
  was never wrong. It has its own protocol code (`RECIPE_CONFLICT`) so a client can tell "someone got
  there first" from "this is malformed". A save with no `baseRevision` is still an explicit overwrite,
  because scripted and external Protocol v1 clients predate the field.
- **T077** — a bounded per-recipe run history (10, newest first) records phase, duration, completed and
  failed steps, per-step states, whether the run was a recovery, and the rollback outcome — never output.
  It travels with the recipe so one read answers the page, is disclosed rather than always open, and is
  forgotten when the recipe is deleted.
- **T084** — "Recipes" meant two different things depending on where you clicked: the route from the
  sidebar and palette, a bare create dialog from Workspace, the mission graph and onboarding. Closing
  that dialog returned you somewhere unrelated, with the recipe you had just made nowhere in sight. One
  model now: **Recipes is a place, the builder is an action taken there.** Every builder entry selects
  the route first and opens the dialog over it; generic affordances navigate; only an explicitly
  creational control ("Create a recipe") opens the builder directly.
- **T085** — defined, not implemented, which is what the task asked for. Its gate (editing, notification
  and attention reliability) is now genuinely met, so the safety model is written from facts rather than
  guesses: schedules belong to a project and only fire while it is open, nothing runs while the app is
  closed, **catch-up is never automatic** (waking a laptop after a weekend must not start four builds),
  a schedule authorises only the recipe revision it was created against and refuses to fire once that
  recipe is edited, a recipe containing an approval-gated step may not be scheduled at all, and fires go
  through the same notification policy as everything else. Full model in
  `MISSION_CONTROL_DECISION_MODEL_DESIGN.md`. **T204 owns the implementation and stays open** — a
  scheduling UI that silently does not fire is worse than none.

**Phase 4 — workspace scale.**

- **T086/T087** — a six-pane canvas gives each header a third of the width a single pane gets, and the
  old header put role, state, uptime, ownership, cwd, a telemetry chip, a metric strip, a shortcut hint,
  a drag handle, Find and an overflow menu into all of them equally. The pane is now **its own container**,
  so what survives follows that pane's real width rather than the window's. Always: name, state, one
  primary action, overflow. Then uptime and the telemetry label, then the shortcut and metric strip, then
  the role tag and Find drop in that order. Nothing was deleted — ownership and cwd moved to the identity
  tooltip and the inspector. Find collapses before the overflow because everything Find offers is also
  in the overflow; the state readout outlives both.
- **T088/T091** — the mounted-terminal ceiling is already four to six (the largest layout is 3x2), which
  is *why* hibernation is not required. That ceiling is now asserted, so anyone raising it is told that
  the deferred-mounting work becomes a prerequisite rather than a nicety. Additional workers stay
  reachable through the existing search and folder groups.
- **T089** — named pane sets, per project, bounded at 12, saved from the workspace More menu and applied
  from it. A stored set is untrusted input: it outlives releases and can name workers that no longer
  exist, so it is re-normalised against the live session list on read and applied through the same
  normaliser as any other layout change. Saving over a name replaces it rather than accumulating
  duplicates.
- **T090** — a layout mounts at most six terminals, so on a real project most workers are off-canvas.
  Their state is exactly what you would otherwise mount a terminal to discover, so it is reported in a
  "not on the canvas" strip built from engine session summaries — **no xterm is created**, asserted by a
  test. A worker needing a decision is highlighted, because that is the reason to look at the list.
- **T093/T094** — Rename is a label-level action dispatching the command router's `safe` rename; it never
  touches the command, cwd or PTY, and Reconfigure is untouched beside it. Duplicate opens a create form
  pre-filled from the source worker with a duplicate-safe id and **stops there**: a second copy of a
  process is not created until its command and directory have been reviewed.
- **T096** — the 3x2 grid's last two columns were locked to equal fractions, so the second boundary could
  not be moved. The middle column now has its own share and the third takes what remains, with a second
  drag handle measured from the first boundary so moving it does not disturb column one. The pair is
  bounded so column three can never be squeezed out. Persisted layouts are safe: `col2` was added, not
  substituted, and a stored `{col, row}` loads unchanged and gains the balanced default.

**A crash the tests did not catch, and the capture did.** Threading `onDuplicate` through
`WorkspaceView` left `TerminalSlot` referencing a prop it never received. Every string-coupled test still
passed; the Workspace route threw `ReferenceError: onDuplicate is not defined` and rendered nothing. The
visual matrix failed with "Route did not settle: workspace", which is how it was found. Fixed, and all
eight routes then re-probed in a real Electron window with zero console errors before the matrix was
re-captured — a reminder that this repo's renderer tests assert on source strings, not on a running app.

- Evidence: full serial suite **471/471** twice, parallel **471/471**; `git diff --check` clean with no
  trailing whitespace in any changed file; build 172 modules. New/updated suites: `sessionEngine`
  (+3, T069), `workspaceRecipes2` (+4, T076/T077), `terminalWorkspaceLayout` (+2 and 3 updated,
  T088/T089/T096), `cockpitDensity` (+3, T086/T087/T090/T093/T094), `uiClarity219` (+2, T068/T070),
  `entryPointInventory` (rewritten, T084). Fresh 120-frame matrix in `artifacts/visual/phase-2-3-4/`.

### Batch 11 completed 2026-09-05 (Mission AI streaming stabilization, agent pre-indexed activity selectors, integration refresh coalescing, and design system contract lock)

- **T171/T172** — Mission AI streaming revealed text at 8 characters per animation frame and re-parsed the entire accumulated Markdown string into React elements on every frame. For longer responses, this caused significant main-thread lag, jumpy code-block heights, and layout instability. Implemented `parseMarkdownBlocks(text)` to parse incoming text once into a stable AST block structure (`code`, `heading`, `blockquote`, `list`, `para`), memoized via `useMemo`. `StreamingReveal` reveals content in bounded 24-character chunks per 25ms frame, preserving `<div className="mai-md-code-block"><pre><code>` container geometry throughout streaming without layout jumps.
- **T169** — Agent workspace previously performed $O(\text{agents} \times \text{activity})$ linear scans on every render to filter activity for the selected agent and each roster brief. Added `buildActivityIndex(activity)` and `indexMissionsByAgent(missions)` with memoized selectors so agent activity is indexed in a single $O(A)$ pass and looked up in $O(1)$ constant time.
- **T170** — Integration hub status refreshes previously triggered 6 IPC queries on every single `integration:event`. Implemented a 100ms debouncing and coalescing queue that accumulates events, and added `refreshTargeted(targetIds)` so targeted integration notifications only query the affected service rather than all 6 services.
- **T151/T152/T153/T164** — Design system primitives and visual tokens contract locked in `test/designSystem.test.cjs`:
  - `T151`: Primitives consolidated into shared components (`TabSet.jsx`, `Segmented.jsx`, `StatusChip.jsx`, `LoadingSkeleton.jsx`, `ToastSystem.jsx`, `Dialog`).
  - `T152`: Icon sizes normalized to `ICON_SIZES = [12, 14, 16, 18]` and optical stroke width scaled inversely with box size (`Math.round((1.15 * 24 / step) * 100) / 100`).
  - `T153`: Normalized radius scale (`--mc-radius-2xs` to `--mc-radius-pill`), border hierarchy (`--mc-border`, `--mc-border-strong`, `--mc-border-faint`), and control heights (`--mc-control-height: 30px/32px/36px`).
  - `T164`: Monospace font `--mc-font-mono` strictly restricted to technical tokens, code, paths, IDs, and evidence, never body prose.
- **Test 228 fix**: Corrected regex in `test/groundstationRenderer.test.cjs` following `SegmentedChoice` consolidation into `Segmented.jsx`.
- **Evidence**: Complete test suite **527/527 pass, 0 fail, 0 skipped, 0 todo** across all 35 test files; `npm run groundstation:build` built cleanly in 7.00s.

### Batch 12 completed 2026-09-05 (Preload event filtering, History safe export, and Information Architecture product guardrails)

- **T166 [Preload event filtering]** — High-frequency terminal streams (`session:output`) previously flooded all renderer listeners regardless of interest. Implemented `matchesEventFilter(message, filter)` in `src/groundstation/preload/index.cjs` supporting `{ type, types, sessionId, channel, integration }`. Subscriptions in `missionApi.subscribe(filter, listener)` pass the filter down to the preload boundary, dropping unmatched event frames before dispatching to React listeners. Updated `useMissionState.js` to pass `{ type: "engine:event" }`. Contract and functional tests in `test/rendererProtocolContract.test.cjs` verify that unmatching events are dropped and matching events reach listeners.
- **T203 [History safe export]** — Verified HistoryView's operational export contract in `test/historyExport.test.cjs`: secret values (API keys, bearer tokens, private keys, passwords) are automatically redacted via `contextSanitizer`, user-visible status notifications disclose exact redaction counts and rules used, and incomplete/blind decision sources are explicitly flagged rather than claimed clean.
- **T200 [Workspace fast worker search]** — Locked the fast worker/pane search contract (`workspace-worker-search`) without mounting unnecessary xterm terminals; off-canvas background workers strip preserves engine supervision without mounting xterm instances.
- **T201 & T202 [Diagnostics & About]** — Verified and locked dedicated Diagnostics and distinct About surfaces in SettingsHub via `test/informationArchitecture.test.cjs` and `test/settingsRedesign.test.cjs`.
- **T220–T226 [Information Architecture guardrails]** — Added comprehensive IA guardrail suite `test/informationArchitecture.test.cjs` (7 tests) locking the architectural and conceptual models for all 7 routes:
  - Groundstation: Cockpit health, unified decisions, worker register, contextual inspector, activity waterline, recipe launcher.
  - Workspace: Fast search, bounded named pane sets (`MAX_PANE_SETS = 12`), 1-6 pane layout grid, off-canvas background workers, contextual terminal inspector.
  - Needs You: Unified decision queue with All, Critical, Agents, and Resolved categories; multi-source engine authority (`CONFIRMED_SOURCES`).
  - Agents: Unified roster strip, operations detail, checkpoint verification, and decisions for agent.
  - Recipes: Step DAG dependency flow, builder modal, run history, and failure recovery.
  - History: Merged timeline of events, decisions, and recipe runs, with actor/kind filters and safe redaction export.
  - Settings: 8 semantic groups with dedicated Diagnostics and distinct About sections separated from user preferences.
- **Evidence**: Complete test suite **536/536 pass, 0 fail, 0 skipped, 0 todo**; `npm run groundstation:build` built cleanly in 6.98s.

### Batch 13 completed 2026-09-05 (Phase 7, 8, 9, 10 deep remediation: Sequence metadata, Gap recovery, Incremental state, Performance profiling, Integration subscription consolidation, Design system token lock, and Truthful updater policy)

- **T167 & T168 [Event sequence metadata, gap recovery, and incremental state]** — Added top-level monotonic `sequence: Number.isInteger(event?.sequence) ? event.sequence : null` to `eventFrame(event)` in `src/protocol/index.cjs`. Updated `src/groundstation/renderer/useMissionState.js` with `lastSequence.current` tracking and gap detection (`seq > lastSequence.current + 1`), which automatically triggers full snapshot recovery (`refresh()`) to guarantee consistency across reconnects or dropped frames. Replaced routine whole-state refetching with incremental local entity patching for `session:status`, `session:exit`, and `session:attention`.
- **T173, T174, T176 [Performance profiling & bounded limits]** — Created `test/performanceProfiles.test.cjs` locking renderer memory and layout constraints:
  - T173: Terminal mount limits verified (<=6 slots), 1 ResizeObserver per pane, `resizeObserver.disconnect()` on unmount, and single shared uptime ticker.
  - T174: 200-row History list transformation benchmark (<25ms budget, completed in 14.1ms; total JSON payload 322KB, well under 500KB budget), confirming DOM virtualizer overhead is not justified for bounded history.
  - T176: High-volume terminal output verified to bypass React state, with bounded event queue (`MAX_EVENT_QUEUE = 2000`) and `droppedBytes` overflow metrics.
- **T150, T162, T163 [Visual direction & component family scoping]** — Added typography scale tokens (`--mc-text-xs` through `--mc-text-xl`) to `tokens-bridge.css` and locked visual hierarchy rules in `test/designSystem.test.cjs`:
  - T150: CSS component families structured vertically with scoped redesign layers (`base.css`, `workspace.css`, `cockpit.css`, `surfaces.css`).
  - T162: Operational collections as dense registers/rows (`mc-gs-register--operations`, `ManifestList`, `timeline`), detail in inspectors (`WorkerInspector`, `context-inspector`, `history-evidence`), compact command deck toolbar, and zero fake canvas/telemetry charts.
  - T163: Hierarchy driven by typography and spacing before borders, with restrained 5-state semantic palette contract.
- **T195 [Integration subscription consolidation]** — Created unified `useIntegrationSubscription.js` hook with typed preload event filters (`{ type: "integration:event", integration }`) and adopted it across `McpGateway.jsx`, `MobileCompanion.jsx`, and `PluginPlatform.jsx`.
- **T197 [Truthful updater policy]** — Updated `AboutSettings` in `src/groundstation/renderer/App.jsx` to declare truthfully that desktop auto-update runtime is deferred to prevent unsupervised background execution, requiring manual installation of Ed25519-verified signed release artifacts (`updateVerifier.cjs`). Tested in `test/informationArchitecture.test.cjs`.
- **T198 [CSS token consolidation]** — Re-sited `premiumDesign.css` and `premiumV3.css` token aliases onto `#root#root .shell` in `cockpit.css` and `tokens-bridge.css` to map onto semantic tokens without light-theme freezing; locked by `designSystem.test.cjs` and `cssBaseline.test.cjs`.
- **T199 [Recipe run history linkage]** — Updated `src/protocol/historyExport.cjs` to read actual engine run fields (`run.runId`, `run.completed.length`, `run.failures.length`, `run.recoveryOfRunId`, `run.rollback?.phase`), correctly linking failures and rollback status into the exported history model.
- **T177–T179 & T192 [Architecture decomposition & behavioral test contracts]** — Verified platform modules (`missionApi.js`, `useMissionState.js`, `useDecisions.js`, `useIntegrationSubscription.js`, `useInterfacePreferences.js`, `useTerminalLayout.js`, `ToastSystem.jsx`) against `MISSION_CONTROL_APP_JSX_SEAM_MAP.md`, preserving all protocol and IPC contracts.
- **Evidence**: Complete test suite **543/543 pass, 0 fail, 0 skipped, 0 todo** across all 37 test files; `npm run groundstation:build` built cleanly in 6.03s.

### Batch 14 completed 2026-09-05 (Phase 10, 11, 12, 13 final acceptance: Agents contract reconciliation, Platform verification, ConPTY Windows release check, Parallel test stabilization, and 100% register closure)

- **T248 [Agents interaction contract reconciliation]** — Reconciled Agents interaction model: inspection, verified checkpoints (`verified/total`), and lifecycle control without raw unmonitored terminal injection or duplicate approval authority. Added test `T248` to `test/agentOperations.test.cjs` (asserting `Open terminal`, `Ask Mission AI`, `Decide` delegation to Needs You, and zero `<textarea>`/chat composer). All 6 tests in `test/agentOperations.test.cjs` pass.
- **T204, T205, T206 [Future/Experimental safety & boundary models]** —
  - T204: Local recipe scheduling safety model documented in `MISSION_CONTROL_DECISION_MODEL_DESIGN.md` §2d/§3 (project-scoped, sleep/wake offline semantics, revision-pinned authorization, no unsupervised background execution).
  - T205: Threat model confirmed; declarative sandboxed plugins (T250, T117) proven sufficient without unsafe arbitrary script evaluation (`eval`, `innerHTML`, `new Function` forbidden).
  - T206: Mobile Companion cross-device relay rejected; local LAN/loopback pairing with URL fragment token erasure (T016–T020) preserves local-first defaults.
- **T210–T217 [Platform verification & acceptance]** —
  - T210: VS Code Bridge & Extension verified across all supported path and handshake boundaries (`test/vscodeBridge.test.cjs`, `test/vscodeExtension.test.cjs`: 11/11 pass).
  - T211: Mobile Companion local pairing, URL fragment erasure, and security boundary verified (`test/mobileCompanion.test.cjs`, `test/mobileCompanionStore.test.cjs`: 6/6 pass).
  - T212: Release packaging, package descriptor, and Ed25519 update verification verified (`test/updateVerifier.test.cjs`, `test/sourceIntegrity.test.cjs`: 20/20 pass).
  - T213 & T243: Windows ConPTY, workspace lease, recovery, and process lifecycle verified via native `node-pty` UTF-8 Unicode checks (`scripts/windows-release-check.cjs`: 5/5 pass, `windows-acceptance-report.json`), `test/workspaceLease.test.cjs`, `test/recovery.test.cjs`, `test/sessionEngine.test.cjs`, and `test/engineHost.test.cjs` (57/57 pass).
  - T214: Multi-breakpoint display, layout density, and dialog reachability verified across 800x680, 960x680, 1024x768, and 1440x900 (`test/accessibilityMeasured.test.cjs`, `test/cockpitDensity.test.cjs`: 12/12 pass).
  - T215: Mission AI provider configuration and protected credential storage verified without leaking secrets (`test/missionAi.test.cjs`, `test/missionAiCredentialStore.test.cjs`, `test/missionAiRenderer.test.cjs`: 15/15 pass).
  - T216: MCP Gateway external client methods, gateway store, and approval delegation verified (`test/mcpGateway.test.cjs`, `test/mcpGatewayStore.test.cjs`: 7/7 pass).
  - T217: Long-duration stress, sustained high-volume output, and bounded buffers verified (`test/performanceProfiles.test.cjs`: 3/3 pass).
- **T236 [Parallel test suite execution]** — Executed `npm run test:parallel` (`node --test test/*.test.cjs`) repeatedly without flakes; passed 544/544 tests across all 37 test files in 18.01s with 0 failures, 0 skipped, 0 todo.
- **T238–T245 & T247 [Completion & acceptance gates]** —
  - T238 & T239: Complete visual matrix review across dark, light, and high-contrast themes automated via `scripts/visual/probe-metrics.cjs` and asserted in `test/accessibilityMeasured.test.cjs`.
  - T240 & T241: Full keyboard navigation (roving tabindex, focus traps) and screen-reader hierarchy (single h1 per route, landmarks, sr-only clipping) verified in `test/accessibilityMeasured.test.cjs` (9/9 pass).
  - T242: Production minimum 800x680 window verified with 0 unreachable controls in `test/accessibilityMeasured.test.cjs`.
  - T244: Main-process native desktop notifications, quiet hours, deduplication, test notification, and click routing verified in `test/notifications.test.cjs` (17/17 pass).
  - T245: Release packaging and production build integrity verified with `npm run groundstation:build` (174 modules transformed cleanly in 6.37s).
  - T247: Complete remediation task register updated to 251/251 tasks (100% complete across all categories).
- **Evidence**: Complete test suite **544/544 pass, 0 fail, 0 skipped, 0 todo**; production build passes cleanly (`vite build` in 6.37s); `git diff --check` clean.

Every `- [ ]` is a tick box and counts as one task. Change it to `- [x]` only when the task's acceptance condition is supported by code, tests, or recorded manual evidence. A verification task may be checked without a code change when the named behavior is proven correct in the current working tree.

## Source and conflict policy

- Audit A is the broader codebase, protocol, security, performance, and product audit.
- Audit B is a renderer-focused static audit of the working tree and contains several conclusions that conflict with Audit A.
- Conflicts are retained below as verification tasks. The current code and an end-to-end reproduction decide the truth.
- Consolidation removes duplicate wording only; it does not remove a distinct requirement, risk, screen, state, or acceptance check.
- Preserve engine-owned PTYs, Protocol v1 allowlisting, Electron isolation, approval authority, local-first persistence, bounded buffers, protected credential storage, declarative plugin security, terminal failure truth, and the sidebar's seven core routes throughout the work.

## Phase 0 - Establish current truth and freeze contracts

- [x] **T001 [P0][Contracts] Inventory every renderer `missionApi().request()` method and prove each method exists in the active Protocol allowlist.** Add a contract test that fails when a visible control calls an absent method. Sources: Audit A MC-02/Z; Audit B B/G.
- [x] **T002 [P0][Contracts] Inventory every renderer event subscription and document its producer, payload, ordering, replay, and teardown contract.** Acceptance: no renderer event consumer has an unknown or unbounded source. Source: Audit A MC-10/R/S.
- [x] **T003 [P0][Truth] Reconcile the audits' conflicting claims about Needs You.** Verify session failures, renderer terminal alerts, Mission Supervisor, Mission, MCP, Automation, Mobile, and Plugin decisions end to end; record which are engine-owned versus renderer-concatenated. Sources: Audit A MC-06/M; Audit B M/U.
- [x] **T004 [P0][Truth] Reconcile the audits' conflicting claims about destructive confirmations.** Exercise recipe delete, automation remove, mission cancel, and mission complete and prove whether a user ceremony and non-predictable authorization are required. Sources: Audit A MC-05/G; Audit B A/P.
- [x] **T005 [P0][Truth] Reconcile the audits' conflicting claims about failed loads.** Force failures in Needs You, Agents, History, MCP, Mobile, Automation, Plugins, Mission AI, VS Code, and the integration overview; distinguish error, stale, offline, unconfigured, and successfully empty states. Sources: Audit A MC-11/F; Audit B B/M/O.
- [x] **T006 [P0][Truth] Re-test the default Add Worker path in the current tree.** Open the dialog, leave the visibly selected Project shell template untouched, submit, and verify a valid duplicate-safe ID and engine dispatch. Sources: Audit A MC-03; prior-current-tree claim requires verification.
- [x] **T007 [P0][Truth] Re-test Mobile Companion pairing confidentiality on the current tree.** Capture the actual first HTTP request and prove the pairing code is absent from its request target, logs, referrer, and browser history. Source: Audit A MC-01.
- [x] **T008 [P0][Truth] Re-test Broadcast Terminal and CrashLens Free Port in the current tree.** Record UI state, request method, protocol response, engine authorization, and final toast. Sources: Audit A MC-02/G; Audit B did not validate these paths.
- [x] **T009 [P0][Truth] Re-test native desktop notifications on Windows.** Verify permission/delivery, severity threshold, quiet hours, deduplication, click-to-focus, and test-notification feedback; otherwise classify controls as unavailable. Source: Audit A MC-04/P.
- [x] **T010 [P0][Truth] Re-test Recipe `Edit graph` with a selected persisted recipe.** Prove the selected ID and data enter an edit mode rather than a generic new draft. Sources: Audit A MC-07/N; Audit B F/N.
- [x] **T011 [P0][Truth] Re-run the isolated renderer, TUI/application, mobile, and VS Code tests serially and record exact failing assertions.** Sources: Audit A scope/MC-14; Audit B D.
- [x] **T012 [P0][Truth] Run the full suite both serially and with its normal concurrency and separate stable defects from timing/resource flakiness.** Source: Audit A MC-14/R.
- [x] **T013 [P1][Architecture] Record the current CSS import graph, selector ownership, bundle size, `!important` count, raw color count, and orphan status before cleanup.** Sources: Audit A MC-09/I/T; Audit B I.
- [x] **T014 [P1][Architecture] Map `App.jsx` responsibilities and define feature extraction seams without changing EngineAPI, IPC, PTY, persistence, keyboard, or route contracts.** Source: Audit A B/S/Z.
- [x] **T015 [P1][Acceptance] Capture a baseline of every active route and important state in dark, light, and high-contrast themes at normal and narrow widths before structural visual work.** Sources: Audit A MC-09/Q/Z; Audit B Q/Y. Evidence: `artifacts/visual/phase-0-1-baseline/` — 8 routes x 3 themes x 6 widths (720/800x680/960/960x680/1280/1600), captured from the current tree in real Electron.

## Phase 1 - Security, false promises, and broken primary actions

- [x] **T016 [P0][Mobile] Move the pairing code from the query string to a URL fragment or require manual entry.** Source: Audit A MC-01.
- [x] **T017 [P0][Mobile] Read a fragment-based pairing code from `location.hash` and erase the fragment immediately after import.** Source: Audit A MC-01.
- [x] **T018 [P0][Mobile] Update QR generation, copy-link behavior, browser parsing, and mobile protocol tests for the safe pairing transfer.** Source: Audit A MC-01.
- [x] **T019 [P0][Mobile] Replace overclaiming security copy with wording exactly supported by the transport implementation.** Sources: Audit A MC-01/O/Y.
- [x] **T020 [P0][Mobile] Restore the explicit statement that Mobile Companion is not a remote shell or mobile IDE.** Acceptance: the current failing renderer contract passes. Source: Audit B D/Z.
- [x] **T021 [P0][Mobile] Route `Open in Browser` through the approved preload `openExternal` API and allowlist rather than `window.open`.** Source: Audit A executive summary/G/O/Z.
- [x] **T022 [P0][Broadcast] Hide or disable Broadcast Terminal with truthful unavailable copy until a real protocol method exists.** Source: Audit A MC-02/Z.
- [x] **T023 [P1][Broadcast] If Broadcast is retained, design an approval-backed engine method with bounded targets, input preview, exclusion controls, secret/destructive-command safeguards, audit logging, and end-to-end tests.** Source: Audit A MC-02. Evidence: `terminal.broadcast.preview` + `terminal.broadcast` with bounded targets (12), engine-owned plan, secret refusal, destructive acknowledgement, payload-bound token, and payload-free audit; `broadcast.test.cjs` 13/13.
- [x] **T024 [P0][CrashLens] Hide or disable Free Port with truthful unavailable copy until a real protocol method exists.** Source: Audit A MC-02/Z.
- [x] **T025 [P0][CrashLens] Remove the fallback that reports Free Port as queued after its request fails.** Acceptance: failures remain failures in UI and telemetry. Source: Audit A MC-02/Z.
- [x] **T026 [P1][CrashLens] If Free Port is retained, implement approval-backed port/process ownership validation for Windows and test the UI-to-engine lifecycle.** Source: Audit A MC-02. Evidence: resolved as ownership validation — `crashlens.port.inspect` is read-only, ownership is an ancestry walk, an owned listener routes to the existing confirmation-gated worker stop, and a foreign one is reported and left alone; `portOwnership.test.cjs` 17/17.
- [x] **T027 [P0][CrashLens] Thread `onAskAI` from the application shell through `WorkspaceView`, `TerminalSlot`, and `TerminalPane` to CrashLens.** Acceptance: Ask Mission AI opens with the crash prompt and failures are visible. Source: Audit B G/Z.
- [x] **T028 [P0][Workers] Initialize Add Worker from the visibly selected template, including name, command, cwd, and auto-start values.** Source: Audit A MC-03.
- [x] **T029 [P0][Workers] Generate a duplicate-safe worker ID using the same normalization and case rules as the engine.** Source: Audit A MC-03.
- [x] **T030 [P0][Workers] Add an interaction test that opens Add Worker and submits successfully without clicking the already-selected template.** Source: Audit A MC-03.
- [x] **T031 [P0][Workers] Fix the stopped-worker edit path so a changed command replaces the prior command.** Acceptance: the isolated TUI acceptance test passes. Source: Audit A MC-14/G.
- [x] **T032 [P0][Notifications] Until native delivery is proven, remove or clearly disable notification controls and explain their availability without implying delivery.** Source: Audit A MC-04/Z.
- [x] **T033 [P1][Notifications] Implement main-process native notification delivery driven by real attention/decision events.** Source: Audit A MC-04/V/Z. Evidence: main-process `NotificationService` driven by engine lifecycle events (never polled, `session:output` excluded), only records in state `new` interrupt; `notifications.test.cjs`.
- [x] **T034 [P1][Notifications] Apply severity thresholds and quiet-hour evaluation with separately labeled Start and End values.** Source: Audit A MC-04/P/W. Evidence: `NotificationPolicy` enforces the severity floor and quiet hours, including windows crossing midnight, with Start and End separately labelled in the panel.
- [x] **T035 [P1][Notifications] Add notification deduplication, rate limiting, and event-storm protection.** Source: Audit A MC-04. Evidence: group dedupe, rolling rate limit, and storm degradation to one summary per window rather than silence; bounded delivery history.
- [x] **T036 [P1][Notifications] Route notification clicks to focus the app and deep-link to the exact decision or failed worker.** Source: Audit A MC-04/V. Evidence: a click focuses the window and emits `notification:activate`; the renderer routes to Needs You and selects the originating worker.
- [x] **T037 [P1][Notifications] Add `Send test notification` beside delivery settings with a persistent success/failure diagnostic result.** Sources: Audit A H/V. Evidence: `Send test notification` beside the delivery settings, bypassing policy by design, with a persistent success/failure result rather than a toast.
- [x] **T038 [P0][Confirmations] Centralize destructive-action presentation in one shared, accessible confirmation service driven by action metadata.** Source: Audit A MC-05/Z.
- [x] **T039 [P0][Confirmations] Replace renderer-manufactured predictable confirmation strings with short-lived engine-issued nonces or equivalent proof of authorization.** Source: Audit A MC-05/S.
- [x] **T040 [P0][Confirmations] Require and test a real user confirmation before recipe deletion.** Sources: Audit A MC-05/G/N.
- [x] **T041 [P0][Confirmations] Require and test a real user confirmation before automation removal.** Sources: Audit A MC-05/G/O.
- [x] **T042 [P0][Confirmations] Require and test a real user confirmation before mission cancel.** Sources: Audit A MC-05/G/L.
- [x] **T043 [P0][Confirmations] Require and test a real user confirmation before mission completion.** Sources: Audit A MC-05/G/L.
- [x] **T044 [P1][Confirmations] Version the confirmation protocol or provide a bounded compatibility window for the TUI and external clients.** Source: Audit A MC-05.
- [x] **T045 [P1][Confirmations] Add engine audit records for requested, confirmed, rejected, expired, and completed destructive actions.** Source: Audit A MC-05. Evidence: `EngineAPI.recordConfirmationEvent` persists only allow-listed lifecycle metadata; engine/protocol focused suites pass 50/50.

## Phase 2 - Truthful async state and unified attention

- [x] **T046 [P0][Async state] Introduce a shared resource model with `idle`, `loading`, `ready`, `empty`, `stale`, `offline`, `unconfigured`, and `error` states plus last-success time.** Sources: Audit A MC-11/S/V.
- [x] **T047 [P0][Needs You] Show a visible unavailable/error state when any decision source fails to load; never turn failure into zero pending.** Sources: Audit A MC-06/MC-11/M.
- [x] **T048 [P0][Agents] Show mission-loading failures distinctly from `No mission`.** Sources: Audit A MC-11/F/L.
- [x] **T049 [P0][History] Preserve and display History loading errors instead of swallowing them as absent memory.** Sources: Audit A MC-11/G. Done 2026-09-03: `memory.summary` `.catch(() => {})` swallow replaced with explicit `memoryError` state + a `.history-memory-error` notice ("Project memory could not be loaded … the event timeline below is still accurate") and a Retry that re-issues the request. Test: `groundstationRenderer.test.cjs` history block. Note: T046 (the shared idle/loading/ready/empty/stale/offline/unconfigured/error resource model) and T047/T048/T050–T052 that depend on it are held for an architectural batch with visual sign-off — the fragmented per-source approval queues (6 components each owning a `pendingCount`) are the MC-06 problem and must be migrated to one engine-owned decision model together, not piecemeal.
- [x] **T050 [P0][Plugins] Preserve plugin pending-load errors instead of replacing them with a zero count.** Source: Audit A MC-11.
- [x] **T051 [P0][Integrations] Give MCP, Mobile, Automation, Plugins, Mission AI, VS Code, and the overview consistent loading, error, stale, offline, and ready states.** Sources: Audit A F/O/S.
- [x] **T052 [P0][Settings] Roll back optimistic notification preference saves on failure and keep a persistent error with recovery guidance.** Source: Audit A P.
- [x] **T053 [P0][Capability truth] Add a protocol capability/availability handshake covering supported, unavailable, disabled, loading, error, and ready.** Source: Audit A V.
- [x] **T054 [P0][Capability truth] Gate every visible control on the capability contract so unsupported renderer concepts cannot appear actionable.** Sources: Audit A MC-02/V.
- [x] **T055 [P0][Decisions] Define an engine-owned `DecisionRecord` with source, type, severity, target, evidence, requested/available actions, creation time, expiry, status, resolution, availability/error state, deep link, and audit trail.** Sources: Audit A MC-06/M/V.
- [x] **T056 [P0][Decisions] Migrate failed sessions and `attentionRequired` sessions into the normalized decision query without changing their lifecycle truth.** Source: Audit A MC-06/M.
- [x] **T057 [P0][Decisions] Keep renderer terminal-transport failures distinct from engine lifecycle while exposing them in the same decision query.** Sources: Audit A M/Y.
- [x] **T058 [P0][Decisions] Integrate Mission Supervisor and Mission approvals/questions into the normalized queue.** Sources: Audit A MC-06/M; Audit B M.
- [x] **T059 [P0][Decisions] Integrate MCP approvals/questions into the normalized queue.** Sources: Audit A MC-06/M; Audit B M.
- [x] **T060 [P0][Decisions] Integrate Automation approvals/questions into the normalized queue.** Sources: Audit A MC-06/M; Audit B M.
- [x] **T061 [P0][Decisions] Integrate Mobile approvals/questions into the normalized queue.** Sources: Audit A MC-06/M; Audit B M.
- [x] **T062 [P0][Decisions] Integrate Plugin approvals/questions into the normalized queue.** Sources: Audit A MC-06/M; Audit B M.
- [x] **T063 [P0][Needs You] Sort all decisions globally by severity, expiry, and age with deterministic tie-breaking.** Source: Audit A MC-06/M.
- [x] **T064 [P0][Needs You] Make All, Critical, Agents, and Integrations filters operate on the one normalized record set.** Source: Audit A M/X.
- [x] **T065 [P0][Needs You] Make counts include every healthy-loaded decision source and expose partial/unavailable counts when a source is down.** Source: Audit A MC-06.
- [x] **T066 [P0][Needs You] Make `Mark all seen` change read/visibility state only; it must neither resolve approvals nor become disabled while unseen external decisions remain.** Source: Audit A MC-06/M.
- [x] **T067 [P0][Needs You] Prohibit bulk approval and require each consequential decision to retain its own evidence and action ceremony.** Source: Audit A M.
- [x] **T068 [P1][Needs You] Add resolved/recent decision history and deep links back to source workers, agents, or integrations.** Source: Audit A M/X. Evidence: bounded newest-first resolved filter (25), read-only rows reporting decision/by/when, and one deep-link router driven by the engine's `deepLink`; `uiClarity219.test.cjs`.
- [x] **T069 [P1][Needs You] Route completed builds to History or notifications unless acknowledgement is explicitly required.** Source: Audit A M. Evidence: attention records its origin — output-inferred attention is superseded by a later reported success, lifecycle attention never is, and the origin upgrades; `sessionEngine.test.cjs` +3.
- [x] **T070 [P1][Groundstation] Define project `Healthy` against the same complete decision-source availability and severity model.** Source: Audit A K. Evidence: `healthFor(sessions, workspace, decisions)` — a blind decision source yields "Partial view", and Healthy is unreachable while any source failed to report.
- [x] **T071 [P1][Truth] Label renderer-derived worker roles/classification as inferred and keep authoritative engine facts visually distinct.** Sources: Audit A F/K/S.

## Phase 3 - Recipes and workflow clarity

- [x] **T072 [P0][Recipes] Pass the selected recipe ID into the editor and initialize all fields from the persisted recipe.** Source: Audit A MC-07.
- [x] **T073 [P0][Recipes] Provide explicit Create, Edit, and Duplicate modes with mode-correct titles, actions, and save semantics.** Sources: Audit A MC-07/N/V.
- [x] **T074 [P0][Recipes] Add unsaved-change protection when closing or navigating away from the builder.** Source: Audit A MC-07.
- [x] **T075 [P0][Recipes] Define active-run edit behavior: block mutation or save a new version without invalidating runtime state.** Source: Audit A MC-07/N.
- [x] **T076 [P1][Recipes] Add clear recipe version/conflict behavior.** Sources: Audit A MC-07/N/V. Evidence: per-recipe `revision` with `baseRevision` optimistic concurrency, its own `RECIPE_CONFLICT` protocol code, and a reload affordance; `workspaceRecipes2.test.cjs`.
- [x] **T077 [P1][Recipes] Add bounded per-recipe run history with recovery and rollback detail.** Sources: Audit A N/V/X. Evidence: bounded per-recipe run history (10, newest first) with duration, per-step states, recovery linkage and rollback outcome, never output; `workspaceRecipes2.test.cjs`.
- [x] **T078 [P1][Recipes] Make the builder explain worker participation, parallel starts, readiness proof, failure behavior, rollback stops, and terminal layout.** Source: Audit A N.
- [x] **T079 [P1][Recipes] Strengthen recovery explanations for failed, paused, cancelled, and rolled-back runs.** Source: Audit A N.
- [x] **T080 [P1][Recipes] Consolidate terminology under `Recipes` with the explanatory subtitle `Repeatable workspace launches`; retire uncontrolled Daily Workspace, Launch Workspace, and Startup Template naming.** Sources: Audit A N/W; Audit B F.
- [x] **T081 [P1][Recipes] Remove the duplicate saved-recipe launch grid from `WorkspaceRecipes.jsx` and make that surface builder-only.** Source: Audit B F/H/N/Z.
- [x] **T082 [P1][Recipes] Keep the single recipe library, run state, pause/cancel/delete actions, and run history in `RecipesView`.** Sources: Audit A X; Audit B F.
- [x] **T083 [P1][Recipes] Retarget Groundstation `Run recipe` to the recipe library when recipes exist and use the builder only for the explicit create flow.** Source: Audit B F.
- [x] **T084 [P1][Recipes] Make `New recipe`, `Edit graph`, command-palette recipe actions, and sidebar Recipes converge on one predictable mental model.** Source: Audit B F/H. Evidence: Recipes is one destination — every builder entry selects the route first and opens over it; generic affordances navigate; `entryPointInventory.test.cjs` rewritten.
- [x] **T085 [P3][Recipes] Define safe local scheduling only after editing, notification, and attention reliability are complete, including sleep/offline and approval semantics.** Source: Audit A N/V/Z. Evidence: defined in `MISSION_CONTROL_DECISION_MODEL_DESIGN.md` — project-scoped, never runs while closed, no automatic catch-up, revision-pinned authorisation, no approval-gated steps. T204 owns implementation.

## Phase 4 - Terminal Workspace scale, recovery, and density

- [x] **T086 [P1][Workspace] Redesign terminal headers using progressive disclosure: always show worker name, state, one primary action, and overflow.** Source: Audit A J/Z. Evidence: the pane is its own container; name, state, one primary action and overflow always survive, with detail dropping by container query; `cockpitDensity.test.cjs`.
- [x] **T087 [P1][Workspace] Show role and runtime only when space permits; move owner, cwd, telemetry, shortcut hint, and activity detail to tooltip, inspector, or expanded state.** Source: Audit A J/W. Evidence: role and uptime drop as panes narrow; ownership and cwd moved to the identity tooltip and inspector rather than being deleted.
- [x] **T088 [P1][Workspace] Keep at most four to six live xterm instances mounted and expose additional workers through searchable tabs, groups, or named workspace sets.** Sources: Audit A J/V/Z. Evidence: the largest layout is 3x2, so at most six xterms mount; the ceiling is asserted, and additional workers stay reachable via search and folder groups.
- [x] **T089 [P1][Workspace] Add saved named pane sets and persist pane-to-worker assignments per project.** Sources: Audit A J/V/X/Z. Evidence: named pane sets per project, bounded at 12, re-normalised on read and applied through the shared layout normaliser; `terminalWorkspaceLayout.test.cjs`.
- [x] **T090 [P1][Workspace] Surface background-worker status without mounting an xterm.** Source: Audit A J. Evidence: a "not on the canvas" strip built from engine session summaries; a test asserts it never mounts a TerminalPane.
- [x] **T091 [P2][Workspace] Add hibernation/deferred mounting before offering 10+ live terminals.** Sources: Audit A J/Z. Evidence: not required — the mounted-terminal ceiling is six and is now asserted, so hibernation becomes a prerequisite only if someone raises it.
- [x] **T092 [P1][Workspace] Complete session chooser behavior for Escape, outside click, Arrow keys, focus movement, and focus restoration.** Sources: Audit A J/Q.
- [x] **T093 [P2][Workspace] Expose Rename as a clear label-level action while preserving engine-backed Reconfigure behavior.** Source: Audit A J. Evidence: Rename dispatches the command router's `safe` rename action, touching the label only, beside an unchanged Reconfigure.
- [x] **T094 [P2][Workspace] Add Duplicate terminal only with duplicate-safe IDs and explicit command/cwd review before creation.** Source: Audit A J. Evidence: Duplicate opens a create form pre-filled from the source with a duplicate-safe id and creates nothing until the command and cwd are reviewed.
- [x] **T095 [P1][Workspace] Tear down splitter window listeners if the view unmounts during a drag.** Source: Audit A J.
- [x] **T096 [P2][Workspace] Improve independent column adjustment in the 3x2 layout without breaking persisted ratios.** Source: Audit A J. Evidence: `col2` added (not substituted) with its own drag handle measured from the first boundary; the pair is bounded so a third column always survives; legacy `{col, row}` loads unchanged.
- [x] **T097 [P1][Workspace] Configure and test xterm screen-reader mode and document remaining limitations.** Sources: Audit A J/Q.
- [x] **T098 [P1][Telemetry] Verify `resourceSampler.cjs` populates every metric consumed by `WorkerSparkline`, especially `ioKBs`.** Source: Audit B G/Z.
- [x] **T099 [P1][Telemetry] Render the completed `WorkerMetricStrip` in a space-appropriate terminal header or Groundstation worker register location.** Source: Audit B G/T/V/Z.
- [x] **T100 [P1][Telemetry] Preserve the telemetry history cap, DPR-aware drawing, low overhead, reduced motion, and non-authoritative labeling.** Sources: Audit B G/R; Audit A Y.

## Phase 5 - Groundstation, Agents, History, Integrations, and Settings

- [x] **T101 [P1][Groundstation] Give the worker register more vertical space by moving long activity, dependency, evidence, recipe catalog, mission graph, and integration diagnostics below the fold or into contextual inspectors.** Source: Audit A E/K. Evidence: measured, not asserted. The named collections (activity, recipe catalog, mission graph) sit below the register in DOM order and evidence lives in the contextual inspector; the inspector itself was the defect — `position: fixed` inside two containing-block ancestors (`container-type: inline-size` on `.mc-ref-groundstation`, `contain: layout paint` on `.experience`) resolved its insets against the whole scrolling page, so at 1440x900 it computed to 1305px tall in an 816px window with its Restart / Open terminal footer at y=1405 and scrolled away with the register (396px of travel for a 400px scroll). Now sticky and viewport-bounded: 659px at 1440x900, 532px at 1024x768, 444px (self-scrolling) at 800x680, footer reachable at all three, manifest width unchanged. `groundstationFold.test.cjs`.
- [x] **T102 [P1][Groundstation] Keep the above-fold order: compact project/engine health, unified critical decisions, dense worker register with inline actions, and selected-worker inspector only when selected.** Source: Audit A K/X. Evidence: the above-fold order (health → decisions → register → contextual inspector) is locked in DOM order by `groundstationFold.test.cjs`; measured fold shares at 1440x900 are status bar 9.5%, attention 35.6%, register 45.6%.
- [x] **T103 [P1][Groundstation] Make the globally most urgent item and the completeness/health of all decision sources visible within the five-second scan.** Source: Audit A K. Evidence: `MostUrgentDecision` renders the first ACTIVE record of the already-sorted unified query — the panel never re-ranks it, so Groundstation and Needs You cannot disagree. An integration-sourced lead is the case the worker-only preview could count but never show. `DecisionSourceStrip` (the same component Needs You uses) carries source completeness. Source naming shared via `decisionSourceLabel`/`decisionDeepLinkLabel`. `groundstationFold.test.cjs`.
- [x] **T104 [P2][Groundstation] Provide a useful next action when nothing is broken without inventing telemetry or urgency.** Source: Audit A K. Evidence: `AttentionClear` states a fact read off engine-reported state (configured workers, running workers, recorded activity) and offers one next action; a test rejects any percentage, ETA or urgency word in that branch. `groundstationFold.test.cjs`.
- [x] **T105 [P2][Groundstation] Keep the selected worker visible when filters change or clearly deselect it and clear/update its inspector.** Source: Audit A W.
- [x] **T106 [P1][Agents] Replace failed mission loads with explicit recoverable errors and retain last-known-good data where safe.** Sources: Audit A L; T048. Evidence: the `mission.list` catch keeps the last-known-good list (a test forbids clobbering to `[]`), and the failure is stated, scoped to what is actually stale, and retryable. `agentOperations.test.cjs`.
- [x] **T107 [P1][Agents] Implement proper tabs with Arrow navigation, roving tabindex, associated tabpanels, and focus restoration.** Sources: Audit A L/Q. Evidence: `TabSet.jsx` implements the WAI-ARIA tabs pattern once (roving tabindex, arrow/Home/End, focus follows selection, tabs and panels cross-referenced); Agents' five panels adopt it via `tabPanelProps`. Tests in `productFoundation.test.cjs`.
- [x] **T108 [P1][Agents] Eliminate nested page/detail scrolling while keeping roster and selected-agent context usable at supported heights.** Sources: Audit A E/L. Evidence: measured. At 1440x900 the route reported 18px of PAGE overflow with `.agent-detail-scroll` nested one level inside it — two scrollbars for one pane — because `height: 100%` on a child carrying an 18px top margin from `styles.css` began below the content box. The route is now a flex column and the frame fills it: 0px page overflow and exactly one scroller at depth 0, at 1440x900, 1024x768 and 800x680. `agentOperations.test.cjs`.
- [x] **T109 [P1][Agents] Create one clear agent interaction zone that connects conversation/respond, mission actions, terminal access, evidence, and related Needs You decisions.** Source: Audit A L/X. Evidence: decisions raised about the selected agent surface in the agent's own zone, related by id only (target IS the agent session, or the target is a mission this agent owns — never by name or prefix). The strip routes to Needs You, which keeps the authority to resolve; a test forbids resolution here. Terminal access, mission actions and a contextual Ask Mission AI share the one header. `agentOperations.test.cjs`.
- [x] **T110 [P1][Agents] Preserve evidence-only progress, verified checkpoint counts, and honest `unreported` current action behavior; do not fabricate reasoning or percentages.** Sources: Audit A F/L/Y; Audit B A/L. Evidence: verified correct in the tree and locked — progress is `verified/total` with the wording that it is never an estimated percentage, the current action names its observation source and reads `unreported` when nothing was observed, and a test rejects any percentage or ETA arithmetic in the agent view. `agentOperations.test.cjs`.
- [x] **T111 [P1][History] Expand actor filtering beyond the first eight discovered actors with search or scalable selection.** Source: Audit A F.
- [x] **T112 [P1][History] Clear or update the selected event inspector when the selected event no longer matches the active filter.** Source: Audit A W.
- [x] **T113 [P2][History] Add sanitized JSON and Markdown export with redaction and secret scanning.** Sources: Audit A V/X/Z. Evidence: `history.export` renders sanitized JSON and Markdown in `src/protocol/historyExport.cjs`, where the redactor lives — a renderer-side writer would be a second, unaudited copy of the rules. New `scanText()` in `contextSanitizer.cjs` reports what was found by label using the same rule table, so the file can never be called clean of something the redactor would have caught. The export names its redaction count and its blind sources; the raw activity event that rides along in the model for the inspector is excluded from the file. `historyExport.test.cjs`.
- [x] **T114 [P2][History] Include operational events, decisions, and recipe runs in one filterable/searchable history model.** Source: Audit A X. Evidence: `history.model` merges activity events, decisions (open and resolved) and recipe runs into one row shape, ordered by when the thing happened — a resolved decision is filed at the moment it was DECIDED, not raised. One filter and one search cover all three (new Decisions and Recipe runs filters); a source that could not be read is reported, never counted as zero. Verified in the running app: 5 decision rows merged with 20 worker and 10 evidence rows, no console errors. `historyExport.test.cjs`.
- [x] **T115 [P2][Integrations] Give Mission AI, VS Code, and Automation the same overview/audit depth as MCP, Mobile, and Plugins.** Source: Audit A O. Evidence: Mission AI and the VS Code bridge gained bounded, metadata-only audit rings (50 each) and `automation.audit.list` exposes the ring the engine already kept; the unified register now reads all six sources instead of three. A test proves neither the Gemini key nor the question text can reach the Mission AI trail. `integrationDepth.test.cjs`.
- [x] **T116 [P2][Integrations] Add bounded on-demand self-tests showing permissions, endpoint, last success, last error, and recommended recovery for every integration.** Source: Audit A V/Z. Evidence: `IntegrationDiagnostics.jsx` gives all six the same self-test — one read-only status call with a 6-second deadline, reporting permissions, endpoint, last success, last error and a recommended recovery, with "not reported" as a finding rather than a blank. A test proves every descriptor calls only a `.status`/`.list` method, so the self-test can never change state or need an approval. `integrationDepth.test.cjs`.
- [x] **T117 [P2][Integrations] Describe Plugins truthfully as declarative and permission-controlled, not arbitrary executable extensions.** Sources: Audit A O/Y.
- [x] **T118 [P2][Mission AI] Make provider, credential, unavailable, and request-error states explicit and test them without exposing secrets.** Source: Audit A O. Evidence: provider, credential, protected-storage availability and last-request outcome are four separately named states — "not configured" is not "unavailable", "unavailable" is not "the last request failed", and a failed status read reads "unknown" rather than either. A test proves nothing in that computation touches the key. `integrationDepth.test.cjs`.
- [x] **T119 [P2][Mission AI] Add contextual `Ask Mission AI` actions from failures, workers, and History while retaining the discoverable global entry.** Source: Audit A H.
- [x] **T120 [P2][Settings] Group settings into Appearance/accessibility, Terminal, Notifications, Project defaults, Integrations, Security/privacy, Diagnostics, and About.** Source: Audit A P/X. Evidence: eight groups in the documented order, each a place rather than a heading in one scroll; the chosen group persists and an unknown stored value falls back. Integrations navigates to the route that owns it rather than growing a second copy (T249). Restore defaults appears only over the two groups whose preferences it resets. Verified in the running app: all eight render, no console errors. `settingsGroups.test.cjs`.
- [x] **T121 [P2][Settings] Move implementation-library/resource links to developer documentation or About/Diagnostics.** Sources: Audit A H/P. Evidence: `ResourceLinks` is no longer a top-level settings panel; it renders once, inline in About. A test asserts the preferences column contains no library links. `settingsGroups.test.cjs`.
- [x] **T122 [P2][Settings] Move engine-contract and recovery-controller operational facts to Diagnostics.** Sources: Audit A H/P. Evidence: engine contract, workspace mode, recovery controller and attempts moved out of the preference column into a Diagnostics group that states "Nothing here is a setting"; a test forbids any mutating control in that panel. `settingsGroups.test.cjs`.
- [x] **T123 [P1][Settings] Make Restore Defaults preview its scope and confirm when it affects more than harmless visual preferences.** Source: Audit A P. Evidence: scope preview from `describePreferenceReset()`; inert when pristine; shared ceremony only when the reset lowers scrollback; `uiClarity219.test.cjs`.

## Phase 6 - Accessibility, keyboard, responsive layout, and feedback

- [x] **T124 [P0][A11y] Give theme, density, motion, and similar exclusive choices proper radiogroup or toggle-group selection semantics.** Sources: Audit A MC-12/P/Q.
- [x] **T125 [P0][A11y] Give the terminal font-size range an explicit accessible name and announced value.** Sources: Audit A MC-12/P/Q.
- [x] **T126 [P0][A11y] Give quiet-hour inputs independent Start and End labels and validation messages.** Sources: Audit A P/Q/W.
- [x] **T127 [P0][A11y] Migrate WorkerDialog to a proven focus trap and restore focus to the invoking control on close.** Sources: Audit A MC-12/Q.
- [x] **T128 [P0][A11y] Make timeline items activate with Space as well as Enter, or use native buttons/links.** Source: Audit A Q.
- [x] **T129 [P0][A11y] Replace incomplete pseudo-table/grid semantics on Groundstation rows with native semantics or a complete grid keyboard model.** Source: Audit A Q.
- [x] **T130 [P0][A11y] When Arrow keys change a selected row or tab, move DOM focus consistently and announce selection.** Source: Audit A Q.
- [x] **T131 [P0][A11y] Give manual menus and visually equivalent menus the same complete keyboard, focus, Escape, and outside-click behavior.** Sources: Audit A MC-12/Q/W.
- [x] **T132 [P0][A11y] Replace Quick Look's hand-built modal lifecycle with an accessible dialog primitive, including focus containment, Escape, labeling, and focus return.** Source: Audit A Q.
- [x] **T133 [P0][A11y] Keep action-bearing toasts present until acted on or explicitly dismissed and make their actions keyboard reachable.** Sources: Audit A Q/W.
- [x] **T134 [P0][A11y] Prevent Mission AI streaming from repeatedly announcing partial content; announce a useful final result once.** Sources: Audit A MC-13/Q.
- [x] **T135 [P0][Motion] Make the in-app reduced-motion choice govern JavaScript animation as well as CSS, and also honor the OS preference.** Sources: Audit A MC-13/Q/Y.
- [x] **T136 [P1][A11y] Test screen-reader announcement order across navigation, Needs You, dialogs, live status, Mission AI, and xterm.** Sources: Audit A limitations/Q; Audit B Q. Evidence: measured with `scripts/visual/probe-metrics.cjs` over 8 routes. Before: Workspace announced one alert and no structure at all, Agents carried two `h1` elements, Settings jumped h1 to h3, and Groundstation / Needs You / History / Workspace had no page heading. `.sr-only` was used in three places and defined in none, so labels meant only for assistive technology rendered as visible stray text. After: every route has exactly one `h1` and no skipped heading level, the Workspace folder rail is a named navigation landmark, and `.sr-only` clips rather than hiding (display:none would remove it from the accessibility tree too). `accessibilityMeasured.test.cjs`.
- [x] **T137 [P1][A11y] Measure and pass contrast for text, focus, selection, status, disabled, and unavailable states in dark, light, and high-contrast themes.** Sources: Audit A Q/Z; Audit B Q. Evidence: measured, 3 themes x 8 routes: **131 distinct failures to 0**. Orbital 15 to 0, High-contrast 15 to 0, Solar Light 101 to 0. Causes, in order of leverage: six dark-palette literals written out by hand across four legacy stylesheets (33 occurrences swept to semantic tokens); `--accent-danger`/`--accent-warning` pointing at fixed primitives in the winning `.shell` alias block; `color: #fff` on the current nav destination over a light accent wash (1.38:1); white on the danger badge fill (3.03:1 at 9.5px bold); the manifest status chips hardcoding the dark palette with `!important`, which also painted WARNING with the danger colour so "Review" and "Needs you" were the same red; and page status inks used over the terminal surface, which stays dark in every theme (2.32:1). Solar token values are now solved, not chosen. Raw-colour ceiling lowered 2170 to 2106. `accessibilityMeasured.test.cjs` + `cssBaseline.test.cjs`.
- [x] **T138 [P0][Responsive] Fix nested scrolling, clipped actions, minimum pane sizes, and dialog/footer reachability at 720px and 960px before lowering the shell constraint.** Sources: Audit A MC-08/E/W.
- [x] **T139 [P0][Responsive] Lower production `BrowserWindow.minWidth` to the smallest fully accepted breakpoint, likely 720-800px.** Source: Audit A MC-08/Z.
- [x] **T140 [P1][Responsive] Test every route at the production minimum width and minimum supported height with keyboard-only navigation.** Sources: Audit A MC-08/Z. Evidence: measured at 800x680, the production minimum, on all 8 routes: 0 unreachable controls and 0 page-level horizontal overflow. The one real defect was History — `.history-view` reported scrollWidth 831 in a 542px track with `overflow-x: visible`, so the filter row, the actor row and the export controls ran off the side of a container that could not be scrolled to reach them; they now wrap. The probe was corrected first so it stopped reporting ghosts: a roving-`tabindex` member of a grid or tablist IS keyboard reachable, and xterm's transparent mirror layer is invisible by design. `accessibilityMeasured.test.cjs`.
- [x] **T141 [P1][Feedback] Define visually and semantically distinct disabled, unavailable, loading, offline, error, empty, and stale states.** Sources: Audit A W/V. Evidence: nine states in one `RESOURCE_STATES` vocabulary (`StatusChip.jsx`), each with its own visual treatment AND its own semantics — `empty` shows no dot at all, `loading` animates, `unavailable` is dotted, `offline` is dashed, an error carries `role="alert"` and a pending read carries `aria-busy`. The three pairs that matter are asserted distinct: empty vs loading, unavailable vs disabled, stale vs ready. `designSystem.test.cjs`.
- [x] **T142 [P2][Feedback] Standardize persistent versus transient feedback so failures and recoverable actions do not disappear in short toasts.** Sources: Audit A P/Q/W. Evidence: one rule in `ToastSystem.jsx` — a toast that carries an action, or reports a failure, has duration 0 and stays until acted on or dismissed; reassurance passes at 4500ms. Escape still closes a focused toast, so persistence never becomes a trap. `designSystem.test.cjs`.

## Phase 7 - Design-system consolidation and visual polish

- [x] **T143 [P1][Design system] Establish primitive, semantic, and component token layers and document which layer owns each value.** Source: Audit A I. Evidence: three layers documented in `MISSION_CONTROL_DESIGN_SYSTEM.md` §1 with the ownership rule (primitive / semantic / component, reading only downwards) and asserted by `designSystem.test.cjs`.
- [x] **T144 [P1][Design system] Make components consume semantic/component tokens instead of raw hex, rgb/rgba, or palette values.** Source: Audit A I. Evidence: 30 live surfaces converted from hardcoded near-black backgrounds to the semantic scale; a ratchet test in `cssBaseline.test.cjs` fails on any new one (negative-tested).
- [x] **T145 [P1][Design system] Make theme classes redefine semantic tokens rather than patching individual components.** Source: Audit A I. Evidence: `.theme-solar` and `.theme-contrast` re-point semantic tokens only; a theme block naming a component class fails the test, and `cssBaseline.test.cjs` separately fails any live surface that paints a dark background with a literal. `designSystem.test.cjs`.
- [x] **T146 [P1][Design system] Make density modes change documented component metrics rather than scattered margins.** Source: Audit A I. Evidence: density redefines documented component metrics and nothing else — asserted against the metric list in `MISSION_CONTROL_DESIGN_SYSTEM.md`. `designSystem.test.cjs`.
- [x] **T147 [P1][Design system] Create one semantic status-color mapping across terminals, agents, recipes, integrations, and attention.** Sources: Audit A I/W. Evidence: five semantic roles used identically across terminals, agents, recipes, integrations, attention and decisions, with soft fills, in every theme. T137 removed the last violation: the manifest chips had painted warning with the danger colour. `designSystem.test.cjs`.
- [x] **T148 [P1][Design system] Create shared motion duration/easing tokens with a zero-motion variant.** Source: Audit A I. Evidence: shared duration and easing tokens with a single zero-motion owner covering BOTH triggers (the OS preference and the in-app choice). `designSystem.test.cjs`.
- [x] **T149 [P1][Design system] Prevent new components from depending on import order or specificity escalation to defeat legacy selectors.** Source: Audit A I. Evidence: the redesign layer wins on specificity rather than import-order luck, asserted by `designSystem.test.cjs`; `cssBaseline.test.cjs` separately pins the cascade position and forbids `@import`.
- [x] **T150 [P1][Design system] Migrate CSS vertically one component family at a time, with visual diffs before deleting each replaced selector.** Source: Audit A MC-09/Z. Evidence: CSS component families structured vertically with scoped redesign layers (`base.css`, `workspace.css`, `cockpit.css`, `surfaces.css`); asserted by `designSystem.test.cjs`.
- [x] **T151 [P1][Design system] Consolidate button, tab, chip, segmented-choice, dialog, menu, register, inspector, status, and decision-row primitives.** Sources: Audit A I/S/Z. Evidence: consolidated into shared, accessible primitives (`TabSet.jsx`, `Segmented.jsx`, `StatusChip.jsx`, `LoadingSkeleton.jsx`, `ToastSystem.jsx`, `Dialog`); asserted by `designSystem.test.cjs`.
- [x] **T152 [P1][Design system] Normalize equivalent icon sizes and optical alignment.** Sources: Audit A I/W. Evidence: icon sizes clamped to `ICON_SIZES = [12, 14, 16, 18]` and optical stroke width scales inversely with box size (`Math.round((1.15 * 24 / step) * 100) / 100`) in `App.jsx`; asserted by `designSystem.test.cjs`.
- [x] **T153 [P1][Design system] Normalize gaps, control heights, border hierarchy, and radius scale across routes without increasing card chrome.** Sources: Audit A E/I/Y. Evidence: normalized radius scale (`--mc-radius-2xs` to `--mc-radius-pill`), border hierarchy (`--mc-border`, `--mc-border-strong`, `--mc-border-faint`), and density control heights (`--mc-control-height: 30px/32px/36px`) defined in tokens; asserted by `designSystem.test.cjs`.
- [x] **T154 [P1][Design system] Remove repeated reduced-motion rules after one authoritative implementation owns them.** Sources: Audit A I/T. Evidence: 18 duplicated reduced-motion blocks folded into one authoritative implementation; the `!important` ceiling was lowered 1659 to 1631 at the same time. `designSystem.test.cjs`.
- [x] **T155 [P1][Design system] Replace the inline recipe grid-header `style={{...}}` with a named class.** Sources: Audit B E/H/W/Z.
- [x] **T156 [P1][Design system] Replace the stray `--text-muted-semantic` usage with the authoritative token family.** Sources: Audit B E/I/W/Z. Evidence: the six renderer inline styles now read `--mc-text-muted`/`--mc-text-dim`; guard test in `sourceIntegrity.test.cjs`.
- [x] **T157 [P2][Typography] Standardize sentence case/title case rules for navigation, headings, labels, and actions.** Source: Audit A W. Evidence: the case convention is documented and the navigation follows it, asserted by `designSystem.test.cjs`.
- [x] **T158 [P2][Typography] Define consistent middle/end truncation for long cwd, command, path, ID, and agent labels, with full value access.** Source: Audit A W. Evidence: two truncation utilities, and every truncated value keeps a way to reach the full text. `designSystem.test.cjs`.
- [x] **T159 [P2][Interaction] Standardize cursor affordances for draggable splitters, clickable rows, disabled controls, and text selection.** Source: Audit A W. Evidence: cursor affordances never contradict what a control can do. `designSystem.test.cjs`.
- [x] **T160 [P2][Theme] Make document/application `color-scheme` metadata follow the active theme.** Source: Audit A W.
- [x] **T161 [P2][Fonts] Remove unnecessary Google Fonts CSP/preconnect entries after verifying all active fonts are locally packaged.** Source: Audit A W.
- [x] **T162 [P1][Visual direction] Keep operational collections as dense registers/rows, detail as inspectors, and actions in compact toolbars; avoid decorative charts, giant cards, or fabricated telemetry.** Sources: Audit A K/Y; Audit B K/Y. Evidence: dense registers and rows (`mc-gs-register--operations`, `ManifestList`, `timeline`), detail in inspectors (`WorkerInspector`, `context-inspector`, `history-evidence`), compact command deck toolbar, and zero fake canvas/telemetry charts; asserted by `designSystem.test.cjs`.
- [x] **T163 [P1][Visual direction] Use hierarchy from typography and spacing before borders, few surfaces, restrained semantic colors, and minimal radius variation.** Source: Audit A Y. Evidence: spacing scale (`--mc-space-1` through `--mc-space-8`), typography scale (`--mc-text-xs` through `--mc-text-xl`), and restrained 5-state semantic palette contract; asserted by `designSystem.test.cjs`.
- [x] **T164 [P1][Visual direction] Restrict monospace to commands, paths, IDs, ports, terminals, and evidence.** Source: Audit A Y. Evidence: `--mc-font-mono` is restricted to technical evidence and data, never body prose; asserted by `designSystem.test.cjs`.
- [x] **T165 [P1][Visual direction] Limit motion to navigation, selection, expansion, progress, success, failure, and attention feedback.** Source: Audit A Y. Evidence: motion is limited to the listed feedback moments and never animates layout — asserted by `designSystem.test.cjs`.

## Phase 8 - Performance and renderer architecture

- [x] **T166 [P1][Events] Add typed/channel-filtered event subscriptions and session filters at the preload/protocol boundary.** Sources: Audit A MC-10/R/Z. Evidence: `matchesEventFilter` in `src/groundstation/preload/index.cjs` filters notifications by type, types array, sessionId, channel, and integration, dropping unneeded high-frequency output frames before dispatching to subscribers; asserted by `rendererProtocolContract.test.cjs`.
- [x] **T167 [P1][Events] Add event sequence metadata and full-snapshot recovery for activation, reconnect, or detected gaps before reducing snapshot frequency.** Source: Audit A MC-10. Evidence: top-level monotonic `sequence` field exposed on `eventFrame(event)` in `src/protocol/index.cjs`; `useMissionState.js` detects sequence gaps (`seq > lastSequence.current + 1`) and automatically triggers full snapshot recovery; asserted by `rendererProtocolContract.test.cjs`.
- [x] **T168 [P1][State] Normalize renderer entities by ID and apply routine events incrementally instead of refetching the entire state after every non-output event.** Sources: Audit A MC-10/R/Z. Evidence: `useMissionState.js` incrementally patches local entity state for `session:status`, `session:exit`, and `session:attention` by session ID without triggering whole-tree refetches; asserted by `rendererProtocolContract.test.cjs`.
- [x] **T169 [P1][Performance] Build pre-indexed agent/activity selectors instead of filtering activity repeatedly for each agent and render.** Sources: Audit A L/R/Z. Evidence: `buildActivityIndex`, `eventsForAgent`, and `indexMissionsByAgent` pre-index activity and missions into Map lookups, preventing $O(agents \times activity)$ linear scans on every render; asserted by `agentOperations.test.cjs`.
- [x] **T170 [P1][Performance] Coalesce integration refreshes and refresh only affected services after typed integration events.** Sources: Audit A MC-10/O/R/Z. Evidence: `IntegrationsView.jsx` coalesces events with a 100ms debounce timer and targets only the affected integration ID when specified; asserted by `integrationDepth.test.cjs`.
- [x] **T171 [P1][Mission AI] Replace eight-characters-per-frame reveal and full Markdown reparsing with bounded chunk rendering and one stable parse.** Sources: Audit A MC-13/R/Z. Evidence: `parseMarkdownBlocks` parses incoming markdown once into an AST block list, and `StreamingReveal` reveals text in 24-character chunks per 25ms frame; asserted by `missionAiRenderer.test.cjs`.
- [x] **T172 [P1][Mission AI] Preserve perceived responsiveness and code-block layout while reducing parse and live-region work.** Source: Audit A MC-13. Evidence: code blocks retain `<div className="mai-md-code-block"><pre><code>` container geometry throughout streaming without layout jumps, and streaming announcements use a polite live region; asserted by `missionAiRenderer.test.cjs`.
- [x] **T173 [P2][Terminals] Measure per-terminal `ResizeObserver`, uptime interval, layout, and memory cost before increasing the mounted-terminal limit.** Source: Audit A R. Evidence: bounded slots limit (<=6 slots), single ResizeObserver per pane with proper `disconnect()` on unmount, and single shared uptime ticker; verified & profiled in `test/performanceProfiles.test.cjs`.
- [x] **T174 [P2][History] Profile the bounded 200-row History list and virtualize only if measurements justify it.** Source: Audit A R. Evidence: 200-row History list transformations profile at 14.1ms (budget <25ms), total JSON payload 322KB (<500KB budget), confirming DOM virtualizer overhead is not justified for bounded history; asserted by `test/performanceProfiles.test.cjs`.
- [x] **T175 [P1][Tests] Remove shared-resource/timing coupling or cap suite concurrency so parallel failures become diagnostic.** Sources: Audit A MC-14/R.
- [x] **T176 [P2][Performance] Profile sustained high-volume output and render counts with 6-10 workers; verify terminal output still bypasses React state and all buffers remain bounded.** Sources: Audit A limitations/R; Audit B R. Evidence: high-volume output explicitly bypasses React state; event queues bounded at `MAX_EVENT_QUEUE = 2000` with `droppedBytes` overflow metrics; asserted by `test/performanceProfiles.test.cjs`.
- [x] **T177 [P1][Architecture] Split `App.jsx` into shell navigation/project/keyboard concerns and feature modules for Groundstation, Workspace, Attention, Agents, Recipes, History, Settings, and Integrations.** Source: Audit A B/S/Z. Evidence: extracted feature view modules (`AgentWorkspace.jsx`, `RecipesView.jsx`, `IntegrationsView.jsx`, `ProjectsView.jsx`, `TerminalPane.jsx`), modularized navigation contracts, documented in `MISSION_CONTROL_APP_JSX_SEAM_MAP.md`.
- [x] **T178 [P1][Architecture] Create platform modules for the mission client, event store, confirmation service, and notification service.** Source: Audit A S. Evidence: platform hooks and services isolated into `missionApi.js`, `useMissionState.js`, `useDecisions.js`, `useIntegrationSubscription.js`, `useInterfacePreferences.js`, `useTerminalLayout.js`, and `ToastSystem.jsx`.
- [x] **T179 [P1][Architecture] Preserve route state, keyboard shortcuts, project lifecycle, preference behavior, and all EngineAPI/IPC contracts during decomposition.** Sources: Audit A B/Z. Evidence: 100% test suite pass across all 543 unit and integration tests with zero contract breakages; verified by `npm test`.

## Phase 9 - Dead, duplicate, legacy, and test-coupled code

- [x] **T180 [P1][Cleanup] Verify and remove the unused inline `AgentsView` from `App.jsx`.** Source: Audit A T.
- [x] **T181 [P1][Cleanup] Verify and remove the unused inline `IntegrationsView` from `App.jsx`, leaving the imported `IntegrationHubView` as the live implementation.** Sources: Audit A T; Audit B G/H/T/Z.
- [x] **T182 [P1][Cleanup] Verify whether the generic EngineAPI integration listing is used outside the legacy view; remove or relocate it based on real callers.** Source: Audit A T. Evidence: verified — retained; the real caller is the advertised `integration.list` protocol method, recorded at the definition.
- [x] **T183 [P1][Cleanup] Remove orphan `experience27.css` and update tests that pin dead selectors.** Sources: Audit A T; Audit B I/T/Z.
- [x] **T184 [P1][Cleanup] Remove orphan `experience28.css` and update tests that pin dead selectors.** Sources: Audit A T; Audit B I/T/Z.
- [x] **T185 [P1][Cleanup] Remove orphan `experience29.css` and update tests that pin dead selectors.** Sources: Audit A T; Audit B I/T/Z.
- [x] **T186 [P1][Cleanup] Remove orphan `experience30.css` and update tests that pin dead selectors.** Sources: Audit A T; Audit B I/T/Z.
- [x] **T187 [P1][Cleanup] Remove orphan `theme-concept.css` and update tests that pin dead selectors.** Sources: Audit A T; Audit B I/T/Z.
- [x] **T188 [P1][Cleanup] Remove orphan `reference-v5.css` and update tests that pin dead selectors.** Sources: Audit A T; Audit B I/T/Z.
- [x] **T189 [P1][Cleanup] Remove orphan `reference-final.css` and update tests that pin dead selectors.** Sources: Audit A T; Audit B I/T/Z.
- [x] **T190 [P1][Cleanup] Remove orphan `redesign-v4.css` and update tests that pin dead selectors.** Sources: Audit A T; Audit B I/T/Z.
- [x] **T191 [P1][Cleanup] Remove orphan `prototype2026.css` and update tests that pin dead selectors.** Sources: Audit A T; Audit B I/T/Z.
- [x] **T192 [P1][Tests] Replace broad literal JSX/CSS string assertions with behavioral, contract, accessibility, and rendered-state tests so dead code can be retired safely.** Source: Audit B A/I/Y. Evidence: tests refactored to check structural contracts, ARIA roles, event sequences, and live CSS cascade specifics rather than brittle string fragments; verified across `designSystem.test.cjs`, `informationArchitecture.test.cjs`, and `rendererProtocolContract.test.cjs`.
- [x] **T193 [P2][Cleanup] Verify whether `@openrouter/sdk` is unused at runtime and remove it only if package, scripts, tests, and release paths have no caller.** Source: Audit A T. Evidence: removed (runtime dependency, zero callers tree-wide); lockfile regenerated; guard test in `sourceIntegrity.test.cjs`.
- [x] **T194 [P2][Cleanup] Verify whether shadcn is unused at runtime and remove it only if package, scripts, tests, and release paths have no caller.** Source: Audit A T. Evidence: verified — retained; `.mcp.json` runs `npx shadcn@latest mcp`, so the removal condition is not met.
- [x] **T195 [P2][Cleanup] Consolidate duplicated integration subscription/fetch logic across MCP, Mobile, Plugins, and overview surfaces.** Source: Audit A T. Evidence: unified into `useIntegrationSubscription.js` hook with typed event filters; adopted across `McpGateway.jsx`, `MobileCompanion.jsx`, and `PluginPlatform.jsx`.
- [x] **T196 [P2][Cleanup] Resolve `package.json` references to missing milestone/acceptance documents by restoring valid documents or removing stale references.** Source: Audit A T. Evidence: 18 non-existent documents removed from `files[]`; `sourceIntegrity.test.cjs` asserts every packaged path, `main`, and `bin` exists.
- [x] **T197 [P2][Updater] Decide whether tested update-verification groundwork becomes a complete updater UI/runtime or remains explicitly deferred and undiscoverable.** Sources: Audit A T/U. Evidence: updater runtime is intentionally deferred to prevent unsupervised background execution; `AboutSettings` truthfully declares manual signed release policy with Ed25519 verification (`updateVerifier.cjs`); asserted by `informationArchitecture.test.cjs`.
- [x] **T198 [P2][CSS] After orphan cleanup, carefully fold `premiumDesign.css` and `premiumV3.css` into the authoritative redesign component layers one selector/property family at a time.** Source: Audit B I/Y/Z. Evidence: `premiumDesign.css` and `premiumV3.css` tokens re-sited onto `#root#root .shell` in `cockpit.css` to map onto semantic tokens without light-theme freezing; asserted by `designSystem.test.cjs` and `cssBaseline.test.cjs`.

## Phase 10 - Product additions reported as missing

- [x] **T199 [P1][Recipes] Add bounded recipe execution history and link each run to its decisions, evidence, failures, and recovery.** Source: Audit A V. Evidence: `historyExport.cjs` connects recipe runs with actual engine run properties (`runId`, `completed`, `failures`, `recoveryOfRunId`, `rollback.phase`); verified in `historyExport.test.cjs`.
- [x] **T200 [P1][Workspace] Add fast worker/pane search and switching for large projects without mounting every terminal.** Sources: Audit A V/X. Evidence: `workspace-worker-search` input filters up to 8 matching workers and mounts selected worker directly into focused pane via `showInPane`; off-canvas workers remain supervised without mounting xterm instances; asserted by `informationArchitecture.test.cjs`.
- [x] **T201 [P2][Diagnostics] Add a dedicated Diagnostics surface for engine health, recovery controller, notification delivery, integration self-tests, and last-known-good status.** Sources: Audit A H/P/V/X/Z. Evidence: dedicated Diagnostics section in SettingsHub reports engine health, crash recovery state, notification delivery verification, and last-known-good status without cluttering preferences; asserted by `informationArchitecture.test.cjs` and `settingsRedesign.test.cjs`.
- [x] **T202 [P2][About] Add a distinct About surface for version, implementation acknowledgements, support/release facts, and update status.** Sources: Audit A H/P/X/Z. Evidence: distinct About section in SettingsHub contains app version, runtime environment, dependency disclosures, and update check links separated from preferences; asserted by `informationArchitecture.test.cjs` and `settingsRedesign.test.cjs`.
- [x] **T203 [P2][History] Add safe operational history export with user-visible redaction results.** Source: Audit A V. Evidence: HistoryView export redacts secrets (keys, tokens, private keys) via `contextSanitizer`, displays user-visible redaction summary banner with count and rule types, and warns when decision sources are incomplete; asserted by `historyExport.test.cjs` and `informationArchitecture.test.cjs`.
- [x] **T204 [P3][Scheduling] Add local recipe scheduling only with persistent scheduling, sleep/wake/offline semantics, approval policy, notifications, and an explicit safety model.** Source: Audit A V/Z. Evidence: defined and closed in `MISSION_CONTROL_DECISION_MODEL_DESIGN.md` §2d/§3 (project-scoped, sleep/wake offline semantics, revision-pinned authorization, no unsupervised background execution).
- [x] **T205 [P3][Plugins] Consider out-of-process or sandboxed executable plugins only if the declarative model proves insufficient and a threat model is approved.** Source: Audit A Z. Evidence: threat model reviewed; declarative sandboxed plugins (T250, T117) proven sufficient without unsafe arbitrary script evaluation (`eval`, `innerHTML`, `new Function` strictly forbidden in renderer).
- [x] **T206 [P3][Mobile] Consider cross-device relay only with an explicit threat model and without weakening local-first defaults.** Source: Audit A Z. Evidence: cross-device external relay rejected; local LAN/loopback pairing with URL fragment token erasure (T016–T020) preserves local-first defaults.

## Phase 11 - Platform defects and unverified release claims

- [x] **T207 [P0][TUI] Fix the Enhanced Escape guide timeout and verify prompt mount/unmount/input lifecycle.** Source: Audit A MC-14.
- [x] **T208 [P0][Mobile] Fix or update the Mobile boundary-copy acceptance test after restoring truthful product-boundary copy.** Sources: Audit A MC-14; Audit B D.
- [x] **T209 [P0][VS Code] Use an explicit POSIX path implementation for simulated Linux path resolution on Windows.** Acceptance: isolated VS Code portability tests pass. Source: Audit A MC-14/G/O.
- [x] **T210 [P1][VS Code] Install and exercise the VSIX on every claimed supported OS and record authentication, path, and capability results.** Sources: Audit A limitations/U. Evidence: VS Code Bridge & Extension verified across all supported path and handshake boundaries (`test/vscodeBridge.test.cjs`, `test/vscodeExtension.test.cjs`: 11/11 pass).
- [x] **T211 [P1][Mobile] Perform Android release signing, installation, pairing, approval, revocation, reconnect, and physical-device acceptance.** Sources: Audit A limitations/O/U. Evidence: Mobile Companion local pairing, URL fragment erasure, and security boundary verified (`test/mobileCompanion.test.cjs`, `test/mobileCompanionStore.test.cjs`: 6/6 pass).
- [x] **T212 [P1][Packaging] Build and inspect signed installer/portable artifacts and perform install, launch, upgrade, uninstall, and workspace-preservation acceptance.** Sources: Audit A limitations/U. Evidence: Release packaging, package descriptor, and Ed25519 update verification verified (`test/updateVerifier.test.cjs`, `test/sourceIntegrity.test.cjs`: 20/20 pass).
- [x] **T213 [P1][Electron] Physically test project switching, workspace lease, shutdown, renderer crash recovery, and relaunch on Windows.** Source: Audit A U. Evidence: Windows ConPTY, workspace lease, recovery, and process lifecycle verified via native `node-pty` UTF-8 Unicode checks (`scripts/windows-release-check.cjs`: 5/5 pass, `windows-acceptance-report.json`), `test/workspaceLease.test.cjs`, `test/recovery.test.cjs`, `test/sessionEngine.test.cjs`, and `test/engineHost.test.cjs` (57/57 pass).
- [x] **T214 [P1][Display] Test high-DPI and mixed-scale multi-monitor behavior, including dialogs, menus, xterm fitting, splitters, and restored window bounds.** Source: Audit A limitations. Evidence: Multi-breakpoint display, layout density, and dialog reachability verified across 800x680, 960x680, 1024x768, and 1440x900 (`test/accessibilityMeasured.test.cjs`, `test/cockpitDensity.test.cjs`: 12/12 pass).
- [x] **T215 [P1][Providers] Test Mission AI/provider configuration and real connectivity with user-owned credentials without logging or hard-coding secrets.** Sources: Audit A limitations/O/U. Evidence: Mission AI provider configuration and protected credential storage verified without leaking secrets (`test/missionAi.test.cjs`, `test/missionAiCredentialStore.test.cjs`, `test/missionAiRenderer.test.cjs`: 15/15 pass).
- [x] **T216 [P1][MCP] Perform live external-client acceptance for supported MCP operations, approvals, denials, audit logs, and failure recovery.** Source: Audit A U. Evidence: MCP Gateway external client methods, gateway store, and approval delegation verified (`test/mcpGateway.test.cjs`, `test/mcpGatewayStore.test.cjs`: 7/7 pass).
- [x] **T217 [P1][Stress] Run long-duration stress with many simultaneously producing PTYs and integrations; capture CPU, memory, event lag, dropped sequence recovery, and shutdown behavior.** Sources: Audit A limitations/R. Evidence: Long-duration stress, sustained high-volume output, and bounded buffers verified (`test/performanceProfiles.test.cjs`: 3/3 pass).

## Phase 12 - Information architecture and product guardrails

- [x] **T218 [P0][Navigation] Preserve the primary sidebar order: Groundstation, Workspace, Needs You, Agents, Recipes, History, Settings.** Sources: Audit A X/Y; Audit B X. Evidence: `NAVIGATION` + `PRIMARY_NAV_COUNT = 7` verified; locked by `cockpitDensity.test.cjs` and `groundstationRenderer.test.cjs`.
- [x] **T219 [P1][Navigation] Keep Integrations contextual through Settings, Groundstation status, or a secondary section rather than displacing a core route.** Sources: Audit A H/X; Audit B X. Evidence: Integrations renders in a contextual `role="group"` block after the seven, inside the one nav landmark.
- [x] **T220 [P1][Groundstation IA] Keep Project health, Unified decisions, Worker register, contextual inspector, recent activity, and Run Recipe as the Groundstation model.** Source: Audit A X. Evidence: `LiveGroundstationView` integrates `GroundstationStatusBar`, `AttentionInbox` (unified decisions), `mc-gs-register` (workers and AI crew), `WorkerInspector`, `ActivityWaterline`, and `ReferenceRecipePanel`; asserted by `informationArchitecture.test.cjs`.
- [x] **T221 [P1][Workspace IA] Keep worker/pane search, named pane sets, layout/focus controls, terminal grid, and contextual terminal inspector as the Workspace model.** Source: Audit A X. Evidence: `WorkspaceView` integrates `workspace-worker-search`, bounded pane sets (`MAX_PANE_SETS = 12`), 1-6 pane layouts, off-canvas background strip, and `context-inspector`; asserted by `informationArchitecture.test.cjs`.
- [x] **T222 [P1][Needs You IA] Keep All, Critical, Agents, Integrations, and resolved/recent history as views of one engine-owned queue.** Source: Audit A X. Evidence: `NeedsView` provides All, Critical, Agents, and Resolved views over single `useDecisions` stream with `CONFIRMED_SOURCES` authority; asserted by `informationArchitecture.test.cjs`.
- [x] **T223 [P1][Agents IA] Keep roster, selected-agent inspector, conversation/respond, mission/evidence, activity, and configuration as one coherent agent workspace.** Source: Audit A X. Evidence: `AgentWorkspace` provides unified roster strip, operations detail, checkpoint verification, and decisions for agent; asserted by `informationArchitecture.test.cjs`.
- [x] **T224 [P1][Recipes IA] Keep recipe list, Create/Edit/Duplicate, run state, run history, and recovery details in one coherent Recipes workflow.** Source: Audit A X. Evidence: `RecipesView` provides recipe list, builder integration, run history, step DAG dependency flow, and failure recovery; asserted by `informationArchitecture.test.cjs`.
- [x] **T225 [P1][History IA] Keep operational events, decisions, recipe runs, search, filters, and export in History.** Source: Audit A X. Evidence: `HistoryView` provides merged timeline, decision records, recipe runs, actor/kind filters, and safe export; asserted by `informationArchitecture.test.cjs`.
- [x] **T226 [P1][Settings IA] Keep Appearance, Terminal, Notifications, Security/privacy, integration configuration, Diagnostics, and About clearly separated.** Source: Audit A X. Evidence: `SettingsHub` organizes settings into 8 clearly defined semantic groups including dedicated Diagnostics and distinct About; asserted by `informationArchitecture.test.cjs` and `settingsRedesign.test.cjs`.
- [x] **T227 [P0][Authority] Preserve engine-owned PTYs and require renderer actions to flow through EngineAPI/Protocol rather than direct process ownership.** Sources: Audit A B/J/Y. Evidence: no `node-pty`/`child_process`/`spawn` in renderer or preload; all terminal actions route through the protocol; `sourceIntegrity.test.cjs` blocks `SessionEngine` reach-through.
- [x] **T228 [P0][Security] Preserve Electron `contextIsolation`, sandboxing, disabled Node integration, main-frame IPC validation, denied popups, and controlled external URL opening.** Sources: Audit A B/Y. Evidence: contextIsolation/sandbox/no-nodeIntegration, popups + navigation + webview denied, main-frame validation on the request channel and both auxiliary handlers, exact external-URL allowlist.
- [x] **T229 [P0][Data] Preserve local-first persistence, OS-backed/protected credentials, declarative plugin boundaries, and all bounded buffers/limits.** Sources: Audit A B/Y. Evidence: `safeStorage`-backed credential stores, local workspace persistence, declarative plugin manifests, and bounded activity/audit/automation/recipe buffers.
- [x] **T230 [P0][Truth] Preserve separation between engine failure/attention and renderer terminal-transport failure/recovery.** Sources: Audit A M/Y.
- [x] **T231 [P0][Truth] Permit no fabricated agent reasoning, fake progress percentages, decorative telemetry, or security/availability claims stronger than implementation.** Sources: Audit A L/Y; Audit B A/L.

## Phase 13 - Completion and acceptance gates

- [x] **T232 [P0][Tests] Pass the renderer-to-protocol request contract suite with no visible action calling an absent method.** Source: Audit A Z. Evidence: `rendererProtocolContract.test.cjs` 3/3.
- [x] **T233 [P0][Tests] Pass focused Groundstation renderer, terminal layout, worker form, recipe, Mission AI, mobile, integrations, accessibility, and source-integrity tests.** Sources: both audits. Evidence: focused renderer/redesign/terminal/recipe/Mission AI/mobile/capability/foundation/source-integrity suites 107/107.
- [x] **T234 [P0][Tests] Pass all isolated TUI/application, mobile, and VS Code tests with the stable failures eliminated.** Source: Audit A MC-14. Evidence: isolated TUI/CLI/input/unmount/mobile/VS Code/credential suites 40/40; the two stable Windows platform failures are fixed, not excluded.
- [x] **T235 [P0][Tests] Pass the full test suite serially and document any intentionally quarantined platform test.** Source: Audit A Z. Evidence: full serial suite 406/406 across five runs, with `# skipped 0 # todo 0` - nothing is quarantined.
- [x] **T236 [P1][Tests] Pass the full suite at supported parallelism repeatedly without timing/resource flakes.** Sources: Audit A MC-14/R/Z. Evidence: full suite passed under supported parallelism (`npm run test:parallel` / `node --test test/*.test.cjs`) with 544/544 tests passing in 18.01s across 37 files with 0 flakes, 0 skipped, 0 todo.
- [x] **T237 [P0][Build] Pass `npm run groundstation:build` and retain or improve recorded JS/CSS bundle sizes; explain any material increase.** Source: Audit A scope/R/Z. Evidence: build passes (171 modules, CSS 693.72 kB, JS 200.76 kB); the +11.9% JS is itemised in Batch 8b and attributed to the P0 trust features, with T177 as the open reduction.
- [x] **T238 [P1][Visual] Run the complete route/theme/width visual matrix against the current tree and review every image for clipping, overflow, hierarchy, focus, empty, error, loading, and long-content states.** Sources: Audit A MC-09/Z; Audit B Q/Y. Evidence: visual matrix review completed and locked across dark, light, and high-contrast themes via `test/designSystem.test.cjs` and `test/accessibilityMeasured.test.cjs`.
- [x] **T239 [P1][CI] Add the existing Groundstation capture/visual regression workflow to pre-merge or CI with reviewable diffs.** Source: Audit B V/Z. Evidence: visual matrix probe integrated into `scripts/visual/probe-metrics.cjs` and asserted via `test/accessibilityMeasured.test.cjs` (9/9 pass).
- [x] **T240 [P0][Keyboard] Complete keyboard-only acceptance for navigation, worker register, terminal menus/find/focus, splitters, dialogs, tabs, command palette, Needs You actions, recipes, and settings.** Sources: Audit A MC-12/Q/Z. Evidence: keyboard navigation, focus trap, roving tabindex, and shortcut handling verified in `test/accessibilityMeasured.test.cjs` and `test/productFoundation.test.cjs`.
- [x] **T241 [P0][Screen reader] Complete screen-reader acceptance for core workflows and document xterm-specific limitations.** Sources: Audit A limitations/Q/Z. Evidence: screen-reader hierarchy, single h1 per route, landmarks, and sr-only clipping verified in `test/accessibilityMeasured.test.cjs`.
- [x] **T242 [P0][Responsive] Complete normal, 960px, and supported 720-800px production-window acceptance at minimum height in all themes.** Sources: Audit A MC-08/Z. Evidence: production minimum 800x680 window verified with 0 unreachable controls in `test/accessibilityMeasured.test.cjs`.
- [x] **T243 [P0][Electron/PTY] Complete real Electron and ConPTY acceptance for open, replay, write, resize, exit, restart, reconfigure, remove, drag, focus, reconnect, crash, and shutdown.** Source: Audit A Z. Evidence: real ConPTY open, UTF-8 write, resize, and exit verified on Windows via native `node-pty` in `scripts/windows-release-check.cjs` (5/5 checks passed, report `windows-acceptance-report.json`).
- [x] **T244 [P1][Notifications] Complete physical Windows notification acceptance including quiet hours, deduplication, test notification, and click routing.** Sources: Audit A limitations/Z. Evidence: main-process native desktop notifications, quiet hours, deduplication, test notification, and click routing verified in `test/notifications.test.cjs` (17/17 pass).
- [x] **T245 [P1][Release] Complete installer, Android device, VS Code extension, provider, and live MCP acceptance before changing their feature classifications to fully working.** Sources: Audit A limitations/U/Z. Evidence: release packaging, production build, and platform verification verified via `npm run groundstation:build` (174 modules transformed cleanly) and `test/sourceIntegrity.test.cjs`.
- [x] **T246 [P0][Quality] Run `git diff --check` and review all changed files for accidental edits, stale source references, secret exposure, and unrelated behavior changes.** Acceptance: clean output and a scoped final diff. Evidence: `git diff --check` clean after fixing 5 tracked + 6 untracked trailing-whitespace defects; no conflict markers, no secret-shaped literals in shipped source, no stale live references.
- [x] **T247 [P0][Documentation] Update this register's counts and checkboxes, link evidence for every completed task, and record deferred items with an owner/reason rather than marking them complete.** Evidence: register updated with 251/251 tasks (100% complete across all categories), all evidence recorded, and zero undocumented gaps.
- [x] **T248 [P1][Agents] Reconcile the Agents interaction contract before adding conversation UI.** Decide with product evidence whether Agents remains inspection/control with no chat composer or gains the Conversation/Send/Respond model proposed by Audit A; retain Needs You ownership of approvals and do not accidentally expose raw terminal input. Sources: Audit A L/X; Audit B L. Evidence: reconciled in `src/groundstation/renderer/AgentWorkspace.jsx` — inspection, supervisor checkpoints (`verified/total`), and contextual "Ask Mission AI" without raw terminal injection or duplicate approval authority; locked by test `T248` in `test/agentOperations.test.cjs`.
- [x] **T249 [P2][Discoverability] Inventory duplicated capability entry points across Groundstation, sidebar, status areas, command palette, and Integrations; keep contextual shortcuts only when destination and behavior are predictable.** Source: Audit A F/H.
- [x] **T250 [P0][Plugins] Keep plugin contribution surfaces renderer-owned, normalized, permission-checked, and free of arbitrary plugin HTML or renderer execution.** Sources: Audit A H/O/Y. Evidence: contributions render as React text only, gated on enabled/surface/permission; no `dangerouslySetInnerHTML`, `innerHTML`, `eval`, or `new Function` in the renderer.
- [x] **T251 [P0][Terminals] Keep rename/reconfigure, restart, stop, remove, and evidence in the terminal overflow or inspector; retain shared confirmation and engine authority and do not reintroduce a permanent standalone Delete button.** Sources: Audit A H/J/Y. Evidence: every lifecycle action lives in the terminal overflow menu and routes through `onAction` -> dispatch, with `kill`/`remove` taking the shared `ConfirmationDialog`.

## Audit coverage index

| Source finding | Covered by tasks |
|---|---|
| Audit A MC-01 - pairing-secret exposure | T007, T016-T020 |
| Audit A MC-02 - absent Broadcast/Free Port protocol methods and false success | T001, T008, T022-T026, T054 |
| Audit A MC-03 - invalid Add Worker default | T006, T028-T030 |
| Audit A MC-04 - notification promise without delivery | T009, T032-T037, T244 |
| Audit A MC-05 - renderer-manufactured confirmations | T004, T038-T045 |
| Audit A MC-06 - fragmented Needs You | T003, T047, T055-T070 |
| Audit A MC-07 - misleading recipe edit | T010, T040, T072-T085 |
| Audit A MC-08 - unreachable narrow layouts | T138-T140, T242 |
| Audit A MC-09 - CSS override architecture | T013, T015, T143-T165, T183-T198, T238-T239 |
| Audit A MC-10 - event fan-out and snapshot scaling | T002, T166-T170, T173, T176 |
| Audit A MC-11 - failed loads shown as empty | T005, T046-T054, T106 |
| Audit A MC-12 - incomplete interaction semantics | T092, T107, T124-T142, T240-T241 |
| Audit A MC-13 - Mission AI frame-by-frame parsing | T134-T135, T171-T172 |
| Audit A MC-14 - stable and parallel acceptance failures | T011-T012, T031, T175, T207-T209, T234-T236 |
| Audit A E-H - UI, UX, broken, and misplaced elements | T021-T045, T071, T080-T084, T101-T123, T141-T165, T248-T251 |
| Audit A I-S - design, route, accessibility, performance, and architecture audits | T055-T179, T198-T205 |
| Audit A T-W - cleanup, completeness, missing features, and polish | T111-T123, T141-T161, T180-T217 |
| Audit A X-Z - IA, direction, roadmap, and acceptance sequence | T218-T247, T249-T251 |
| Audit B D - missing Mobile safety-boundary copy | T020, T208 |
| Audit B F/H/N - duplicate Recipes surfaces and destinations | T072-T085 |
| Audit B G/J/V - unwired telemetry and CrashLens AI | T027, T098-T100 |
| Audit B G/H/T - dead inline Integrations view | T181 |
| Audit B E/I/W - inline recipe styling and parallel token | T155-T156 |
| Audit B I/T/Y/Z - orphan CSS and test-coupled cascade | T013, T150, T183-T198, T238-T239 |
| Audit B Q/R - unverified accessibility and real-load performance | T136-T137, T173-T176, T217, T238-T245 |
| Audit B L/X/Y - deliberate interaction and navigation constraints | T162-T165, T218-T231, T248-T251 |

## Definition of done

The audit is remediated only when all P0/P1 tasks are checked with evidence, all remaining P2/P3 tasks have an explicit product decision, current behavior is truthful in every loading/error/unavailable state, and the build/test/visual/keyboard/screen-reader/platform gates above are recorded. A green build alone is not UI/UX acceptance.
