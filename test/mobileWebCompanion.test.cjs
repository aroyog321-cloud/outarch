"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getMobileWebCompanionHtml } = require("../src/service/mobileWebCompanion.cjs");

test("Mobile Web Companion returns valid HTML with embedded crypto polyfill and SSE", () => {
  const html = getMobileWebCompanionHtml();
  assert.equal(typeof html, "string");
  assert.match(html, /<!DOCTYPE html>/i);
  assert.match(html, /Mission Control · Mobile Companion/);
  assert.match(html, /PureCrypto/);
  assert.match(html, /x25519ScalarMult/);
  assert.match(html, /aesGcmEncrypt/);
  assert.match(html, /aesGcmDecrypt/);
  assert.match(html, /EventSource/);
  assert.match(html, /\/mobile\/v1\/events/);
  assert.match(html, /\/mobile\/v1\/pair/);
  assert.match(html, /\/mobile\/v1\/request/);
});
