# Destructive-confirmation reconciliation (T004)

The two audits described apparently conflicting states: one credited destructive
confirmation, while the other showed that confirmation values were predictable and
bypassable. Both observations matched only part of the old implementation. This file
records the traced and tested current state.

## Verified state before remediation

| Flow | Protocol method | User ceremony | Protocol enforcement |
|---|---|---|---|
| Recipe deletion | `recipe.delete` | Shared confirmation dialog | None |
| Automation removal | `automation.delete` | None | Predictable renderer-generated string |
| Mission cancellation/completion | `mission.transition` | None | Predictable renderer-generated string |
| Other protected integration and project operations | Several methods | Inconsistent | Predictable renderer-generated string |

The old `confirm:<method>:<id>` values were payload completeness checks, not
authorization. They could be reconstructed and replayed by any caller that knew the
method and identifier. Recipe deletion had the opposite weakness: a good renderer
ceremony but no protocol enforcement.

## Implemented confirmation service

Protocol v1 now advertises confirmation subprotocol version 2 in `system.hello`.
Protected operations use this sequence:

1. The UI presents the shared accessible confirmation ceremony for a destructive action.
2. After explicit confirmation, the renderer calls `confirmation.request` with the target
   method and exact target parameters.
3. Protocol validates that the target operation requires confirmation and issues a
   cryptographically random 32-byte token.
4. The token is bound to a canonical SHA-256 digest of the exact method and parameters,
   excluding only the top-level `confirmation` field.
5. The protected request consumes the token before validation or execution, preventing
   replay even after a mismatch.

Tokens expire after 60 seconds, are scoped to one protocol connection, are cleared when
the connection closes, and are capped at 128 pending tokens per connection. Predictable
legacy strings are rejected. `system.hello.confirmation` documents the version, binding,
TTL, cap, and absence of legacy-token support so external clients can feature-detect the
security contract.

## Renderer coverage

The shared flow now covers recipe deletion, worker kill/remove, bulk kill, project
open/initialize, mission transitions and checkpoints, automation removal, Mission AI
history clearing, Mobile device revocation, MCP token rotation, plugin uninstall, VS Code
managed-terminal create/write/close, and confirmed decisions. Non-destructive actions may
request a bound token without presenting destructive wording.

Destructive child components do not fall back to firing when the confirmation callback is
missing: the action is unavailable instead. This prevents a second renderer entry point
from silently bypassing the ceremony.

## Trust boundary and lifecycle audit

The token service protects protocol calls from stale, mismatched, replayed, or fabricated
confirmation values. The Electron renderer remains inside the application's trusted local
UI boundary: a fully compromised renderer could ask for a token without showing its own
ceremony. Context isolation, sandboxing, the narrow preload bridge, request allowlisting,
and exact token binding remain essential layers; this is not a claim of privilege
separation from a compromised renderer.

The protocol now appends requested, confirmed, rejected, expired, and completed lifecycle
events through `EngineAPI.recordConfirmationEvent`. These records use the existing bounded,
durable activity store. The EngineAPI method accepts only an allow-listed lifecycle kind,
protocol operation name, and optional outcome code. Confirmation tokens, exact parameter
bindings, paths, commands, decision text, and target payloads are never recorded.

`confirmed` means the single-use token passed exact-operation validation. `completed` is
recorded only after the protected operation returns successfully. A required, unknown,
replayed, or mismatched token records `rejected`; a detected stale token records `expired`.
Audit recording is deliberately non-authoritative: a persistence failure cannot execute,
cancel, or otherwise change the outcome of the protected operation.

## Evidence

- `test/protocol.test.cjs` verifies unpredictability, exact binding, mismatch consumption,
  replay rejection, expiry, predictable-token rejection, safe-method rejection, recipe
  deletion enforcement, and the advertised confirmation contract.
- `test/destructiveConfirmation.test.cjs` verifies renderer ceremonies, absence of legacy
  strings, no destructive fallback, and protected method coverage.
- `test/rendererProtocolContract.test.cjs` checks both ordinary and confirmed renderer
  request literals against the Protocol v1 allowlist.
- `test/engineApi.test.cjs` verifies that confirmation lifecycle activity is bounded and
  strips token and target payload fields.
