"use strict";

// The mobile page renders text that originates on the desktop — worker names
// and commands from workspace.json, reasons and memory from terminal output.
// These tests run the page's own script with a minimal DOM and check that
// none of that text can become markup or break the action it sits on.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const vm = require("node:vm");
const nodeCrypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { getMobileWebCompanionHtml } = require("../src/service/mobileWebCompanion.cjs");

const HOSTILE = `<img src=x onerror="alert(1)">`;

function fakeElement() {
  return {
    style: {}, dataset: {}, innerHTML: "", innerText: "", textContent: "", value: "",
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    append() {}, appendChild() {}, remove() {}, focus() {}, setSelectionRange() {},
    addEventListener() {}, setAttribute() {}, getAttribute() { return null; }, querySelector() { return null; }
  };
}

function loadPage({ hash = "", search = "" } = {}) {
  const scripts = [...getMobileWebCompanionHtml().matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const elements = new Map();
  const storage = new Map();
  const context = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, URLSearchParams, TextEncoder, TextDecoder,
    Uint8Array, Uint32Array, BigInt, atob, btoa,
    navigator: { userAgent: "node-test" },
    localStorage: {
      getItem: key => (storage.has(key) ? storage.get(key) : null),
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: key => storage.delete(key)
    },
    document: {
      getElementById: id => { if (!elements.has(id)) elements.set(id, fakeElement()); return elements.get(id); },
      querySelector: () => null,
      querySelectorAll: () => [],
      createElement: () => fakeElement(),
      addEventListener() {}
    },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    confirm: () => false,
    alert: () => {}
  };
  context.window = {
    location: { origin: "http://127.0.0.1:1", hash, search, pathname: "/mobile" },
    history: { replaceState() {} },
    addEventListener() {},
    scrollTo() {},
    crypto: { getRandomValues: buffer => nodeCrypto.randomFillSync(buffer) }
  };
  vm.createContext(context);
  vm.runInContext(scripts.at(-1)[1], context);
  return { context, elements };
}

const hostileData = {
  project: { name: `acme ${HOSTILE}` },
  workers: [
    { id: "evil", name: `evil ${HOSTILE}`, command: `echo ${HOSTILE}`, args: [], status: "failed", role: HOSTILE },
    { id: "api", name: "Bob's API", command: "node", args: ["api.js"], status: "idle" }
  ],
  attention: [
    { id: "a1", sessionId: "evil", sessionName: `evil ${HOSTILE}`, state: "new", reason: `exit 1 ${HOSTILE}` },
    { id: "a2", sessionId: "api", sessionName: "Bob's API", state: "seen", reason: "can't connect" }
  ],
  recipes: [],
  projectMemory: { chapters: [{ id: "c1", title: HOSTILE, summary: HOSTILE }] }
};

test("desktop-supplied text renders as text on every mobile tab", () => {
  const { context } = loadPage();
  for (const render of ["renderOverviewTab", "renderWorkersTab", "renderNeedsTab", "renderMemoryTab"]) {
    const html = context[render](hostileData);
    assert.doesNotMatch(html, /<img/i, `${render} must not emit desktop text as markup`);
    assert.match(html, /&lt;img/, `${render} shows the text, escaped`);
  }
  const settings = context.renderSettingsTab({ deviceName: HOSTILE, endpoint: "http://127.0.0.1:1", scopes: [HOSTILE] });
  assert.doesNotMatch(settings, /<img/i);
  context.appendFeedItem({ kind: "alert", title: HOSTILE, detail: HOSTILE });
  assert.doesNotMatch(context.renderFeedTab(), /<img/i);
});

test("a Mission AI answer on the phone renders as text, with only its own formatting added", () => {
  const { context } = loadPage();
  const tick = String.fromCharCode(96);
  const html = context.renderAskThread({ busy: false, messages: [
    { role: "user", text: HOSTILE },
    { role: "assistant", text: "**Bold** " + tick + HOSTILE + tick + "\n\n- item " + HOSTILE + "\n\n" + tick.repeat(3) + "sh\n" + HOSTILE + "\n" + tick.repeat(3), looked: [HOSTILE], model: HOSTILE },
    { role: "assistant", text: "", error: HOSTILE }
  ] });
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<code>&lt;img/);
  assert.match(html, /<li>item &lt;img/);
  assert.match(html, /<pre class="ask-code">&lt;img/);
});

test("a name with an apostrophe cannot break the action it sits on", () => {
  const { context } = loadPage();
  for (const render of ["renderOverviewTab", "renderWorkersTab", "renderNeedsTab"]) {
    const html = context[render](hostileData);
    // Inline handlers take their target from data- attributes, never from spliced text.
    for (const [, handler] of html.matchAll(/onclick="([^"]*)"/g)) {
      assert.doesNotMatch(handler, /Bob|evil/, `${render}: ${handler}`);
    }
    assert.match(html, /data-name="Bob&#39;s API"/, `${render} carries the name as an attribute value`);
  }
});

test("a pairing link can prefill only digits", () => {
  // The payload carries no digits of its own, so what survives is exactly 123456.
  const { elements } = loadPage({ hash: "#code=12<img src=x onerror=alert()>3456" });
  const html = elements.get("appContainer").innerHTML;
  assert.doesNotMatch(html, /<img/i);
  assert.match(html, /value="123456"/);
});

test("the service worker is registered for the page it serves", () => {
  const html = getMobileWebCompanionHtml();
  assert.match(html, /navigator\.serviceWorker\.register\("\/mobile\/sw\.js", \{ scope: "\/mobile" \}\)/);
  const gateway = fs.readFileSync(path.resolve(__dirname, "../src/service/mobileCompanion.cjs"), "utf8");
  assert.match(gateway, /"Service-Worker-Allowed": "\/mobile"/);
});
