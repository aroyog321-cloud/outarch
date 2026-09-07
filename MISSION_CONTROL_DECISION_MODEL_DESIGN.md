# Unified Decision Model — design sketch (Batch 2b)

Status: **proposal, awaiting sign-off.** No code in this batch yet.
Covers register tasks: T003, T046, T053–T069, T222, T230, T231, and unblocks T047/T048/T050/T051/T052, T101–T103, T106.
Date: 2026-09-03.

---

## 1. What exists today (verified in the current tree)

`NeedsView` (`App.jsx:1025`) is a **renderer-side concatenation of eight independent sources**:

| # | Source | How Needs You gets it | Owner | Failure behaviour today |
|---|---|---|---|---|
| 1 | Session failures / `attentionRequired` | `attention` prop (from `state.get`) + `attention.list` for lifecycle | Engine (`engineApi.listAttention()`, `App.jsx` merge) | `attention.list` `catch {}` — lifecycle silently drops, session rows remain |
| 2 | Renderer terminal-transport alerts | `session.rendererAttention` (merged into `attention` by `reportTerminalAlert`) | **Renderer only** — never engine | n/a (local) |
| 3 | Mission Supervisor approvals | `<MissionSupervisorApprovalQueue>` → `missionSupervisor.approval.list` + `missionSupervisor.status` | Service (`callMissionSupervisor`) | component reports `pendingCount` `0` on catch |
| 4 | Mission (agent contract) approvals | `<MissionApprovalQueue>` → `mission.approval.list` | Engine (`engineApi.listMissionApprovals()`) | same |
| 5 | MCP approvals | `<McpApprovalQueue>` → `mcp.approval.list` + `mcp.status` | Service (`callMcp`) | same |
| 6 | Automation approvals | `<AutomationApprovalQueue>` → `automation.approval.list`* | Engine (`engineApi`) | same |
| 7 | Mobile approvals | `<MobileApprovalQueue>` → `mobile.approval.list` | Service (`callMobile`) | same |
| 8 | Plugin approvals | `<PluginApprovalQueue>` → `plugin.approval.list` | Service (`callPlugin`) | `onPendingChange?.(0)` — **explicitly reports zero on failure** |

\* `automation.approval.list` is not in `METHODS`; the queue currently reads approvals off the automation list. Confirm during implementation.

### Concrete defects this produces (all reproduced by reading the code)

1. **False "0 pending".** `totalWaiting = available.length + supervisorPendingCount + mcpPendingCount + missionPendingCount + automationPendingCount + mobilePendingCount + pluginPendingCount` (`App.jsx:1048`). Any failed source contributes `0`. The sidebar badge (`pendingCount`, `App.jsx:1340`) has the same bug. A user cannot tell "nothing is waiting" from "three sources are down".
2. **No global ordering.** Session rows render first (unsorted beyond snooze), then the six queue components render in fixed component order, each internally ordered its own way. Nothing is sorted by severity, expiry, or age across sources (T063).
3. **`Mark all seen` is wrong twice.** It only mutates the local `queueState` for session `attention` ids, and it is `disabled={!attention.length}` — so it does nothing to external approvals and is unavailable exactly when only external decisions remain (T066).
4. **Two parallel filter systems.** The list filters `available` by `filter`; the queue components separately receive `visible={filter === ...}`. All / Critical / Agents / Integrations are not one operation over one set (T064).
5. **Resolved/recent decisions vanish.** Only engine `attention` records expose `recovered`; a resolved MCP or mobile approval leaves no trace in Needs You (T068).
6. **Six subscriptions, six refetches.** Each queue subscribes to `integration:event` and refetches its whole list on any event for its integration (MC-10 / T170).

Audit A (MC-06) is correct on aggregation; Audit B is right that no source *fabricates* data, but the concatenation still produces an untrustworthy count and empty state.

---

## 2. The model

### 2.1 `DecisionRecord` (engine-owned, serialisable)

```
DecisionRecord {
  id:            string            // stable, engine-issued, unique across sources
  source:        "session" | "terminal" | "missionSupervisor" | "mission"
               | "mcp" | "automation" | "mobile" | "plugin"
  type:          string            // e.g. "worker.failed", "approval.scopes", "approval.command"
  severity:      "critical" | "warning" | "info"
  status:        "pending" | "acknowledged" | "acting" | "verifying"
               | "resolved" | "expired" | "dismissed"
  title:         string            // one line, imperative
  target: {                        // what the decision is about — drives the deep link
    kind:  "worker" | "agent" | "integration" | "mission" | "recipe" | "none"
    id:    string | null
    label: string
  }
  evidence:      string            // observed fact only; never inferred/fabricated
  impact:        string            // consequence of acting / not acting
  actions: [                       // what the user may do, engine-declared
    { id: string, label: string, tone: "primary"|"danger"|"neutral",
      confirm: boolean,            // true => needs the shared confirmation ceremony (Batch: T038-T045)
      resolves: boolean }          // true => terminal for this record
  ]
  createdAt:     number
  expiresAt:     number | null
  resolution:    { decision: string, at: number, by: "user"|"engine"|"expiry" } | null
  deepLink:      { view: string, params: object }   // e.g. { view: "workspace", params: { focus: "api" } }
  origin:        "engine" | "renderer"   // preserves T230: renderer terminal alerts stay distinct
  audit:         [ { at: number, event: string, detail?: string } ]
}
```

Renderer terminal-transport alerts (`source: "terminal"`, `origin: "renderer"`) are **injected client-side into the same list** by the `useDecisions` hook — they are never sent to the engine, and their only resolving action stays "Dismiss (clears the renderer alert; engine worker state unchanged)". This keeps the T230 separation explicit while giving the user one queue.

### 2.2 Query envelope

```
DecisionQuery {
  records:  DecisionRecord[]            // already globally sorted (see 2.3)
  sources: [
    { id: source, availability: "ready"|"loading"|"stale"|"error"|"unavailable"|"unconfigured",
      lastSuccessAt: number | null, error: string | null, pending: number }
  ]
  complete: boolean                     // true iff every source is "ready" or "unconfigured"
  counts:   { pending: number, critical: number, byTarget: { agent: n, integration: n, worker: n } }
}
```

`complete: false` is what Needs You renders as "12 waiting · 2 sources unavailable", never as a clean number.

### 2.3 Global ordering (deterministic)

`records` sorted by, in order:
1. `status` bucket: pending/acting/verifying before acknowledged before resolved/expired/dismissed
2. `severity`: critical → warning → info
3. `expiresAt`: sooner first (nulls last)
4. `createdAt`: older first
5. `id`: lexical tiebreak (stable across refetches)

### 2.4 Protocol surface (additive — nothing removed this batch)

New `METHODS`:
- `decisions.list` → `DecisionQuery`
- `decisions.acknowledge` `{ id }` → visibility/read state only, never resolves
- `decisions.resolve` `{ id, actionId, confirmation? }` → routes to the owning source's existing resolver

New events (engine → renderer, one channel):
- `decision:changed` `{ id }` (created / updated / resolved) — renderer patches one record, no full refetch
- `decision:sources` `{ sources }` — availability changed

**Kept for compatibility (one release):** every existing `*.approval.list` / `*.approval.resolve` / `attention.*` method. The TUI, mobile client, and any external client keep working unchanged. `decisions.resolve` is a thin front door that calls the same engine/service resolver the old method does, so authority and the confirmation contract are untouched (T044).

### 2.5 Engine `DecisionBroker`

A new module `src/engine/decisionBroker.cjs`, owned by `EngineApi`:
- Pulls from the eight sources on demand for `decisions.list`; each pull is independently `try`-wrapped and tagged with `availability` + `lastSuccessAt` + `error`. One slow/broken source never blanks the others.
- Subscribes to the events that already exist (`attention:lifecycle`, `automation:approval`, `mission:approval`, and the services' `integration:event`) and re-emits `decision:changed`.
- Normalises each source's native record into `DecisionRecord` with a small per-source adapter (≈30 lines each). No new persistence — resolved/expired history reuses each source's own store; the broker only *reads*.
- `acknowledge` writes to the existing engine attention lifecycle for `source: "session"`, and to a tiny per-record `seenAt` map (persisted in the workspace store) for external sources.

---

## 3. Renderer collapse

**Delete:** `MissionSupervisorApprovalQueue`, `MissionApprovalQueue`, `McpApprovalQueue`, `AutomationApprovalQueue`, `MobileApprovalQueue`, `PluginApprovalQueue` **usages inside `NeedsView`**, plus the six `*PendingCount` state hooks + callbacks in `GroundstationApp`. Keep the queue components' resolve logic by folding it into per-source adapters, or keep the components importable for any other caller and just stop mounting them in Needs You.

**Add:**
- `useDecisions()` hook — one `decisions.list` + one subscription; injects renderer terminal alerts; returns `{ records, sources, complete, counts, acknowledge, resolve, retrySource }`.
- `<DecisionList records=… />` — renders `DecisionItem` (already the shared primitive) for every record, in engine order. Filters (All / Critical / Agents / Integrations) are `records.filter(...)` over the one array (T064).
- `<DecisionSourceStrip sources=… />` — one compact line above the list: `● session ● mission ⚠ mobile (retry) ○ mcp unconfigured`. This is the completeness signal (T065, T103).

**Sidebar badge:** `pendingCount` becomes `counts.pending` from the same query; when `!complete` the badge gets a dot ("+" affordance) meaning "at least this many".

### State treatments (T046, T141)

| availability | Source strip | List behaviour |
|---|---|---|
| `ready` | ● solid | records shown |
| `loading` | ◐ pulse (reduced-motion: static) | skeleton rows if first load |
| `stale` | ● + "syncing" | last records shown, dim |
| `error` | ⚠ + **Retry** | banner "Mission requests could not be loaded"; **count excluded, never zeroed** |
| `unavailable` | ○ "offline" | no rows, no count contribution, explains why |
| `unconfigured` | ○ "not set up" | no rows; does **not** count against `complete` |

### Rules preserved

- `Mark all seen` → `acknowledge` for every currently-visible record; **visibility only**, never resolves, never disabled while unseen records remain (T066).
- **No bulk approve.** `decisions.resolve` takes exactly one `id`; each consequential action keeps its own evidence and (post Batch T038–T045) its own confirmation ceremony (T067).
- Completed builds route to History/notifications, not Needs You, unless acknowledgement is explicitly required (T069).
- Renderer terminal alerts keep `origin: "renderer"` styling and copy (T230).
- No fabricated reasoning / progress / telemetry (T231) — every field is a passthrough of an observed value.

---

## 4. Rollout — safe increments, checkpoint after each

| Step | Change | Test / proof | Visual? |
|---|---|---|---|
| 2b-1 | `decisionBroker.cjs` + `decisions.list` returning **only `source: "session"`** (parity with `attention.list`). Adapters for the other 7 stubbed as `unavailable`. | new `test/decisionBroker.test.cjs`; `decisions.list` shape contract; `rendererProtocolContract` still green | no |
| 2b-2 | Adapters for mission, missionSupervisor, mcp, automation, mobile, plugin — read-only, each independently failure-isolated. | broker test: kill one source → others intact, `complete: false`, that source `error` | no |
| 2b-3 | `useDecisions` + `<DecisionSourceStrip>`; `NeedsView` renders the strip **above the existing six queues** (no deletion yet). Badge switches to `counts.pending`. | renderer test; manual: force a source down, see strip + honest badge | **yes — screenshot** |
| 2b-4 | Replace the six queue components + session list in `NeedsView` with `<DecisionList>`. Delete the six `*PendingCount` hooks. | renderer tests updated; `groundstationRedesign` string assertions migrated to behavioural | **yes — screenshot, all filters, empty/error/partial** |
| 2b-5 | `decisions.resolve` / `decisions.acknowledge` wired; `Mark all seen` = acknowledge-only. Remove per-component subscriptions. | resolve routes to same engine resolver (assert authority unchanged); acknowledge never flips `resolves` | yes — screenshot |
| 2b-6 | Groundstation "critical decisions" strip (T102/T103) consumes the same `useDecisions`. | — | **yes — screenshot** |
| 2b-7 | Deprecate (comment, not delete) the per-source `*.approval.list` renderer calls; keep protocol methods. Update register. | full suite serial + parallel; build; bundle delta explained | — |

Each "yes" step pauses for your screenshot review before the next.

---

## 5. Explicitly out of scope for 2b

- The shared **confirmation service / engine nonce** (T038–T045) — separate batch; `DecisionRecord.actions[].confirm` is the seam for it.
- **Native notification delivery** (T033–T037) — `decisions.list` + `decision:changed` is the event source it will consume later.
- Any restyle of `DecisionItem` itself beyond the source strip.
- Removing the dead inline `AgentsView` / `IntegrationsView` from `App.jsx` (T180/T181) — trivial, can ride along or go in the cleanup batch.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Broker pull latency if a service is slow | per-source timeout (500 ms) → `stale`, never blocks the envelope |
| Test suite pins the six queue components' markup | step 2b-4 migrates those assertions to behavioural/contract in the same commit (register T192) |
| `decision.id` collisions across sources | broker namespaces every id as `${source}:${nativeId}` |
| External client still calls old methods | old methods retained and tested for one release; register T044 |
| Regression in approval authority | `decisions.resolve` calls the identical engine/service resolver; a test asserts the confirmation string contract is unchanged |

---

## T085 — Safe local recipe scheduling: the definition

T085 was deliberately gated: *"Define safe local scheduling **only after** editing, notification,
and attention reliability are complete."* Those three preconditions are now met — recipe editing has
create/edit/duplicate modes with unsaved-change protection (T072–T075) and revision-conflict detection
(T076); native notification delivery exists with severity, quiet hours, deduplication and rate limiting
(T033–T037); and attention is one engine-owned decision model with source-availability truth
(T046–T070). So the definition can be written honestly rather than guessed at.

This section is the **safety model**. Implementation is T204 and remains open.

### What a schedule may and may not be

A scheduled recipe is a *request to run at a time*, never a promise that it did. Mission Control is a
local-first desktop app: the machine sleeps, the app is closed, the project is not open. Any design
that hides those facts produces the exact class of false confidence this register exists to remove.

- **A schedule belongs to a project, not to the app.** It is stored with the workspace, and it can only
  fire while that project is the open one. A schedule that fires against a different project — or
  against no project — is not a feature, it is a wrong-directory `rm`.
- **Nothing is ever run without the app running.** No service, no scheduled task, no daemon. If the app
  is closed at the appointed time, the schedule did not fire, and the UI must say so.

### Missed-fire semantics (sleep, shutdown, project closed)

The only honest options for a missed occurrence are *skip* and *ask*, and the choice belongs to the
operator per schedule:

| Policy | On the next launch after a missed time |
|---|---|
| `skip` (default) | Record "missed" in history. Do nothing. |
| `ask` | Raise one decision in Needs You: "Nightly tests was due 6h ago. Run it now?" It expires like any other decision. |

**Catch-up is never automatic.** Waking a laptop after a weekend must not start four builds. This is
why `skip` is the default: the safe direction is to do nothing and say so.

### Approval semantics

A schedule is an *authorisation to start workers*, granted once at creation, and it is bounded by what
the recipe already is:

- Creating a schedule requires the same confirmation ceremony as any destructive action, because it
  grants a future action that no one will be watching.
- A schedule authorises **only the recipe as it was when the schedule was created**. Editing the recipe
  bumps its revision (T076), and a schedule whose recorded revision no longer matches does **not** fire:
  it raises a decision asking the operator to re-authorise the changed recipe. Otherwise "schedule the
  test suite" silently becomes "schedule whatever that recipe says next month".
- A recipe whose steps include an approval-gated operation may not be scheduled at all. An unattended
  run cannot answer an approval, and queueing one to be answered hours later defeats the point of asking.

### Delivery and visibility

- Every fire, skip, miss and refusal is an engine activity event, so History is the record.
- A fire raises a notification through the existing policy (T033–T037): it obeys the severity floor,
  quiet hours, deduplication and rate limiting like everything else. Scheduling does not get a private
  channel that bypasses the operator's interruption settings.
- The Recipes page shows the next occurrence and the last outcome for every schedule, and the run
  history (T077) records scheduled runs the same way as manual ones, marked as scheduled.

### Why this is not implemented yet

The semantics above are cheap to write and expensive to get wrong, and two of them need engine work
that does not exist: a persistent per-project timer that survives project switches without leaking, and
the revision-pinned authorisation check. T204 owns that work. Until it lands, Mission Control has **no**
scheduling surface at all — which is the correct state, because a scheduling UI that silently does not
fire is worse than none.
