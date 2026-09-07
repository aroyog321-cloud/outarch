# Mission Control 2.19 — Full Codebase, UI/UX and Product Audit

Date: 2 September 2026  
Repository: Mission-Control-2.19.0-Full-App-UI-Redesign/nvkh-main  
Audit type: Read-only architecture, implementation, product, UI/UX, accessibility, performance, and feature-completeness review

No source changes were made as part of the audit.

The central conclusion is that Mission Control has a substantially real and thoughtfully secured backend, but parts of the renderer overstate or misrepresent what that backend currently supports. This is not primarily a “bad CSS” application. Its largest risks are broken UI-to-protocol contracts, fragmented attention/error truth, misleading success states, a mobile pairing-secret leak, and a renderer/design-system layer that has accumulated too many overlapping implementations.

The application should be evolved, not rewritten.

## A. Executive Summary

Mission Control is trying to be a local-first developer operations cockpit: a single desktop surface for supervised terminals, agents, reusable workspace recipes, approvals, project history, AI assistance, and local integrations.

That concept is coherent and much of the difficult infrastructure is already present:

- Real Electron security boundaries.
- Engine-owned PTYs.
- Central protocol allowlisting.
- Persistent workspace and activity state.
- Bounded terminal and event buffers.
- Working agent, recipe, MCP, mobile, plugin, Mission AI, and VS Code service foundations.
- Direct terminal streaming that avoids React rendering every output chunk.
- A generally strong visual direction: calm graphite surfaces, restrained blue accents, compact typography, and terminal-first density.

It is not ready to be treated as production-complete because several visible features are disconnected or misleading:

1. The mobile pairing code is embedded in a plaintext HTTP query URL while the UI says it is never transmitted in plaintext.
2. Broadcast Terminal and CrashLens Free Port invoke protocol methods that do not exist.
3. CrashLens reports a request as queued even when the request failed.
4. “Open in Browser” uses window.open, which Electron explicitly denies.
5. Add Worker opens with a visually selected template but an invalid blank worker ID.
6. Desktop notification settings exist, but no native Electron notification delivery exists.
7. Several destructive actions manufacture their own confirmation token without asking the user.
8. Needs You is not a genuinely unified priority queue.
9. “Edit graph” does not edit the selected recipe.
10. The production window cannot be narrowed below approximately 1040px despite responsive layouts and 720px/960px visual tests.
11. The styling layer is an expensive cascade reconciliation system rather than a coherent design system.
12. Some test failures are stable product/portability defects; others are concurrency-sensitive and need isolation before being called regressions.

Overall condition: approximately **6.5/10**. The engine and security foundations are stronger than the UI’s reliability and truthfulness.

### Audit scope and limitations

The audit inventoried 415 repository files, including approximately 46,667 lines across 208 authored text files and 192 visual artifacts. It traced production code, renderer surfaces, Electron main/preload code, protocol handlers, engine and service layers, integrations, mobile sources, tests, scripts, package configuration, CSS import order, and the existing 96-image route/theme/width validation matrix.

Validation performed:

- npm run groundstation:build: passed.
- Focused renderer/layout suite: 38/39 passed.
- Full suite: 342/350 passed.
- Stable isolated failures:
  - Application/TUI tests: 13/15 passed.
  - Mobile group: 22/23 passed.
  - VS Code extension: 2/3 passed.
- CSS bundle: approximately 685 KB raw / 111 KB gzip.
- Main JavaScript chunk: approximately 181 KB raw.
- Xterm chunk: approximately 360 KB raw.

The full parallel suite generated additional timing failures. Those are recorded as flakiness or resource-sensitivity, not automatically classified as eight distinct product defects.

Not determined from the repository alone:

- Actual provider connectivity with user credentials.
- Physical Windows notification delivery, because it is not implemented.
- Signed installer acceptance.
- Android release signing and physical-device acceptance.
- Real VS Code extension installation on each supported OS.
- High-DPI behavior on physical multi-monitor setups.
- Screen-reader quality inside xterm.
- Long-duration stress behavior with dozens of simultaneously producing PTYs.

## B. Architecture Understanding

### Product model

Mission Control is not fundamentally a task dashboard. It is a supervised runtime:

    React renderer
        ↓ bounded request / subscription API
    Electron preload
        ↓ Protocol v1 allowlist
    Electron main / EngineHost
        ↓ EngineAPI
    SessionEngine ── PTY processes
        ├─ activity and attention persistence
        ├─ recipes and missions
        ├─ recovery and resource sampling
        └─ project/workspace state

    Integration services
        ├─ Mission AI
        ├─ MCP gateway
        ├─ VS Code Bridge
        ├─ automation
        ├─ mobile companion
        └─ declarative plugin platform

The Electron window is appropriately hardened in src/groundstation/main/index.cjs:

- contextIsolation: true
- nodeIntegration: false
- renderer sandboxing
- denied pop-up windows
- main-frame IPC validation
- controlled external URL opening
- explicit shutdown coordination

The preload exposes a small frozen API rather than Node primitives directly. Protocol methods are centrally allowlisted in src/protocol/index.cjs.

### Primary workflows

The actual primary workflows are:

1. Open or switch a local project.
2. Inspect project health and supervision state.
3. Start, stop, reconfigure, or inspect workers.
4. Work directly in one or more PTY-backed terminals.
5. Respond to failures, approvals, or agent questions.
6. Launch repeatable groups of workers through recipes.
7. Inspect agents and their mission evidence.
8. Use Mission AI, MCP, VS Code, mobile, automation, or plugins as controlled extensions.
9. Review recent operational history.

### State and event flow

The renderer’s useMissionState obtains a complete state snapshot and subscribes to engine events. Raw terminal output is treated specially: TerminalPane subscribes directly and writes to xterm without routing every character through React state.

Other engine events cause a debounced full state.get. That makes correctness straightforward, but becomes expensive under high-frequency non-terminal event activity.

### Persistence and authority

Authority is generally placed correctly:

- PTYs belong to the engine.
- React requests actions rather than directly owning processes.
- Workspace state is persisted locally.
- Activity and replay buffers are bounded.
- Secrets use OS-backed or protected storage.
- Confirmation strings are checked at the protocol boundary.
- Mobile payloads use application-layer encryption after pairing.
- Plugins are declarative rather than arbitrary executable code.

These boundaries should remain intact.

### Architectural concentration

The largest renderer architecture problem is src/groundstation/renderer/App.jsx, which is approximately 1,591 lines and combines:

- application routing
- global shell state
- project lifecycle
- Groundstation presentation
- Workspace presentation
- Needs You
- History
- Settings
- dialogs
- action orchestration
- keyboard behavior
- preference handling

This concentration causes visual changes, error behavior, and data-flow concerns to collide in one module.

## C. UI/UX Health

| Area | Rating | Assessment |
|---|---:|---|
| Product concept | 8/10 | Clear local-first developer command-center purpose |
| Engine architecture | 8/10 | Strong authority boundaries and bounded state |
| Electron security | 8/10 | Good renderer isolation; mobile pairing defect lowers end-to-end trust |
| Groundstation | 7/10 | Useful operational data, but cramped and not fully unified |
| Terminal Workspace | 7/10 | Strong PTY implementation; six-pane ceiling and header density limit scale |
| Agents | 7/10 | Substantial real functionality; interaction semantics and error states lag |
| Needs You | 5/10 | Correct session failures, but fragmented external decisions and misleading empty states |
| Recipes | 6/10 | Strong engine; creator/editing model is conceptually incomplete |
| Integrations | 6/10 | Broad real foundations; several overclaims and disconnected actions |
| Settings | 6/10 | Reasonable grouping, but contains non-settings and nonfunctional promises |
| History | 6/10 | Real bounded activity, but shallow filtering and weak failure handling |
| Design-system coherence | 4/10 | Good visual outcome produced by a very costly cascade |
| Accessibility | 5/10 | Good baseline intent; several custom controls lack complete semantics |
| Responsiveness | 5/10 | CSS supports narrow layouts that the production window prevents |
| Performance readiness | 7/10 | Good terminal path and bounded buffers; event fan-out and full snapshots need work |
| Feature truthfulness | 5/10 | Several controls visibly promise behavior that is absent or rejected |

## D. Critical Problems

### MC-01 — Mobile pairing secret is sent in a plaintext URL

#### Issue

The generated QR/copy URL contains ?code=<pairing-code> on a plaintext LAN HTTP endpoint.

#### Evidence

- URL construction: src/groundstation/renderer/MobileCompanion.jsx:225
- UI claim: src/groundstation/renderer/MobileCompanion.jsx:348
- LAN endpoints use HTTP: src/service/mobileCompanion.cjs:337
- Browser reads query parameters: src/service/mobileWebCompanion.cjs:547

#### Root Cause

The pairing convenience flow treats the query string as local browser state, but query strings are part of the HTTP request target. Application-layer encryption begins too late to protect that first request.

#### User Impact

The pairing code can be exposed through request logs, proxies, browser history, referrers, or LAN observation. The interface’s security claim is false.

#### Severity

**Critical**

#### Recommended Fix

Place the code in a URL fragment such as #code=..., read it from location.hash, erase the fragment immediately after import, and add tests proving it never appears in a request URL. Alternatively, require manual code entry.

#### Dependencies

Mobile web companion parsing, QR generation, clipboard behavior, security copy, mobile protocol tests.

#### Regression Risk

Existing QR codes and bookmarked pairing URLs will stop pre-filling. Pairing invitations are short-lived, so compatibility should not outweigh the security fix.

### MC-02 — Broadcast and Free Port call nonexistent protocol methods

#### Issue

Visible controls call methods absent from the Protocol v1 allowlist.

#### Evidence

- Broadcast request: src/groundstation/renderer/BroadcastBar.jsx:73
- Free-port request: src/groundstation/renderer/CrashLens.jsx:135
- Protocol allowlist: src/protocol/index.cjs:17
- False success message after failure: src/groundstation/renderer/CrashLens.jsx:142

#### Root Cause

Renderer concepts were added without an accompanying engine/protocol implementation and end-to-end contract tests.

#### User Impact

Broadcast does not work. Free Port does not work. Worse, Free Port can tell the user it was queued after the request failed.

#### Severity

**Critical** for false success; **High** for disconnected functionality.

#### Recommended Fix

Hide or disable both features immediately with truthful “not available” copy. Then design real approval-backed engine methods, add them to Protocol v1, implement bounded input/port ownership validation, and test the entire UI → protocol → engine → event cycle.

#### Dependencies

Engine authorization model, attention/approval broker, PTY input safety, Windows process/port ownership semantics.

#### Regression Risk

Broadcasting input to multiple interactive shells is intrinsically dangerous. A naive implementation could submit secrets or destructive commands to the wrong terminals.

### MC-03 — Add Worker starts from an invalid visible default

#### Issue

The Project Shell template appears selected, but the underlying worker ID and name are blank until the user clicks the already-selected template.

#### Evidence

- Selected template state: src/groundstation/renderer/WorkerDialog.jsx:67
- Blank draft: src/groundstation/renderer/workerForm.js:97
- Required ID validation: src/groundstation/renderer/workerForm.js:59

#### Root Cause

The template-selection state and form-draft initialization have separate defaults.

#### User Impact

The app’s primary creation flow fails on first submission despite showing a valid-looking selection.

#### Severity

**High**

#### Recommended Fix

Create the initial draft from the selected template, assign a duplicate-safe ID such as terminal, terminal-2, and preserve engine validation. Add a test that opens the dialog and submits it without any intermediate click.

#### Dependencies

Existing session IDs must be supplied to the draft factory.

#### Regression Risk

ID generation can collide with case-insensitive or normalized IDs unless the same rules are used by renderer and engine.

### MC-04 — Desktop notification settings promise nonexistent behavior

#### Issue

Settings offer native desktop notifications, severity thresholds, and quiet hours, but there is no Electron native notification dispatch.

#### Evidence

- Notification preference UI and save path: src/groundstation/renderer/App.jsx:1146
- Engine preference storage exists, but the Electron main layer contains no corresponding notification delivery path.

#### Root Cause

Preference persistence was implemented before the consumer.

#### User Impact

Users may rely on a notification that will never arrive, potentially missing failed builds or agents waiting for input.

#### Severity

**High**

#### Recommended Fix

Either remove/label the controls as unavailable or implement main-process Notification delivery with severity mapping, quiet-hour evaluation, deduplication, click-to-focus routing, and explicit test-notification feedback.

#### Dependencies

Unified attention events, Windows notification permission/delivery diagnostics, application lifecycle behavior.

#### Regression Risk

Event storms can create notification spam. Deduplication and rate limits are mandatory.

### MC-05 — Destructive actions bypass meaningful confirmation

#### Issue

Several renderer actions generate the required confirmation token themselves and immediately dispatch it.

#### Evidence

- Automation removal: src/groundstation/renderer/AutomationWorkflows.jsx:40
- Agent mission transition: src/groundstation/renderer/AgentWorkspace.jsx:276
- Recipe deletion: src/groundstation/renderer/WorkspaceRecipes.jsx:152
- Protocol token checks: src/protocol/index.cjs:845

#### Root Cause

The protocol validates a string rather than proof that a confirmation ceremony occurred. Confirmation policy is duplicated across screens.

#### User Impact

A single misplaced click can delete a recipe, remove automation, cancel a mission, or mark it complete.

#### Severity

**High**

#### Recommended Fix

Create one renderer confirmation service driven by action metadata. Require a dialog for destructive transitions and send a short-lived nonce issued by the engine, not a predictable string manufactured by UI code.

#### Dependencies

Protocol evolution, shared dialogs, action metadata, engine audit logging.

#### Regression Risk

Changing confirmation contracts affects TUI, renderer, tests, and external clients. Version the protocol or retain a compatibility window.

### MC-06 — Needs You is not a unified priority system

#### Issue

Session failures and renderer terminal errors are surfaced, but Mission AI, MCP, automation, mobile, and plugin decisions are fetched and concatenated through separate paths.

#### Evidence

The session attention merge resides in src/groundstation/renderer/App.jsx, while integrations independently subscribe and fetch their pending state.

#### Root Cause

Each subsystem owns its own pending-count and error behavior. There is no normalized engine-owned decision model.

#### User Impact

- Critical counts can exclude external approvals.
- “Mark all seen” can be disabled while external decisions remain.
- Items are not globally ordered by severity or expiry.
- An integration request failure can be shown as zero pending rather than “unavailable.”
- Users cannot trust the empty state.

#### Severity

**High**

#### Recommended Fix

Introduce an engine-owned DecisionRecord with source, type, severity, creation time, expiry, status, available actions, target, and evidence. Needs You should consume one ordered query/subscription.

#### Dependencies

All integration services, persistence, protocol events, notification delivery.

#### Regression Risk

Migrating existing session attention must preserve failure lifecycle semantics and avoid turning intentional exits into errors.

### MC-07 — Recipe “Edit graph” does not edit the selected recipe

#### Issue

The control opens the generic recipe manager, whose draft is rebuilt from current sessions and saved under a new random ID.

#### Evidence

- Misleading action: src/groundstation/renderer/RecipesView.jsx:66
- Builder initialization: src/groundstation/renderer/WorkspaceRecipes.jsx:45

#### Root Cause

The list has no selected-recipe editing contract. “Manage” and “Edit” were treated as equivalent.

#### User Impact

Users can believe they are changing a recipe while actually creating or modifying a different draft.

#### Severity

**High**

#### Recommended Fix

Pass a recipe ID into the editor, initialize from the persisted recipe, distinguish Create/Edit/Duplicate modes, and show unsaved-change protection. Add a confirmation to Delete.

#### Dependencies

Recipe update semantics, version or conflict handling, form normalization.

#### Regression Risk

Updating recipes with an active run can invalidate runtime state. Editing should be blocked or saved as a new version while active.

### MC-08 — Narrow responsive layouts are unreachable in production

#### Issue

The application has responsive rules and captures at 720px and 960px, but the normal BrowserWindow minimum width is effectively 1040px.

#### Evidence

src/groundstation/main/index.cjs:178

#### Root Cause

The visual-capture mode and production window have different geometry constraints.

#### User Impact

Users cannot use the app beside an editor on a laptop or narrow split-screen. Responsive testing validates a state ordinary users cannot reach.

#### Severity

**High**

#### Recommended Fix

Lower production minWidth to a supported breakpoint—probably 720–800px—after resolving the remaining nested-scroll and action-crowding defects at that size.

#### Dependencies

Route-by-route narrow-width acceptance and minimum terminal pane sizing.

#### Regression Risk

Lowering the constraint before fixing route overflow can expose inaccessible controls.

### MC-09 — CSS is operating as an override system, not a design system

#### Issue

Twenty-two active CSS imports contain roughly 14,298 physical lines, 1,665 !important declarations, 888 hexadecimal literals, and 1,288 rgb/rgba declarations.

#### Evidence

- Import order: src/groundstation/renderer/main.jsx
- Current token bridge: src/groundstation/renderer/redesign/tokens-bridge.css
- Legacy base styles: src/groundstation/renderer/styles.css
- Late corrective layer: src/groundstation/renderer/redesign/cockpit.css

#### Root Cause

Successive redesigns were layered over earlier implementations. Specificity and import order now encode architecture.

#### User Impact

Tiny changes can break unrelated routes, theme overrides are difficult to reason about, and visual inconsistency returns whenever a selector is missed.

#### Severity

**High architectural debt**, though not an immediate runtime failure.

#### Recommended Fix

Create a token contract and migrate one component family at a time to scoped primitives. Delete a legacy selector only after reference and visual-matrix verification. Do not attempt a wholesale CSS rewrite.

#### Dependencies

Component inventory, route-level visual tests, theme snapshots, style ownership documentation.

#### Regression Risk

Very high if performed as global cleanup. Moderate if migrated vertically by component with screenshot diffs.

### MC-10 — Event delivery will not scale cleanly with many workers

#### Issue

Every raw terminal event is dispatched to every renderer subscriber. Every TerminalPane filters the stream locally, while non-output events trigger debounced full-state snapshots.

#### Evidence

- Preload subscription fan-out: src/groundstation/preload/index.cjs:42
- Terminal direct stream: src/groundstation/renderer/TerminalPane.jsx
- Per-agent activity scanning: src/groundstation/renderer/AgentWorkspace.jsx:240
- Integration-wide refresh: src/groundstation/renderer/IntegrationsView.jsx:50

#### Root Cause

Subscriptions are global rather than channel- or selector-based.

#### User Impact

With many active terminals and integrations, callback work, snapshot requests, filtering, and object allocation grow unnecessarily.

#### Severity

**Medium now; High at the stated 10+ worker target**

#### Recommended Fix

Add typed subscription channels and session filters at the preload/protocol boundary. Incrementally update normalized renderer stores for routine events; reserve full snapshots for activation, recovery, and detected sequence gaps.

#### Dependencies

Protocol event metadata, replay sequencing, renderer state normalization.

#### Regression Risk

Dropping or reordering events can desynchronize the UI. Sequence-gap recovery is required before optimizing.

### MC-11 — Failed data loading is frequently rendered as an empty state

#### Issue

Several surfaces catch request failures and replace them with empty arrays or zero counts.

#### Evidence

- History memory failure swallowed: src/groundstation/renderer/App.jsx:1105
- Plugin pending refresh becomes zero: src/groundstation/renderer/PluginPlatform.jsx:85
- Similar patterns exist in agent mission and integration loaders.

#### Root Cause

Remote state is represented as data only, without idle/loading/ready/error/stale.

#### User Impact

“Nothing needs attention” can mean “the request failed.” “No mission” can mean “missions could not be loaded.”

#### Severity

**High for attention surfaces; Medium elsewhere**

#### Recommended Fix

Adopt a shared async-resource model with explicit availability and last-success timestamps. Empty states must render only after a successful empty response.

#### Dependencies

Common renderer data hooks and error copy.

#### Regression Risk

Previously hidden failures will become visible and may initially make the application appear less healthy. That is correct behavior.

### MC-12 — Custom interaction semantics are incomplete

#### Issue

Several custom tabs, menus, segmented choices, pseudo-table rows, timeline entries, and form controls lack complete keyboard or accessible-name behavior.

#### Evidence

- Settings choices: src/groundstation/renderer/App.jsx:1134
- Unnamed terminal range input: src/groundstation/renderer/App.jsx:1212
- Hand-built Worker dialog focus behavior: src/groundstation/renderer/WorkerDialog.jsx:87

#### Root Cause

The application uses Radix successfully in some places but implements other equivalent widgets manually.

#### User Impact

Keyboard and assistive-technology users receive inconsistent navigation, focus containment, selection announcements, and activation behavior.

#### Severity

**High for core workflows**

#### Recommended Fix

Use Radix or a shared internal primitive for dialogs, menus, tabs, and roving-focus lists. Give all ranges and time inputs explicit labels. Add keyboard contract tests.

#### Dependencies

Component migration and focus-restoration rules.

#### Regression Risk

Changing focus behavior can affect global shortcuts, terminal input, and Space-to-quick-look interactions.

### MC-13 — Mission AI streaming repeatedly reparses the entire response

#### Issue

The reveal animation adds eight characters per animation frame and reruns the Markdown parser over the complete accumulated string.

#### Evidence

src/groundstation/renderer/MissionAIScreen.jsx:35 and :89–104

#### Root Cause

Streaming presentation is implemented as an animated client-side reveal rather than actual chunk rendering.

#### User Impact

Long answers cause avoidable CPU work and repeated live-region changes. The JavaScript behavior also ignores reduced-motion preferences.

#### Severity

**Medium**

#### Recommended Fix

Render incoming text in bounded time-based chunks, avoid full Markdown parsing on every frame, parse once when stable, honor both application and OS reduced-motion settings, and announce the final result once.

#### Dependencies

Mission AI response model and accessibility behavior.

#### Regression Risk

Changing render cadence can affect perceived responsiveness and code-block layout.

### MC-14 — Stable acceptance failures remain

#### Issue

The full suite is not clean. Three defects remain reproducible in isolated groups, while other failures appear under parallel load.

#### Evidence

- TUI Enhanced Escape guide timeout.
- Stopped-worker edit test retains the prior command.
- Mobile boundary-copy test expects a clear statement that the companion is not a remote shell/mobile IDE.
- VS Code simulated Linux path resolution returns null on Windows because host path is used instead of an explicit POSIX implementation.

#### Root Cause

A mix of TUI input timing/lifecycle behavior, stale or missing product-boundary copy, and platform abstraction leakage.

#### User Impact

Keyboard guidance and stopped-worker editing may be unreliable; mobile capability boundaries are unclear; cross-platform VS Code path logic is not testable reliably from Windows.

#### Severity

**High for worker editing; Medium for the others**

#### Recommended Fix

Fix each isolated failure before addressing parallel flakiness. Then cap full-suite concurrency or remove shared test resources so the suite becomes diagnostic.

#### Dependencies

TUI prompt lifecycle, cross-platform path adapter, mobile product copy.

#### Regression Risk

Low to moderate when fixed independently.

## E. UI Problems

The interface is visually stronger than its code structure suggests, but it feels messy for identifiable reasons:

- Groundstation places a worker register, attention region, status summary, action controls, activity, dependencies, recipe entry, and a persistent inspector into one viewport. The selected inspector can consume roughly 360px while the worker list becomes unusually short.
- Terminal headers contain name, role, state, uptime, owner, cwd, telemetry, keyboard hint, drag, find, overflow, and expand behavior. Container queries hide some fields, but four- and six-pane layouts still devote too much height and width to chrome.
- Agents uses both page scrolling and an internally scrolling detail region.
- Settings is visually tidy but long and flat. Operational diagnostics, preferences, notification policy, integration setup, and developer implementation links appear in the same route.
- Needs You’s empty state is calm, but because load failures can collapse to zero, the blankness is not trustworthy.
- Many surfaces are technically “cards,” even when their semantics are registers, inspectors, or form sections. Borders and rounded containment are doing too much hierarchy work.
- The style cascade creates route-specific differences in gap, border, radius, typography, and control height even where components look nominally related.
- The main CSS output is larger than the main application JavaScript chunk.

The underlying mess is caused by competing component generations and CSS ownership, not merely inconsistent spacing.

## F. UX Problems

- The app’s highest-value question—“What actually needs me now?”—is answered differently by session attention, terminal alerts, integration pending counts, and notification preferences.
- “Recipe” remains navigation terminology while the content alternates among Recipe, Daily Workspace, Startup Template, and Launch Workspace.
- “Edit graph” is not an edit operation.
- Free Port reports success despite failure.
- Native notifications are presented as a usable preference rather than an unavailable capability.
- Broadcast is discoverable but nonfunctional.
- Mobile security copy is stronger than the implementation.
- Agent request failures can appear as “no mission.”
- Integration status errors can appear as disconnected or zero pending without saying the service could not be reached.
- History exposes only the first eight discovered actors as filter options.
- Some contextual capabilities are duplicated in Groundstation, sidebar navigation, status areas, and integration surfaces.
- Agent “current action” correctly avoids fabricating private reasoning; this restraint should remain untouched.
- The UI sometimes mixes engine truth with renderer inference. Worker classification inferred from command/output should be labeled “inferred,” not presented as authoritative evidence.

## G. Broken Functionality

| Function | Status | Evidence-backed result |
|---|---|---|
| Mobile pairing link confidentiality | Broken | Code is placed in plaintext HTTP query |
| Mobile Open in Browser | Broken | Uses window.open while Electron denies pop-ups |
| Broadcast to terminals | Broken/disconnected | Protocol method absent |
| CrashLens Free Port | Broken and misleading | Protocol method absent; failure becomes queued-success toast |
| Default Add Worker submission | Broken | Selected template does not initialize required ID |
| Desktop notifications | UI/configuration only | Preferences persist; delivery absent |
| Recipe Edit graph | Miswired | Opens generic creator rather than selected recipe |
| Recipe Delete confirmation | Missing | Direct protocol dispatch |
| Automation Remove confirmation | Missing | Renderer manufactures confirmation |
| Mission Cancel/Complete confirmation | Missing | Renderer manufactures confirmation |
| Needs You external ordering | Partial | Separate subsystem queues are concatenated |
| History load failure | Misrepresented | Failure swallowed as absent memory |
| Mission load failure | Misrepresented | Failure can appear as no mission |
| Narrow production window | Disabled by shell constraint | Responsive views exist but normal window cannot reach them |
| TUI stopped-worker edit | Failing acceptance | Isolated test retains old command |
| VS Code simulated POSIX path | Failing portability test | Host path API leaks into platform simulation |

## H. Misplaced Elements

- **Settings → Resources:** links to Radix, cmdk, or implementation libraries belong in developer documentation or About/Diagnostics, not end-user preferences.
- **Settings → Operational facts:** engine contract and recovery-controller diagnostics should move to an About/Diagnostics surface.
- **Groundstation detailed mission graphs:** should remain contextual in an inspector or drawer rather than consuming persistent command-center space.
- **Mission AI:** its sidebar-footer placement makes it discoverable, but it behaves like a separate tool. Keep the entry, while also exposing contextual “Ask Mission AI” actions from failures, workers, and history.
- **Recipes:** keeping Recipes in the sidebar is appropriate, but Run Recipe also belongs prominently in Groundstation because it is an operational action.
- **Integrations:** keeping it contextual rather than promoting it above the core seven routes is correct.
- **Terminal operations:** rename/reconfigure, restart, stop, remove, and evidence belong in the terminal overflow or inspector. The decision not to retain a permanent standalone Delete button is correct.
- **Notification testing:** when native notifications are implemented, Send test notification belongs immediately beside notification delivery settings, with a persistent result.
- **Plugin contribution surfaces:** renderer-owned normalized contribution slots are correct. Arbitrary plugin HTML should not be added.

## I. Design System Problems

Mission Control has a visual style, but not yet a single enforceable design system.

### Current conflicts

- Multiple token generations.
- Component values hard-coded directly alongside tokenized values.
- Legacy selectors overridden by late layers.
- Heavy reliance on !important.
- High-specificity correction patterns.
- Repeated reduced-motion implementations in separate CSS files.
- Different control families for buttons, tabs, chips, and segmented choices.
- Multiple icon sizing conventions.
- Route-specific surfaces that reproduce generic card anatomy.
- Dormant redesign files remain in the repository and make ownership ambiguous.

### Recommended token architecture

    Primitive
      color.gray.950
      space.2
      radius.2
      font.size.sm
            ↓
    Semantic
      surface.canvas
      surface.panel
      border.muted
      text.primary
      status.danger
      focus.ring
            ↓
    Component
      terminal.header.height
      navigation.item.active
      decision.critical.surface

Rules:

- Components consume semantic or component tokens, not raw palette values.
- Theme classes redefine semantic tokens.
- Density changes component metrics, not arbitrary individual margins.
- Status tones retain the same semantic meaning across every route.
- Animation tokens define duration/easing and include a zero-motion variant.
- New components may not depend on import order to defeat old selectors.

## J. Terminal Workspace Audit

### What works

- PTYs are engine-owned.
- Xterm receives raw stream data directly.
- Output is not copied through page-level React state.
- Replay-before-live behavior is considered.
- Resize observers and xterm fitting are cleaned up.
- Engine exit prevents subsequent PTY resize IPC while local reflow continues.
- Copy, selection, scrolling, find, focus, stop, restart, remove, and expansion foundations exist.
- Terminal history and stream sizes are bounded.
- Layout ratios persist by project.
- Destructive terminal removal uses a shared confirmation path.

### Density and scale

Current layouts support:

- 1
- 1×2
- 2×1
- 2×2
- 3×2

Only six session IDs are mounted in the visible grid. Ten configured workers can exist, but ten simultaneous terminal tiles cannot.

That is a reasonable rendering ceiling for live xterm instances, but the product needs a clearer scale model:

- Keep at most four to six mounted terminals.
- Provide searchable terminal tabs/groups/workspace sets for additional workers.
- Allow saved pane assignments.
- Surface background-worker status without mounting an xterm.
- Hibernation or deferred mounting should be considered before allowing 10+ live terminals.

### Header problems

The terminal header is functionally rich but overcrowded. The correct fix is not simply smaller text. It needs progressive disclosure:

1. Always visible: worker name, state, one primary action, overflow.
2. Visible when space permits: role and runtime.
3. Contextual/tooltip/inspector: owner, cwd, telemetry, shortcut hint.
4. Activity details: inspector or expanded state.

### Interaction concerns

- The manual session chooser uses menu-like semantics without complete Escape, outside-click, or arrow-key behavior.
- Rename exists through Reconfigure rather than as an explicit label-level action.
- Duplicate terminal is absent.
- The splitter’s window listeners can survive a view unmount during a drag.
- The 3×2 layout has limited independent column adjustment.
- screenReaderMode is not configured for xterm; terminal accessibility remains unverified.

### Scrolling

Core terminal flex/grid containers correctly use min-width: 0, min-height: 0, and contained overflow. This is one of the better-implemented layout areas.

The primary scaling problem is not a missing min-height: 0; it is the product’s six-pane model, header density, and the unreachable narrow window mode.

## K. Groundstation Audit

Groundstation is close to the right product concept. It is an operational register, not a generic chart dashboard.

It currently answers:

- What is running?
- Which workers failed?
- Which sessions require attention?
- What changed recently?
- What recipes can run?
- What worker is selected?
- What dependencies or evidence exist?

It does not answer reliably:

- Are all decision sources healthy and loaded?
- Which item is globally most urgent?
- Does “Healthy” include external approvals?
- Is a displayed worker role engine truth or renderer inference?
- What should I do next when nothing is broken?

### Recommended hierarchy

Above the fold:

1. Compact project/engine health.
2. Unified critical decision strip.
3. Dense worker register with inline actions.
4. Selected-worker inspector only when selected.

Below/contextual:

- Recent activity.
- Dependency detail.
- Longer evidence.
- Recipe catalog.
- Mission graphs.
- Integration diagnostics.

The worker register should gain more vertical space. Activity and detailed context should not permanently compete with the primary operating surface.

Do not replace the register with cards or add decorative charts.

## L. Agents Audit

### Working capabilities

- Adapter discovery and creation.
- Start/stop lifecycle.
- Mission contracts.
- Evidence and checkpoint structures.
- Approval state.
- Activity inspection.
- Terminal association.
- Agent detail view.
- Honest “unreported” behavior when an action cannot be known.

### Problems

- Mission-loading failures can become an empty mission list.
- Detail tabs do not implement full roving tab behavior or clearly associated tabpanels.
- Cancel and Mark Complete bypass a visible confirmation ceremony.
- Activity is repeatedly filtered per agent on each render.
- The layout has nested page/detail scrolling.
- Communication is distributed between mission actions, terminal access, and evidence rather than presented as a single clear interaction zone.
- An unused legacy AgentsView remains in App.jsx even though the route uses AgentWorkspace.

### Recommended hierarchy

- Roster/register: name, adapter, state, current reported task, last event, attention.
- Inspector header: Stop, Open terminal, Send/Respond, overflow.
- Detail tabs: Overview, Conversation, Evidence, Activity, Configuration.
- Needs You should own all approvals and blocking questions, while the agent inspector links to the relevant decision.

## M. Needs You Audit

Session failure truth is better than a typical notification feed:

- status === failed and attentionRequired are respected.
- Renderer terminal transport failures are kept separate from engine lifecycle.
- Terminal recovery can dismiss renderer-originated alerts without falsifying engine state.

The weakness is aggregation. Needs You is a renderer composition of independent sources rather than an engine-owned decision system.

The All/Critical/Agents model should operate over one normalized record set. A record needs:

- severity
- source
- target
- request type
- evidence
- requested action
- creation time
- expiry
- resolution state
- unavailable/error state
- deep link
- audit trail

Mark all seen should affect visibility/read state, not silently resolve approvals. There should be no bulk approve.

Completed builds should normally go to History or notifications, not Needs You, unless user acknowledgement is required.

## N. Recipes Audit

### Engine

The recipe engine is one of the stronger features:

- Persistent recipe definitions.
- Dependency graph.
- Readiness gates.
- Parallelism limits.
- Pause/resume/cancel.
- Failure and rollback state.
- Retry controls.
- Bounded steps and concurrency.

### UX

The creator communicates graph concepts better than its terminology suggests, but it still assumes the user knows why a recipe exists.

A new user should see:

> A recipe starts a repeatable set of workers in the required order and waits for each one to become ready.

The builder should then explain:

1. Which workers participate?
2. Which can start together?
3. What proves each worker is ready?
4. What happens when one fails?
5. What should be stopped during rollback?
6. What terminal layout should open?

Missing or incomplete:

- True edit.
- Duplicate.
- Per-recipe execution history.
- Clear version behavior.
- Safe deletion confirmation.
- Scheduling semantics.
- Strong recovery explanation.
- Active-run edit rules.

Daily Workspace is more understandable than Recipe, but mixing both terms increases cognitive load. Recommended label: **Recipes**, with the subtitle **Repeatable workspace launches**.

## O. Integrations Audit

### Mission AI

Mostly real:

- Secure credential path.
- Provider configuration.
- Structured project context.
- Evidence-oriented UI.
- Streaming presentation.

Problems:

- Expensive reveal animation.
- Reduced-motion mismatch.
- No live-provider acceptance in this audit.
- Error and credential state should be more explicit.

### MCP

Substantial real implementation:

- Bounded scopes.
- Approval-sensitive operations.
- Local service model.
- Audit/status concepts.

The MCP terminal.input.request scope must not be confused with a renderer Protocol method of the same name. The renderer Broadcast feature does exactly that.

### VS Code Bridge

Real authenticated loopback architecture and bounded capabilities exist. The failing cross-platform path abstraction should be repaired before claiming broad platform correctness.

### Mobile

Substantial service and client implementation exists, but:

- Pairing code confidentiality is broken.
- Open in Browser is broken.
- Product-boundary copy is insufficient.
- Physical Android release acceptance is unverified.
- Security copy currently overclaims.

### Automation

The design is appropriately approval-oriented, but deletion bypasses meaningful confirmation and load failures are not surfaced consistently.

### Plugins

The current declarative, permission-controlled model is a good local-first security decision. It should be described as a declarative plugin platform, not as arbitrary executable extensions.

### Integration overview

The unified audit is not fully unified; Mission AI, VS Code, and automation are not represented with the same depth as MCP, mobile, and plugins. Refreshing all statuses after any integration event also causes avoidable request bursts.

## P. Settings Audit

Recommended groups:

1. Appearance and accessibility.
2. Terminal.
3. Notifications.
4. Project defaults.
5. Integrations.
6. Security and privacy.
7. Diagnostics.
8. About.

Current problems:

- Implementation-resource links are misplaced.
- Operational facts are diagnostics, not preferences.
- Native-notification controls are nonfunctional.
- Notification save is optimistic without robust rollback.
- Theme/density/motion choice buttons lack complete selection semantics.
- Terminal font-size range lacks an explicit accessible name.
- Quiet-hour inputs need independent Start and End labels.
- Restore Defaults should preview scope and confirm when it affects more than harmless visual preferences.
- Settings failure feedback should persist rather than disappear as a short toast.

## Q. Accessibility Problems

### Positive foundation

- Skip link exists.
- Main content receives focus on navigation.
- Visible focus styles exist.
- Many icon buttons have labels.
- Radix is used for several dialogs and menus.
- Reduced-motion CSS exists.
- Major screens have semantic headings.

### Significant gaps

- Custom Settings choices need radiogroup or toggle-group semantics.
- Agent tabs need arrow navigation, roving tabindex, and tabpanel relationships.
- Manual terminal menus need complete keyboard behavior.
- WorkerDialog should use a proven focus trap and restore focus on close.
- Timeline articles respond to Enter but should also support Space or use native buttons/links.
- Pseudo-table roles on interactive Groundstation articles do not implement complete grid/table keyboard semantics.
- Arrow-key selection changes state without necessarily moving DOM focus.
- Terminal range and quiet-hour controls need distinct labels.
- Mission AI’s animated live output can cause repeated announcements.
- Xterm screen-reader behavior is not configured or tested.
- Action-bearing toasts should persist until acted on or dismissed.
- Quick Look behaves like a modal but has hand-built lifecycle semantics.
- Application reduced-motion settings should govern JavaScript animation, not CSS alone.

## R. Performance Problems

### Strong decisions already present

- Terminal output bypasses React state.
- Terminal replay is bounded.
- Activity is bounded to approximately 200 entries.
- Protocol queues and open-terminal counts are bounded.
- Resource sampling history is bounded.
- Recipe steps, retries, and parallelism are bounded.
- Mission history is bounded.

### Risks

1. Every subscriber receives every terminal event.
2. Full state is re-fetched after non-output events.
3. IntegrationOverview refreshes multiple services after any integration event.
4. Agent activity uses repeated array filtering.
5. Mission AI reparses accumulated Markdown every animation frame.
6. Each mounted terminal has its own ResizeObserver and uptime interval.
7. History renders up to 200 records without virtualization.
8. The CSS bundle is unusually large for the product.
9. More than six live xterm instances would materially increase layout and observer cost.
10. Full-suite parallel instability suggests shared resource or timing pressure in tests.

Recommended order:

- Add event channels.
- Normalize renderer data by ID.
- Build pre-indexed activity selectors.
- Coalesce integration refreshes.
- Remove per-frame Markdown parsing.
- Virtualize only where measured; the bounded 200-row History list is not yet a P0.

## S. Architectural Problems Affecting UX

- **Fragmented attention ownership:** cannot be fixed by restyling Needs You.
- **Predictable confirmation tokens:** cannot be fixed by adding a modal alone.
- **Global event fan-out:** cannot be fixed by React memoization alone.
- **App.jsx concentration:** makes route behavior and shell behavior overly coupled.
- **Async data represented as arrays:** produces false empty states.
- **Renderer-derived operational classification:** blurs engine truth and UI inference.
- **Integration-specific state models:** cause inconsistent errors, pending counts, and audit presentation.
- **CSS import order as authority:** makes design correctness non-local.
- **Visual features added before protocol contracts:** caused Broadcast and CrashLens failures.
- **Test harness/platform abstraction leakage:** makes Windows-hosted cross-platform claims unreliable.

Recommended module boundaries:

    shell/
      navigation, project switcher, keyboard routing

    features/
      groundstation/
      workspace/
      attention/
      agents/
      recipes/
      history/
      settings/
      integrations/

    platform/
      mission-client
      event-store
      confirmation-service
      notification-service

    ui/
      dialog, menu, tabs, status, decision-row, register, inspector

## T. Dead / Duplicate / Legacy Code

Items safe to investigate, but not delete without another reference pass:

- Unused local AgentsView in App.jsx; the actual route uses AgentWorkspace.
- Unused local IntegrationsView; the real route uses the imported integration hub.
- Nine dormant redesign CSS files:
  - experience27.css
  - experience28.css
  - experience29.css
  - experience30.css
  - theme-concept.css
  - reference-v5.css
  - reference-final.css
  - redesign-v4.css
  - prototype2026.css
- Generic EngineAPI integration listing appears tied primarily to the unused legacy view.
- @openrouter/sdk and shadcn appear in dependencies but have no runtime source imports.
- Update verification exists as tested groundwork but is not integrated into a complete updater UI/runtime.
- package.json lists milestone/acceptance documents that are absent from the checkout.
- Repeated reduced-motion rules exist in legacy and premium CSS layers.
- Similar integration subscription/fetch logic is duplicated across MCP, mobile, plugins, and overview surfaces.

The audit did not find widespread fake worker/session data or large commented-out production implementations. Most major backend features are real; the disconnected functionality is concentrated in a smaller number of recently added renderer controls.

## U. Feature Completeness Matrix

| Feature | Classification | Qualification |
|---|---|---|
| Electron shell/security | Mostly Working | Strong code; physical release acceptance unverified |
| Project switching/workspace lease | Mostly Working | Real lifecycle; shutdown/relaunch still deserves physical Windows tests |
| PTY/session lifecycle | Fully Working by code/tests | Engine-owned, bounded, replayable |
| Terminal Workspace | Mostly Working | Strong 1–6 pane support; weak 10+ worker navigation and a11y |
| Worker creation | Broken default path | Template and draft defaults disagree |
| Worker reconfiguration | Mostly Working | Renderer engine path exists; isolated TUI edit test fails |
| Groundstation | Mostly Working | Real data and actions; hierarchy and truth-source issues remain |
| Agents | Mostly Working | Real adapters/missions/evidence; error and confirmation gaps |
| Needs You — sessions | Mostly Working | Failed/attention sessions and renderer terminal alerts work |
| Needs You — global | Partially Working | External decisions are fragmented |
| Recipe engine | Fully Working by repository evidence | DAG, gates, persistence, recovery |
| Recipe UI | Partially Working | Edit is misleading; no duplicate/version history |
| History | Mostly Working | Real bounded activity; weak loading-error model |
| Mission AI | Mostly Working | Real service; provider acceptance and streaming performance unresolved |
| MCP | Mostly Working | Strong bounded foundation; live external-client acceptance not performed |
| VS Code Bridge | Mostly Working | Portability test failure; physical VSIX acceptance unverified |
| Automation | Mostly Working | Real engine/service; confirmation and error-state gaps |
| Mobile backend | Mostly Working | Real local service/encryption after pairing |
| Mobile pairing web flow | Broken security boundary | Secret in query URL |
| Mobile Open in Browser | Broken | Blocked by Electron window policy |
| Plugin platform | Mostly Working | Declarative platform, not arbitrary executable plugins |
| Desktop notifications | Disconnected/UI only | Preferences without native delivery |
| Broadcast Terminal | Broken/disconnected | No protocol method |
| CrashLens diagnosis | Partially Working | Diagnosis/restart/AI paths exist; Free Port is broken |
| Command palette/help | Mostly Working | Needs continued keyboard regression coverage |
| TUI | Mostly Working | Two isolated acceptance failures |
| Update verification | Foundation/deferred | No complete app-update workflow |
| Windows packaging/signing | Unclear | Not provable from source/build alone |
| Android release | Unclear | Source exists; signing/device acceptance unverified |

## V. Missing Features

### P0 — Unified decision broker

- **Problem:** Needs You cannot guarantee completeness or global priority.
- **Target user:** Anyone supervising several workers or integrations.
- **Workflow:** Every subsystem emits a normalized decision; one queue sorts, resolves, audits, and deep-links it.
- **Location:** Engine/protocol foundation plus Needs You.
- **Fit:** This is central to Mission Control.
- **Dependencies:** Sessions, Mission AI, MCP, automation, mobile, plugins, notifications.
- **Difficulty:** High.
- **UX complexity:** Medium.
- **Performance:** Positive if it replaces multiple polling paths.

### P0 — Truthful capability/availability contract

- **Problem:** UI controls appear before protocol support or hide loader failures.
- **Target user:** All users.
- **Workflow:** Feature descriptors report supported, unavailable, disabled, loading, error, or ready.
- **Location:** Protocol handshake and shared renderer resource hooks.
- **Fit:** Prevents false buttons and empty states.
- **Dependencies:** Protocol versioning.
- **Difficulty:** Medium.
- **UX complexity:** Low.
- **Performance:** Negligible.

### P1 — Recipe editing, duplication, and run history

- **Problem:** Recipes are powerful but difficult to maintain safely.
- **Target user:** Developers repeatedly starting the same project stack.
- **Workflow:** Open recipe → inspect version → edit or duplicate → validate graph → save → inspect previous runs.
- **Location:** Recipes.
- **Dependencies:** Recipe update/version semantics.
- **Difficulty:** Medium.
- **UX complexity:** Medium.
- **Performance:** Low impact; bound run history.

### P1 — Scalable terminal workspace sets

- **Problem:** Six panes are the visual maximum while larger projects can have many workers.
- **Target user:** Multi-service and multi-agent projects.
- **Workflow:** Save named pane sets, switch quickly, search workers, mount only visible xterms.
- **Location:** Workspace command deck.
- **Dependencies:** Pane assignment persistence and terminal mount lifecycle.
- **Difficulty:** Medium-high.
- **UX complexity:** High.
- **Performance:** Positive if hidden terminals are not mounted.

### P1 — Real notification delivery and diagnostics

- **Problem:** Attention is lost when the app is backgrounded.
- **Target user:** Developers running long builds or agents.
- **Workflow:** Configure → send test → receive native toast → click to open the corresponding decision.
- **Location:** Main process, Needs You, Settings.
- **Dependencies:** Unified decisions.
- **Difficulty:** Medium.
- **UX complexity:** Medium.
- **Performance:** Requires rate limiting.

### P2 — Integration health diagnostics

- **Problem:** Connected/disconnected is insufficient to explain failures.
- **Target user:** Users configuring MCP, VS Code, mobile, AI, or plugins.
- **Workflow:** Run bounded self-test → see permissions, endpoint, last success, last error, recommended recovery.
- **Location:** Integrations and Diagnostics.
- **Dependencies:** Per-service diagnostic contracts.
- **Difficulty:** Medium.
- **UX complexity:** Medium.
- **Performance:** Run on demand, not continuous polling.

### P2 — Operational history export

- **Problem:** Evidence cannot easily be shared or retained outside the bounded in-app feed.
- **Target user:** Developers diagnosing failures or documenting work.
- **Workflow:** Filter history → export sanitized JSON/Markdown.
- **Location:** History.
- **Dependencies:** Redaction and secret scanning.
- **Difficulty:** Medium.
- **UX complexity:** Low.
- **Performance:** On-demand only.

### P3 — Local recipe scheduling

- **Problem:** Repetitive local workflows still require manual launch.
- **Target user:** Advanced users with predictable local routines.
- **Workflow:** Attach a local schedule with clear sleep/offline behavior and approval policy.
- **Location:** Recipe detail.
- **Dependencies:** Persistent local scheduler, wake/sleep semantics, safety policy.
- **Difficulty:** High.
- **UX complexity:** High.
- **Performance:** Low if event-driven.
- **Caution:** Do not add scheduling until recipe editing, notifications, and attention reliability are complete.

## W. Small Polish Problems

- Recipe, Daily Workspace, Launch Workspace, and Startup Template need a controlled terminology hierarchy.
- Some interface labels alternate title case and sentence case.
- Status colors need one semantic mapping across terminal, agent, recipe, integration, and attention surfaces.
- Icon sizes vary between approximately 12px, 13px, and larger defaults for equivalent actions.
- Multiple control families represent selection differently.
- Some menus use Radix while visually similar menus are hand-built.
- Terminal keyboard hints consume persistent header space despite being secondary help.
- Settings quiet-hour fields need explicit Start and End labels.
- Disabled and unavailable need visually distinct states.
- Long CWD, command, and agent labels need consistent middle/end truncation policy.
- Action toasts should not disappear while an action is still available.
- Groundstation’s selected worker should remain visible when filters change or be clearly deselected.
- History’s selected event can remain in the inspector after it no longer matches the active filter.
- Empty states should differentiate successfully empty, not configured, offline, and failed to load.
- Cursor behavior should consistently indicate draggable splitters and clickable rows.
- Dialog footer reachability needs regression coverage at minimum supported height.
- The application’s color-scheme metadata should follow the active theme rather than being effectively dark-first.
- Google Fonts CSP/preconnect entries appear unnecessary because the current fonts are locally packaged.

## X. Recommended Information Architecture

Keep the sidebar. The existing order is fundamentally sound:

1. Groundstation
2. Workspace
3. Needs You
4. Agents
5. Recipes
6. History
7. Settings

Integrations should remain contextual, accessed from Settings, Groundstation status, or a secondary navigation section.

### Groundstation

- Project health
- Unified decisions
- Worker register
- Contextual inspector
- Recent operational activity
- Run Recipe

### Workspace

- Worker/pane search
- Named pane sets
- Layout/focus controls
- Terminal grid
- Contextual terminal inspector

### Needs You

- All
- Critical
- Agents
- Integrations
- Resolved/recent history

Filters should operate over one engine-owned queue.

### Agents

- Roster
- Selected-agent inspector
- Conversation
- Mission/evidence
- Activity
- Configuration

### Recipes

- Recipe list
- Create/Edit/Duplicate
- Run state
- Run history
- Recovery details

### History

- Operational events
- Decisions
- Recipe runs
- Search/filter/export

### Settings

- Appearance
- Terminal
- Notifications
- Security/privacy
- Integration configuration
- Diagnostics
- About

## Y. Recommended UI/UX Direction

Mission Control should continue toward a compact, high-contrast developer cockpit—not a generic SaaS dashboard.

The visual grammar should be:

- Registers and rows for operational collections.
- Inspectors for detail.
- Compact toolbars for actions.
- One persistent accent color.
- Semantic status colors used sparingly.
- Few surfaces, with hierarchy created by typography and spacing before borders.
- Minimal radius variation.
- Monospace only for commands, paths, IDs, ports, and evidence.
- Progressive disclosure instead of permanently visible metadata.
- Motion limited to navigation, selection, expansion, progress, success, failure, and attention.
- No decorative telemetry.
- No fabricated agent reasoning.
- No security or availability claim stronger than the implementation.

Keep untouched:

- Engine-owned PTYs.
- Protocol allowlist.
- Electron sandbox and main-frame IPC restrictions.
- Local-first persistence.
- Bounded buffers and limits.
- OS-backed credential handling.
- Declarative plugin security.
- Sidebar navigation.
- Terminal-first workflow.
- Separation between engine failures and renderer terminal-transport failures.

## Z. Prioritized Improvement Roadmap

### P0 — Fix immediately

1. Replace mobile query-string pairing secrets with fragment/manual transfer.
2. Hide Broadcast and Free Port until real protocol methods exist.
3. Remove CrashLens’s false queued-success fallback.
4. Route Open in Browser through the approved preload external-opening API.
5. Fix Add Worker’s initial valid draft and duplicate-safe ID.
6. Remove or clearly disable native notification settings until delivery exists.
7. Add real confirmations for recipes, automation, and mission transitions.
8. Make loader failures visible in Needs You, Agents, History, and Integrations.
9. Fix the stable isolated acceptance failures.
10. Add contract tests asserting every renderer request method exists in Protocol v1.

### P1 — High priority

1. Introduce the unified decision broker.
2. Add typed/channel-filtered renderer subscriptions.
3. Decompose App.jsx by feature without altering EngineAPI contracts.
4. Create shared async-resource, confirmation, menu, dialog, and tabs primitives.
5. Make recipe editing real and add duplication.
6. Lower the production minimum width after route acceptance at 720–960px.
7. Redesign terminal headers around progressive disclosure.
8. Add named terminal workspace sets for more than six workers.
9. Implement native notifications backed by unified decisions.
10. Complete keyboard and screen-reader contracts for core workflows.

### P2 — Product improvement

1. Consolidate CSS vertically by component family.
2. Remove verified dormant CSS and unused legacy views.
3. Add recipe run history and sanitized History export.
4. Add integration self-tests and last-known-good status.
5. Pre-index agent/activity data and coalesce integration refreshes.
6. Replace Mission AI’s frame-by-frame Markdown parsing.
7. Add diagnostics and About as distinct from Settings.
8. Add saved workspace/pane assignments.

### P3 — Future / experimental

1. Safe local recipe scheduling.
2. Terminal hibernation for very large worker sets.
3. Out-of-process or sandboxed executable plugin capabilities only if the declarative model proves insufficient.
4. Cross-device relay only with an explicit threat model and without weakening the local-first default.

### Exact implementation sequence

The safest transformation order is:

1. Freeze current EngineAPI and Protocol behavior with renderer-to-protocol contract tests.
2. Repair security and false-success defects.
3. Repair primary creation and confirmation workflows.
4. Establish the unified decision/error model.
5. Establish typed event channels and normalized renderer state.
6. Split App.jsx along feature boundaries.
7. Migrate shared interactive primitives for accessibility.
8. Consolidate design tokens and CSS one component family at a time.
9. Improve terminal scale and narrow-window layouts.
10. Complete Recipes, Notifications, History, and Integration diagnostics.
11. Run build, focused suites, full serial and parallel suites, visual matrix, keyboard acceptance, real Electron/PTY acceptance, Windows notification tests, installer tests, and physical mobile/VS Code checks.

That sequence fixes trust and correctness before visual consolidation, while preserving the engine, PTY, persistence, and security foundations that already work.
