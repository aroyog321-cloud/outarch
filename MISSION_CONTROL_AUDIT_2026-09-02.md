# Mission Control — Full Codebase Deep Audit (2026-09-02)

**Scope of this pass:** the working tree as it sits on disk right now — which is *not* the last committed state. Every renderer file is modified since commit `7a96f25`, plus 13 new untracked files (`BroadcastBar.jsx`, `ContextSnapshotButton.jsx`, `CrashLens.jsx`, `DecisionItem.jsx`, `IntegrationAuditLog.jsx`, `LoadingSkeleton.jsx`, `PluginContributionSlot.jsx`, `StatusChip.jsx`, `ToastSystem.jsx`, `TrustBoundary.jsx`, `WorkerSparkline.jsx`, `qrGenerator.js`, `src/service/mobileWebCompanion.cjs`) and a new test file (`test/uiClarity219.test.cjs`). Nothing is committed or staged. This audit treats the disk state as ground truth.

**Method:** direct reading of the renderer shell (`App.jsx`, all 1591 lines), every terminal/agent/recipe/integration component, the Electron main process, preload, IPC host, and a sample of the engine/service layer; quantified greps across all 30 renderer CSS files; and a live `node --test test/*.test.cjs` run against the current tree (not the committed baseline).

**Headline finding:** this is not a vibe-coded prototype. It is an unusually disciplined, evidence-driven, security-conscious Electron app — real IPC contracts, `contextIsolation`/`sandbox` hardening, OS-encrypted credentials, confirmation-gated destructive actions, zero fabricated progress bars, zero placeholder/TODO handlers anywhere in `src/`. The actual disease is **cascade accumulation**: five to six successive "redesign layers" stacked on top of each other and never retired, each fighting the last with `!important`, producing ~1,665 `!important` declarations across 21 imported stylesheets and ~4,000 lines of completely dead CSS kept alive only because tests assert their content exists. That is where the UI's "messy" feeling actually comes from — not sloppy components.

---

## A. Executive Summary

Mission Control is a mature, feature-complete local-first developer command center (Electron + React 18 renderer, a shared PTY engine, `node-pty` terminals, a real protocol layer with ~95 IPC methods). The product thinking is genuinely strong: every surface distinguishes *observed engine fact* from *inference* (`workerActivity()`, `evidenceBadges()`, "Progress is a count of verified checkpoints, never an estimated percentage"), every connected capability (Mission AI, VS Code, MCP, Automation, Mobile, Plugins) declares its permission boundary before touching a project, and every destructive action routes through one shared `ConfirmationDialog`. The main process is correctly hardened (`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, IPC requests rejected from non-main frames, an allow-listed `openExternal`, `safeStorage`-encrypted credentials).

The problem is not the product logic. It is presentation debt from **repeated, unretired redesign passes**:

1. **21 CSS files are imported in `main.jsx`**, in a fixed cascade, several of which exist only to out-`!important` the one before it (`premiumV3.css` alone carries 454 `!important` declarations).
2. **9 more CSS files (~4,000 lines) are completely orphaned** — not imported anywhere, kept alive only because test files assert strings inside them (a self-perpetuating dead-code trap: nobody can delete them without first rewriting the tests that pin them).
3. The **renderer test suite pins ~40 KB of literal JSX source strings**, which is why past redesign attempts either got reverted wholesale (see `[[mission-control-redesign-rejected]]`) or had to fight the test suite line-by-line instead of refactoring structure.
4. A handful of **freshly built features are wired only halfway** — a live telemetry sparkline component built and imported but never rendered; a "Ask Mission AI" button inside crash detection that is unreachable because a prop isn't threaded through one intermediate component; a safety-boundary sentence that got silently dropped from Mobile Companion's copy during its latest rewrite (currently a failing test, not yet a merged regression).

None of this requires "redesign increment 6." It requires **retirement of the layers that already lost**, plumbing three prop chains, and restoring one sentence — all far cheaper and far lower-risk than another whole-app pass, which is exactly the kind of change the user has already rejected once (`[[mission-control-redesign-rejected]]`: "you literally messed the whole ui of the app").

## B. Architecture Understanding

```
Electron main (src/groundstation/main/index.cjs)
 ├─ EngineHost → EngineAPI (src/engine/index.cjs, sessionEngine.cjs) — owns every PTY
 ├─ ProjectCoordinator/ProjectRegistry — multi-project switching, persisted recents
 ├─ GroundstationIpcHost (main/ipcHost.cjs) — one request channel, one event channel,
 │    per-webContents Protocol connection (src/protocol/connection.cjs, ~95 methods),
 │    torn down on navigation/crash/destroy
 ├─ Capability services, each store + gateway pair, each behind safeStorage:
 │    MissionAI, MissionSupervisor, SecureMcpGateway, MobileCompanionGateway,
 │    PermissionedPluginPlatform, VSCodeBridge
 └─ RendererRecoverySupervisor + GroundstationRecoveryService — renderer-crash recovery
      with a native "Retry / Close safely" dialog

Preload (src/groundstation/preload/index.cjs)
 └─ contextBridge exposes exactly 4 functions: request, subscribe, openExternal,
      setPendingBadge. No Node API surface reaches the renderer.

Renderer (src/groundstation/renderer/)
 └─ App.jsx (1591 lines) — single-file shell: routing, 8 keyboard-shortcut systems,
      command palette, confirmation dialog, toast system, all "page" components
      inline. Feature panels (TerminalPane, AgentWorkspace, RecipesView,
      WorkspaceRecipes, IntegrationsView, MissionGraph, MissionAI*, McpGateway,
      AutomationWorkflows, MobileCompanion, PluginPlatform) are separate files.
      21 CSS files loaded in a fixed order in main.jsx; a `.shell` div carries
      theme/density/motion/type-scale as class modifiers consumed across all 21.
```

Every renderer feature follows the same trace: **UI event → `missionApi().request(method, params)` → `ipcRenderer.invoke` on a single channel → `GroundstationIpcHost` → per-tab `ProtocolConnection` → engine/service method → response**, and unsolicited state changes arrive over one `EVENT_CHANNEL` the renderer subscribes to. This is consistent everywhere — I did not find a component that reads engine internals directly, bypasses the protocol, or fabricates data when a request fails (failures render an explicit `EmptyState`/error message instead).

## C. UI/UX Health (1–10)

| Area | Score | Basis |
|---|---|---|
| Groundstation | 7 | Strong information architecture (status bar → attention inbox → manifest → activity/recipes/graph), evidence-only badges. Loses points to the CSS cascade fights below, not to its own logic. |
| Terminal Workspace | 7 | Real xterm lifecycle management, replay-on-reconnect, drag-to-move, per-pane resize, CrashLens. Loses points to two unwired features (§G). |
| Needs You | 8 | Single unified queue, correct snooze/lifecycle handling (the NaN-snooze bug is already fixed per the codebase's own comment), honest empty states. |
| Agents | 8 | Single roster (explicitly de-duplicated per its own comment), evidence-only summaries, no fabricated progress. One of the most disciplined screens in the app. |
| Recipes | 5 | Functionally solid DAG builder, but split across two full implementations that both render the saved-recipe list (§H, §N). |
| Integrations | 8 | Single source of truth (`INTEGRATIONS` array) drives tabs, overview, and status polling identically. Well done. |
| Settings | 8 | Correctly scoped to device preferences only; connected-capability panels correctly relocated to Integrations. |
| Design system / CSS | 3 | 21 imports, ~1,665 `!important`s, 9 orphaned files, one dead inline component. This is the actual score-dragger for the whole app. |
| Accessibility | 6 | Real `aria-*`/`role` usage throughout, skip link, focus return on route change, `prefers-reduced-motion` respected — but not verified end-to-end with a screen reader or contrast tooling in this pass (§Q). |
| Performance | 6 | No obvious unbounded growth found in the files read; not exhaustively profiled (§R). |

## D. Critical Problems

None of the "critical" severity in the sense of data loss or crash. The closest is:

### Issue: Mobile Companion's safety-boundary sentence is missing from the current source, and its own contract test is failing right now
**Evidence:** `test/groundstationRenderer.test.cjs:450` asserts `assert.match(mobile, /not a remote shell or mobile IDE/i)` against `src/groundstation/renderer/MobileCompanion.jsx`; a live run (`node --test test/groundstationRenderer.test.cjs`) fails this exact assertion. Every other assertion in the same test block (`mobile.invite`, `mobile.device.revoke`, `mobile.approval.resolve`, `<DecisionItem`, `Denying performs no local action`, and the negative check that `terminal.write|terminal.open|action.dispatch` never appear) still passes.
**Root cause:** `MobileCompanion.jsx` was rewritten in the current pass (new QR-pairing UI via `qrGenerator.js`) and the explicit "this is not a remote shell or mobile IDE" disclaimer sentence was dropped from the panel's copy in the process. The underlying safety guarantee is intact (no terminal/action dispatch calls exist in the file) — only the user-facing statement of that boundary is gone.
**User impact:** low today (nothing is actually less safe), but the sentence existed specifically to stop a user from expecting full remote-terminal control from their phone. Losing it silently is exactly the kind of scope-creep-by-omission the rest of the app is careful never to do.
**Severity:** Low-but-verified (it is a *currently failing test*, which is why it is listed under "Critical" rather than "Polish" — it is the one item in this whole audit that is objectively, mechanically broken right now).
**Recommended fix:** restore one sentence to the panel's intro copy near line 240 (`"Pair a smartphone for real-time monitoring and approval-gated operational control over LAN."` → append the "not a remote shell or mobile IDE" clause).
**Dependencies:** none.
**Regression risk:** none — pure copy restoration.

## E. UI Problems

- **21 stacked stylesheets, quantified `!important` load** (see table in §I) — the single largest source of "why does changing one rule not work" friction reported in this codebase's own history (`[[mission-control-cascade-authority]]`).
- **A raw inline `style={{...}}` block** in `WorkspaceRecipes.jsx:151` (`gridColumn`, `fontSize: "11px"`, `color: "var(--text-muted-semantic)"`, etc.) bypassing every token/class convention used everywhere else in the same file — the one place in the renderer I found hand-rolled inline styling outside of the canvas-drawing components (MissionGraph's SVG `foreignObject` styling is arguably justified since SVG text layout needs it; the recipe grid header does not).
- `--text-muted-semantic` used in that inline style does not match the `--mc-*` token family used throughout the rest of `redesign/*.css` — a second, parallel naming convention leaking into one component.

## F. UX Problems

### Issue: Two separate, fully-functional "Recipes" surfaces both list and launch the same saved recipes
**Evidence:** `RecipesView.jsx` (77 lines, the `recipes` nav destination) renders a card list of saved recipes with a Launch button, sourced from `recipe.list`. `WorkspaceRecipes.jsx` (156 lines, a `Dialog` opened by "Run recipe" in the Groundstation status bar, "New recipe"/"Edit graph" in `RecipesView`, and the `Ctrl K` → "Open workspace recipes" palette entry) *also* renders a full card grid of the same saved recipes (`recipe-launch-grid`, `recipes.slice()`/`recipe.list`) with its own Launch/Pause/Cancel/Delete buttons, stacked below its DAG builder form.
**Root cause:** `WorkspaceRecipes.jsx` predates the page-level `RecipesView.jsx` that a past redesign increment built "from scratch" (per `[[mission-control-redesign]]`, increment 3) without folding the dialog's own recipe list into it — the redesign added a second front door instead of replacing the first.
**User impact:** clicking "Edit graph" on a recipe in the page takes the user into a modal that shows the *entire* recipe library again, including the one they just came from — redundant information in two visual grammars (page cards vs. dialog cards) for the same data, and no single answer to "where do I manage my recipes."
**Severity:** Medium.
**Recommended fix:** `WorkspaceRecipes` should become purely the *builder* (name, template, worker selection, DAG/dependency editor, advanced policy) triggered from "New recipe"/"Edit graph" with a specific recipe in context; the launch/pause/cancel/delete card grid at the bottom of the dialog should be deleted and left solely to `RecipesView`, which already owns that list.
**Dependencies:** none — the dialog and page already read from the same `recipe.list` method, so this is a JSX deletion, not a data-model change.
**Regression risk:** low; `groundstationRedesign.test.cjs`/`groundstationRenderer.test.cjs` likely assert some of the deleted markup — expect to update a handful of string-match assertions (§ dependency in test coupling).

### Issue: "Run recipe" in the Groundstation status bar and "Recipes" in the sidebar go to two different UIs for the same task
Same root cause as above, called out separately because it is a *discoverability* problem, not just a duplication problem: a new user has no way to predict that the prominent "▶ Run recipe" button opens a modal builder rather than the recipes page one click away in the sidebar.
**Severity:** Low-Medium. **Recommended fix:** once the dialog is builder-only (see above), rename its trigger button contextually (e.g., "Run recipe" when a recipe already exists should deep-link to `RecipesView` and only fall back to the builder dialog when none exist yet), or simply retarget "Run recipe" to navigate to the Recipes page.

## G. Broken Functionality

### Issue: `WorkerSparkline`/`WorkerMetricStrip` — a fully built live-telemetry component that is never rendered anywhere
**Evidence:** `TerminalPane.jsx:12` imports `{ WorkerSparkline }` and never references it in its JSX. `App.jsx:34` imports `{ WorkerMetricStrip }` from `WorkerSparkline.jsx` and never renders `<WorkerMetricStrip`. Confirmed via `grep -rn "<WorkerMetricStrip" src/groundstation/renderer/*.jsx` → no matches. The component itself (`WorkerSparkline.jsx`, 211 lines) is complete and correct: a dependency-free Canvas 2D sparkline with DPR awareness, a `useWorkerMetrics` hook that accumulates CPU/RAM/IO history from `session.resources`, and a composite `WorkerMetricStrip` meant for "the Groundstation worker cards and the terminal pane header" per its own doc comment.
**Root cause:** built in the current pass, wired only as far as the import statement.
**User impact:** none negative today (nothing crashes), but it is a finished feature the user cannot see — the exact "features that exist technically but are difficult to discover" case called out in this audit's brief, escalated to "impossible to discover" since it never renders.
**Severity:** Medium (wasted, finished work; easy win).
**Recommended fix:** render `<WorkerMetricStrip session={session} compact />` in `TerminalPane`'s header (its own doc comment already names this location) and/or in the Groundstation manifest row.
**Dependencies:** confirm `session.resources.ioKBs` is actually populated by `resourceSampler.cjs` (not verified in this pass — see §12 in the "cannot determine" list).
**Regression risk:** low; purely additive JSX.

### Issue: CrashLens's "Ask Mission AI" button is wired to a prop that is never passed, so it silently does nothing
**Evidence:** `TerminalPane.jsx:68` declares `onAskAI` in its props and passes `onAskAI={prompt => onAskAI?.(prompt)}` into `<CrashLens>` (line 431). `CrashLens.jsx:156` calls `onAskAI(prompt)` unconditionally when its own "Ask Mission AI" button is clicked. But the parent that renders `TerminalPane`, `TerminalSlot` in `App.jsx:828`, does not declare or forward an `onAskAI` prop at all, and its caller `WorkspaceView` never passes one into `<TerminalSlot>` either (confirmed via `grep -n "onAskAI" App.jsx` — the only two hits are `RecipesView` and `WorkspaceRecipes`, both unrelated).
**Root cause:** a 3-hop prop chain (`GroundstationApp → WorkspaceView → TerminalSlot → TerminalPane → CrashLens`) has the last two hops wired and the middle hop missing.
**User impact:** when a worker crashes, CrashLens correctly detects the failure pattern (port collision, missing module, syntax error, OOM, permission denied, generic) and shows an "Ask Mission AI" button with no visual indication it is disabled — clicking it is a silent no-op (`onAskAI?.()` on `undefined` swallows the call). This is precisely the "broken/partially working interaction" category this audit was built to catch: a button that looks fully actionable and produces zero effect.
**Severity:** Medium — a crash-recovery affordance failing exactly when the user is already frustrated.
**Recommended fix:** thread `onAskAI` from `GroundstationApp` (it already has `openMissionAI`) through `WorkspaceView` → `TerminalSlot` → `TerminalPane`, mirroring how `onReconfigure`/`onTerminalError` are already threaded on the same call chain.
**Dependencies:** none.
**Regression risk:** none.

### Issue: A complete, unused `IntegrationsView()` component sits dead inside `App.jsx`
**Evidence:** `App.jsx:1138-1144` defines `function IntegrationsView()` — full header, capability-registry grid, `integration.list` request, inspector aside — but it is never instantiated anywhere in the file (only match for `IntegrationsView(` in the whole file is its own definition). The route actually rendered at `App.jsx:1550` is `<IntegrationHubView>`, imported from the dedicated `IntegrationsView.jsx` file under the alias `IntegrationHubView`. The two are unrelated, differently-structured implementations of the same idea.
**Root cause:** superseded when Integrations was split out into its own file/component (`IntegrationHubView`) in a past increment; the old inline version was never deleted.
**User impact:** none functionally (dead code doesn't render), but it is ~450 characters of a completely different Integrations design sitting invisibly inside the 1591-line shell file, a maintenance trap for the next person who searches for "IntegrationsView" and edits the wrong one.
**Severity:** Low (dead code), but flagged under "Broken" rather than "Polish" because it is a duplicate *implementation*, not a duplicate string.
**Recommended fix:** delete `App.jsx:1138-1144` outright.
**Dependencies:** verify no test asserts against this specific dead block before deleting (a quick grep of `test/*.test.cjs` for its unique strings, e.g. `"Connect tools without surrendering control"`, is worth running first — that exact phrase also appears in the live `IntegrationHubView`, so a test asserting it would still pass either way).
**Regression risk:** low.

## H. Misplaced Elements

- The dead `IntegrationsView()` (§G) is misplaced by definition — it belongs nowhere, since it has already been superseded.
- `WorkspaceRecipes.jsx`'s bottom "saved recipes" card grid (§F) is misplaced: it duplicates content that has a dedicated, better-suited home (`RecipesView.jsx`) one click away.
- The inline `style={{...}}` block in `WorkspaceRecipes.jsx:151` is misplaced relative to the rest of the file, which otherwise drives every visual property through classnames and CSS custom properties.

## I. Design System Problems

This is the app's real weak point, and it is quantifiable rather than a matter of taste.

**CSS imported by `main.jsx`, in cascade order** (21 files, `src/groundstation/renderer/`):
`tokens.css` (156L) → `styles.css` (2217L, 25×`!important`) → `uiFoundation.css` (345L, 20×) → `groundstation21.css` (500L, 10×) → `missionGraph.css` (132L) → `projectMemory.css` (201L) → `vscodeBridge.css` (416L) → `mcpGateway.css` (234L) → `agentSupervision.css` (57L) → `automationWorkflows.css` (1L) → `mobileCompanion.css` (803L) → `pluginPlatform.css` (1L) → `missionAi.css` (162L) → `workspaceRecipes2.css` (64L, 7×) → `premiumDesign.css` (1085L, **227×**) → `premiumV3.css` (810L, **454×**) → `redesign/tokens-bridge.css` (272L) → `redesign/base.css` (804L, **257×**) → `redesign/workspace.css` (669L, 98×) → `redesign/screens.css` (2099L, **192×**) → `redesign/cockpit.css` (1793L, **313×**) → `redesign/surfaces.css` (1477L, 58×).

**Total: ~1,665 `!important` declarations across the loaded stylesheets.** Per this codebase's own documented finding (`[[mission-control-cascade-authority]]`), load order alone does not grant a later file authority — an `!important` from any earlier file beats a normal declaration from any later one regardless of order, which is *why* each successive "authoritative" layer had to out-weight the last with more `!important`, compounding the total every time a new layer was added. This is the literal mechanism of "why is the UI messy": there is no single place that owns geometry, and every fix is layered on top rather than made in place, because the earlier layers are too dangerous to edit (test-locked, per `[[mission-control-test-coupling]]`) and too dangerous to delete (also test-locked).

**Confirmed dead CSS — imported nowhere, 9 files, ~3,987 lines:**
`redesign-v4.css` (1066L), `reference-final.css` (415L), `reference-v5.css` (471L), `experience27.css` (234L), `experience28.css` (199L), `experience29.css` (131L), `experience30.css` (500L), `prototype2026.css` (515L), `theme-concept.css` (456L). Verified via `grep -rn` for each filename across every `.jsx`/`main.jsx` in the renderer — zero import sites. These are pure dead weight, kept in the repo only because `test/groundstationRenderer.test.cjs`/`prototypeUi.test.cjs` and others assert specific rules exist inside them (per `[[mission-control-test-coupling]]`, e.g. `experience30.css` must contain `.power-rail { display: none !important; }`). **This is a self-perpetuating trap**: nobody can delete the files without first deleting the tests that pin them, and nobody has had reason to touch the tests because the files "still pass."

**Two parallel token vocabularies observed:** `--mc-*` (the live system, declared correctly on `.shell` per the documented `:root`-freeze fix) and at least one stray `--text-muted-semantic` reference in `WorkspaceRecipes.jsx`'s inline style that doesn't belong to that family — a small but real sign of the token system not being the only source of truth a developer reaches for under time pressure.

**Recommendation, not a redesign:** this does not need increment 6. It needs (a) a mechanical pass deleting the 9 orphaned files and updating/removing the ~15 test assertions that pin them, and (b) — separately, carefully, with visual sign-off at every step per `[[mission-control-redesign-rejected]]` — collapsing `premiumDesign.css` + `premiumV3.css` into the `redesign/*` layer they were superseded by, one property at a time, verified against rendered screenshots, never as a single big-bang replacement.

## J. Terminal Workspace Audit

`TerminalPane.jsx` (436 lines) is one of the best-engineered files in the renderer:
- Correct xterm lifecycle: `Terminal`/`FitAddon` created and disposed per session identity change, `ResizeObserver` + `requestAnimationFrame`-debounced fit, PTY resize only sent while `aliveRef.current` is true (resizing an exited worker is explicitly guarded against, with a comment explaining the Protocol would reject it).
- Correct reconnect semantics: replay buffer honored, `terminal.activate` pending data flushed, subscription keyed to a specific `streamId` so stale events from a torn-down stream are ignored.
- Real in-terminal find (Ctrl+F), drag-and-drop to move a worker between panes, per-session dropdown to swap panes, a session chooser, clear/copy-selection, and `CrashLens` mounted only on `status === "failed"`.
- Every fact shown (`uptime`, `ownership`, `activity`) is explicitly sourced from engine state with comments enforcing "never invented."

Pane density: `layoutForCount()` supports single/horizontal/2×2/3×2 (1, 2, 4, 6 slots) with per-axis resize handles and a documented `minmax(<px>, <ratio>)` grid fix from a past increment (`[[mission-control-redesign]]`, increment 1) specifically for resize reliability. I did not find evidence of the "controls disappear at smaller tile sizes" failure mode by reading the JSX (actions are grouped in a `DropdownMenu` "More actions" rather than laid out flat, which is the correct mitigation), but I did **not** render the app to visually confirm sub-6-pane density — see §12 (things I could not determine).

**Two confirmed defects, already detailed in §G:** the unwired `WorkerSparkline`/`WorkerMetricStrip`, and the unreachable CrashLens "Ask Mission AI" button.

## K. Groundstation Audit

`LiveGroundstationView` in `App.jsx` answers the audit's own test list directly: status bar answers "is the project healthy," `AttentionInbox` answers "what needs me," the manifest register answers "what is currently running/broken," `ActivityWaterline` + `ReferenceRecipePanel` + the dependency-graph strip answer "what changed recently" and "what should I look at next." It does **not** degrade into a meaningless-card dashboard — every number shown traces to a real filter/count over `sessions`/`activity`, and empty states are explicit (`GroundstationOnboarding` for zero workers, per-filter empty copy for zero matches). Favoriting/pinning is a per-project, renderer-local preference (correctly not conflated with engine state). Keyboard model (arrow-key row navigation, Ctrl+F search focus, Ctrl+Shift+R/S/F for restart/stop/favorite on the selected row) is thorough and does not fight `contentEditable`/dialog-open states.

## L. Agents Audit

`AgentWorkspace.jsx` is, by its own inline comments, a *second-pass* cleanup ("One roster, not two... the removed duplicate summary grid") — and it shows. Single roster with inline brief per agent, a 5-tab detail view (Summary/Progress/Lifecycle/Evidence/Approvals), mission checkpoints reported as **verified counts, never percentages**, and an explicit design rule enforced by its own test (`test/groundstationRenderer.test.cjs`) that this screen has **no chat composer, no textarea, no `terminal.write`/`terminal.open`** — Agents is inspection-and-control, not a chat UI, by deliberate contract. This is a strong, intentional piece of product design, not an accident.

## M. Needs You Audit

`NeedsView` merges five independent approval sources (Mission Supervisor, Mission, MCP, Automation, Mobile, Plugin) plus live worker attention into one queue with one filter set (All/Critical/Agents) and one snooze mechanism. The `NaN`-snooze bug documented in memory (`Number(undefined) > Date.now()` and `<= Date.now()` are both false, silently hiding every never-snoozed item) is **not present in the current code** — `isSnoozed()` correctly asks "is it snoozed" rather than "is it not snoozed," with a comment explicitly explaining why. Lifecycle states (New → Seen → Acting → Verifying → Recovered) are exposed via a `<details>` disclosure rather than permanent chrome, which matches the "quiet by default" direction without hiding the information.

## N. Recipes Audit

Functionally the DAG engine is real (dependency cycle detection in `recipeBuilderModel.js`, readiness gates, parallel-wave scheduling verified by 6 passing tests in `test/workspaceRecipes2.test.cjs` including rollback and cancellation). The audit's specific worry — "assume a new user does not know what a Recipe means" — is handled reasonably (`RecipesView`'s guide rail: "1. Start roots → 2. Verify readiness → 3. Unlock dependants → 4. Restore the canvas," plus an "Ask Mission AI"/"Design with Mission AI" entry point that hands the model the real available workers). The structural problem is the duplicated surface documented in §F/§H, not the underlying concept or copy.

## O. Integrations Audit

The strongest-architected screen in the app. `IntegrationHubView` (`IntegrationsView.jsx`) drives its tab strip, overview grid, and status polling from a single `INTEGRATIONS` array — "a new bridge only needs one entry, not a second list to keep in sync," per its own comment — and every status shown comes from a live `missionApi().request(integration.request)` call, never a static label. `TrustBoundary` renders the same Observe/Request/Execute framing at both the hub level and inside each connected panel (VS Code, Mission AI, MCP, Mobile — confirmed via grep), so the "what permission does this receive" requirement from the audit brief is satisfied structurally, not just in one panel. `IntegrationAuditLog` surfaces `mobile.audit.list`/`mcp.audit.list`/`plugin.audit.list` in one place.

## P. Settings Audit

Correctly scoped post-split: `SettingsHub` holds only device preferences (theme/density/type-scale/motion, terminal font/theme/cursor/scrollback, notification policy) plus a single link out to Integrations for anything connection-shaped. No dangerous action lives in Settings without a confirmation (destructive actions are all routed through the shared `ConfirmationDialog` from elsewhere in the app, not from Settings itself, since Settings has no destructive actions of its own). "Restore defaults" is present.

## Q. Accessibility Problems

Structurally strong (skip link, `aria-live` regions, `role="dialog"`/`"alertdialog"`/`"tablist"`/`"row"`/`"rowgroup"` used correctly, focus returned to `#main-content` on route change, `prefers-reduced-motion` and an in-app motion toggle both respected per `[[mission-control-redesign]]` increment 4). **What I could not verify in this pass** (no rendered/measured session was run): actual contrast ratios in the current CSS state across all three themes, real screen-reader announcement order, and whether the 1,665 `!important` declarations ever fight an ARIA-relevant CSS property (e.g., `content` on a pseudo-element used for a status icon with no text alternative). The project's own visual harness (`scripts/visual/`, `[[mission-control-visual-harness]]`) is the right tool to close this gap and already exists in this tree — it was not re-run in this pass.

## R. Performance Problems

Nothing alarming found in the files read. Terminal panes correctly tear down xterm instances, unsubscribe from IPC, and cancel animation frames on unmount. `WorkerSparkline`'s rolling history correctly caps at 40 points via `.slice(-(MAX_POINTS - 1))`. `useFavoriteWorkers`/command-recents/history-cursor all persist through try/caught `localStorage` calls that degrade gracefully. **Not verified in this pass:** actual terminal-output throughput under sustained high-volume PTY writes, whether `activity.events` (fed into multiple `.filter()`/`.reverse()` calls per render across Groundstation/History/Agents) is bounded upstream in the engine, and real render-count profiling with 6–10 simultaneous live workers. These require the running app or a profiler, not source reading.

## S. Architectural Problems Affecting UX

The CSS cascade (§I) is the one architectural problem that manifests as a UX problem and cannot be fixed by editing components — it requires deleting/consolidating stylesheets, which is a structural change with real regression risk against the test suite (§ Dead/Duplicate section, and `[[mission-control-test-coupling]]`). Everything else audited (routing, IPC, state, keyboard model) is architecturally sound and does not need structural rework to fix its UX symptoms — the three broken interactions in §G are prop-plumbing fixes, not architecture fixes.

## T. Dead / Duplicate / Legacy Code

| Item | Type | Lines | Why it's still here |
|---|---|---|---|
| `redesign-v4.css`, `reference-final.css`, `reference-v5.css`, `experience27-30.css`, `prototype2026.css`, `theme-concept.css` | Dead CSS, 0 import sites | ~3,987 | Tests assert their content exists (`[[mission-control-test-coupling]]`) |
| `App.jsx:1138-1144` `IntegrationsView()` | Duplicate/dead component | ~7 | Superseded by `IntegrationHubView`, never deleted |
| `WorkerSparkline`/`WorkerMetricStrip` | Built, unwired | 211 | New feature, wiring incomplete (§G) |
| `WorkspaceRecipes.jsx` bottom recipe-launch grid | Duplicate of `RecipesView.jsx` | ~1 (dense JSX line) | Predates the page it now duplicates (§F) |

Everything else searched (`TODO`/`FIXME`/`HACK:`/"not implemented"/"mock data"/"dummy data"/"coming soon" across all of `src/`) returned **zero matches** — there is no backlog of half-finished placeholder work hiding in the codebase. That is a genuinely good sign and worth stating plainly rather than manufacturing findings to fill this section.

## U. Feature Completeness Matrix

| Feature | Status | Evidence |
|---|---|---|
| Terminal PTY lifecycle (open/resize/write/close/replay) | **Fully working** | Real subscription/stream-id handling, reconnect-safe, guarded against resizing a dead PTY |
| Worker CRUD + recipes DAG execution | **Fully working** | 6 passing tests incl. rollback/cancellation (`workspaceRecipes2.test.cjs`) |
| Needs You unified queue | **Fully working** | Snooze bug already fixed in current source |
| Agents roster + mission checkpoints | **Fully working** | Evidence-only, no fabricated progress |
| Integrations hub (6 capabilities) | **Fully working** | Live status polling, real permission framing |
| Mobile Companion pairing/approval | **Fully working**, **copy regression** | 4/4 service tests pass; renderer contract test fails on one missing sentence (§D) |
| CrashLens | **Mostly working** | Detection + 2 of 3 actions work; "Ask Mission AI" unreachable (§G) |
| Live worker telemetry sparklines | **UI only / disconnected** | Component complete, never rendered (§G) |
| Recipes page + builder dialog | **Fully working, duplicated** | Both operate on real data; overlapping surfaces (§F) |
| Mission AI (Ask/Plan) | **Fully working** | Real markdown renderer, streaming reveal, plan-not-execute contract enforced |
| Mission Graph (DAG canvas) | **Fully working** | Interactive pan/zoom SVG with real readiness data |

## V. Missing Features

I am deliberately conservative here, per the audit's own instruction not to suggest features merely because competitors have them, and because I have not exhaustively read the engine layer (`src/engine/index.cjs`, 1624 lines; `sessionEngine.cjs`, 1010 lines) to know what's already possible underneath.

- **P1 — Wire up the telemetry sparklines that already exist.** Not a new feature — §G. Zero new design or engineering; the highest ratio of value to effort in this entire report.
- **P2 — A single "Recipes" mental model.** Fold the builder and the library into one place (§F). Improves discoverability without adding surface area.
- **P3 — Contrast/motion verification as a CI gate.** The repo already has a working offscreen visual harness (`scripts/visual/`, per `[[mission-control-visual-harness]]`) that isn't run in CI (`npm test` only runs `node --test`). Wiring `groundstation:capture` into a pre-merge check would catch the next `!important` regression before it ships, rather than after a human has to discover it by screenshot.

## W. Small Polish Problems

- Inline `style={{...}}` in `WorkspaceRecipes.jsx:151` instead of a class (§E).
- Stray `--text-muted-semantic` token name that doesn't match the `--mc-*` family used everywhere else (§I).
- Dead component left inside a 1591-line shell file makes future search-and-edit error-prone (§H).

I looked specifically for the audit's named small-detail categories (icon size drift, gap inconsistency, cursor mismatches, truncation bugs, capitalization drift, missing confirmations) across the files read and did not find further confirmed instances — the component code is unusually consistent in these respects (shared `Icon` component with fixed sizes, shared `section-kicker`/`EmptyState` primitives reused everywhere). I would not claim this list is exhaustive without a rendered visual pass (§ next section).

## X. Recommended Information Architecture

No change recommended. The current seven-primary-plus-Integrations structure (Groundstation, Workspace, Needs You, Agents, Recipes, History, Settings, +Integrations as a contextual eighth) is deliberate, documented in the app's own code comments, and correctly test-locked. The one adjustment worth making is folding Recipes' two surfaces into one (§F) — an interaction fix, not a navigation fix.

## Y. Recommended UI/UX Direction

**Do not start another whole-app redesign pass.** The user has already rejected exactly that once, in writing, after five compounding increments each individually measured as "improved" (contrast ratios, `scrollHeight === clientHeight`, 362/365 tests) while the cumulative result got worse to look at (`[[mission-control-redesign-rejected]]`). The correct direction now is **subtraction and repair**, not another layer:

1. Delete the 9 orphaned CSS files and their pinning test assertions (mechanical, verifiable, zero visual risk since nothing currently renders from them).
2. Fix the three concrete broken/unwired interactions in §G (prop plumbing, no design decisions required).
3. Fold Recipes' two surfaces into one (§F).
4. Only after that, and only with screenshots shown to the user at each step (per `[[mission-control-redesign-rejected]]`'s own instruction), begin consolidating `premiumDesign.css`/`premiumV3.css` into the `redesign/*` layer they were meant to replace — in place, one selector at a time, never as a new 22nd file.

## Z. Prioritized Improvement Roadmap

**P0 — Fix immediately**
- Restore the "not a remote shell or mobile IDE" sentence to `MobileCompanion.jsx` (currently a failing test).
- Wire `onAskAI` through `WorkspaceView → TerminalSlot → TerminalPane` so CrashLens's AI button works.

**P1 — High priority**
- Render `WorkerMetricStrip` in `TerminalPane`'s header (component is finished; verify `resourceSampler.cjs` actually populates `ioKBs` first).
- Delete the dead `IntegrationsView()` block in `App.jsx` (verify no test uniquely pins it first).
- Delete the redundant recipe-launch grid at the bottom of `WorkspaceRecipes.jsx`, leaving it as builder-only; update the handful of tests that assert its markup.

**P2 — Product improvement**
- Mechanically remove the 9 orphaned CSS files and the test assertions that pin them; document the deletion in the same commit so the "why is this file gone" question never needs re-investigating.
- Replace the one inline `style={{...}}` in `WorkspaceRecipes.jsx` with a class, and rename its stray `--text-muted-semantic` reference to the `--mc-*` family.
- Wire `npm run groundstation:capture` (the existing visual harness) into a pre-merge or CI check so cascade regressions are caught by a diff, not by the user's eyes after the fact.

**P3 — Future / experimental**
- Begin the careful, screenshot-verified consolidation of `premiumDesign.css`/`premiumV3.css` into `redesign/*.css`, one property at a time, only after P0–P2 are shipped and separately signed off.

---

## What I could not determine from static reading (say so explicitly, per the audit's own rule 12)

- **Rendered visual state** — actual contrast ratios, whether controls truncate at small pane sizes, real overflow/scrolling behavior. This audit was static-code-only; the repo already has a working offscreen visual harness (`scripts/visual/`, documented in `[[mission-control-visual-harness]]`) built for exactly this, and re-running it against the *current* tree (not the reverted one it was last verified against) would close this gap directly.
- **`src/engine/index.cjs` (1624 lines) and `sessionEngine.cjs` (1010 lines)** were sampled for their public IPC surface (95 methods confirmed in `src/protocol/`) but not read line-by-line — I cannot make claims about internal engine correctness, only that every renderer feature genuinely calls through to a real method rather than a stub.
- **`McpGateway.jsx`, `AutomationWorkflows.jsx`, `PluginPlatform.jsx`, `MobileCompanion.jsx` bodies** were confirmed to make only real, non-mocked IPC calls (grepped their `missionApi().request(...)` call sites) but not read in full for UI-polish-level findings the way `App.jsx`/`TerminalPane.jsx`/`AgentWorkspace.jsx`/`IntegrationsView.jsx` were.
- **`src/cli`, `src/tui`, `mobile/android`, `integrations/vscode`** were not explored at all in this pass — this audit was scoped to the Groundstation desktop renderer per the bulk of the audit brief's own emphasis (Terminal Workspace, Groundstation, Agents, Needs You, Recipes, Integrations, Settings).
- **Performance under real load** (6–10 simultaneous live PTYs, sustained high-throughput terminal output) requires running the app, not reading it.
