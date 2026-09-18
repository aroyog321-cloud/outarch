"use strict";

// Readiness verification for discovered local services.
//
// A worker printing an address is a claim, not proof. Before OUTARCH
// tells someone a service is ready — and certainly before it interrupts them
// with a notification carrying an Open button — something has to confirm that
// the port actually accepts a connection.
//
// The check is a bounded TCP connect and nothing more. It never issues an HTTP
// request: a GET against an arbitrary path a dependency happened to print can
// have side effects, and "is anything listening" is the question that matters.

const net = require("node:net");

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_ATTEMPTS = 6;
const DEFAULT_RETRY_MS = 700;

/**
 * Resolves true when something accepts a TCP connection on the port.
 * @param {{host: string, port: number, timeoutMs?: number, connect?: Function}} options
 */
function probeOnce({ host, port, timeoutMs = DEFAULT_TIMEOUT_MS, connect = net.connect } = {}) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      try { socket?.destroy(); } catch { /* already gone */ }
      resolve(value);
    };

    let socket;
    try {
      socket = connect({ host, port });
    } catch {
      resolve(false);
      return;
    }

    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref?.();

    socket.once("connect", () => { clearTimeout(timer); finish(true); });
    socket.once("error", () => { clearTimeout(timer); finish(false); });
    socket.once("timeout", () => { clearTimeout(timer); finish(false); });
    socket.setTimeout?.(timeoutMs);
  });
}

/**
 * A dev server prints its address a moment before it can serve, so a single
 * failed probe means "not yet", not "never". Retries are bounded and stop as
 * soon as the caller says the run is gone.
 */
// `hosts` lists the addresses one name can mean. "localhost" is both 127.0.0.1
// and ::1, and a dev server that binds only one of them — Vite on Windows binds
// ::1 — is still listening; checking one address alone reported it as never up.
async function waitForListening({
  host,
  hosts = null,
  port,
  attempts = DEFAULT_ATTEMPTS,
  retryMs = DEFAULT_RETRY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  connect = net.connect,
  isCancelled = () => false,
  sleep = ms => new Promise(resolve => { const t = setTimeout(resolve, ms); t.unref?.(); })
} = {}) {
  const candidates = Array.isArray(hosts) && hosts.length ? hosts : [host];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (isCancelled()) return { listening: false, cancelled: true, attempts: attempt };
    for (const candidate of candidates) {
      if (await probeOnce({ host: candidate, port, timeoutMs, connect })) {
        return { listening: true, cancelled: false, attempts: attempt + 1, host: candidate };
      }
    }
    if (attempt < attempts - 1) await sleep(retryMs);
  }
  return { listening: false, cancelled: false, attempts };
}

module.exports = {
  probeOnce,
  waitForListening,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_ATTEMPTS,
  DEFAULT_RETRY_MS
};
