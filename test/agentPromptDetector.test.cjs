"use strict";

// An AI agent stopping to ask for permission raises exactly one notice, from
// any of the agent CLIs OUTARCH supervises, and ordinary output never does.

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AgentPromptDetector, cleanScreen } = require("../src/service/agentPromptDetector.cjs");

const ESC = String.fromCharCode(27);
const color = text => `${ESC}[1;36m${text}${ESC}[0m`;

function detector() {
  let now = 1_000_000;
  const instance = new AgentPromptDetector({ now: () => now });
  const prompts = [];
  const cleared = [];
  instance.on("prompt", prompt => prompts.push(prompt));
  instance.on("cleared", event => cleared.push(event));
  return { instance, prompts, cleared, advance: ms => { now += ms; } };
}

test("Claude Code's permission dialog is recognised through box drawing and colour", () => {
  const { instance, prompts } = detector();
  const screen = [
    "╭─── Bash command ───╮",
    "│   npm install                 │",
    `│ ${color("Do you want to proceed?")}       │`,
    "│ ❯ 1. Yes                      │",
    "│   2. Yes, and don't ask again for npm install commands │",
    "│   3. No, and tell Claude what to do differently (esc) │",
    "╰───╯"
  ].join("\r\n");
  // It arrives in pieces, as a terminal delivers it.
  instance.observe("api", screen.slice(0, 40), { workerName: "Claude" });
  instance.observe("api", screen.slice(40), { workerName: "Claude" });
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].question, "Do you want to proceed?");
  assert.equal(prompts[0].agent, "claude");
  assert.deepEqual(prompts[0].choices.slice(0, 2), ["Yes", "Yes, and don't ask again for npm install commands"]);
});

test("Codex, Gemini and Aider approvals are recognised", () => {
  const { instance, prompts } = detector();
  instance.observe("codex", "Would you like to run the following command?\n  $ npm test\n▌ Yes (y)\n  No, and tell Codex what to do differently (esc)\n");
  instance.observe("gemini", "│ ?  Shell npm install │\n│ Allow execution of: 'npm'? │\n│ ● 1. Yes, allow once │\n");
  instance.observe("aider", "Run shell command? (Y)es/(N)o/(D)on't ask again [Yes]: ");
  assert.deepEqual(prompts.map(prompt => prompt.workerId), ["codex", "gemini", "aider"]);
  assert.equal(prompts[1].agent, "gemini");
});

test("one prompt raises one notice, however often it is repainted", () => {
  const { instance, prompts } = detector();
  const dialog = "Do you want to make this edit to app.js?\n 1. Yes\n 2. No, and tell Claude what to do differently (esc)\n";
  instance.observe("w", dialog);
  instance.observe("w", dialog);
  instance.observe("w", `${ESC}[2J${ESC}[H${dialog}`);
  assert.equal(prompts.length, 1);
});

test("answering the prompt re-arms it, so the next question notifies again", () => {
  const { instance, prompts, cleared } = detector();
  const dialog = "Do you want to proceed?\n 1. Yes\n 2. No, and tell Claude what to do differently (esc)\n";
  instance.observe("w", dialog);
  assert.equal(instance.noteInput("w"), true);
  assert.equal(cleared[0].reason, "answered");
  instance.observe("w", dialog);
  assert.equal(prompts.length, 2);
});

test("a prompt that leaves the screen is cleared after a short grace", () => {
  const { instance, cleared, advance } = detector();
  instance.observe("w", "Do you want to proceed?\n 1. Yes\n");
  for (let index = 0; index < 40; index += 1) instance.observe("w", `compiling module ${index}\n`);
  advance(5000);
  instance.observe("w", "done\n");
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0].reason, "gone");
});

test("ordinary output and prose questions never raise a notice", () => {
  const { instance, prompts } = detector();
  instance.observe("w", "npm WARN deprecated inflight@1.0.6\nDo you want to proceed with the refactor? I think we should.\n");
  instance.observe("shell", "Is this OK? (yes) ");
  // A bare y/n question counts only in a terminal known to run an agent.
  instance.observe("npm", "Ok to proceed? (y/n) ");
  assert.equal(prompts.length, 0);
  instance.observe("agent", "Continue with these changes? [y/N] ", { isAgent: true });
  assert.equal(prompts.length, 1);
});

test("escape codes are stripped without losing the words", () => {
  assert.equal(cleanScreen(`${ESC}]0;title${String.fromCharCode(7)}${color("Allow")} it?`).trim(), "Allow it?");
});
