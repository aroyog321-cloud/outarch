"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { getMobileManifestJson, getMobileServiceWorkerJs, getMobileWebCompanionHtml } = require("../src/service/mobileWebCompanion.cjs");

test("Mobile Web Companion returns valid HTML with embedded crypto polyfill, PWA shell, and SSE", () => {
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
  assert.match(html, /\/mobile\/manifest\.json/);
  assert.match(html, /\/mobile\/sw\.js/);
});

test("Mobile Web Companion generates valid PWA manifest and Service Worker script", () => {
  const manifestRaw = getMobileManifestJson();
  assert.equal(typeof manifestRaw, "string");
  const manifest = JSON.parse(manifestRaw);
  assert.equal(manifest.name, "Mission Control · Mobile Companion");
  assert.equal(manifest.short_name, "MC Companion");
  assert.equal(manifest.start_url, "/mobile");
  assert.equal(manifest.display, "standalone");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0);

  const sw = getMobileServiceWorkerJs();
  assert.equal(typeof sw, "string");
  assert.match(sw, /CACHE_NAME/);
  assert.match(sw, /self\.addEventListener\("push"/);
  assert.match(sw, /self\.addEventListener\("notificationclick"/);
});


test("PureCrypto in Mobile Web Companion correctly expands AES-256 key and interoperates with Node crypto", () => {
  const html = getMobileWebCompanionHtml();
  const match = html.match(/const PureCrypto = \(\(\) => \{([\s\S]*?)\n    \}\)\(\);/);
  assert.ok(match, "PureCrypto definition found in HTML");

  const vm = require("node:vm");
  const nodeCrypto = require("node:crypto");
  const context = {
    Uint8Array,
    Uint32Array,
    BigInt,
    Number,
    Math,
    TextEncoder,
    TextDecoder,
    window: { crypto: { getRandomValues: buf => nodeCrypto.randomFillSync(buf) } }
  };
  vm.createContext(context);
  const result = vm.runInContext(`(() => { ${match[1]} })()`, context);
  const PureCrypto = result;

  // Test AES-256-GCM key expansion and encryption round-trip
  const key = nodeCrypto.randomBytes(32);
  const iv = nodeCrypto.randomBytes(12);
  const plaintext = Buffer.from(JSON.stringify({ deviceId: "mobile-123", secret: "test-secret" }), "utf8");
  const aad = Buffer.from("1|/mobile/v1/request|test", "utf8");

  // Encrypt with Node crypto
  const cipher = nodeCrypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const nodeCiphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const nodeTag = cipher.getAuthTag();

  // Decrypt with PureCrypto (this previously threw ReferenceError: rot is not defined during aesKeyExpansion)
  const decrypted = PureCrypto.aesGcmDecrypt(
    new Uint8Array(key),
    new Uint8Array(iv),
    new Uint8Array(nodeCiphertext),
    new Uint8Array(nodeTag),
    new Uint8Array(aad)
  );
  assert.deepEqual(Buffer.from(decrypted), plaintext);

  // Encrypt with PureCrypto and Decrypt with Node crypto
  const encResult = PureCrypto.aesGcmEncrypt(
    new Uint8Array(key),
    new Uint8Array(iv),
    new Uint8Array(plaintext),
    new Uint8Array(aad)
  );
  const decipher = nodeCrypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(Buffer.from(encResult.tag));
  const nodeDecrypted = Buffer.concat([decipher.update(Buffer.from(encResult.ciphertext)), decipher.final()]);
  assert.deepEqual(nodeDecrypted, plaintext);
});

