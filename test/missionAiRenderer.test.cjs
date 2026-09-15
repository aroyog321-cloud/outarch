"use strict";

// Mission AI in the renderer, rebuilt 2026-09-12.
//
// What it replaced: a key form in Integrations, a forced JSON answer with a row
// of evidence IDs under every reply, a mode router that sent ordinary questions
// to an action planner, and — because the chat layer read a field the service
// never returned — an empty reply for every real question. What replaced it is
// one assistant, any model, tools that read the terminals, and actions that run
// only once the operator approves them in the conversation.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const renderer = path.join(root, "src", "groundstation", "renderer");
const read = name => fs.readFileSync(path.join(renderer, name), "utf8");

// T154 — reduced motion is owned by one layer, not repeated per stylesheet.
function assertReducedMotionIsCentral() {
  const owner = read(path.join("redesign", "surfaces.css"));
  assert.match(owner, /@media \(prefers-reduced-motion: reduce\)/, "the redesign surface layer owns the OS preference");
  assert.match(owner, /\.shell\.motion-reduced,/, "and the in-app Motion setting resolves to the same rule");
  assert.match(owner, /--mc-duration-fast: 0ms;/, "stilling the duration tokens is what stops token-driven motion");
}

test("Mission AI is a first-class screen built on the shared assistant", () => {
  const app = read("App.jsx");
  const screen = read("MissionAIScreen.jsx");
  const catalog = read("aiCatalog.jsx");
  const chat = read("AssistantChat.jsx");
  const main = read("main.jsx");

  assert.match(app, /import \{ MissionAISettings \} from "\.\/MissionAI\.jsx"/);
  assert.match(app, /import MissionAIScreen from "\.\/MissionAIScreen\.jsx"/);
  assert.match(app, /label: "Open Mission AI"/);
  assert.match(app, /<MissionAISettings/);
  assert.match(app, /<MissionAIScreen initialPrompt=\{missionAiPrompt\} onConfirm=\{setConfirmation\}\/>/);
  assert.doesNotMatch(app, /<MissionAIOverlay/);
  assert.doesNotMatch(app, /\["mission-ai",\s*"Mission AI"/);

  // One conversation, one hook, one set of assistant methods.
  assert.match(screen, /useConversation\(MISSION_AI_CONVERSATION, "missionAi"\)/);
  assert.match(catalog, /request\("ai\.status"\)/);
  assert.match(catalog, /request\("ai\.chat\.history", \{ conversationId \}\)/);
  assert.match(catalog, /send: \(text, focusWorkerId = null\) => run\("ai\.chat\.send", \{ surface, text, focusWorkerId \}\)/);
  assert.match(catalog, /resolve: decision => run\("ai\.chat\.resolve", \{ decision \}\)/);
  assert.match(catalog, /message\?\.type !== "ai:conversation"/, "progress arrives as the turn happens");

  // Evidence IDs under every answer were what the operator asked to be rid of.
  for (const source of [screen, chat]) {
    assert.doesNotMatch(source, /Evidence used|answer\.citations|mai-evidence/);
  }

  // Switching models is one control, and it can reach both Mission AI's models
  // and the operator's own keys.
  assert.match(screen, /<ModelSwitcher status=\{status\} surface="missionAi"/);
  assert.match(catalog, /heading: "Mission AI", detail: "Built in", source: "mission"/);
  assert.match(catalog, /source: "byok", keyId: key\.id/);
  assert.match(screen, /Keys &amp; models/);

  // A prompt handed over from elsewhere lands in the composer; it is not sent
  // on the operator's behalf.
  assert.match(screen, /setDraft\(initialPrompt\.slice\(0, 8000\)\)/);

  // No browser storage for anything to do with the assistant.
  for (const name of ["MissionAIScreen.jsx", "MissionAI.jsx", "AssistantChat.jsx", "AssistantKeys.jsx", "aiCatalog.jsx"]) {
    assert.doesNotMatch(read(name), /localStorage|sessionStorage|window\.confirm|<select/, `${name} must not use browser storage or native selects`);
  }

  assert.match(main, /import "\.\/missionAi\.css";[\s\S]*import "\.\/premiumV3\.css";[\s\S]*import "\.\/redesign\/screens\.css";/);
  const surfaces = read(path.join("redesign", "surfaces.css"));
  assert.match(surfaces, /13 · The assistant — Mission AI, the Workspace pane, Keys & models/);
  assert.match(surfaces, /^\.shell \.ai-screen \{/m);
  assert.match(surfaces, /^\.shell \.ai-composer \{/m);
  assert.match(surfaces, /^\.shell \.ai-approval \{/m);
  assertReducedMotionIsCentral();
});

test("anything that would change the project is approved in the conversation, verbatim", () => {
  const chat = read("AssistantChat.jsx");
  assert.match(chat, /<section className=\{`ai-approval/);
  // What will be typed is shown as code, exactly as it will be typed.
  assert.match(chat, /action\.code \? <code>\{action\.detail\}<\/code>/);
  assert.match(chat, /onResolve\("approve"\)/);
  assert.match(chat, /onResolve\("deny"\)/);
  assert.match(chat, /onResolve\("approve-always"\)/);
  // The composer waits while an approval is open, rather than letting a new
  // message overtake it.
  assert.match(chat, /const blocked = disabled \|\| Boolean\(conversation\.pending\);/);
  // The operator can see what the assistant did while answering.
  assert.match(chat, /aria-label="What the assistant did"/);
});

test("Mission AI's keys cannot be entered or read in the renderer", () => {
  const settings = read("MissionAI.jsx");
  const keys = read("AssistantKeys.jsx");

  // The Integrations section reports and links; it has no field for a key.
  assert.doesNotMatch(settings, /type="password"|apiKey|missionAi\.configure|missionAi\.clear/);
  assert.match(settings, /Mission AI's own keys cannot be changed from the app\./);

  // The operator's own keys go in once, masked, and are removed through the
  // confirmation ceremony every destructive action uses.
  assert.match(keys, /<input type="password" autoComplete="off" spellCheck="false"/);
  assert.match(keys, /request\("ai\.byok\.add"/);
  assert.match(keys, /confirmedRequest\("ai\.byok\.remove", \{ keyId: key\.id \}\)/);
  assert.match(keys, /These keys are part of the app\. They cannot be viewed or changed here/);
  assert.doesNotMatch(keys, /hint\.length|apiKey:\s*key\./, "a saved key is never read back");
});

test("Mission AI credentials and provider calls remain outside renderer ownership", () => {
  const builtin = fs.readFileSync(path.join(root, "src", "service", "missionAiBuiltinKeys.cjs"), "utf8");
  const byok = fs.readFileSync(path.join(root, "src", "service", "byokStore.cjs"), "utf8");
  const credentialStore = fs.readFileSync(path.join(root, "src", "service", "missionAiCredentialStore.cjs"), "utf8");
  const providers = fs.readFileSync(path.join(root, "src", "service", "aiProviders.cjs"), "utf8");
  const mainProcess = fs.readFileSync(path.join(root, "src", "groundstation", "main", "index.cjs"), "utf8");

  assert.match(builtin, /const MISSION_AI_PRIMARY_KEY = "/);
  assert.match(builtin, /const MISSION_AI_FALLBACK_KEY = "/);
  assert.match(builtin, /cannot be given another one/);
  assert.match(byok, /safeStorage\.encryptString/);
  assert.match(byok, /safeStorage\.decryptString/);
  assert.match(byok, /basic_text/);
  // The legacy store is still readable, for the one-time carry-over only.
  assert.match(credentialStore, /will not store a plaintext API key/);
  assert.match(mainProcess, /async function migrateLegacyMissionAiKey\(\)/);

  assert.match(providers, /generativelanguage\.googleapis\.com\/v1beta/);
  assert.match(providers, /"x-goog-api-key": apiKey/);
  assert.match(providers, /text\.split\(apiKey\)\.join\("\[key\]"\)/, "errors are scrubbed of the key");

  assert.match(mainProcess, /new BuiltinMissionAiCredentials\(/);
  assert.match(mainProcess, /new ByokStore\(/);
  assert.match(mainProcess, /new AiAssistant\(/);
  assert.match(mainProcess, /MissionAIService/);
});

test("markdown answers are parsed once into stable blocks (T171/T172)", () => {
  const markdown = read("aiMarkdown.jsx");

  assert.match(markdown, /export function parseMarkdownBlocks\(text\)/);
  assert.match(markdown, /const blocks = React\.useMemo\(\(\) => parseMarkdownBlocks\(text\), \[text\]\);/);
  assert.match(markdown, /blocks\.map\(\(block, idx\) => renderBlock\(block/);
  assert.match(markdown, /const CHUNK = 24;/);
  assert.match(markdown, /const FRAME_BUDGET_MS = 25;/);
  assert.doesNotMatch(markdown, /const CHUNK = 8;/, "eight-character unbudgeted chunking is eliminated");
  assert.match(markdown, /className="mai-md-code-block">\{block\.lang && <span className="mai-md-code-lang">\{block\.lang\}<\/span>\}<pre><code>\{visibleCode\}<\/code><\/pre>/);
  // Still exported from the screen for anything that imported it from there.
  assert.match(read("MissionAIScreen.jsx"), /export \{ parseMarkdownBlocks, renderMarkdown, StreamingReveal \} from "\.\/aiMarkdown\.jsx";/);
});

test("keys are recognised as they are pasted, and the model is chosen where the message is written", () => {
  const keys = read("AssistantKeys.jsx");
  const screen = read("MissionAIScreen.jsx");
  const chat = read("AssistantChat.jsx");
  const catalog = read("aiCatalog.jsx");
  // Detection reads only the key's shape through the main process; the key is sent to a provider on Add key alone.
  assert.match(keys, /request\("ai\.byok\.detect", \{ apiKey: key \}\)/);
  assert.match(keys, /each is tried in turn until one accepts it/);
  // Adding a key reads its model list and offers every model; nothing is sent to test one.
  assert.match(keys, /models found\. Choose any of them from the model menu\./);
  assert.match(keys, /no message is sent, so nothing is charged/);
  assert.doesNotMatch(keys, /answered a test message|sends one short test message/);
  assert.match(keys, /free-tier models/);
  // The composer carries the model switcher and the approval setting; the header does not.
  assert.match(chat, /toolbar \? <div className="ai-composer__bar"><div className="ai-composer__tools">\{toolbar\}<\/div>\{action\}<\/div> : action/);
  assert.match(screen, /toolbar=\{<>\s*<ModelSwitcher status=\{status\} surface="missionAi"/);
  const header = screen.slice(screen.indexOf("<header"), screen.indexOf("</header>"));
  assert.doesNotMatch(header, /ModelSwitcher|ai-screen__toggle/);
  // New providers have marks of their own.
  for (const provider of ["nvidia", "perplexity", "cerebras", "fireworks", "huggingface"]) assert.match(catalog, new RegExp(`case "${provider}":`));
});
