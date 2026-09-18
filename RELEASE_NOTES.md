# OUTARCH 2.19.0 — the app is now OUTARCH

- Renames Mission Control to OUTARCH everywhere a person reads the name: the
  window and taskbar, dialogs, notifications, the sidebar, Settings > About,
  the phone companion, the MCP gateway page, the VS Code bridge, the Android
  client, the TUI and the CLI. Feature names (Groundstation, Mission AI,
  Mission Command) are unchanged.
- Adds the OUTARCH logo: the glitch O app icon on the window, taskbar, Windows
  notifications, Android launcher, phone home screen and VS Code; the wordmark
  on the startup screen, the sidebar and About. Brand sources live in
  `assets/brand/source/`; `scripts/brand/build-brand-assets.py` rebuilds every
  derived image.
- Gives the desktop app its own data folder (`%APPDATA%\OUTARCH`). Until now
  it shared Electron's generic folder with every other unpackaged Electron
  program. The first launch copies projects, sealed keys, credentials and
  window layouts across, never moves or deletes the originals, and keeps
  using the old folder if the copy cannot finish. `OUTARCH_USER_DATA_DIR`
  points the app at any other folder.
- Opens one OUTARCH at a time: launching it again brings the open window to
  the front instead of failing on the project that window already holds. A
  launch with `--config` still opens a separate workspace.
- Windows toasts are headed "OUTARCH" with the app icon.
- The launcher no longer reinstalls dependencies on every start (it looked
  for a node-pty file that prebuilt releases do not have) and rebuilds the
  renderer only when it changed. `OPEN_OUTARCH_WINDOWS.cmd` is the new
  launcher; the old name still works.
- History's run chapters read at the app's type floor again (names and
  summaries were 9-11px) and keep the whole name beside the state badge.
- Identifiers other tools and saved data depend on are unchanged: storage
  keys, IPC channels, the MCP server key, the VS Code extension id and the
  Android package.

# Mission Control 2.19.0 — full-app concept UI

- Maps the supplied full-app HTML concept onto the actual Electron/React
  renderer rather than shipping a second static prototype.
- Uses the graphite canvas, 64px instrument rail, live project tape, restrained
  bracket accents, dense manifests, semantic state color, and contextual AI
  styling consistently across every application route.
- Adds visible rail hover labels, a project identity mark, current-screen status
  crumb, narrow layouts, bounded scroll ownership, reduced-motion handling, and
  forced-colors support.
- Keeps Workspace terminal panes as the primary work surface and preserves all
  real terminal, recipe, agent, history, project, AI, VS Code, MCP, automation,
  mobile, and plugin interactions.
- Separates operational workers from AI crew on Groundstation so agents are not
  rendered twice.
- Opens failed or attention-requiring workers in evidence review before any
  restart is offered from the overview.
- Corrects Mission AI authority copy: answers are read-only; action plans are
  proposals that still require local approval.
- Adds prototype-alignment regression coverage and keeps the production bundle
  and complete engine test suite as release gates.

---

# Mission Control 2.18.1 — terminal actions and scrolling correction

- Adds a permanently visible Delete button to every populated terminal pane.
  Removal still opens the existing local confirmation and executes only through
  `action.dispatch` and EngineAPI.
- Replaces the clipped custom three-dot menu with a portalled Radix menu. Start,
  restart, acknowledge, copy, clear, stop, and delete now receive pointer and
  keyboard input outside terminal-pane overflow containment.
- Adds explicit feedback for copy-without-selection, successful copy, and clear
  display actions.
- Establishes one application page-scroll owner and removes paint containment
  from content screens that was clipping scrolled output.
- Gives Workspace a minimum usable terminal height while allowing the page to
  scroll on short windows.
- Gives New Worker, Recipes, Mission AI, agent picker/editor, Mission Graph,
  Help, Quick Look, worker focus, confirmation, and command dialogs bounded,
  visible vertical scroll paths.

---

# Mission Control 2.18.0 — operational workspace UX

This release turns the highest-traffic screens into simpler, direct operating
surfaces while preserving EngineAPI, PTY ownership, approval, and integration
security boundaries.

## Groundstation and daily startup

- Live Project Environment is now the first Groundstation surface. The Evidence
  Briefing and duplicate Terminal Wall, Agent Operations, and Project Memory
  runway cards are no longer part of the live composition.
- Live Project Scene is rebuilt as a bounded worker list plus a responsive,
  scroll-safe selected-worker inspector. Long agent names, commands, and status
  summaries can no longer push the inspector outside the window.
- Saved Daily Workspaces now appear directly on Groundstation with Launch and
  Recover controls. Running workers are reused through the existing recipe
  engine and never create duplicate PTYs.

## Workspace, Needs You, and Agents

- Terminal headers are compact. Search and focus stay visible; restart, stop,
  acknowledge, copy, clear, and the new Delete Terminal action live in one
  described menu. Delete still requires the existing exact EngineAPI
  confirmation.
- Needs You always renders its All, Critical, and Agents filters, includes
  Mission Supervisor, Mission, and MCP approvals in agent totals, and provides
  explicit empty states instead of blank filtered views.
- Agents is now full width and summary-first: total, active, needs-you, and
  standing-by counts; plain observable descriptions of what each agent is
  doing; a horizontal selector; and prominent Add More Agents actions.

## Creation, recipes, and contextual help

- New Worker now explains the three-step flow, uses clearer templates and
  field hierarchy, and includes an AI help entry point.
- Daily Workspace recipes default to a simple select-and-order model. Readiness
  gates, dependency graphs, retries, failure policy, and recovery are available
  under Advanced Startup Controls.
- Worker and recipe help opens Mission AI with bounded, contextual questions.
  It does not auto-submit, execute tools, or bypass local approvals.
- MCP Gateway and Mobile Companion now have direct working Settings links and
  Mission Command entries.

## Verification boundary

- All 15 renderer JSX entry files parse successfully.
- All 286 automated tests pass with the declared dependency cache connected,
  and the Vite production renderer was rebuilt with the new operational UX.
- Windows publisher signing, Android release signing, hosted relay/update
  infrastructure, and physical Windows 11/Android acceptance still require the
  release owner's credentials, infrastructure, and devices.

---

# Mission Control 2.17.0 — UI/UX system and operational clarity

This release makes the live application easier to scan and operate without
moving process, PTY, credential, or approval authority into React.

## Experience system

- Adds semantic typography, spacing, surface, border, radius, motion, focus,
  domain-accent, and operational-status tokens.
- Adds Orbital Dark, Solar Light, and High Contrast themes plus compact,
  comfortable, and spacious density modes.
- Unifies dialog and overlay treatment, honors reduced motion globally, keeps a
  visible focus system, and adds an F1 keyboard reference and status bar.
- Preserves seven durable destinations and removes persistent shortcut clutter.

## Core surfaces

- Makes the live supervision composition the default Groundstation and places
  the bounded Project Supervision briefing before secondary content.
- Gives PTYs the majority of Workspace space, flattens terminal chrome, makes
  structured worker facts primary, and puts raw evidence behind disclosure.
- Adds terminal themes, cursor and scrollback preferences, in-pane search,
  copy-selection, and clear controls without changing PTY ownership.
- Turns Needs You into a compact decision queue and Settings into a stable
  sidebar information architecture.
- Turns Projects into a searchable keyboard-friendly switcher.

## Contextual integrations

- Mission AI now keeps bounded session-only prior turns while its dialog is
  open. Provider requests remain stateless; evidence links open History and
  plans still execute only after exact approval in Needs You.
- VS Code Bridge now presents a truthful three-step setup path while preserving
  observe-only VS Code terminals and approved managed-terminal controls.
- Mobile pairing details can be copied, and the UI states clearly that this
  source build is LAN-only until a separately hosted authenticated relay exists.

## Verification boundary

- Updated source architecture checks pass for the new live Groundstation,
  semantic layer, terminal preferences, contextual AI, MCP, and VS Code rules.
- JSX source parsing passes for every changed renderer component.
- Electron native acceptance must still be run on Windows 11. Windows publisher signing,
  Android release signing, hosted relay/update infrastructure, and physical
  Windows/Android acceptance remain release-owner work and are not claimed.

---

# Mission Control 2.16.0 — Unified project supervision

This batch gives Groundstation, Mission AI, and MCP one bounded operational
model while keeping all process, PTY, and mutation authority behind EngineAPI
and exact local approval.

## Added

- A service-owned Project Supervision snapshot that answers what is running,
  what changed, and what needs the operator.
- Stable evidence IDs and an explicit facts-versus-inferences boundary across
  Groundstation, Mission AI, and MCP.
- Grounded Mission AI JSON answers with validated evidence citations and
  optional time ranges containing confidence, assumptions, and missing
  evidence. Percentages and invented deadlines remain prohibited.
- Read-only MCP resources for unified supervision, workers, recent history,
  recipes, and VS Code ownership, plus a `mission_control_supervision` tool.
- Dependency-aware workspace-profile validation before approval, including
  duplicate worker/profile rejection and recipe cycle validation.
- A responsive supervision briefing inside the existing Groundstation and
  evidence/range presentation inside Mission Command.

## Preserved

- React does not own or inspect processes and PTYs.
- Mission Control workers remain EngineAPI-owned; Full Attach remains a view of
  the existing PTY.
- VS Code-owned terminals remain observe-only. Only explicitly managed VS Code
  terminals expose approved controls.
- Gemini remains stateless and observe-only for answers. Proposed mutations and
  exact terminal input remain inert until local approval in Needs You.
- No new top-level Git, tests, Docker, logs, VS Code, or assistant page was
  introduced.

---

# Mission Control 2.15.0 — VS Code managed terminals

This batch implements the first production slice of the dual-ownership VS Code
terminal bridge while preserving the v1.7 Groundstation composition and the
EngineAPI PTY boundary.

## Added

- Stable VS Code terminal IDs and explicit `vscode-owned` versus
  `mission-control-managed` ownership.
- Bounded activity metadata from VS Code shell integration without raw output,
  process IDs, environment values, or PTY attachment.
- Approved Protocol operations to create, focus, write to, and close only
  managed VS Code terminals.
- Request-correlated command acknowledgements with timeout and disconnect
  cleanup.
- A responsive Settings terminal control surface with ownership labels, active
  command state, project-relative working directories, and explicit
  `Approve & ...` controls.
- Secret screening, single-command enforcement, capability negotiation, and
  project-root validation on terminal controls.

## Preserved

- Mission Control EngineAPI continues to own all Mission Control worker PTYs.
- Existing VS Code-owned terminals cannot be written to or closed.
- Built-in Mission AI and Mission Supervisor approval behavior from 2.14.1.
- Replay/live terminal sequence handoff and Full Attach behavior.

The included extension is now `mission-control-bridge-0.2.0.vsix`.

---

# Mission Control 2.14.1 — Mission AI configuration correction

- Fixes the Groundstation Mission AI Settings request to send the
  Protocol-required `configuration` object. API-key protection and preference
  saving no longer fail with “configuration is required”.
- Adds renderer regression coverage for the complete configuration wrapper.
- Enforces every negotiated VS Code Bridge capability after authentication.
  Unpermitted editor, diagnostics, Git, task, or terminal-identity records are
  ignored, and editor commands require the explicit `editor.open` capability.
- Keeps Gemini credentials out of source code, renderer storage, logs, status
  responses, and project files. Existing Electron OS encryption remains the
  only credential persistence path.
- 279 automated tests pass and the production renderer build succeeds.

# Mission Control 2.14.0 — Approval-gated Mission Supervisor

This release preserves the v1.7 Groundstation composition and upgrades the
existing Mission Command, Needs You, Settings, Recipes, terminal evidence, and
MCP surfaces. It does not add a dashboard, assistant page, or alternate worker
lifecycle.

## Gemini planning with local authority

- Adds schema-constrained Gemini workspace proposals for worker lifecycle,
  Daily Workspace profiles, recipe launches, and bounded terminal input.
- Validates every proposal against the active persistent project and known
  workers/recipes before it can appear in Needs You.
- Requires an exact, expiring local approval; denial or expiry performs no
  mutation. Approved actions execute sequentially through EngineAPI.
- Persists supervisor request, decision, execution, verification, and failure
  events in project History.

## Terminal evidence and operational context

- Makes replay-to-live handoff atomic with monotonic output sequence checkpoints,
  preventing both missed and duplicated terminal chunks.
- Adds bounded, source-attributed input evidence only after completed line
  boundaries, with secret and high-entropy redaction.
- Adds worker role and current-activity inference and includes active healthy
  workers when explicitly authorized terminal evidence has remaining capacity.

## Secure MCP planning surface

- Adds separate permissions for supervisor plans, create-worker requests, and
  terminal-input requests.
- Adds `mission_control_plan`, `mission_control_request_create_worker`, and
  `mission_control_request_terminal_input`; all mutations remain local-approval
  requests and never grant an external client a shell.

## Groundstation refinement

- Keeps Groundstation, Workspace, Needs You, History, Projects, and Settings in
  place while categorizing Settings within the existing destination.
- Removes the worker-list display cap, corrects uptime and History cursor data,
  improves Quick Look focus behavior, and exposes Daily Workspace from Project
  Pulse without changing navigation.

## Verification and boundary

- 277 automated tests pass and the production renderer build succeeds.
- Real Gemini calls require the operator's key. Same-machine third-party MCP
  client acceptance, Windows 11/ConPTY visual acceptance, signed installers,
  hosted updates, and physical Android acceptance remain outstanding.

# Mission Control 2.13.0 — Permissioned Plugins and Release Foundations

This release preserves the v1.7 Groundstation composition while adding the
permission-controlled plugin registry to existing Settings and Needs You.
Plugins are declarative: executable and privileged manifest fields are rejected,
grants begin off, and every worker or recipe request requires a local approval.

Release hardening adds Windows process-tree metrics, dedicated renderer chunks,
a native Windows/ConPTY smoke-check launcher, and Ed25519 plus SHA-256 update
artifact verification. Android 13+ supervision client source now matches the
2.12 pairing/encrypted request protocol and protects device credentials with
Android Keystore.

No signed Windows installer or APK is claimed. Trusted signing, hosted updates,
push/outside-LAN relay, and physical-device acceptance require external release
infrastructure and remain explicitly outstanding.

# Mission Control 2.12.0 — Mobile Supervision Security Foundation

## Secure pairing and device trust

- Adds five-minute proof-based pairing without transmitting the six-digit code.
- Uses X25519, HKDF-SHA256, AES-256-GCM, per-device OS-encrypted credentials,
  scoped trust, immediate revocation, timestamp validation, and replay nonces.
- Binds every device to the project active during pairing so a later project
  switch cannot silently expose another workspace.

## Supervision without remote shell access

- Exposes bounded project health, workers, agents, Needs You, Project Memory,
  and optional redacted terminal evidence through encrypted payloads.
- Remote worker and recipe requests create expiring local approvals only.
  EngineAPI executes only after the operator chooses Approve once in Needs You.
- Adds a bounded metadata-only audit with no credentials, pairing codes, request
  bodies, source code, terminal output, or environment values.

## Existing Groundstation integration

- Adds device permissions, pairing, device status, and revocation to existing
  Settings; adds mobile requests to existing Needs You and its badge.
- Adds no primary page, desktop redesign, renderer process authority, direct PTY
  access, terminal input, arbitrary execution, or remote shell.

## Boundary

- This milestone is the verified desktop security/protocol foundation. The
  installable Android/iOS client, push relay, biometrics, and outside-LAN
  rendezvous remain future work.
- Native Windows Firewall, LAN phone, and ConPTY acceptance are not claimed.

# Mission Control 2.11.0 — Automation Workflows and Visible Windows Launch

## Automation with human control

- Adds engine-owned persistent workflows for explicit worker failure,
  attention, exit, and recipe-failure triggers.
- Restricts actions to EngineAPI worker lifecycle and recipe launch operations;
  there is no arbitrary shell or renderer-owned execution path.
- Keeps workflows disabled until explicitly enabled and routes every match to a
  30-minute, one-time Needs You approval before anything executes.
- Adds cooldown and duplicate-pending suppression, dry run, expiration, and a
  bounded privacy-safe audit.

## Existing Groundstation integration

- Adds workflow configuration to existing Settings, approval decisions to
  existing Needs You, and pending items to the existing badge.
- Adds no navigation destination, dashboard redesign, chatbot, or PTY owner.

## Windows visibility

- Adds `OPEN_MISSION_CONTROL_WINDOWS.cmd` as the obvious desktop entry point.
- Includes the built renderer and a read-first guide that distinguishes the real
  Electron Groundstation from the preserved static v1.7 HTML reference.

## Verification

- Production Vite build passes and emits separate app, React, and terminal
  chunks.
- Native Windows 11/ConPTY and packaged Electron visual acceptance remain
  outstanding and are not claimed.

# Mission Control 2.10.0 — Deeper AI Supervision

## Observable mission intelligence

- Adds engine-owned mission phases, observable current action, bounded lifecycle
  history, explicit related workers, and evidence-backed checkpoints.
- Reports progress only as verified checkpoints out of configured checkpoints;
  no synthetic percentage or private reasoning is inferred.
- Keeps structured test, build, Git, and service evidence authoritative over
  nearby generic terminal activity signals.

## Mission authority and Needs You

- Adds expiring one-time permission requests for bounded read, write, execute,
  and network scopes.
- Routes every request into the existing Needs You page with reason, impact,
  requested scopes, expiration, and explicit Approve once or Deny controls.
- Approval executes nothing by itself and may be consumed by only one matching
  recorded instruction. Denied, expired, and consumed approvals grant nothing.

## Existing Groundstation integration

- Adds a Mission Contract dialog and Summary, Progress, Lifecycle, Evidence,
  Files, and Approvals detail inside the existing Agents workflow.
- Adds no chatbot, prompt composer, primary page, navigation destination,
  terminal-input path, PTY owner, or alternate lifecycle architecture.

## Verification

- 246 automated tests pass.
- Focused supervision, Protocol, persistence, and renderer suite: 47 passing.
- Real Vite production build passes with 133 transformed modules and separate
  application, React, and terminal chunks.
- Native Windows 11/ConPTY and packaged Electron visual acceptance remain
  outstanding and are not claimed.

# Mission Control 2.9.0 — Secure MCP Gateway

## Authenticated local MCP transport

- Adds an optional Streamable HTTP endpoint bound only to `127.0.0.1` with a
  256-bit bearer token protected by Electron OS encryption.
- Validates Origin, authorization, request size, concurrency, JSON-RPC shape,
  current MCP 2026-07-28 metadata and mirrored headers, with compatible legacy
  initialization for 2025 MCP clients.
- Rotates credentials through a one-time token reveal and immediately revokes
  the previous credential.
- Requires token creation before enablement so no usable credential is generated
  without being revealed once to the operator.

## Explicit permissions and approvals

- Adds independent grants for Mission Context, Project Memory, Needs You,
  bounded terminal evidence, worker-action requests, and recipe-action requests.
- Keeps terminal evidence off by default and routes every read through the
  existing bounded Mission Context sanitizer.
- Mutation tools create expiring approval records only. Needs You shows the
  request and EngineAPI executes it only after a confirmed local approval.
- Adds a bounded audit trail with no prompts, arguments, tokens, terminal
  output, source code, or environment values.

## Existing Groundstation integration

- Adds Secure MCP controls to the existing Settings composition and external
  AI approvals to the existing Needs You queue and badge.
- Adds no navigation item, assistant page, chatbot, renderer process access, or
  alternate worker lifecycle.

## Verification

- 242 automated tests pass across MCP security, token storage, permissions,
  approvals, Protocol, renderer composition, EngineAPI, PTY ownership, and all
  prior milestones.
- A fresh declared dependency install and the real Vite production build now
  pass; 132 modules transform into separate application, React, and terminal
  chunks.
- Native Windows 11/ConPTY and signed-installer validation remain outstanding
  and are not claimed.

# Mission Control 2.8.0 — Workspace Recipes 2

## Engine-owned parallel DAG scheduler

- Replaces sequential recipe execution with bounded dynamic DAG scheduling.
- Starts dependency-ready workers immediately up to a one-to-eight worker
  concurrency limit; an independent ready branch no longer waits for a slow
  unrelated root.
- Rejects unknown workers, duplicate steps, invalid dependencies, and cycles
  before saving or launching a recipe.
- Preserves all starts and restarts through EngineAPI and the existing
  serialized SessionEngine lifecycle. The renderer never creates a process.

## Gates, retry, and recovery

- Adds per-worker gates for running process, ready service, passing tests,
  completed build, connected database, healthy container, clean Git state,
  successful exit, and engine health evidence.
- Adds bounded per-step timeouts, zero-to-three retries, retry delay, and an
  explicit reuse-or-restart policy for already-running workers.
- Adds stop-scheduling or continue-independent-branches failure policy.
- Adds safe cancellation, active-recipe edit/delete protection, explicit
  recovery runs, and optional rollback restricted to workers started by that
  recipe. Pre-existing workers are never rolled back.
- Pause suspends readiness clocks; shutdown cancels recipe scheduling before
  the existing PTY shutdown sequence.

## Existing Workspace workflow

- Upgrades the existing Workspace Recipes dialog without adding navigation.
- Adds Ordered Stack, Parallel Services, and Start Then Verify templates.
- Adds per-worker dependency and gate editing with renderer cycle prevention;
  the engine revalidates the authoritative graph.
- Shows roots, edges, concurrency, retry policy, live step phase, attempt,
  rollback status, cancellation, and failed-run recovery.

## Verification

- 234 automated tests pass across recipe DAGs, dynamic branch scheduling,
  retries, rollback scope, cancel/mutation safety, Protocol, renderer templates,
  PTY ownership, and every previous milestone.
- JSX bundling/parsing succeeds. The full Vite build remains blocked in this
  scratch copy by the inherited v1.6 `node_modules` symlink missing the Radix
  packages already declared in the package manifests.

## Boundary

The v1.7 Groundstation layout and navigation, Workspace concept, SessionEngine,
EngineAPI process ownership, PTY lifecycle, persistence, recovery, Mission AI,
VS Code Bridge, and existing primary workflows remain unchanged.

# Mission Control 2.7.0 — Built-in Mission AI

## Secure Gemini credential boundary

- Adds optional Gemini credentials encrypted in the Electron main process with
  operating-system `safeStorage`.
- Fails closed when secure OS encryption is unavailable or Linux exposes the
  insecure `basic_text` backend; no plaintext fallback exists.
- Never returns the key to the renderer, places it in a provider body, stores it
  in renderer/project/history state, or exposes it through integration status.
- Rejects corrupt, oversized, unsupported-version credential files and
  unsupported Gemini model IDs.

## Bounded, grounded Mission AI

- Adds a main-process Gemini Interactions client grounded in the versioned
  Mission Context snapshot.
- Sends stateless requests with `store: false`, a 30-second timeout, one active
  request, a 1 MiB response ceiling, and a 12 KiB answer ceiling.
- Defaults to `gemini-2.5-flash` and sends the API key only in the
  `x-goog-api-key` header.
- Treats operational context as untrusted data, reuses shared secret redaction,
  redacts bare Gemini key patterns, and requires explicit permission before
  bounded failed/Needs You terminal evidence can be included.
- Grants `observe` authority only: no tools, worker operations, terminal input,
  filesystem access, process ownership, or execution claims.

## Existing Groundstation integration

- Adds **Ask Mission AI…** to Mission Command and secure configuration to the
  existing Settings composition.
- Uses one question against one current snapshot without conversation history,
  agent chat, a new page, or a navigation change.
- Keeps Settings solid and reserves restrained glass for the transient dialog.

## Verification

- 225 automated tests pass across EngineAPI, Protocol, PTY ownership, Mission
  Context, Mission AI security, renderer composition, and all prior milestones.
- JSX bundling/parsing succeeds. The full Vite build remains blocked in this
  scratch copy by its inherited v1.6 `node_modules` symlink, which lacks all
  already-declared Radix packages; run a clean dependency install before release.

## Boundary

The v1.7 Groundstation layout/navigation, Workspace, SessionEngine, EngineAPI,
PTY lifecycle, worker architecture, persistence, recovery, VS Code Bridge, and
existing primary workflows remain unchanged.

# Mission Control 2.6.0 — Mission Context Engine

## Shared project intelligence

- Adds a versioned Mission Context snapshot that composes public EngineAPI
  lifecycle, Worker Intelligence, dependency impact, Needs You, missions,
  Project Memory 2, recipes, durable activity, and current VS Code state.
- Adds explicit `MISSION_CONTROL_OWNED` and `VS_CODE_OWNED` worker identity so
  context consumers cannot confuse observation with process ownership.
- Exposes the snapshot through the additive, read-only Protocol v1
  `context.snapshot` method.

## Privacy and context budgets

- Omits terminal output by default and requires an explicit bounded opt-in for
  recent evidence from known workers.
- Adds one reusable sanitizer for credential-shaped properties, private keys,
  authorization headers, JWTs, provider tokens, URL credentials, and inline
  secret assignments.
- Omits source code and environment values, bounds every collection and string,
  and enforces a 256 KiB serialized context ceiling.
- Trims terminal evidence before secondary history when budget pressure occurs.

## Boundary

The v1.7 Groundstation composition, navigation, Workspace, SessionEngine, PTY
lifecycle, persistence, recovery, and the existing VS Code handshake are
unchanged.

# Mission Control 2.5.0 — VS Code Bridge

## Authenticated launch handshake

- Adds an optional VS Code extension and a Groundstation-owned TCP service bound
  only to `127.0.0.1` on an ephemeral port.
- Launches VS Code through its registered extension URI with a 256-bit one-time
  token that expires after 60 seconds and never enters the renderer response.
- Requires an exact active-project identity and workspace-path match before the
  token is consumed or editor synchronization begins.
- Invalid tokens, wrong projects, oversized messages, non-loopback clients, and
  unsupported capabilities fail closed.

## Editor synchronization

- Synchronizes the active project-relative file and cursor, bounded diagnostics,
  aggregate Git state, task results, and terminal names.
- Adds precise open-file and open-Problems commands while rejecting absolute,
  parent-relative, missing, and symlink-escaped paths.
- Never streams terminal output, sends terminal input, creates terminals, or
  changes Mission Control's PTY ownership.
- Invalidates the connection immediately when Mission Control changes project.

## Groundstation integration

- Adds live bridge state to the existing Settings workflow with no navigation
  destination or layout redesign.
- Streams bridge state through additive Protocol v1 methods and bounded
  `integration:event` notifications.
- Includes `mission-control-bridge-0.1.0.vsix` for local installation.

## Boundary

SessionEngine, PTY lifecycle, Workspace persistence, recovery, worker
architecture, primary navigation, and the v1.7 Groundstation composition remain
unchanged.

# Mission Control 2.4.0 — Project Memory 2

## Resumable chapters

- Builds bounded run chapters in the engine from existing correlation IDs and
  structured evidence instead of rebuilding history in the renderer.
- Adds concise chapter summaries, explicit unresolved, retrying, recovered,
  active, completed, and ended states, plus current-worker resume targets.
- Keeps memory bounded to 20 chapters, 30 event facts per chapter, 20 causal
  links, and five prioritized resume points.

## Evidence-backed relationships

- Connects runs only when they belong to the same worker and occur in recorded
  chronological order.
- Marks a later run as recovery only after tests, builds, services, databases,
  containers, or a clean exit provide structured success evidence.
- Keeps a later active run in retrying state until verification arrives and
  never infers causality between unrelated workers.

## Existing History workflow

- Adds Resume Work, failure-to-recovery relationships, engine-built run
  chapters, and chapter context to the existing History page.
- Opens the existing worker focus flow from a resume target; it adds no primary
  page, chatbot surface, navigation change, or replacement workspace concept.

## Boundary

The v1.7 Groundstation composition, Workspace, navigation, Protocol v1, PTY
ownership, worker architecture, persistence, and recovery behavior remain
intact.

# Mission Control 2.3.0 — Engine-owned Worker Intelligence

## Process intelligence

- Adds bounded, engine-owned CPU and working-set memory sampling for up to 50
  active worker root processes.
- Uses Windows `Get-Process`, Linux `/proc`, and a bounded POSIX `ps` fallback
  without giving the renderer process access or spawning replacement workers.
- Samples every five seconds by default, coalesces concurrent collection, and
  emits one non-durable `worker:metrics` state event per sample.
- Keeps high resource use observational: it never fabricates a failure or adds
  an item to Needs You without authoritative lifecycle or attention evidence.

## Health and impact

- Derives explicit Healthy, Observing, Resource pressure, Needs You, Failed,
  and Idle states behind EngineAPI.
- Computes direct and transitive dependency impact only from configured
  Workspace Recipe edges.
- Surfaces CPU, memory, health analysis, sample scope, and dependent workers in
  the existing Workspace Worker Intelligence inspector.
- Adds the same authoritative health and impact facts to the contextual Mission
  Graph inspector without changing navigation.

## Boundary

The v1.7 Groundstation composition, Workspace model, Protocol v1 transport, PTY
ownership, recovery, persistence, and existing worker lifecycle remain intact.

# Mission Control 2.2.0 — Contextual Mission Graph

## Mission Graph

- Adds an operational dependency view inside the existing v1.7 Groundstation
  workflow; it is not a new primary page and does not change navigation.
- Uses only dependency edges, readiness gates, failure policies, and run state
  already stored by Workspace Recipes and returned through EngineAPI.
- Groups recipe workers into startup stages, shows live engine status, surfaces
  cycles, and distinguishes workers outside the selected recipe.
- Adds a selected-worker inspector for configured upstream and downstream
  impact with direct terminal and recipe handoff.
- Opens contextually from Project Pulse, Workspace, and Mission Command.
- Refreshes from recipe lifecycle events and performs no renderer polling.

## Boundary

The v1.7 Groundstation layout and navigation remain intact. Engine, EngineAPI,
Protocol v1, PTY ownership, workspace persistence, recovery, and worker
architecture are unchanged.

# Mission Control 2.1.0 — Groundstation Professional Polish

## Preserved v1.7 Groundstation

- Keeps the v1.7 Groundstation layout, navigation, Project Pulse, status strip,
  worker scene, Needs You shelf, Live Agents rail, and operational workflows.
- Does not route to or continue the later connected-scene redesign.
- Adds a scoped craftsmanship layer instead of restructuring the application.

## Professional polish

- Refines typography weight, line height, contrast, numeric formatting, spacing,
  borders, elevation, focus states, and selection continuity.
- Consolidates the four project statistics into one quieter instrument strip
  without removing or relocating any information.
- Makes selected workers unambiguous with a restrained accent edge and keeps
  contextual actions available for hover, keyboard focus, and selection.
- Removes the remaining perpetual Project Pulse sweep and decorative movement.
- Gives terminal panes stronger active, drop-target, focus, and resize feedback
  while preserving all existing layouts and PTY behavior.
- Reserves restrained blur for transient menus, dialogs, Quick Look, and Mission
  Command; workspaces, terminals, logs, and primary surfaces remain solid.
- Adds compact responsive corrections without changing desktop navigation.

## Boundary

Engine, EngineAPI, Protocol v1, PTY ownership, workspace persistence, recovery,
worker definitions, agent adapters, and backend behavior are unchanged.

# Mission Control 1.7.0 — Professional Groundstation

## Agent Operations

- Replaces the agent conversation and instruction composer with a focused
  roster plus Summary, History, and Evidence views.
- Keeps agent creation, lifecycle controls, terminal handoff, and durable
  operational review in one clear workspace.
- Shows readable status briefs, mission scope, runtime, recent lifecycle,
  changed-path counts, checks, and privacy-safe evidence summaries.
- Redacts changed-file names from durable mission evidence while retaining the
  structured change count and branch proof.

## Product UI and performance

- Establishes a shared Segoe UI Variable-first type scale across the entire
  desktop product, with larger body, control, metadata, and heading text.
- Tightens spacing, hierarchy, focus states, surface contrast, and responsive
  behavior for Groundstation, Workspace, Needs You, and Agents.
- Removes perpetual sweeps, pulses, orbit effects, costly blur filters, and
  hover transforms from high-frequency work surfaces.
- Limits surviving UI transitions to short 120 ms state changes and fully
  honors reduced-motion preferences.
- Preserves Protocol v1, EngineAPI ownership, terminal streaming, and the
  existing local-agent execution model.

## Verification

- 176 automated engine, service, protocol, accessibility, renderer, and
  workspace tests pass.
- Windows and POSIX adapter fixtures now use their platform-native path rules.

# Mission Control 1.6.3 — Workspace Recipes

- Adds project-local workspace recipes for named daily working sets.
- Captures worker selection, explicit startup priority, terminal layout, and pane assignments.
- Launches idle workers sequentially through the existing EngineAPI and reports partial failures.
- Restores the saved terminal canvas atomically and exposes recipes in Workspace, the mission bar, and Mission Command.

# Mission Control 1.6.1 — Worker Focus and Agent Start Reliability

## Worker and agent workflow refinements

- Worker Focus is now distinct from Quick Look and opens a summary/history dialog before terminal navigation.
- Worker Canvas cards describe the worker's current state using related engine activity.
- Docker operations now live inside Everything in Motion.
- Live Agents shows the selected agent's command, runtime, activity, output recency, and summary.
- Adding an allow-listed agent now creates its worker and immediately starts its official CLI command.
- The dialog's explicit Open Terminal action is the only Groundstation focus action that changes to Workspace.

## Previous 1.6.0 release

- Agent adapters now expose their fixed allow-listed CLI command and existing
  agents provide explicit Start and Open Terminal actions.
- Groundstation includes a live-agent rail with expandable operational
  summaries, Worker Quick Look, and direct terminal handoff.
- Docker-related supervised workers are summarized contextually without adding
  Docker privileges or bypassing the EngineAPI boundary.
- Terminal pane selection moved from a disruptive native select to a compact
  contextual menu.
- Settings now includes local typography, density, motion, command-hint, and
  terminal font-size preferences.
- Default typography was raised from the overly compressed 7–9px range while
  retaining professional workstation density.

## v1.5.0 — Product Identity & Living Workspace

This release redesigns the entire Groundstation experience around the question:
"What should I do next?" It changes no backend feature, PTY ownership rule, or
Protocol v1 boundary.

## Product experience

- Seven intentional destinations: Groundstation, Workspace, Needs You, Agents,
  History, Projects, and Settings
- Project Pulse replaces generic KPI cards with health, motion, latest change,
  and a recommended next action
- Worker Canvas replaces the permanent action table with living worker surfaces
  and contextual hover controls
- Workspace becomes the visual hero with a quiet layout switcher, fullscreen
  focus, and a contextual worker inspector
- Needs You becomes a filtered operational decision queue
- Agent Operations treats local AI CLIs as engineers with mission, progress,
  activity, risk, and direct terminal focus
- Project Memory presents durable events as a causal timeline
- Mission Command opens with Ctrl+K and searches navigation, actions, workers,
  and recent history

## Design system and interaction

- Orbital Dark visual identity with warm graphite and restrained sage signals
- Solid workspace surfaces; glass and blur only on floating interface layers
- Premium proportional hierarchy and SF Mono/Cascadia Code operational type
- Spring focus transitions, contextual controls, reduced-motion support, and
  responsive workstation layouts
- Double-click or Enter focuses a worker; Escape unwinds Mission Command,
  fullscreen focus, and the Context Inspector
- Full product critique, information architecture, and system guidance are kept
  in `UI_UX_REDESIGN.md`

## Safety and verification boundary

- All mutations remain routed through the existing renderer bridge and Protocol v1
- Terminal streams still attach to the existing engine-owned PTYs
- Agent creation remains allow-listed and manual-start only
- Native Windows visual review, ConPTY behavior, and installed CLI authentication
  still require Windows 11 acceptance testing

# Mission Control 1.4.0 — Recovery, Projects, Layouts & AI Agents

This release reconciles the previously divergent Groundstation layout and
reliability branches into one tested product line.

## Added

- Bounded renderer recovery with delayed retries and crash-loop pause
- Durable, privacy-safe recovery diagnostics
- Safe recent-project discovery, initialization, switching, and restoration
- Workspace lease and rollback hardening during project switches
- Visible recovery status without replacing or duplicating engine-owned PTYs
- Allow-listed manual worker adapters for Claude Code, Codex, Gemini CLI, and OpenCode
- Existing single, horizontal, vertical, 2x2, and 3x2 layouts retained

## Safety boundaries

- Agent workers are created stopped and start only after an operator action
- Agent commands are fixed by the main-process adapter catalog
- Mission Control accepts no agent prompt, token, environment value, provider URL,
  or arbitrary executable through the agent protocol
- Each CLI remains responsible for its own authentication and credential storage
- Renderer recovery reloads only the interface; the engine retains PTY ownership
- Project switching stops and leases transactionally, with rollback on failure

## Verification boundary

- Recovery, diagnostics, project transactions, layout persistence, adapter
  allow-listing, protocol isolation, engine behavior, and production rendering
  are automated.
- Native ConPTY, visible renderer-crash behavior, and installed CLI authentication
  still require Windows 11 acceptance testing.

# Mission Control 1.2.0 — Groundstation Worker Management & Terminal Layouts

This milestone closes the remaining multi-terminal desktop-management gap.
Groundstation can now configure the workspace through the existing Protocol v1
and EngineAPI paths instead of requiring the TUI or hand-edited JSON.

## Added

- New-worker form with manual or automatic startup
- Saved-preset picker backed by workspace `commands`
- Stopped-worker command, arguments, cwd, environment, restore-policy, and
  PowerShell compatibility editing
- Rename, remove, startup-policy, start, restart, stop, and acknowledge controls
- Single, horizontal, vertical, 2x2, and 3x2 terminal layouts
- Per-workspace layout and pane-assignment restoration
- Worker selection and explicit empty panes without duplicate terminal streams

## Reliability and security

- Every mutation remains routed through Protocol v1 and the public EngineAPI
- Destructive removal still requires main-process protocol confirmation
- Running workers cannot be reconfigured implicitly
- Environment values are never used for edit prefill and remain unchanged by
  default; replacement requires an explicit operator choice
- Pane reassignment closes the prior stream before the replacement opens
- Layout persistence stores only layout identifiers and worker IDs
- Renderer-side validation mirrors engine limits but the engine remains the
  authoritative validator and PTY owner

## Verification boundary

- Form validation, secret-preserving edit patches, required layout sizes,
  unique pane assignment, public action routing, destructive confirmation, and
  the production renderer build are automated.
- Native ConPTY behavior and the visible Electron interaction flow still require
  Windows 11 acceptance testing.

# Mission Control 1.1.0 — Groundstation Protocol & Real Terminal Matrix

This milestone begins the visible desktop product without rewriting the stable
Node engine. A transport-independent Protocol v1 and Electron host connect a
real React/xterm.js Groundstation to the same engine-owned PTYs used by the TUI.

## Added

- Versioned local request/response protocol with structured errors and limits
- Snapshot/event activation handoff with ordered non-terminal engine events
- Same-PTY terminal streams with bounded replay-before-live activation
- Stream IDs and terminal epochs that reject stale input and resize requests
- Electron engine host with workspace validation, leasing, and safe shutdown
- Sandboxed/context-isolated preload bridge and main-frame IPC enforcement
- Groundstation Overview, Terminals, Attention, and Activity surfaces
- Real four-pane xterm.js matrix with input, resize, focus mode, and controls
- Explicit Windows 11 acceptance checklist

## Reliability and security

- General IPC events exclude raw terminal output; panes subscribe explicitly
- One terminal stream per session/connection prevents competing writers
- Request, input, dimension, replay, live queue, and batch sizes are bounded
- Output overflow is observable and asks the pane to resynchronize
- Destructive actions require an exact main-process-validated confirmation
- Renderer reload disposes terminal listeners before reconnecting
- Workspace locks remain held when shutdown cannot stop an owned PTY
- Environment values remain outside state, event, activity, and renderer data

## Verification boundary

- Protocol, same-PTY routing, replay/live ordering, overflow, cleanup, IPC,
  workspace-host lifecycle, renderer bridge, engine regressions, and the Vite
  production build are automated.
- The Electron binary can be installed on this Linux build host, but no display
  server or native Windows ConPTY is available here. Windows 11 behavior remains
  an explicit acceptance gate.

# Mission Control 1.0.0 — Saved Worker Presets

This milestone completes the saved-command slice of the Workspace Engine.
Optional builds, checks, databases, and AI agents can remain available without
launching during restore or cluttering the active worker list.

## Added

- Optional top-level `commands` workspace definitions
- Public, redacted `EngineAPI.listSavedCommands()` contract
- Transaction-safe `createFromSavedCommand(id)` operation
- Ordered `saved-command:instantiated` activity events
- TUI saved-preset picker on `p`
- CLI validation and counts for saved commands
- `CommandRouter` support for future Groundstation clients

## Reliability

- Presets never launch while a workspace is loading
- Presets default to manual startup unless explicitly opted into automatic
- Instantiation reuses the single EngineAPI/SessionEngine creation path
- Failed workspace saves create no worker and launch no PTY
- Invalid and duplicate presets are isolated from valid sessions
- Preset environment values stay out of state, events, activity, and TUI data
- Structural workspace validation completes before EngineAPI load state changes

## Compatibility

- Workspace schema remains version 1 and `commands` is optional
- Existing workspaces need no migration
- Windows 11 ConPTY acceptance testing remains required for native attachment

# Mission Control 0.9.0 — Transaction-Safe Worker Reconfiguration

This milestone completes the core saved-worker lifecycle. Operators can change
a stopped worker's launch definition from Mission Control without hand-editing
workspace JSON or accidentally starting another process.

## Added

- Public `EngineAPI.reconfigure(id, patch)` operation
- Sanitized `getSessionConfiguration(id)` edit-prefill contract
- TUI worker editor for command, arguments, working directory, environment,
  and PowerShell compatibility
- Ordered `session:reconfigured` events and durable activity records
- `CommandRouter` support for future Groundstation edit clients

## Reliability

- Live workers reject edits without being stopped or restarted implicitly
- Reconfiguration serializes with start, restart, removal, and shutdown
- Workspace changes persist before runtime mutation and roll back on failure
- Edited launch definitions remain idle until explicitly started
- Prior output and lifecycle state are cleared when the launch definition
  changes, so old process facts are not presented as current
- Environment values never enter snapshots, edit-prefill data, event
  envelopes, or activity history
- Unknown patch fields and session-ID changes are rejected

## Compatibility

- Workspace schema remains version 1 and existing files need no migration
- Custom per-session fields are preserved during supported edits
- Windows 11 ConPTY acceptance testing remains required for native attachment

# Mission Control 0.8.0 — Controlled Workspace Restore

This milestone makes workspace restoration safe for larger projects. Saved
workers can now remain registered and observable without launching a process
until the operator explicitly starts them.

## Added

- Persisted `autoStart` policy with backward-compatible automatic startup
- Real `idle` lifecycle state for registered sessions with no owned PTY
- Public `EngineAPI.start(id)` and `setAutoStart(id, enabled)` operations
- Ordered `session:autostart` contract events and durable activity records
- TUI start control, startup-policy toggle, status counts, and metadata
- New Session wizard choice for automatic or manual workers

## Reliability

- Manual workspace restore creates zero PTYs for opted-out sessions
- Explicit start owns exactly one PTY and rejects duplicate live starts
- Start, restart, removal, and shutdown share lifecycle serialization
- Startup-policy saves complete before runtime state changes
- Failed policy saves leave both runtime and workspace JSON unchanged
- Changing startup policy never starts or stops the current process

## Compatibility

- Existing workspaces continue to start sessions automatically
- `autoStart: false` is an additive schema-v1 field; no migration is required
- Windows 11 ConPTY acceptance testing remains required for native attachment

# Mission Control 0.7.0 — Durable Activity & Attach Reliability

This milestone integrates the Windows Full Attach fixes from the updated GitHub
tree, closes their failure-path and performance gaps, and completes durable
Phase 2 activity history without introducing a database or native dependency.

## Added

- Atomic, bounded activity persistence beside persistent workspace files
- Event sequence continuity across Mission Control restarts
- Isolated recovery from corrupt, incompatible, or oversized activity history
- Explicit `powershellCompatibility` workspace option
- Raw VT replay metadata so truncated history falls back safely

## Reliability

- Full Attach reclaims stdin synchronously and keeps the CLI lifecycle alive
- Dead-session attach checks use fresh EngineAPI state
- Partial listener setup and live host-output failures clean up and return to
  Mission Control instead of leaking listeners or escaping PTY callbacks
- PowerShell host-input modes are filtered across chunk boundaries and disabled
  before Ink remounts
- Raw replay uses byte-accounted, coalesced chunks instead of repeatedly copying
  a one-megabyte string
- UTF-8 is never split during replay truncation; incomplete VT history is not
  replayed as if it were a valid screen
- The PSReadLine workaround is opt-in for configured sessions and enabled only
  for the Windows onboarding shell by default
- Raw output and output-derived attention reasons are excluded from the durable
  activity file

## Verification boundary

- Lifecycle, listener cleanup, bounded replay, persistence recovery, redaction,
  and sequence continuity are covered by automated tests.
- Windows 11 ConPTY, VS Code raw mode, Ctrl+C, resizing, and full-screen terminal
  applications still require manual host acceptance testing.

# Mission Control 0.6.0 — Replayable Activity Contract

This milestone gives future Groundstation clients a bounded way to learn what
changed without coupling them to Ink, PTYs, or Session Engine internals.

## Added

- Engine-owned, JSON-serializable activity history with sequence cursors
- Bounded replay through `EngineAPI.getActivity({ afterSequence, limit })`
- Explicit replay-gap and pagination metadata
- Workspace load/save failures and attach rejections in the versioned event
  stream
- Compact recent-activity feed in the TUI

## Reliability

- Raw terminal output remains live-only and is not duplicated into the
  activity history
- Activity records are bounded and returned as defensive copies
- Re-entrant subscriber actions are serialized so later observers never see
  sequence 2 before sequence 1
- Observer failures remain isolated from event publication and PTY ownership

## Current boundary

- Activity history is in-memory and resets between Mission Control launches.
  Durable timeline persistence remains a later Workspace Engine milestone.
- Windows 11 ConPTY behavior still requires manual host acceptance testing.

# Mission Control 0.5.0 — Engine Contract & Transaction Safety

This milestone turns the Engine API into a safer foundation for the future
Groundstation desktop client without introducing IPC or coupling the engine to
a GUI framework.

## Added

- Versioned, JSON-serializable `EngineAPI.getState()` envelopes
- Ordered subscription events with contract version, sequence, and timestamp
- Public EngineAPI resize operation for terminal clients and command routing
- Regression coverage for disk-write failures and API boundary leaks
- Per-session lifecycle serialization and shutdown coordination with in-flight
  restarts/removals
- Observer isolation so client callback failures cannot unwind engine lifecycle
  operations or starve later subscribers

## Changed

- The Session Engine and Workspace Store are private implementation details of
  `EngineAPI`
- `CommandRouter` now dispatches only through public EngineAPI methods
- Create and rename persist before runtime mutation
- Removal stops the owned PTY, persists deletion, then finalizes engine removal
- WorkspaceStore mutations commit in memory only after the atomic disk write
  succeeds
- Atomic workspace writes now flush temporary-file contents before replacement
- Shutdown blocks new lifecycle actions, waits for in-flight work, and reopens
  the API if a stuck PTY prevents a safe stop

## Failure behavior

- A failed create save spawns no PTY
- A failed rename save leaves both runtime and JSON names unchanged
- A failed remove save keeps the safely stopped session tracked and returns a
  hard error instead of a success-with-warning result

## Verification boundary

- Transaction ordering, rollback state, contract serialization, monotonic event
  sequences, same-PTY attachment, and architecture boundaries are covered by
  automated tests.
- Windows 11 ConPTY behavior still requires manual host acceptance testing.

# Mission Control 0.4.0 — Startup Safety

This milestone hardens the boundary between a workspace definition and the
processes Mission Control owns. It also improves operator clarity without
changing the one-PTY-per-session architecture.

## Added

- `--config`, `--check`, `--help`, and `--version` CLI options
- No-process workspace validation with actionable per-session errors
- Atomic per-workspace lease with PID metadata and stale-lock recovery
- Duplicate-instance protection before any workspace PTY can spawn
- Coordinated all-session shutdown before workspace ownership is released
- Keyboard help overlay and cyclic attention navigation
- Persistent/temporary workspace indicator and last-output timestamps

## Changed

- Existing malformed workspaces now fail closed instead of silently launching
  an unrelated fallback shell
- Explicit missing config paths exit with an actionable error
- The default one-shell fallback remains available only when the default config
  path is absent

## Verification

- CLI validation tests prove `--check` does not need to launch configured
  commands.
- Lease tests cover live-owner rejection, stale recovery, idempotent release,
  partial-write protection, cross-host safety, and ownership-token protection.
- Engine and mounted Ink tests cover last-output metadata, attention cycling,
  and Windows enhanced-Escape help dismissal.
- Native Windows ConPTY behavior still requires manual Windows 11 testing.

# Mission Control 0.3.0 — Attention Foundation

This milestone preserves the Workspace Engine and same-PTY attach architecture
while adding the first deterministic supervision layer.

## Added

- Sticky `attentionRequired` state for classified error output, spawn failures,
  and unexpected non-zero exits
- `session:supervision` events and `EngineAPI.acknowledge(id)`
- Attention count, failure reason, jump-to-attention, and acknowledge controls
- Shared Windows enhanced-Escape handling across Tail and modal prompts
- Linux Node 20/22 and Windows Node 22 CI
- Package file allow-list and repository hygiene rules

## Fixed

- Full Attach handoff now registers Ink's exit wait before unmounting
- Full Attach handoff errors no longer become unhandled promise rejections
- Ink input integration tests wait for input readiness instead of relying on a
  host-speed timing assumption
- ANSI stripping now has one implementation shared by snapshots and
  classification

## Repository cleanup

- Generated `node_modules` content is no longer tracked
- Machine-local `termctl.config.json` is no longer tracked; the example remains

## Verification

- 56 engine, TUI integration, syntax, and module-loading tests pass.
- `npm pack --dry-run` produces a 23-file package without generated or local
  configuration content.
- Windows CI covers syntax, engine behavior, and Ink integration with Node 22.
- Manual Windows ConPTY/VS Code attach verification remains required.

# Mission Control 0.2.0 — Workspace Engine

This milestone continues from the verified same-PTY Phase 1 foundation. It does
not introduce cloud, mobile, split attach, or the Groundstation GUI.

## Added

- Versioned, human-readable workspace configuration
- Atomic workspace writes that preserve unrelated configuration fields
- Workspace-relative working directories
- Validated per-session arguments and environment overrides
- Persistent create, rename, and remove operations through `EngineAPI`
- Safe removal that waits for the owned PTY and aborts rather than abandoning it
- `session:removed` subscription events
- Cancellation of restart/removal waits during engine disposal
- Guided TUI session creation and typed removal confirmation
- Compact status overview, bounded session navigation, failure emphasis, PID,
  environment-key count, and recent-output preview
- Node.js LTS compatibility declaration

## Removed

- The unused `better-sqlite3` dependency and disconnected registry prototype.
  Workspace persistence now uses atomic JSON and leaves `node-pty` as the only
  native dependency.

## Verification

- 46 unit and Ink integration tests pass.
- Every `.js` and `.cjs` file passes `node --check`.
- ESM UI imports and CommonJS engine imports were exercised.
- The CLI mounted in a real Linux PTY and quit cleanly with exit code 0.
- The 50-session bounded-output stress test passes with one PTY per session.
- Static scans found no TUI process spawning, inherited-stdio attach, JSX, or
  direct TUI access to the Session Engine's session map.

## Not verified in this environment

Windows 11 ConPTY behavior, VS Code raw-mode ownership, Windows resize behavior,
and interactive full-screen terminal programs still require manual testing on
Windows with Node.js 22 LTS. The Linux runner uses Node 24 and cannot load the
native `node-pty` addon, so native PTY behavior is not claimed as runtime-tested
here.
# 1.6.3 — Agent Operations and Project Memory

- Added an Add Agent route directly to Groundstation's Live Agents rail, including its empty state.
- Redesigned Agent Operations around a selectable crew roster and focused mission brief.
- Redesigned History as filterable Project Memory with worker, risk, and attention views.
- Added project-memory totals and clearer risk emphasis without changing activity persistence.
- Replaced native Groundstation scrollbars with restrained, cross-browser desktop styling.
- Kept all agent actions on the existing allow-listed Protocol v1 and engine-owned PTY paths.

# 1.6.2 — Operational Workspace Refinement

- Refines Groundstation with a live operations ribbon for workers, agents, Docker-supervised commands, recent movement, and current risk.
- Keeps worker actions visible for the selected card and adds clear pending feedback for start and restart operations.
- Redesigns the Workspace toolbar and replaces the remaining empty-pane native selector with a contextual worker menu.
- Adds an operational crew summary to Agents while preserving the fixed, allow-listed CLI adapter boundary.
- Defaults new workers to an auto-started `powershell.exe` command, creating an immediately usable empty PowerShell terminal on Windows.
- Preserves EngineAPI, Protocol v1, PTY ownership, recovery, and agent command safety.
# Unreleased — Trust-first Groundstation

- Upgrades Mission Command from substring filtering to scored fuzzy matching across
  labels, groups, and explicit aliases.
- Persists the eight most recent commands locally and uses recency as a ranking boost;
  exact and prefix matches still outrank recency.
- Adds developer-language aliases for attention, history, agents, project switching,
  appearance, focus, workspace launch, and workspace shutdown.
- Improves no-result guidance and labels recent commands without changing the safety or
  execution path of any operation.
- Adds a per-project “Since You Last Checked” briefing on Groundstation using durable
  activity sequence numbers and a local review cursor.
- The briefing reports new meaningful-event count, recorded risk count, affected
  workers, and the latest event, with Review Memory and Mark Reviewed actions.
- Opening History advances only the local cursor; it does not mutate, acknowledge, or
  delete engine-owned activity. First use establishes a quiet baseline instead of
  presenting all retained history as new.
- Adds true hold-Space Worker Quick Look on Groundstation. The transient preview keeps
  users in context while showing worker role, state, command, working directory,
  restore policy, last output, recent lifecycle evidence, and direct start/restart or
  terminal actions.
- Keeps Select, Quick Look, Focus, and Open Terminal as distinct interactions and adds
  visible usage hints to the live project scene.
- Mission Command now prioritizes contextual inspect/conversation and acknowledgement
  actions for the selected worker.
- Adds daily workspace controls to start every idle worker or stop every running
  worker from the Workspace toolbar and Mission Command.
- Bulk lifecycle actions run concurrently, refresh state once, summarize partial
  failures by worker, and use one contextual confirmation before stopping the
  workspace. Worker definitions remain available for the next launch.
- Adds a compact Groundstation Needs You shelf that appears only when decisions exist,
  previews the two highest-current engine attention items, and routes agents to their
  conversations and failed workers to restart/inspection actions.
- Redesigns the full Needs You queue around decision kind, exact engine evidence,
  operational impact, recommended action, and explicit acknowledgement semantics.
- Adds per-agent mission context stored locally in the renderer. The first instruction
  becomes the mission when none is set, and users can refine it without changing CLI
  authentication, engine state, or workspace configuration.
- Adds Project Memory search across event type, worker, session, operation, and reason;
  event descriptions now prefer reported reasons and explicitly avoid claiming causal
  links the engine did not provide.
- Replaces the clipped one-agent footer menu with a full, keyboard-dismissable
  add-agent dialog that remains available from both the workforce rail and the active
  conversation header after any number of agents have been created.
- The redesigned chooser shows installation state, existing instance counts, parallel
  agent support, authentication/safety context, and explicit per-adapter start actions.
- The workforce rail now reports active and total agents, and agent attention can be
  acknowledged without leaving the conversation workspace.
- Fixes Windows agent startup for npm-installed CLIs by resolving allow-listed
  commands on PATH and launching `.cmd`/`.bat` shims through `cmd.exe`; native
  executables continue to launch directly.
- Agent availability is now reported by `agents.list`. The add-agent chooser disables
  missing CLIs with an actionable explanation instead of creating a worker guaranteed
  to fail.
- Replaces the ambiguous one-click “+ Add agent” behavior with an explicit adapter
  chooser, clearer checking/starting/error notices, retry treatment, and friendly
  display of wrapped Windows commands.
- Coalesces rapid agent output chunks into readable conversation turns while retaining
  the bounded transcript limit.
- Replaces AI-agent history-first opening with a dedicated Workforce conversation
  workspace inspired by the supplied reference: agent roster, current state, live
  transcript, session summary, terminal escape hatch, and persistent instruction box.
- Agent instructions are written only to the selected agent's existing engine-owned
  PTY through Protocol v1; no API keys, arbitrary executables, or cloud credentials
  enter renderer state.
- Agent output is streamed into a bounded, ANSI-cleaned conversation transcript with
  clear previous-output labeling, connection state, send errors, and responsive layouts.
- Selecting or focusing an AI worker now opens its conversation workspace instead of
  the generic worker-history dialog.
- Reduces the daily navigation rail to Groundstation, Workspace, Needs You, and
  History; Agents, Projects, and Settings remain available contextually and through
  Mission Command.
- Replaces the synthetic Project Pulse score with explainable Healthy, Ready,
  Waiting on You, and Degraded states derived from existing engine facts.
- Groups the Groundstation scene by inferred operational worker role while preserving
  the existing engine-owned worker and PTY model.
- Replaces fixed AI-agent completion percentages and generic risk claims with reported
  phase, output recency, attention, and engine state.
- Clarifies that acknowledgement clears an alert rather than proving recovery, and
  adds impact and recovery actions to Needs You items.
- Implements real Up/Down/Enter Mission Command navigation, active descendant
  semantics, contextual restart actions, and an empty-result state.
- Replaces native stop, remove, and project-switch confirmations with an accessible
  in-app confirmation dialog that explains consequence and recovery.
- Raises default operational typography and removes decorative idle status animation.
- Adds a detailed product and implementation roadmap in
  `MISSION_CONTROL_PRODUCT_PLAN.md`.
