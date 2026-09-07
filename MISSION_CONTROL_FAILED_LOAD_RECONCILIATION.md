# Failed-load reconciliation (T005, T051)

The audits disagreed about whether failed loads were distinguishable from empty data.
The current tree contained both patterns. Every named surface was traced through loading,
successful-empty, ready, stale/error, unavailable/offline, and unconfigured paths where
the backing service supports those states.

## Verified current behavior

| Surface | Current truth contract |
|---|---|
| Needs You | One engine-owned query reports each source as ready, error, or unavailable. An incomplete query never becomes zero pending. Renderer terminal transport alerts remain explicitly renderer-owned. |
| History | A failed project-memory summary shows a retryable warning while the independent engine event timeline remains available. |
| Mission AI | Initial status is “Checking status,” a failed first read is “Status unavailable,” and a failed refresh is “Stale status.” The last verified configuration is retained and mutation controls are disabled until status is current. |
| Integration overview | Each service request settles independently. Failed refreshes retain last-known values and label them stale; an absent first value is unavailable. Counts stay unknown during loading rather than becoming zero. |
| VS Code | Initial state is “Checking status,” a failed first read is “Status unavailable,” and a failed refresh is “Stale status.” Unknown diagnostics, Git, editor, and terminal values render as unknown, not zero/disconnected. Controls are disabled until current status is verified. |
| MCP | Status and audit settle independently; last-known values are retained; unknown counts use an em dash; retry and last-verified age are shown. |
| Mobile | Status and device registry settle independently. Unknown status cannot claim “Disabled,” and a failed device load cannot claim no paired devices. |
| Plugins | Status, manifest registry, and audit settle independently. A registry failure cannot render the successful-empty state. |
| Agents | Mission list failures retain the last list and show a retryable stale-data warning rather than “No mission.” |
| Automation | The initial list renders a loading skeleton. A failed first read cannot claim no workflows or zero approvals; a failed refresh retains definitions, labels them stale, and disables edits until verified. |

“Offline” is shown only when a service returns an enabled-but-not-running or explicit
connection failure state. Mission Control does not infer offline from a rejected request;
that state is “unavailable” (no verified value) or “stale” (last verified value retained).

## Implementation notes

- MCP, Mobile, and Plugins use independent per-resource state because their status,
  registry, device, and audit calls can fail independently.
- Mission AI, VS Code, and Automation use a small local state envelope with `loading`,
  `error`, and `updatedAt`; successful values remain in their existing domain state.
- All degraded-data notices share the `.integration-resource-notice` /
  `.automation-load-error` visual grammar and provide a Retry action.
- Capability support remains a separate protocol-owned concern. The integration hub does
  not mount a detail panel's controls until `system.hello.capabilities` is verified.

## Evidence

`test/failedLoadReconciliation.test.cjs` pins last-known preservation, first-load unknown
states, successful-empty guards, stale-state controls, and the shared degraded-state
grammar. `test/capabilityHandshake.test.cjs` pins the outer capability gate. The focused
renderer truth-state suite passed 33/33 on 2026-09-04, followed by a successful production
renderer build.

## Remaining refinement

History and Agents retain last-known data but do not yet expose a visible last-success
timestamp. VS Code operation errors still share one inline status region; they remain
errors and never produce success copy, but per-action diagnostics would improve recovery.
