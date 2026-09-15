"use strict";

// Pure terminal stream service endpoint parser.
// Extracts local URLs, listener addresses, and preserved paths (e.g., /health, /admin)
// from raw or ANSI-encoded terminal lines without executing requests.

const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const OSC_REGEX = /\x1B\][^\x07\x1B]*(?:\x07|\x1B\\)/g;

// Strip ANSI color codes and OSC escape sequences
function stripAnsi(text) {
  if (typeof text !== "string") return "";
  return text.replace(OSC_REGEX, "").replace(ANSI_REGEX, "");
}

// Normalize wildcard/loopback addresses for browser consumption
function normalizeHost(host) {
  const clean = host.toLowerCase().trim().replace(/^\[|\]$/g, "");
  if (clean === "0.0.0.0" || clean === "::" || clean === "" || clean === "localhost" || clean === "127.0.0.1" || clean === "::1") {
    return "localhost";
  }
  return clean;
}

// Classify candidate service kinds based on port, path, and context
function inferServiceKind(port, path, context = "") {
  const ctx = context.toLowerCase();
  const p = String(path || "").toLowerCase();
  const portNum = Number(port);

  if (p.includes("/health") || p.includes("/ping") || p.includes("/status") || p.includes("/metrics")) {
    return "health";
  }
  if (p.includes("/admin") || p.includes("/dashboard") || p.includes("/console")) {
    return "admin";
  }
  if (portNum === 5432) return "database-postgres";
  if (portNum === 3306) return "database-mysql";
  if (portNum === 6379) return "database-redis";
  if (portNum === 27017) return "database-mongodb";

  // What the line says outranks the port number: an Express server on 8080 is
  // an API, even though 8080 is also a common frontend port.
  const frontendWords = ["vite", "react", "vue", "next", "nuxt", "svelte", "astro"];
  const apiWords = ["api", "fastapi", "express", "flask", "django"];
  if (frontendWords.some(word => ctx.includes(word))) return "frontend";
  if (apiWords.some(word => ctx.includes(word))) return "api";
  if (portNum === 3000 || portNum === 5173 || portNum === 8080 || portNum === 4200) return "frontend";
  if (portNum === 4000 || portNum === 5000 || portNum === 8000 || portNum === 8081) return "api";
  return "web";
}

// Regex patterns for local URLs and listener announcements
const URL_PATTERN = /(?:https?:\/\/)(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|\[::\])(?::\d+)(?:\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=]*)?/gi;
const LISTENER_PATTERN = /(?:listening\s+on|ready\s+on|running\s+at|server\s+on|server\s+started\s+at|local:\s+|network:\s+|app\s+running\s+at)\s*(?:https?:\/\/)?([a-zA-Z0-9\-_.]+|\[[0-9a-fA-F:]+\]):(\d{2,5})(\/[a-zA-Z0-9\-_./~]*)?/gi;
const VITE_READY_PATTERN = /local:\s+(https?:\/\/localhost:\d+(\/[^\s]*)?)/i;

/**
 * Parses raw terminal line output and extracts structured service endpoint records.
 * @param {string} rawLine - Single line or chunk from terminal output.
 * @param {object} [options] - Parsing context (e.g. worker name, command).
 * @returns {Array<object>} Array of detected endpoint candidates.
 */
function parseServiceEndpoints(rawLine, options = {}) {
  if (!rawLine || typeof rawLine !== "string") return [];
  const clean = stripAnsi(rawLine).trim();
  if (!clean) return [];

  const results = [];
  const seenKeys = new Set();

  // 1. Direct URL regex matching
  let match;
  const urlRegex = new RegExp(URL_PATTERN);
  while ((match = urlRegex.exec(clean)) !== null) {
    try {
      const parsed = new URL(match[0]);
      const host = normalizeHost(parsed.hostname);
      const port = Number(parsed.port || (parsed.protocol === "https:" ? 443 : 80));
      if (port > 0 && port < 65536) {
        // Retain safe path (strip query & hash for privacy)
        let pathname = parsed.pathname || "/";
        if (pathname.length > 80) pathname = pathname.slice(0, 80);
        const protocol = parsed.protocol || "http:";
        const url = `${protocol}//${host}:${port}${pathname === "/" ? "" : pathname}`;
        const key = `${host}:${port}${pathname}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          const isVite = VITE_READY_PATTERN.test(clean);
          results.push({
            protocol: protocol.replace(":", ""),
            host,
            port,
            path: pathname,
            url,
            advertised: match[0],
            kind: inferServiceKind(port, pathname, clean),
            confidence: isVite ? "ready" : "detected",
            evidence: clean.slice(0, 160),
            detectedAt: Date.now()
          });
        }
      }
    } catch {
      // Ignore malformed candidate
    }
  }

  // 2. Formatted listener output (e.g. "Listening on 0.0.0.0:4000/api")
  const listenerRegex = new RegExp(LISTENER_PATTERN);
  while ((match = listenerRegex.exec(clean)) !== null) {
    const rawHost = match[1];
    const port = Number(match[2]);
    const pathname = match[3] || "/";
    if (port > 0 && port < 65536) {
      const host = normalizeHost(rawHost);
      const url = `http://${host}:${port}${pathname === "/" ? "" : pathname}`;
      const key = `${host}:${port}${pathname}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        results.push({
          protocol: "http",
          host,
          port,
          path: pathname,
          url,
          advertised: `${rawHost}:${port}${pathname}`,
          kind: inferServiceKind(port, pathname, clean),
          confidence: "detected",
          evidence: clean.slice(0, 160),
          detectedAt: Date.now()
        });
      }
    }
  }

  return results;
}

// An in-terminal restart (Vite's `r`, nodemon's `rs`, a watcher rebuilding)
// keeps the same worker run but starts a new readiness cycle. Recognising it is
// what lets "Storefront is ready" fire again after a restart instead of being
// deduplicated away as an address we have already seen.
const RESTART_SIGNAL_PATTERNS = [
  /\b(?:restarting|reloading)\b.*\b(?:server|app|application)\b/i,
  /\bserver\s+restart(?:ing|ed)\b/i,
  /\[vite\]\s*(?:restarting|server restarted)/i,
  /\brestarting due to changes\b/i,
  /^\s*\[?nodemon\]?\s+restarting\b/i,
  /\bwatching for file changes\b.*\brestart/i
];

/**
 * True when a line is evidence that the process is restarting its server.
 * Sending `r` is not itself proof — only the adapter saying so is.
 */
function detectRestartSignal(rawLine) {
  if (typeof rawLine !== "string" || !rawLine) return false;
  const clean = stripAnsi(rawLine).trim();
  if (!clean) return false;
  return RESTART_SIGNAL_PATTERNS.some(pattern => pattern.test(clean));
}

module.exports = {
  stripAnsi,
  normalizeHost,
  inferServiceKind,
  parseServiceEndpoints,
  detectRestartSignal,
  RESTART_SIGNAL_PATTERNS
};
