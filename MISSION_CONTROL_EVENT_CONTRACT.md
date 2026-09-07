# Renderer event-subscription contract (T002)

Every renderer subscription flows through **one** transport and **one** producer chain.
There is no second event bus, no `window` event listener carrying engine data, no
polling loop masquerading as a stream. This document is the authority for the
producer, payload, ordering, replay, and teardown contract of each consumer, and
`test/rendererProtocolContract.test.cjs` fails the build if the invariants below regress.

## Transport

```
engine / 4 services / terminal streams
        │  (in-process subscribe callbacks)
        ▼
src/protocol/index.cjs  createProtocolConnection  → frames every notification as { version:1, type, … }
        │  options.send(message)
        ▼
src/groundstation/main/ipcHost.cjs   send: only messages with a `type` → webContents.send("mission-control:event", …)
        │  Electron IPC, main frame only
        ▼
src/groundstation/preload/index.cjs   ipcRenderer.on("mission-control:event", …) → fan-out to subscribers
        │  window.missionControl.subscribe(cb)
        ▼
src/groundstation/renderer/missionApi.js   missionApi().subscribe(cb)   ← the only API every consumer uses
```

Request responses travel on the `invoke()` return path, never the event channel
(`ipcHost.cjs` gates on `message?.type`), so a renderer never observes a response twice.

## Producer → payload

| `type` | Producer | Payload | Sequenced? |
|---|---|---|---|
| `engine:event` | `engineApi.subscribe("all", …)` | `{ version:1, type:"engine:event", event }` where `event` carries `event.type`, `event.sequence`, and type-specific fields | **Yes** — monotonic `event.sequence` |
| `integration:event` (`integration:"vscode"`) | `vscodeBridge.subscribe` | `{ version:1, type, integration, status }` — `status` is the **whole** current status object | No — last-writer-wins snapshot |
| `integration:event` (`"mcp"` / `"mobile"` / `"plugins"`) | `mcpGateway` / `mobileCompanion` / `pluginPlatform` `.subscribe` | same shape | No — last-writer-wins snapshot |
| `terminal:data` | protocol terminal stream flush | `{ version:1, type, streamId, terminalEpoch, sessionId, data }` | No — ordered per stream, idempotent chunk |
| `terminal:overflow` | protocol terminal stream flush | `{ …, droppedBytes }` (precedes the `terminal:data` batch that dropped) | No |
| `terminal:exit` | protocol terminal stream | `{ …, exit }` | No — sent once per stream (`state.exitSent`) |

`session:output` engine events are dropped **at the producer** (`onEngineEvent` early-returns);
they never reach the channel. Bulk terminal bytes only ever travel as `terminal:data`.

## Ordering & replay (engine events)

`eventMode`: `queued` → `flushing` → `active`.

1. On connect and after every `state.get`, the connection records `snapshotSequence = state.sequence`
   and sets `eventMode = "queued"`. Engine events now accumulate in `eventQueue`.
2. `eventQueue` is bounded at `MAX_EVENT_QUEUE = 1000`. Overflow drops the **oldest** and
   records `eventDroppedThrough = <last dropped sequence>`.
3. The renderer calls `events.activate({ afterSequence })`. Guards:
   - `SNAPSHOT_REQUIRED` — `state.get` was never called.
   - `STALE_SNAPSHOT` — `afterSequence !== snapshotSequence`.
   - `EVENT_GAP` — `eventDroppedThrough > afterSequence`; the queue overflowed past the
     snapshot, so the renderer **must** take a fresh snapshot rather than accept a silent gap.
4. On success the connection flushes every queued event with `sequence > afterSequence`,
   then switches to `active` (live pass-through).

`integration:event` and `terminal:*` are **not** replayed and carry no sequence.
Integration events are idempotent full-status snapshots; terminal chunks carry
`terminalEpoch` so a stale stream's bytes are rejected downstream. Every consumer of
these coalesces (debounce / refetch), which is safe precisely because they are snapshots.

## Preload buffering

`preload/index.cjs` holds a `subscribers` Set. A message that arrives while the set is
empty is buffered in `bufferedEvents`, bounded at `MAX_BUFFERED_EVENTS = 512` (newest kept).
The first `subscribe()` drains the buffer into that callback. Messages whose
`version !== PROTOCOL_VERSION` are discarded. `subscribe()` returns
`() => subscribers.delete(callback)`.

## Consumers — every site is filtered and has bounded teardown

All 15 call sites use `missionApi().subscribe(...)` inside a `useEffect`, filter by
`type` (and `integration` / event-type prefix), and return a cleanup that invokes the
unsubscribe. Coalescing timers are cleared in the same cleanup.

| File:line | Filter | Reaction | Teardown |
|---|---|---|---|
| `useMissionState.js:55` | `engine:event`, not `session:output` | 150 ms-debounced `refresh()` | `mounted=false; unsubscribe(); clearTimeout` |
| `useDecisions.js:113` | `isDecisionEvent` (`attention:` / `mission:approval` / `automation:approval` / `session:` / `integration:event`) | 250 ms-coalesced `decisions.list` refetch | `active=false; unsubscribe(); clearTimeout` |
| `App.jsx:371` | `type` startsWith `recipe:` | refresh recipes | `unsubscribe?.()` |
| `App.jsx:1250` | `integration:event` && `integration==="vscode"` | `setStatus` | `unsubscribe?.()` |
| `TerminalPane.jsx:230` | `terminal:data` / `terminal:exit` / `terminal:overflow` by `streamId` | apply to xterm | `unsubscribe()` in cleanup |
| `AutomationWorkflows.jsx:47` | `engine:event` && event type startsWith `automation:` | refetch `automation.list` | `active=false; unsubscribe()` |
| `IntegrationsView.jsx:50` | `integration:event` | refetch directory | `unsubscribe?.()` |
| `RecipesView.jsx:37` | `type` startsWith `recipe:` | refetch | `unsubscribe` |
| `MissionGraph.jsx:372` | engine event type startsWith `recipe:` | refetch | `unsubscribe` |
| `McpGateway.jsx:52`, `:124` | `integration:event` && `mcp` | `setStatus` / refetch | `active=false; unsubscribe()` |
| `PluginPlatform.jsx:41`, `:85` | `integration:event` && `plugins` | `setStatus` / refetch | `active=false; unsubscribe()` |
| `PluginContributionSlot.jsx:36` | `integration:event` && `plugins` | refetch contributions | `active=false; unsubscribe()` |
| `MobileCompanion.jsx:120`, `:535` | `integration:event` && `mobile` | `setStatus` / refetch | `active=false; unsubscribe()` |

## T002 acceptance

- **Known source:** one producer chain, one IPC channel, one preload fan-out, one renderer
  wrapper. No consumer subscribes to anything else.
- **Bounded:** engine queue 1000 with explicit `EVENT_GAP` detection; preload buffer 512;
  `session:output` and raw terminal bytes never broadcast as engine events.
- **Ordered / replayable where it matters:** engine events are sequence-checked from the
  snapshot; integration/terminal events are idempotent snapshots and epoch-tagged chunks.
- **Torn down:** all 15 renderer subscription sites return a cleanup that unsubscribes and
  clears any coalescing timer. Enforced by `test/rendererProtocolContract.test.cjs`.
