"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { parseServiceEndpoints, stripAnsi, normalizeHost, inferServiceKind } = require("../src/engine/serviceEndpointParser.cjs");

test("stripAnsi removes SGR colors and OSC hyperlinks cleanly", () => {
  const colored = "\x1b[32m  ➜  Local:   \x1b[39m\x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m";
  assert.equal(stripAnsi(colored), "  ➜  Local:   http://localhost:5173/");
});

test("normalizeHost transforms wildcard 0.0.0.0 and [::] to localhost for browser compatibility", () => {
  assert.equal(normalizeHost("0.0.0.0"), "localhost");
  assert.equal(normalizeHost("::"), "localhost");
  assert.equal(normalizeHost("127.0.0.1"), "localhost");
  assert.equal(normalizeHost("[::1]"), "localhost");
  assert.equal(normalizeHost("api.local"), "api.local");
});

test("parseServiceEndpoints extracts standard Vite development server output", () => {
  const viteLine = "\x1b[32m  ➜\x1b[39m  \x1b[1mLocal\x1b[22m:   \x1b[36mhttp://localhost:\x1b[1m5173\x1b[22m/\x1b[39m";
  const endpoints = parseServiceEndpoints(viteLine);
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].port, 5173);
  assert.equal(endpoints[0].url, "http://localhost:5173");
  assert.equal(endpoints[0].kind, "frontend");
  assert.equal(endpoints[0].confidence, "ready");
});

test("parseServiceEndpoints extracts FastAPI / Express server listening output with paths", () => {
  const apiLine = "INFO:     Uvicorn running on http://127.0.0.1:8000/api/v1 (Press CTRL+C to quit)";
  const endpoints = parseServiceEndpoints(apiLine);
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].port, 8000);
  assert.equal(endpoints[0].path, "/api/v1");
  assert.equal(endpoints[0].url, "http://localhost:8000/api/v1");
  assert.equal(endpoints[0].kind, "api");
});

test("parseServiceEndpoints preserves /health and /admin paths accurately", () => {
  const healthLine = "Server listening on http://0.0.0.0:4000/health";
  const endpoints = parseServiceEndpoints(healthLine);
  assert.equal(endpoints.length, 1);
  assert.equal(endpoints[0].port, 4000);
  assert.equal(endpoints[0].path, "/health");
  assert.equal(endpoints[0].url, "http://localhost:4000/health");
  assert.equal(endpoints[0].kind, "health");
});

test("what the line says outranks the port when naming a service", () => {
  assert.equal(parseServiceEndpoints("[api] Express server listening on 127.0.0.1:8080")[0].kind, "api");
  assert.equal(parseServiceEndpoints("  ➜  Local:   http://localhost:3000/  (vite)")[0].kind, "frontend");
  assert.equal(parseServiceEndpoints("Serving on http://localhost:8080")[0].kind, "frontend");
});
