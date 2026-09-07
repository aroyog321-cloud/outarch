"use strict";

// T023 — the safety rules for sending one command to many terminals.
//
// Broadcast is the only action in Mission Control that multiplies a mistake by
// the number of workers, so the rules are stricter than for typing into one
// terminal, and they live here as pure functions so they can be tested exactly
// rather than inferred from the protocol handler.
//
// Two categories, treated differently on purpose:
//
//   * Secrets are **refused**, never warned about. Broadcasting a key writes it
//     into N scrollback buffers and N shell histories at once; there is no
//     "yes I meant it" that makes that recoverable, and the operator can still
//     paste it into a single terminal deliberately.
//   * Destructive commands are **acknowledged**, not refused. `git reset --hard`
//     across four repositories is a legitimate thing to want; it just must not
//     happen because someone pressed Enter out of habit.

const MAX_BROADCAST_TARGETS = 12;

// Anything that looks like credential material in transit.
const SECRET_PATTERNS = [
  { id: "private-key", label: "a private key block", pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { id: "assignment", label: "a secret assigned inline", pattern: /\b(?:password|passwd|secret|api[-_]?key|access[-_]?token|auth[-_]?token|client[-_]?secret)\b\s*[:=]\s*\S/i },
  { id: "bearer", label: "an Authorization header", pattern: /\bauthorization\s*:\s*(?:bearer|basic)\s+\S/i },
  { id: "provider-token", label: "a provider token", pattern: /\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16})\b/ },
  { id: "long-opaque", label: "a long opaque token", pattern: /\b(?=[A-Za-z0-9+/_-]{40,})(?=[^\s]*\d)(?=[^\s]*[A-Za-z])[A-Za-z0-9+/_-]{40,}={0,2}\b/ }
];

// Commands whose blast radius is the reason broadcast is dangerous at all.
const DESTRUCTIVE_PATTERNS = [
  { id: "recursive-delete", label: "a recursive delete", pattern: /\brm\s+(?:-[A-Za-z]*\s+)*-[A-Za-z]*[rR][A-Za-z]*\b|\bRemove-Item\b[^\n]*-Recurse|\bdel\b[^\n]*\/[sS]\b|\brmdir\b[^\n]*\/[sS]\b/ },
  { id: "history-rewrite", label: "a destructive git operation", pattern: /\bgit\s+(?:reset\s+--hard|clean\s+-[A-Za-z]*[dfx]|push\s+[^\n]*--force(?!-with-lease)|branch\s+-D)\b/ },
  { id: "disk", label: "a disk or filesystem operation", pattern: /\b(?:mkfs(?:\.\w+)?|fdisk|diskpart|format)\b|\bdd\s+if=/i },
  { id: "power", label: "a shutdown or restart", pattern: /\b(?:shutdown|reboot|halt|Restart-Computer|Stop-Computer)\b/i },
  { id: "process-sweep", label: "a broad process kill", pattern: /\b(?:killall|pkill)\b|\btaskkill\b[^\n]*\/[fF]\b|\bStop-Process\b[^\n]*-Force/ },
  { id: "database", label: "a destructive database statement", pattern: /\b(?:DROP\s+(?:DATABASE|TABLE|SCHEMA)|TRUNCATE\s+TABLE)\b/i }
];

function findAll(patterns, text) {
  return patterns.filter(entry => entry.pattern.test(text)).map(entry => ({ id: entry.id, label: entry.label }));
}

// Inspects the text alone. Separated from target planning so the renderer can
// show live feedback while someone is still typing, without naming targets.
function inspectBroadcastInput(input) {
  const text = String(input == null ? "" : input);
  const trimmed = text.trim();
  if (!trimmed) {
    return { ok: false, empty: true, secrets: [], destructive: [], reason: "Enter a command to broadcast." };
  }
  const secrets = findAll(SECRET_PATTERNS, text);
  const destructive = findAll(DESTRUCTIVE_PATTERNS, text);
  if (secrets.length) {
    return {
      ok: false,
      empty: false,
      secrets,
      destructive,
      reason: `This looks like it contains ${secrets.map(item => item.label).join(" and ")}. Broadcasting it would write the value into every target's scrollback and shell history, so Mission Control will not send it. Type it into a single terminal instead.`
    };
  }
  return { ok: true, empty: false, secrets: [], destructive, reason: null };
}

// Builds the exact plan the operator is asked to confirm: who receives it, who
// does not, and why. A worker that is excluded by the operator and one that is
// not running are different outcomes and are reported as different reasons.
function planBroadcast({ sessions, sessionIds, input }) {
  const requested = Array.isArray(sessionIds) ? sessionIds.map(String) : [];
  const inspection = inspectBroadcastInput(input);
  const byId = new Map((Array.isArray(sessions) ? sessions : []).map(session => [String(session.id), session]));

  const targets = [];
  const skipped = [];
  const seen = new Set();

  for (const id of requested) {
    if (seen.has(id)) continue;
    seen.add(id);
    const session = byId.get(id);
    if (!session) { skipped.push({ id, reason: "unknown" }); continue; }
    if (!session.isAlive) { skipped.push({ id, name: session.name, reason: "not-running" }); continue; }
    targets.push({ id, name: session.name || id });
  }

  let error = null;
  if (!inspection.ok) error = inspection.reason;
  else if (!targets.length) error = "Select at least one running worker to broadcast to.";
  else if (targets.length > MAX_BROADCAST_TARGETS) error = `Broadcast is limited to ${MAX_BROADCAST_TARGETS} workers at once.`;

  return {
    ok: error === null,
    error,
    targets,
    skipped,
    destructive: inspection.destructive,
    secrets: inspection.secrets,
    requiresAcknowledgement: inspection.ok && inspection.destructive.length > 0
  };
}

module.exports = {
  MAX_BROADCAST_TARGETS,
  SECRET_PATTERNS,
  DESTRUCTIVE_PATTERNS,
  inspectBroadcastInput,
  planBroadcast
};
