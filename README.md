<p align="center"><img src="assets/brand/source/outarch-wordmark-source.png" alt="OUTARCH" width="480"></p>

# OUTARCH

OUTARCH (formerly Mission Control) is a Windows-first, local developer command
center built around one authoritative Node.js process/session engine. It now has two clients:

- **Groundstation**, an Electron/React desktop control surface with real
  one-, two-, four-, and six-pane xterm.js layouts across Groundstation,
  Workspace, Needs You, Agents, History, Projects, and Settings.
- **TUI**, an Ink-based supervision and recovery client.

Both clients preserve one source of truth for every session: the PTY created and
owned by `SessionEngine` behind the public `EngineAPI` boundary.

## Groundstation desktop preview

Groundstation connects to the real engine through Protocol v1. It does not use
demo state and does not spawn replacement shells to render terminals.

OUTARCH 2.19 maps the supplied full-app UI concept onto the real
renderer: a compact instrument rail, project status tape, dense manifests,
workspace-first terminals, a unified decision room, and one graphite visual
language across Agents, Recipes, History, Mission AI, Projects, Integrations,
Settings, and every dialog. Prototype buttons were not copied; the existing
EngineAPI-backed actions remain the implementation behind each control.

On Windows 11, extract the release and double-click `OPEN_OUTARCH_WINDOWS.cmd`
(the old `OPEN_MISSION_CONTROL_WINDOWS.cmd` still works). If OUTARCH is already
open, launching it again brings that window to the front. The launcher performs
the one-time native dependency install and opens the Electron desktop app. Do not open
`mission-control-prototype.html` to inspect recent changes: it is only the
preserved static v1.7 visual reference and has no EngineAPI connection.

```powershell
npm install
npm run groundstation -- --config D:\Projects\app\termctl.config.json
```

Omit `--config` to use `termctl.config.json` in the current directory. If that
default file is absent, Groundstation starts the same one-shell onboarding
workspace as the TUI.

The current desktop preview provides:

- Real workspace health and worker status
- One-, two-, four-, and six-pane existing-PTY terminal layouts
- Project-specific layout and pane-assignment restoration
- Contextual Mission Graph backed by configured Workspace Recipe dependencies
- Workspace Recipes 2 with bounded parallel DAG scheduling, per-worker evidence
  gates, retries, restart policy, cancellation, and scoped recovery
- Engine-owned root-process CPU/memory sampling and Worker Health analysis
- Resumable Project Memory chapters with concise engine summaries and
  evidence-backed cross-run recovery relationships
- A shared, bounded Mission Context snapshot for built-in AI, MCP, and
  mobile consumers
- Optional Gemini Mission Supervisor for grounded project questions and
  structured workspace plans, using an OS-encrypted key and local approvals
- Optional authenticated VS Code Bridge for active-file, diagnostics, Git,
  task, and editor-terminal identity synchronization
- Optional Secure MCP Gateway with OS-encrypted local credentials, explicit
  capability grants, sanitized resources/tools, and Needs You approvals for
  every requested mutation
- Deeper contextual AI supervision with engine-owned mission phases, observable
  current action, evidence checkpoints, lifecycle, current files, explicit
  related workers, and one-time Needs You permission approvals
- Engine-owned Automation Workflows with explicit event triggers, allow-listed
  actions, cooldown/loop protection, dry run, bounded audit, and one-time local
  approval before every execution
- Mobile supervision security foundation with proof-based local pairing,
  encrypted scoped device sessions, replay protection, immediate revocation,
  bounded Mission Context reads, and Needs You approval before every action
- OUTARCH accounts: sign in on the website with email and password or Google,
  with Free, Pro and Ultimate plans kept in sync from Supabase
- Desktop and in-app notifications, with sound, whenever an AI agent in any
  terminal stops to ask for permission, with a button that opens that terminal
- Signed automatic updates that verify every download before installing it
- Android 13+ supervision client source using Android Keystore, X25519,
  HKDF-SHA256, AES-256-GCM, and biometric identity verification
- Windows descendant-process metrics, release smoke checks, renderer feature
  chunks, and signed-manifest update artifact verification
- Focused-pane keyboard input and ConPTY resize forwarding
- Terminal focus/fullscreen mode
- New-worker and saved-preset creation through the real EngineAPI
- Stopped-worker editing, rename, removal, and restore-policy controls
- Start, restart, confirmed stop, and attention acknowledgement
- Durable activity and attention views
- Bounded renderer crash recovery that preserves engine-owned PTYs
- Safe recent-project switching and last-healthy-project restoration
- Manual local AI-agent workers for Claude Code, Codex, Gemini CLI, and OpenCode
- Bounded replay-before-live terminal handoff
- Secure preload bridge with context isolation, renderer sandboxing, strict IPC
  validation, destructive-action confirmation, and no raw Node access

Electron owns no separate session engine: its main process hosts the same
`EngineAPI`, workspace lease, persistence, and shutdown rules used by the TUI.
Closing Groundstation stops owned PTYs before releasing the workspace lease. A
stuck PTY blocks safe close instead of allowing a second owner to start duplicate
processes.

This is a developer preview, not yet a signed Windows installer. Complete the
checks in `WINDOWS_ACCEPTANCE.md` on Windows 11 before treating native ConPTY
behavior as verified.

## VS Code Bridge

Install the optional extension included with this release:

```powershell
code --install-extension integrations\vscode\mission-control-bridge-0.2.0.vsix
```

Open the same project in OUTARCH and VS Code, then choose **Connect VS
Code** in OUTARCH Settings. The app sends a one-time launch invitation
to the extension and begins synchronization only after the extension proves it
has the exact active project.

The bridge reports the active project-relative file, cursor, bounded diagnostics,
aggregate Git state, task results, and terminal names. It does not receive raw
terminal output, write terminal input, create terminals, expose environment
values, or take PTY ownership. Switching OUTARCH projects disconnects
the previous editor immediately.

## Gemini Mission Supervisor

Open **Settings → Intelligence** to protect a Gemini API key with the operating
system, then run **Ask Mission AI…** from Mission Command. Choose **Ask about
project** for one grounded answer or **Plan workspace actions** for a structured
proposal. It remains contextual—not a chatbot—and creates no primary page.

The API key remains in the Electron main-process credential boundary and is
never returned to the renderer or stored in project files. OUTARCH
refuses to store it when secure OS encryption is unavailable. Provider requests
use the Gemini Interactions endpoint with server-side storage disabled. Terminal
output is omitted unless the user explicitly permits bounded, redacted evidence.

Gemini never receives direct process, filesystem, terminal, or EngineAPI
authority. A plan is parsed into an allow-listed schema, validated against the
active project, and placed in **Needs You**. Only the exact locally reviewed plan
can be approved. Execution then runs sequentially through EngineAPI and records
request, approval, start, verification, or failure in History. Terminal input is
line-bounded, secret-screened, source-attributed, and approval-gated.

## Deeper AI Supervision

Open the existing **Agents** destination and assign a Mission Contract to a
supervised local agent. The contract records its durable objective, explicit
read/write/execute/network scopes, observable checkpoints, and related workers.

Mission phases and current action come only from EngineAPI lifecycle or bounded
structured evidence. Progress is shown as verified checkpoints out of configured
checkpoints—never an inferred percentage. The existing agent detail now keeps
Summary, Progress, Lifecycle, Evidence, current Files, Approvals, and Open Terminal
together without introducing a chat interface.

An agent may request extra authority for one instruction. The request expires
after 30 minutes and appears in **Needs You** with its scope, reason, and impact.
Approving it executes nothing by itself; the matching authority can be consumed
once. Terminal input and PTY ownership remain exclusively behind EngineAPI.

## Secure MCP Gateway

Open **Settings → Connections → Secure MCP Gateway**, choose the explicit capabilities for the
active project, create or rotate the one-time access token, and enable the
localhost endpoint. Copy the generated client configuration into an MCP client.
The server binds only to `127.0.0.1`, validates Origin, requires its OS-encrypted
bearer token, and supports current MCP 2026-07-28 request metadata plus compatible
2025 initialization.

Read tools expose bounded Mission Context, one-worker intelligence, Project
Memory, and Needs You. Terminal evidence is a separate permission and is off by
default. No tool exposes source code, environment values, raw terminal streams,
terminal input, arbitrary paths, credentials, or process objects.

Worker and recipe mutations, new-worker proposals, Gemini plans, and terminal
input requests do not execute from the external request. They create a 15-minute
item in the existing Needs You queue. Only an explicit local approval, after the
current permission is rechecked, routes the bounded action to EngineAPI. The
audit retains operation/outcome metadata but never prompts, arguments, bearer
tokens, source code, or terminal output.

For a same-machine MCP client, use the exact endpoint and one-time bearer token
shown by Settings. The gateway intentionally binds only to localhost; do not
forward or expose that port to the internet. Browser-hosted clients cannot reach
localhost unless they provide a separately secured local connector, which is
outside OUTARCH's current release boundary.

## Automation Workflows

Open **Settings → Automation workflows** to build a project workflow from an
explicit worker event and an allow-listed EngineAPI action. New workflows are
disabled. When enabled, a match creates an expiring item in the existing
**Needs You** queue; nothing executes until you choose **Approve once**.

Cooldowns and one-pending-request suppression prevent approval loops. Dry run
records the proposed action without creating an approval or executing it. The
bounded audit contains outcome metadata only—never terminal output, source code,
environment values, credentials, or arbitrary command text.

## Mobile Supervision Companion

Open **Settings → Mobile supervision companion** to enable the disabled-by-
default local service, select device permissions, create a five-minute pairing
invitation, and revoke paired devices. The pairing code proves the key exchange
but is never transmitted. Each device receives a separate OS-protected desktop
credential and is bound to the project active during pairing.

Mobile payloads use application-layer AES-256-GCM encryption with timestamp and
one-time-nonce replay defense. The protocol exposes bounded supervision rather
than a mobile IDE. Terminal evidence is a separate permission and is disabled
by default. Worker and recipe controls create a request in existing **Needs
You** and cannot execute directly from the device.

The desktop gateway and Android 13+ client source are implemented in this
release. Open `mobile/android` in Android Studio to build a development APK.
Release APK signing, iOS, push notification relay, and secure outside-LAN
rendezvous still require separate release infrastructure.

## Accounts, plans and automatic updates

OUTARCH opens only for a signed-in account. **Sign in** opens the OUTARCH
website in your browser, where you sign in with email and password or with
Google, and the browser hands you back to the app. The plan on that account
(Free, Pro or Ultimate) decides how many terminals, projects, recipes and
BYOK keys you get, and whether MCP, the mobile companion and the VS Code
bridge are available. Features your plan does not include show a crown and an
Upgrade button. **Settings → Account** shows your plan, its limits and today's
Mission AI usage. Updates are checked automatically and installed from
**Settings → About** after their signature is verified.

Administering plans, the built-in Mission AI keys, Google sign-in and releases
is described in [OUTARCH_ACCOUNTS_AND_UPDATES.md](OUTARCH_ACCOUNTS_AND_UPDATES.md).

## Windows release verification

Run `VERIFY_OUTARCH_WINDOWS.cmd` after extraction to build the renderer
and exercise the installed native PTY through CMD and Windows PowerShell. It
produces `windows-acceptance-report.json` without workspace paths, commands,
terminal transcripts, or environment values. Continue the interactive checks
in `WINDOWS_ACCEPTANCE.md` before considering the release accepted.

## Workspace Recipes 2

Open **Workspace Recipes** from the existing Workspace toolbar or Mission
Command. Choose an Ordered Stack, Parallel Services, or Start Then Verify
template, then edit each worker’s dependencies and readiness gate. Recipes are
stored with the project and restore the current terminal layout when launched.

The EngineAPI validates an acyclic graph and dynamically starts every ready
branch up to the configured concurrency limit. Gates can require a running
process, ready service, passing tests, completed build, connected database,
healthy container, clean Git state, zero-code exit, or engine health evidence.
Retries, timeouts, existing-worker restart behavior, failure continuation, and
recovery are bounded configuration—not renderer timers. Optional rollback sends
stop requests only to workers started by that recipe; it never stops a worker
that was already running before launch.

## Current capabilities

- Snapshot list with `idle`, `starting`, `running`, `exited`, and `failed` lifecycle state
- Read-only, bounded, live Tail for the selected PTY
- Full Attach to the same existing PTY (no duplicate shell or command)
- Exit code, spawn error, command, working directory, start time, and runtime
- Safe restart that waits for the old PTY to exit before spawning a replacement
- Kill confirmation and rename prompt
- Persistent create, rename, and remove operations through the Engine API
- Controlled workspace restore with automatic and manual-start sessions
- Explicit start and persisted startup-policy controls without duplicate PTYs
- Transaction-safe editing of stopped worker launch definitions
- Saved worker presets that remain inert until explicitly instantiated
- Full Groundstation worker management through Protocol v1, including create,
  preset instantiation, edit, rename, remove, and startup policy
- Groundstation layouts for single, horizontal, vertical, 2x2, and 3x2 terminal
  arrangements, with unique worker assignment and optional empty panes
- Event-driven Mission Graph with configured startup stages, readiness gates,
  live worker state, dependency-cycle warnings, and downstream impact inspection
- Engine-owned Recipes 2 scheduler with validated acyclic dependencies, dynamic
  parallelism, per-step gates, bounded retry, cancel, and scoped rollback
- Bounded Worker Intelligence for up to 50 active root processes, including
  CPU, working-set memory, stale-sample handling, and recipe-derived impact
- Engine-owned Project Memory with bounded run chapters, prioritized resume
  targets, explicit retry state, and verified recovery evidence
- Authenticated loopback VS Code synchronization with one-time launch tokens,
  same-project validation, project-relative file commands, and no PTY access
- Versioned Mission Context over public EngineAPI facts, with explicit worker
  ownership, terminal-output opt-in, reusable secret redaction, and a 256 KiB
  hard serialization budget
- Built-in Gemini Mission Supervisor with OS-encrypted credentials, stateless
  requests, bounded answers, schema-validated plans, and exact local approvals
- Authenticated localhost MCP resources and tools with current protocol header
  validation, independent scopes, terminal evidence off by default, expiring
  Needs You approvals, and EngineAPI-only mutation execution
- Privacy-safe durable recovery diagnostics and bounded crash-loop handling
- Transactional project switching with recent-project health status
- Allow-listed AI-agent adapters that create stopped workers without accepting
  prompts, tokens, provider URLs, environment values, or arbitrary executables
- Atomic JSON workspace saves with schema and session validation
- Workspace-relative working directories and per-session environment overrides
- Throttled output-driven UI updates
- Deterministic output classification with sticky, acknowledgeable attention
- Fail-closed workspace startup and a no-process `--check` validation command
- Per-workspace single-instance lease that prevents duplicate session launches
- Coordinated shutdown that retains workspace ownership until PTYs exit
- Configurable workspace path with `--config`
- Keyboard guide, cyclic attention navigation, and last-output timestamps
- Engine facade with `list`, `getSnapshot`, `subscribe`, `write`, and
  `attachRawStream`
- Versioned, JSON-serializable engine state and ordered event envelopes used by
  the desktop Protocol v1 client
- Bounded, replayable activity history for lifecycle, attention, workspace,
  and attach events without retaining raw terminal-output events twice
- Durable activity history for persistent workspaces, with monotonic event
  sequences preserved across OUTARCH restarts
- Compact recent-activity surface in the TUI, driven by real engine events
- Transaction-safe workspace mutations that fail before runtime state can
  diverge from the saved configuration
- Per-session lifecycle serialization so restart/removal races cannot orphan a
  replacement PTY, with shutdown waiting for in-flight lifecycle work
- Observer isolation so a faulty UI/event subscriber cannot interrupt PTY
  creation, ownership, or later subscribers

Interactive Split Attach is intentionally not part of this phase. The stable
interaction ladder is Snapshot → Tail → Full Attach.

## Requirements

- Windows 11
- Node.js 22.12+ LTS recommended for Groundstation
- PowerShell, cmd, or another configured terminal command

`node-pty` is the only native dependency. Use Node.js 20 or 22 LTS; Node 22 is
recommended for Windows. The previous unused `better-sqlite3` dependency was
removed so persistence does not add a second native build failure surface.

## Install and run

```powershell
npm install
npm start
```

Use another workspace file or validate one without starting any commands:

```powershell
npm start -- --config D:\Projects\app\termctl.config.json
node bin\termctl.js --config D:\Projects\app\termctl.config.json --check
```

An explicitly selected, malformed, or unreadable workspace fails closed. Mission
Control does not replace it with a fallback shell. When the default
`termctl.config.json` is absent, the original one-shell onboarding fallback is
still used.

Only one OUTARCH process can own a persistent workspace at a time. The
workspace lock records the owner PID and is removed during normal shutdown;
stale locks left by a crashed process are recovered on the next launch.
Normal quit waits for every owned PTY to report exit before releasing that
lease. If a PTY is stuck, shutdown pauses and OUTARCH remounts instead
of opening a window where another instance could launch duplicate work.

OUTARCH reads `termctl.config.json` from the current working directory.
If that default file is missing, it starts one platform-default shell. If the
file exists but is invalid, startup stops with an error.
Valid workspace files use schema version `1`. Legacy files without `version`
remain supported and are upgraded when OUTARCH first saves them.

Commands containing spaces, such as `npm run dev`, run through the platform
shell. For a direct executable with explicit arguments, use an `args` array:

```json
{
  "sessions": [
    {
      "id": "pwsh",
      "name": "PowerShell",
      "command": "powershell.exe",
      "args": ["-NoLogo"],
      "powershellCompatibility": true,
      "cwd": "."
    },
    {
      "id": "server",
      "name": "Dev server",
      "command": "npm run dev",
      "cwd": "./web",
      "env": { "PORT": "3000" },
      "autoStart": false
    }
  ],
  "commands": [
    { "id": "checks", "name": "Run all checks", "command": "npm test", "cwd": "." },
    {
      "id": "build",
      "name": "Production build",
      "command": "npm run build",
      "cwd": ".",
      "autoStart": true
    }
  ]
}
```

Relative working directories resolve from the directory containing
`termctl.config.json`, not from whichever directory later launches the app.
Environment values are passed to the child PTY, but only environment key names
are exposed through snapshots so secrets do not leak into the dashboard.

Top-level `commands` are saved worker presets. They are validated when the
workspace loads but never launch a process at that time. Press `p` to choose a
preset; OUTARCH atomically adds it to `sessions` through the same
EngineAPI creation path used by the normal wizard. Presets default to manual
startup, so selecting one registers an idle worker and `s` starts it. Set
`"autoStart": true` on a preset only when selecting it should launch
immediately. Invalid presets are isolated and do not block valid sessions or
other presets. Environment values in presets are never exposed by state,
events, activity history, or picker data.

`powershellCompatibility` is an explicit Windows fallback for terminal hosts
where PSReadLine cannot accept byte-stream input after Full Attach. It disables
PSReadLine for that session, so leave it off when normal PowerShell editing and
history already work. When enabled, put the executable in `command` and every
option in `args`; OUTARCH does not guess how to split a command line.

Sessions start automatically by default for backward compatibility. Set
`"autoStart": false` to restore a worker as `idle` without launching its PTY.
Press `s` to start it explicitly and `u` to change its saved restore policy.
Changing the policy never starts or stops the current process. The New Session
wizard can also register a manual session without executing it.

Creating, renaming, or removing a session in the TUI updates the same workspace
file atomically. Create and rename are persisted before runtime mutation. A
running session is stopped before removal is persisted, then removed from the
engine only after the save succeeds. If that save fails, OUTARCH keeps
the stopped session tracked and reports a hard failure; it never abandons an
owned PTY or claims that an unsaved mutation succeeded.

Press `e` on an idle, exited, or failed worker to edit its command, arguments,
working directory, environment overrides, or PowerShell compatibility. Mission
Control never stops or restarts a process implicitly for an edit; a running
worker must be stopped first. Changes are saved before runtime state is updated,
and the edited worker remains idle until `s` starts it. Blank edit fields keep
their current values. Environment input accepts a JSON object, pre-fills only
key names rather than saved values, and accepts `{}` to clear all overrides.

Start, restart, policy, and remove operations for the same session are
serialized across the entire EngineAPI transaction. Shutdown first blocks new
lifecycle work, waits
for any in-flight operation, and then stops the final owned PTYs. If shutdown
cannot stop a PTY, the API reopens so the operator can take corrective action.

## Controls

| Key | Snapshot | Tail | Full Attach |
|---|---|---|---|
| `j` / `k` | Move selection | — | Forwarded to PTY |
| `Enter` | Open Tail | — | Forwarded to PTY |
| `Esc` | — | Return to Snapshot | Press twice to detach |
| `F` | Full Attach | Full Attach to same PTY | Forwarded after attach starts |
| `Ctrl+]` | — | — | Detach without stopping session |
| `Ctrl+C` | Quit signal outside attach | — | Forwarded to the child session |
| `s` | Start selected idle/exited worker | — | — |
| `r` | Restart | — | — |
| `u` | Toggle automatic/manual startup | — | — |
| `e` | Edit selected stopped worker | — | — |
| `p` | Open saved worker presets | — | — |
| `g` | Cycle through sessions needing attention | — | — |
| `a` | Acknowledge selected attention item | — | — |
| `c` | Create session | — | — |
| `n` | Rename | — | — |
| `x` | Kill with typed confirmation | — | — |
| `d` | Remove with typed confirmation | — | — |
| `q` | Quit OUTARCH | — | — |
| `?` / `h` | Open keyboard guide | — | — |

`Ctrl+\\` is also accepted as a Full Attach detach fallback. `Ctrl+]` is the
recommended unambiguous detach key.

## Tests

```powershell
npm test
```

The suite uses an injected fake PTY for deterministic lifecycle, attachment,
listener-cleanup, restart/removal races, bounded-buffer, environment redaction,
workspace persistence, and high-output tests. It also mounts the real Ink
component tree to verify Tail input behavior and redraw throttling.

The repository CI runs on Node.js 20 and 22 on Linux, plus Node.js 22 on
Windows. Generated dependencies and machine-local `termctl.config.json` files
are intentionally excluded from source control.

Real Windows ConPTY behavior—especially VS Code raw-mode ownership, Ctrl+C,
resize, and full-screen terminal programs—must still be manually tested on
Windows. Unit tests cannot prove those host-specific behaviors.

## Architecture boundary

TUI components and `CommandRouter` use `EngineAPI`; they do not receive a
public `SessionEngine` reference or read `SessionEngine.sessions`.
Full Attach obtains a small raw adapter from `attachRawStream(id)` with explicit
`write`, `resize`, `onData`, and `onExit` methods. It never launches a process.
Workspace mutations use the same facade and an atomic, human-readable JSON
store. Groundstation now consumes this boundary through a separate versioned
protocol; its renderer never receives `EngineAPI`, `SessionEngine`, or Node
process access.

Protocol v1 validates fixed request/response envelopes, bounds every request
and terminal stream, gates destructive actions, and separates overview events
from explicit raw-terminal subscriptions. Terminal open registers the live
listener before reading replay, queues output until renderer activation, and
rejects stale stream identifiers after restart, exit, reload, or close.

The additive `context.snapshot` method composes worker lifecycle, health,
dependencies, Needs You, missions, Project Memory, recipes, durable activity,
and VS Code synchronization into one sanitized structure. Terminal output is
omitted unless explicitly requested for bounded known workers; source code and
environment values are never included. This context service is read-only and
does not gain PTY ownership or process-control authority.

The additive `missionAi.status`, `missionAi.configure`, `missionAi.ask`, and
confirmed `missionAi.clear` methods keep provider access behind Protocol v1.
Only the Electron main process can decrypt the API key and call Gemini. Requests
are stateless, bounded, grounded in sanitized Mission Context, and carry no tool
declarations. Mission AI therefore cannot bypass `EngineAPI`, create a PTY, or
claim that an operation was executed.

Workspace Recipes are normalized, persisted, and scheduled inside `EngineAPI`.
The renderer edits inert recipe definitions and uses additive Protocol methods;
it never launches a process directly. Dependency-ready branches can advance
independently, while all starts and restarts still use the serialized public
session lifecycle. Cancellation stops scheduling rather than abandoning PTY
ownership, and shutdown cancels recipe work before stopping owned sessions.

Groundstation worker forms use the same protocol actions as the TUI and never
receive private engine or workspace-store objects. Editing a stopped worker
prefills environment key names only; existing values remain unchanged unless
the operator explicitly replaces the environment object. Terminal layout state
contains only layout identifiers and worker IDs and is stored per persistent
workspace in Electron renderer storage. Reassigning or emptying a pane disposes
its existing terminal stream before another worker is opened.

`EngineAPI.getState()` returns a JSON-serializable contract envelope with
`contractVersion`, the latest event `sequence`, workspace facts, and session
summaries. It also includes the latest bounded activity window. Subscription
events include the same contract version plus a strictly increasing sequence
and timestamp. Re-entrant observer actions are queued so every subscriber sees
the same sequence order.

Session summaries expose `autoStart` separately from lifecycle `status`. An
idle session is a real engine-owned definition with no PTY; `EngineAPI.start()`
is serialized with restart, removal, and shutdown so concurrent controls cannot
orphan a newly started process. `session:autostart` records policy changes in
the same ordered activity contract.

`EngineAPI.reconfigure(id, patch)` serializes with start, restart, removal, and
shutdown. It rejects live sessions and immutable ID changes, validates the
merged definition, atomically persists it, then updates the stopped runtime
session without spawning a PTY. `getSessionConfiguration(id)` exposes editable
facts while returning environment key names only. The resulting
`session:reconfigured` event and durable activity record never contain
environment values.

`EngineAPI.listSavedCommands()` exposes sanitized preset summaries, including
environment key names but never values. `createFromSavedCommand(id)` reuses the
transaction-safe `create()` path, so a failed workspace save launches no PTY
and a successful preset can own at most one session/process. The additive
`saved-command:instantiated` event records the source preset without copying
its environment into the public contract.

`EngineAPI.getActivity({ afterSequence, limit })` supports bounded replay and
reports `gap` when a client asks for history older than the retained window.
Raw `session:output` events remain live-only because terminal snapshots already
own bounded output; lifecycle, attention, workspace-save, load-error, and
attach-rejection events are retained. Persistent workspaces save at most 200
activity records in an atomic JSON sidecar next to the workspace file. Event
sequences continue across launches. Raw output is never written there, and
output-derived attention reasons are removed before persistence. Corrupt or
oversized history is surfaced as an activity error without blocking valid
workspace sessions.

Contract version `1` is additive: future clients can reject unknown major
versions instead of guessing at an incompatible payload.

The attention model is also engine-owned. Known error output, spawn failures,
and unexpected non-zero exits create a sticky `attentionRequired` fact. Later
progress output cannot silently clear it; the user explicitly acknowledges it
with `a`, and every client receives the same `session:supervision` event.
