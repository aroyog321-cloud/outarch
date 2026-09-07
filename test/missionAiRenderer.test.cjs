"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const renderer = path.join(root, "src", "groundstation", "renderer");


// T154 — reduced motion is owned by one layer, not repeated per stylesheet.
// Any component test that used to assert its own copy now asserts the owner.
function assertReducedMotionIsCentral() {
  const owner = fs.readFileSync(path.resolve(__dirname, "..", "src", "groundstation", "renderer", "redesign", "surfaces.css"), "utf8");
  assert.match(owner, /@media \(prefers-reduced-motion: reduce\)/, "the redesign surface layer owns the OS preference");
  assert.match(owner, /\.shell\.motion-reduced,/, "and the in-app Motion setting resolves to the same rule");
  assert.match(owner, /--mc-duration-fast: 0ms;/, "stilling the duration tokens is what stops token-driven motion");
}

test("Mission AI stays protected and is surfaced as a first-class dedicated screen", () => {
  const app = fs.readFileSync(path.join(renderer, "App.jsx"), "utf8");
  const missionAi = fs.readFileSync(path.join(renderer, "MissionAI.jsx"), "utf8");
  const missionAiScreen = fs.readFileSync(path.join(renderer, "MissionAIScreen.jsx"), "utf8");
  const main = fs.readFileSync(path.join(renderer, "main.jsx"), "utf8");
  const styles = fs.readFileSync(path.join(renderer, "premiumV3.css"), "utf8");

  assert.match(app, /import \{ MissionAISettings \} from "\.\/MissionAI\.jsx"/);
  assert.match(app, /import MissionAIScreen from "\.\/MissionAIScreen\.jsx"/);
  assert.match(app, /label: "Open Mission AI"/);
  assert.match(app, /<MissionAISettings/);
  assert.match(app, /<MissionAIScreen/);
  assert.doesNotMatch(app, /<MissionAIOverlay/);
  assert.match(app, /<IntegrationHubView/);
  assert.match(app, /initialPrompt=\{missionAiPrompt\}/);
  assert.match(app, /onAskAI=/);
  assert.doesNotMatch(app, /\["mission-ai",\s*"Mission AI"/);
  assert.match(missionAi, /request\("missionAi\.status"\)/);
  assert.match(missionAi, /request\("missionAi\.configure"/);
  assert.match(
    missionAi,
    /request\("missionAi\.configure",\s*\{\s*configuration:\s*\{[\s\S]*?model,[\s\S]*?includeTerminalEvidence[\s\S]*?\}\s*\}\)/,
    "Mission AI configuration must retain the Protocol-required configuration wrapper"
  );
  assert.match(missionAi, /confirmedRequest\("missionAi\.clear"/);
  assert.match(missionAi, /type="password"/);
  assert.match(missionAi, /onConfirm\?\.\(\{ title: "Remove the Gemini API key\?"/);
  assert.match(missionAi, /OBSERVE-ONLY INTELLIGENCE/);
  assert.match(missionAiScreen, /request\("missionAi\.status"/);
  assert.match(missionAiScreen, /request\("missionAi\.ask"/);
  assert.match(missionAiScreen, /request\("missionSupervisor\.plan"/);
  assert.match(missionAiScreen, /configuration: \{ model, includeTerminalEvidence:/);
  assert.match(missionAiScreen, /Project intelligence, grounded in evidence\./);
  assert.match(missionAiScreen, /Evidence used/);
  assert.match(missionAiScreen, /answer\.citations/);
  assert.match(missionAiScreen, /onEvidence/);
  assert.match(missionAiScreen, /initialPrompt/);
  assert.match(missionAiScreen, /minimumHours/);
  assert.match(missionAiScreen, /Nothing runs from this screen/);
  assert.match(missionAi, /Stateless provider requests; server storage disabled/);
  assert.match(missionAi, /Include bounded terminal evidence/);
  assert.doesNotMatch(missionAi, /localStorage|sessionStorage|window\.confirm/);
  assert.doesNotMatch(missionAiScreen, /localStorage|sessionStorage|window\.confirm|<select/);
  assert.match(main, /import "\.\/missionAi\.css";[\s\S]*import "\.\/premiumV3\.css";[\s\S]*import "\.\/redesign\/screens\.css";/);
  assert.match(styles, /Mission AI dedicated route/);
  assert.match(styles, /\.mission-ai-screen/);
  assert.match(styles, /\.mai-composer/);
  assertReducedMotionIsCentral();
  assert.match(styles, /\.mai-estimate/);
  assert.match(styles, /\.mai-evidence/);
});

test("Mission AI credentials and provider calls remain outside renderer ownership", () => {
  const credentialStore = fs.readFileSync(path.join(root, "src", "service", "missionAiCredentialStore.cjs"), "utf8");
  const service = fs.readFileSync(path.join(root, "src", "service", "missionAi.cjs"), "utf8");
  const mainProcess = fs.readFileSync(path.join(root, "src", "groundstation", "main", "index.cjs"), "utf8");

  assert.match(credentialStore, /safeStorage\.encryptString/);
  assert.match(credentialStore, /safeStorage\.decryptString/);
  assert.match(credentialStore, /basic_text/);
  assert.match(credentialStore, /will not store a plaintext API key/);
  assert.match(service, /generativelanguage\.googleapis\.com\/v1beta\/models/);
  assert.match(service, /"x-goog-api-key"/);
  assert.match(service, /authority: "observe"/);
  assert.match(service, /includeOutput: preferences\.includeTerminalEvidence/);
  assert.doesNotMatch(service, /tools\s*:|functionDeclarations|function_declarations/);
  assert.match(mainProcess, /safeStorage/);
  assert.match(mainProcess, /MissionAiCredentialStore/);
  assert.match(mainProcess, /MissionAIService/);
});

test("Mission AI streaming uses stable pre-parsed AST blocks and bounded chunk reveal (T171/T172)", () => {
  const missionAiScreen = fs.readFileSync(path.join(renderer, "MissionAIScreen.jsx"), "utf8");

  // T171 — parse once into stable AST blocks with useMemo, not on every animation frame.
  assert.match(missionAiScreen, /export function parseMarkdownBlocks\(text\)/);
  assert.match(missionAiScreen, /const blocks = React\.useMemo\(\(\) => parseMarkdownBlocks\(text\), \[text\]\);/);
  assert.match(missionAiScreen, /blocks\.map\(\(block, idx\) => renderBlock\(block/);

  // T171 — bounded chunk rendering (CHUNK = 24 with time-budgeted cadence) instead of 8-chars per frame.
  assert.match(missionAiScreen, /const CHUNK = 24;/);
  assert.match(missionAiScreen, /const FRAME_BUDGET_MS = 25;/);
  assert.doesNotMatch(missionAiScreen, /const CHUNK = 8;/, "eight-character unbudgeted chunking is eliminated");

  // T172 — code block layout is preserved during stream (pre and code wrappers intact).
  assert.match(missionAiScreen, /className="mai-md-code-block">\{block\.lang && <span className="mai-md-code-lang">\{block\.lang\}<\/span>\}<pre><code>\{visibleCode\}<\/code><\/pre>/);
});
