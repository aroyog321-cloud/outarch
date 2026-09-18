"use strict";

// T026 — who is holding this port, and is it ours?
//
// The scope of this file is deliberately narrower than "free the port". Mission
// Control's whole authority model is that it owns the PTYs it spawned and
// nothing else, so the useful and honest question is *ownership*:
//
//   * If the listener descends from a worker OUTARCH started, the app
//     already has the authority to stop it, through the existing confirmation
//     ceremony. No new power is needed.
//   * If it is a foreign process, OUTARCH reports it — PID and name —
//     and stops there. Terminating an arbitrary system process is a categorical
//     expansion of what this app is allowed to do, and a crash banner is the
//     worst possible place to grant it.
//
// Ownership is an ancestry test, not a PID equality test: a dev server is a
// child of the PTY shell, so the listener's PID is almost never the worker's.
//
// Parsing is separated from execution so the shapes below are tested against
// real command output without spawning anything.

const MAX_ANCESTRY_DEPTH = 24;

// `netstat -ano` rows look like:
//   TCP    0.0.0.0:3000     0.0.0.0:0     LISTENING       12345
//   TCP    [::]:3000        [::]:0        LISTENING       12345
function parsePortOwners(output, port) {
  const wanted = Number(port);
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) return [];
  const seen = new Map();
  for (const line of String(output || "").split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [proto, local] = parts;
    if (!/^(?:TCP|UDP)$/i.test(proto)) continue;
    // The local address is host:port, and the host may be a bracketed IPv6
    // literal, so take the port from after the final colon.
    const colon = local.lastIndexOf(":");
    if (colon < 0) continue;
    if (Number(local.slice(colon + 1)) !== wanted) continue;
    const pid = Number(parts.at(-1));
    if (!Number.isInteger(pid) || pid <= 0) continue;
    // UDP rows carry no state column.
    const state = /^TCP$/i.test(proto) ? parts.at(-2) : null;
    if (state && !/^LISTENING$/i.test(state)) continue;
    if (!seen.has(pid)) seen.set(pid, { pid, protocol: proto.toUpperCase(), local, state: state || null });
  }
  return [...seen.values()];
}

// CSV from `Get-CimInstance Win32_Process | Select ProcessId,ParentProcessId,Name`.
// Header order is not assumed — PowerShell emits its own column order and adds
// a leading source column in some shells.
function parseProcessTree(output) {
  const lines = String(output || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const headerIndex = lines.findIndex(line => /ProcessId/i.test(line) && /ParentProcessId/i.test(line));
  if (headerIndex < 0) return new Map();

  const splitCsv = line => line.split(",").map(cell => cell.trim().replace(/^"|"$/g, ""));
  const header = splitCsv(lines[headerIndex]).map(cell => cell.toLowerCase());
  const pidAt = header.indexOf("processid");
  const parentAt = header.indexOf("parentprocessid");
  const nameAt = header.indexOf("name");
  if (pidAt < 0 || parentAt < 0) return new Map();

  const tree = new Map();
  for (const line of lines.slice(headerIndex + 1)) {
    const cells = splitCsv(line);
    const pid = Number(cells[pidAt]);
    const parentPid = Number(cells[parentAt]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    tree.set(pid, {
      pid,
      parentPid: Number.isInteger(parentPid) && parentPid > 0 ? parentPid : null,
      name: nameAt >= 0 ? cells[nameAt] || null : null
    });
  }
  return tree;
}

// Walks from the listener up to init, stopping at the first PID that belongs to
// an OUTARCH worker. Depth-bounded and cycle-guarded, because a corrupt
// or racing snapshot of the process table must not hang the inspection.
function resolveOwnership({ pid, tree, workers }) {
  const owners = new Map();
  for (const worker of Array.isArray(workers) ? workers : []) {
    const workerPid = Number(worker?.pid);
    if (Number.isInteger(workerPid) && workerPid > 0) owners.set(workerPid, worker);
  }

  const chain = [];
  const visited = new Set();
  let current = Number(pid);
  for (let depth = 0; depth < MAX_ANCESTRY_DEPTH; depth += 1) {
    if (!Number.isInteger(current) || current <= 0 || visited.has(current)) break;
    visited.add(current);
    const node = tree instanceof Map ? tree.get(current) : null;
    chain.push({ pid: current, name: node?.name || null });

    const worker = owners.get(current);
    if (worker) {
      return {
        owned: true,
        sessionId: worker.id,
        sessionName: worker.name || worker.id,
        workerPid: current,
        chain
      };
    }
    if (!node || node.parentPid === null) break;
    current = node.parentPid;
  }

  return { owned: false, sessionId: null, sessionName: null, workerPid: null, chain };
}

// The renderer never composes this sentence itself; the boundary decides what
// it is allowed to say, so the copy cannot drift from the authority.
function describePortOwner(result) {
  if (!result || result.available === false) {
    return result?.error || "OUTARCH could not inspect port owners on this system.";
  }
  // "We looked and found nothing" and "we could not look" are different
  // answers, and only one of them means the port is free. Collapsing them is
  // the exact class of false conclusion this feature exists to remove.
  if (result.error) return result.error;
  if (!result.owners?.length) {
    return `Nothing is listening on port ${result.port}. The process that held it has already exited.`;
  }
  const owner = result.owners[0];
  if (owner.owned) {
    return `Port ${result.port} is held by ${owner.sessionName}, a worker OUTARCH supervises. You can stop it from here.`;
  }
  const name = owner.chain?.[0]?.name;
  return `Port ${result.port} is held by ${name ? `${name} (PID ${owner.pid})` : `PID ${owner.pid}`}, which OUTARCH did not start. OUTARCH will not terminate a process it does not own — stop it from Task Manager or its own tooling.`;
}

module.exports = {
  MAX_ANCESTRY_DEPTH,
  parsePortOwners,
  parseProcessTree,
  resolveOwnership,
  describePortOwner
};
