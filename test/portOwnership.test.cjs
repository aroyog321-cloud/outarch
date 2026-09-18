"use strict";

// T026 — port-owner inspection with real ownership validation.
//
// The point of this feature is the boundary, so that is what is tested hardest:
// a listener that descends from a Mission Control worker is reported as ours
// and offered a stop; anything else is reported and left alone. There is no
// terminate path in the service at all, and a test asserts that too.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parsePortOwners, parseProcessTree, resolveOwnership, describePortOwner } = require("../src/service/portOwnership.cjs");
const { PortInspector } = require("../src/service/portInspector.cjs");
const { createProtocolConnection } = require("../src/protocol/index.cjs");

const NETSTAT = [
  "",
  "Active Connections",
  "",
  "  Proto  Local Address          Foreign Address        State           PID",
  "  TCP    0.0.0.0:3000           0.0.0.0:0              LISTENING       4812",
  "  TCP    127.0.0.1:3000         127.0.0.1:51544        ESTABLISHED     4812",
  "  TCP    [::]:3000              [::]:0                 LISTENING       4812",
  "  TCP    0.0.0.0:5173           0.0.0.0:0              LISTENING       9001",
  "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       900",
  "  UDP    0.0.0.0:3000           *:*                                    7777",
  ""
].join("\r\n");

const PROCESSES = [
  '"ProcessId","ParentProcessId","Name"',
  '"4812","3300","node.exe"',
  '"3300","1200","powershell.exe"',
  '"1200","900","MissionControl.exe"',
  '"9001","777","python.exe"',
  '"777","1","svchost.exe"'
].join("\r\n");

/* ------------------------------------------------------------------ parsing */

test("T026 — netstat parsing keeps listeners for the requested port only", () => {
  const owners = parsePortOwners(NETSTAT, 3000);
  // One TCP PID (deduped across IPv4/IPv6) plus the UDP row, and never the
  // ESTABLISHED connection, which is a client rather than the holder.
  assert.deepEqual(owners.map(owner => owner.pid).sort(), [4812, 7777]);
  assert.equal(owners.find(owner => owner.pid === 4812).state, "LISTENING");

  assert.deepEqual(parsePortOwners(NETSTAT, 5173).map(owner => owner.pid), [9001]);
  assert.deepEqual(parsePortOwners(NETSTAT, 9999), []);
  // A port number that appears inside an address must not match by substring.
  assert.deepEqual(parsePortOwners(NETSTAT, 35), []);
});

test("T026 — an invalid port yields nothing rather than a wild match", () => {
  for (const port of [0, -1, 70000, "abc", null, undefined, 1.5]) {
    assert.deepEqual(parsePortOwners(NETSTAT, port), [], `port ${port} must not match`);
  }
});

test("T026 — the process table is parsed without assuming column order", () => {
  const tree = parseProcessTree(PROCESSES);
  assert.equal(tree.get(4812).parentPid, 3300);
  assert.equal(tree.get(4812).name, "node.exe");
  assert.equal(tree.get(1200).parentPid, 900);

  const reordered = ['"Name","ParentProcessId","ProcessId"', '"node.exe","3300","4812"'].join("\n");
  assert.equal(parseProcessTree(reordered).get(4812).parentPid, 3300);
  assert.equal(parseProcessTree("nothing useful").size, 0);
});

/* --------------------------------------------------------------- ownership */

test("T026 — a listener descending from a supervised worker is ours", () => {
  const tree = parseProcessTree(PROCESSES);
  const workers = [{ id: "web", name: "Web server", pid: 3300 }];
  const result = resolveOwnership({ pid: 4812, tree, workers });

  assert.equal(result.owned, true, "node.exe is a child of the worker's PTY shell");
  assert.equal(result.sessionId, "web");
  assert.equal(result.sessionName, "Web server");
  assert.equal(result.workerPid, 3300);
  assert.deepEqual(result.chain.map(link => link.pid), [4812, 3300]);
});

test("T026 — a foreign listener is never claimed, even one Mission Control's own tree contains", () => {
  const tree = parseProcessTree(PROCESSES);
  const workers = [{ id: "web", name: "Web server", pid: 3300 }];
  const result = resolveOwnership({ pid: 9001, tree, workers });
  assert.equal(result.owned, false);
  assert.equal(result.sessionId, null);
});

test("T026 — an unreadable process table resolves to not-owned, the safe direction", () => {
  const workers = [{ id: "web", name: "Web server", pid: 3300 }];
  const result = resolveOwnership({ pid: 4812, tree: new Map(), workers });
  assert.equal(result.owned, false, "ancestry cannot be proven, so ownership must not be assumed");
});

test("T026 — a cycle in the process table terminates instead of hanging", () => {
  const tree = new Map([
    [10, { pid: 10, parentPid: 20, name: "a.exe" }],
    [20, { pid: 20, parentPid: 10, name: "b.exe" }]
  ]);
  const result = resolveOwnership({ pid: 10, tree, workers: [{ id: "x", name: "X", pid: 999 }] });
  assert.equal(result.owned, false);
  assert.equal(result.chain.length, 2);
});

test("T026 — a worker with no live PID can never own anything", () => {
  const tree = parseProcessTree(PROCESSES);
  const result = resolveOwnership({ pid: 4812, tree, workers: [{ id: "idle", name: "Idle", pid: null }] });
  assert.equal(result.owned, false);
});

/* ------------------------------------------------------------------ service */

function fakeExec(map) {
  return async (file, args) => {
    const key = file === "netstat" ? "netstat" : "processes";
    const value = map[key];
    if (value === undefined) return { ok: false, error: "not stubbed", stdout: "" };
    if (value instanceof Error) return { ok: false, error: value.message, stdout: "" };
    return { ok: true, stdout: value };
  };
}

const ENGINE = {
  list: () => [{ id: "web" }],
  getSnapshot: () => ({ id: "web", name: "Web server", pid: 3300 })
};

test("T026 — the inspector reports a supervised owner and names the worker", async () => {
  const inspector = new PortInspector({ exec: fakeExec({ netstat: NETSTAT, processes: PROCESSES }), platform: "win32", getEngineApi: () => ENGINE });
  const result = await inspector.inspect(3000);
  assert.equal(result.available, true);
  const owned = result.owners.find(owner => owner.owned);
  assert.ok(owned, "the node.exe listener descends from the worker");
  assert.equal(owned.sessionName, "Web server");
  assert.match(describePortOwner(result), /a worker OUTARCH supervises/);
});

test("T026 — a foreign owner is reported and explicitly not terminated", async () => {
  const inspector = new PortInspector({ exec: fakeExec({ netstat: NETSTAT, processes: PROCESSES }), platform: "win32", getEngineApi: () => ENGINE });
  const result = await inspector.inspect(5173);
  assert.equal(result.owners.length, 1);
  assert.equal(result.owners[0].owned, false);
  const summary = describePortOwner(result);
  assert.match(summary, /python\.exe \(PID 9001\)/);
  assert.match(summary, /will not terminate a process it does not own/);
});

test("T026 — an unsupported platform says so instead of guessing", async () => {
  const inspector = new PortInspector({ exec: fakeExec({}), platform: "linux", getEngineApi: () => ENGINE });
  const result = await inspector.inspect(3000);
  assert.equal(result.available, false);
  assert.match(result.error, /implemented for Windows/);
  assert.equal(inspector.status().available, false);
});

test("T026 — a failing netstat is an error, never an empty 'nothing is listening'", async () => {
  const inspector = new PortInspector({ exec: fakeExec({ netstat: new Error("access denied") }), platform: "win32", getEngineApi: () => ENGINE });
  const result = await inspector.inspect(3000);
  assert.deepEqual(result.owners, []);
  assert.match(result.error, /access denied/);
  // The distinction matters: "nothing is listening" is a different, and wrong,
  // conclusion from "we could not look".
  assert.doesNotMatch(describePortOwner(result), /already exited/);
});

test("T026 — an empty result says the port is free, and says nothing about ownership", async () => {
  const inspector = new PortInspector({ exec: fakeExec({ netstat: NETSTAT, processes: PROCESSES }), platform: "win32", getEngineApi: () => ENGINE });
  const result = await inspector.inspect(4321);
  assert.deepEqual(result.owners, []);
  assert.match(describePortOwner(result), /Nothing is listening on port 4321/);
});

test("T026 — the service exposes no way to terminate a process", () => {
  const inspector = new PortInspector({ platform: "win32" });
  const surface = new Set([
    ...Object.getOwnPropertyNames(Object.getPrototypeOf(inspector)),
    ...Object.keys(inspector)
  ]);
  for (const forbidden of ["kill", "terminate", "free", "freePort", "stop", "taskkill"]) {
    assert.equal(surface.has(forbidden), false, `PortInspector must not expose ${forbidden}`);
  }
  const source = require("node:fs").readFileSync(require.resolve("../src/service/portInspector.cjs"), "utf8");
  assert.doesNotMatch(source, /taskkill|process\.kill|Stop-Process/, "no termination command may appear in the inspector");
});

/* ----------------------------------------------------------------- protocol */

test("T026 — inspection is reachable over the protocol and carries its own summary", async () => {
  const inspector = new PortInspector({ exec: fakeExec({ netstat: NETSTAT, processes: PROCESSES }), platform: "win32", getEngineApi: () => ENGINE });
  const connection = createProtocolConnection(
    { ...ENGINE, subscribe: () => () => {}, getState: () => ({}) },
    { send: () => {}, portInspector: inspector }
  );
  const response = await connection.handle({ version: 1, id: "p1", method: "crashlens.port.inspect", params: { port: 3000 } });
  assert.equal(response.ok, true);
  assert.equal(response.result.port, 3000);
  assert.match(response.result.summary, /Web server/);
  connection.dispose();
});

test("T026 — the protocol exposes inspection only; there is no free-port method", () => {
  const { METHODS } = require("../src/protocol/index.cjs");
  assert.ok(METHODS.includes("crashlens.port.inspect"));
  for (const method of METHODS) {
    assert.doesNotMatch(method, /free.?port|port\.(?:kill|free|terminate)/i, `${method} would grant termination authority`);
  }
});

test("T026 — a connection without an inspector reports the capability as unavailable", async () => {
  const connection = createProtocolConnection(
    { ...ENGINE, subscribe: () => () => {}, getState: () => ({}) },
    { send: () => {} }
  );
  const response = await connection.handle({ version: 1, id: "p2", method: "crashlens.port.inspect", params: { port: 3000 } });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "CAPABILITY_UNAVAILABLE");
  connection.dispose();
});
