"use strict";

// T026 — read-only port-owner inspection.
//
// This service answers "who is holding this port, and did we start it". It has
// no terminate path at all, by design: when the listener turns out to be a
// Mission Control worker, the renderer routes to the *existing*
// confirmation-gated worker stop, so no new destructive authority is created
// for a crash banner to invoke.
//
// `exec` is injected so the whole thing is testable without spawning anything,
// and every command is a fixed string with the port passed as a validated
// integer — nothing user-supplied is ever interpolated into a shell.

const { execFile } = require("node:child_process");
const { parsePortOwners, parseProcessTree, resolveOwnership } = require("./portOwnership.cjs");

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BUFFER = 4 * 1024 * 1024;

function defaultExec(file, args, options) {
  return new Promise(resolve => {
    execFile(file, args, { timeout: DEFAULT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, windowsHide: true, ...options }, (error, stdout) => {
      if (error && !stdout) { resolve({ ok: false, error: String(error.message || error), stdout: "" }); return; }
      resolve({ ok: true, stdout: String(stdout || "") });
    });
  });
}

class PortInspector {
  #exec;
  #platform;
  #getEngineApi;

  constructor(options = {}) {
    this.#exec = typeof options.exec === "function" ? options.exec : defaultExec;
    this.#platform = options.platform || process.platform;
    this.#getEngineApi = typeof options.getEngineApi === "function" ? options.getEngineApi : () => options.engineApi || null;
  }

  status() {
    return { available: this.#platform === "win32", platform: this.#platform };
  }

  async inspect(port) {
    const wanted = Number(port);
    if (!Number.isInteger(wanted) || wanted < 1 || wanted > 65535) {
      return { available: true, port: null, owners: [], error: "A port must be an integer from 1 to 65535." };
    }
    if (this.#platform !== "win32") {
      // Reported, not faked. The Windows commands below are the only ones this
      // build knows how to read, and pretending otherwise is exactly the class
      // of false promise this task exists to remove.
      return { available: false, port: wanted, owners: [], error: `Port inspection is implemented for Windows; this build is running on ${this.#platform}.` };
    }

    const connections = await this.#exec("netstat", ["-ano"]);
    if (!connections.ok) {
      return { available: true, port: wanted, owners: [], error: `Port owners could not be listed: ${connections.error}` };
    }
    const listeners = parsePortOwners(connections.stdout, wanted);
    if (!listeners.length) return { available: true, port: wanted, owners: [] };

    const processes = await this.#exec("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Csv -NoTypeInformation"
    ]);
    const tree = processes.ok ? parseProcessTree(processes.stdout) : new Map();

    const engineApi = this.#getEngineApi();
    let workers = [];
    try {
      workers = (engineApi?.list?.() || [])
        .map(session => engineApi.getSnapshot?.(session.id) || session)
        .filter(snapshot => Number.isInteger(Number(snapshot?.pid)) && Number(snapshot.pid) > 0);
    } catch {
      // An unreadable engine means "we cannot prove ownership", which resolves
      // to not-owned below — the safe direction.
      workers = [];
    }

    const owners = listeners.map(listener => ({
      ...listener,
      ...resolveOwnership({ pid: listener.pid, tree, workers })
    }));

    return {
      available: true,
      port: wanted,
      owners,
      // Surfaced so the UI can say why ancestry was inconclusive rather than
      // silently reporting a worker's own listener as foreign.
      processTableRead: processes.ok
    };
  }
}

module.exports = { PortInspector };
