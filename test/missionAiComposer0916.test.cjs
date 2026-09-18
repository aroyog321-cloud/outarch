"use strict";

// 2026-09-16, from the operator's annotated screenshot of Mission AI:
//   - "fix the scrollbar, there is no need for this one": the route kept an
//     empty, full-height scrollbar gutter beside the chat, because the frame
//     rule that makes every route scrollable out-specified the route's own
//     no-scroll rule, and every route reserves a stable gutter.
//   - "fix this chat box, redesign it": the shared focus ring drew a second
//     box inside the composer, and "Act without asking" painted the whole
//     control amber, the loudest thing on the page.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const renderer = path.resolve(__dirname, "../src/groundstation/renderer");
const read = rel => fs.readFileSync(path.join(renderer, rel), "utf8");

test("the Mission AI route never scrolls or reserves a scrollbar; its conversation does", () => {
  const premium = read("premiumV3.css");
  assert.match(premium, /^html body #root \.shell > \.main-area > \.experience\.view-mission-ai \{ overflow: hidden !important; scrollbar-gutter: auto; \}$/m);
  assert.doesNotMatch(premium, /^\.view-mission-ai \{ overflow: hidden !important; \}$/m, "the weaker selector lost to the frame rule");
  // The frame rule it has to beat, and the gutter it has to undo, are still there.
  const all = fs.readdirSync(renderer, { recursive: true }).filter(name => String(name).endsWith(".css")).map(name => read(String(name))).join("\n");
  assert.match(all, /\.experience,\.worker-lanes,\.needs-list,\.timeline,\.context-inspector,\.agent-workforce > div \{ scrollbar-gutter: stable;/);
  const surfaces = read("redesign/surfaces.css");
  assert.match(surfaces, /^\.shell \.ai-thread \{[^}]*overflow-y: auto;/m, "the thread is the scroller");
});

test("the composer is one surface: no ring inside it, and a quiet approval switch", () => {
  const surfaces = read("redesign/surfaces.css");
  assert.match(surfaces, /^\.shell \.ai-composer textarea:focus-visible \{ outline: none; box-shadow: none; border-radius: 0; \}$/m);
  assert.match(surfaces, /^\.shell \.ai-composer\.has-toolbar \.ai-composer__field:focus-within \{\s*border-color: var\(--mc-accent-line\);\s*box-shadow: 0 0 0 3px var\(--mc-accent-soft\);\s*\}/m);
  assert.match(surfaces, /^\.shell \.ai-composer__tools \.ai-screen__toggle\.is-on \{ color: var\(--mc-text-soft\); background: transparent; border-color: transparent; \}$/m);
  assert.match(surfaces, /^\.shell \.ai-composer__tools \.ai-screen__toggle\.is-on > i \{ background: var\(--mc-warning\); border-color: var\(--mc-warning\); \}$/m);
  assert.doesNotMatch(surfaces, /ai-screen__toggle\.is-on \{ color: var\(--mc-warning\); background: var\(--mc-warning-soft\)/);
  assert.match(surfaces, /^\.shell \.ai-composer\.has-toolbar \.ai-composer__stop \{ color: var\(--mc-void\); background: var\(--mc-text\);/m);
  assert.match(surfaces, /^\.shell \.ai-composer__mode\.is-auto \{ color: var\(--mc-warning\); \}$/m);

  // The hint is a caption, not a paragraph: every <p> on a route is clamped
  // to body size, which made it read as body copy.
  const chat = read("AssistantChat.jsx");
  assert.match(chat, /\{!compact && <div className="ai-composer__hint">/);
  assert.doesNotMatch(chat, /<p className="ai-composer__hint">/);
  assert.match(chat, /<span className="ai-composer__keys"><kbd>Enter<\/kbd> to send · <kbd>Shift<\/kbd> <kbd>Enter<\/kbd> for a new line<\/span>/);
  assert.match(chat, /<span className=\{`ai-composer__mode \$\{conversation\.autoApprove \? "is-auto" : ""\}`\}>\{conversation\.autoApprove \? "Acting without asking in this chat" : "Anything that changes your project asks first"\}<\/span>/);
  // The toolbar row itself is unchanged.
  assert.match(chat, /toolbar \? <div className="ai-composer__bar"><div className="ai-composer__tools">\{toolbar\}<\/div>\{action\}<\/div> : action/);
});
