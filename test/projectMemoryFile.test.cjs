"use strict";

// Project memory (2026-09-22): arch_memory.md in the project folder, the
// rules every AI agent follows, the facts OUTARCH works out itself, the entries
// Mission AI writes for work done by hand, and the ask-before-closing check.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { ENTRY_KINDS, FACTS_START, LEGACY_FILE_NAMES, MEMORY_FILE_NAME, MEMORY_MARKER, POINTER_START, ProjectMemoryFile, parseEntries, parseModelJson } = require("../src/service/projectMemoryFile.cjs");

function fixture(t, { assistant = null, activity = [], sessions = null } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-memory-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "acme");
  fs.mkdirSync(path.join(project, "src"), { recursive: true });
  fs.mkdirSync(path.join(project, "node_modules", "left-out"), { recursive: true });
  fs.writeFileSync(path.join(project, "src", "app.ts"), "export const answer: number = 42;\n".repeat(40));
  fs.writeFileSync(path.join(project, "src", "styles.css"), "body { color: black; }\n".repeat(8));
  fs.writeFileSync(path.join(project, "node_modules", "left-out", "index.js"), "x".repeat(50000));
  fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({ name: "acme", description: "Dashboard for acme", scripts: { dev: "vite", test: "vitest" }, dependencies: { react: "18" }, devDependencies: { vite: "5", typescript: "5" } }));
  fs.writeFileSync(path.join(project, "package-lock.json"), "{}");
  let now = new Date("2026-09-22T10:00:00").getTime();
  const engine = {
    getWorkspace: () => ({ persistent: true, name: "acme", directory: project, path: path.join(project, "termctl.config.json") }),
    list: () => sessions || [{ id: "web", name: "Web dev server", command: "npm", args: ["run", "dev"], cwd: project, autoStart: true }],
    getActivity: () => ({ events: activity })
  };
  const missionContext = { snapshot: () => ({ workers: [{ id: "web", name: "Web dev server", state: "running", evidence: { service: { port: 5173 } }, recentOutput: ["ready in 300 ms"] }] }) };
  const preferencesPath = path.join(root, "userData", "project-memory.json");
  const make = (extra = {}) => new ProjectMemoryFile({ getEngineApi: () => engine, missionContext, assistant, preferencesPath, now: () => now, closeAckTimeoutMs: 60, closeCheckTimeoutMs: 1500, ...extra });
  return { project, file: path.join(project, MEMORY_FILE_NAME), make, advance: ms => { now += ms; }, engine };
}

function assistantAnswering(...answers) {
  const calls = [];
  return {
    calls,
    resolveSelection: () => ({ label: "Gemini 2.5 Flash", model: "gemini-2.5-flash", source: "mission", keyLabel: "Mission AI" }),
    compose: async request => {
      calls.push(request);
      const next = answers.shift();
      if (next instanceof Error) throw next;
      return { text: typeof next === "string" ? next : JSON.stringify(next), model: { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" } };
    }
  };
}

test("turning it on writes the memory with the rules for agents, the facts it found, and a first entry", async t => {
  const { file, project, make } = fixture(t);
  const memory = make();
  const before = memory.status();
  assert.equal(before.enabled, false);
  assert.equal(before.prompt, "open", "a project without a memory is offered one");

  const result = await memory.enable({ pointers: true });
  assert.equal(result.created, true);
  const content = fs.readFileSync(file, "utf8");
  assert.ok(content.includes(MEMORY_MARKER));
  assert.match(content, /^# Project memory: acme/);
  assert.match(content, /## Rules for AI agents/);
  assert.match(content, /Only add, never remove/);
  assert.match(content, /### YYYY-MM-DD HH:MM · <tool> \(<exact model>\) · <kind>/);
  assert.match(content, /Write "model unknown" rather than guessing/);
  assert.match(content, /Never write secrets/);
  // Facts come from the folder, not a model: TypeScript leads, node_modules is not counted.
  assert.match(content, /\*\*Languages:\*\* TypeScript \d+%, CSS \d+%/);
  assert.doesNotMatch(content, /JavaScript/);
  assert.match(content, /\*\*Frameworks and tools:\*\* [^\n]*React[^\n]*Vite/);
  assert.match(content, /\*\*Package managers:\*\* npm/);
  assert.match(content, /Web dev server: `npm run dev`, port 5173, starts with the project/);
  assert.match(content, /\*\*Scripts:\*\* `dev`, `test`/);
  assert.match(content, /### 2026-09-22 10:00 · OUTARCH \(no model\) · docs\n- \*\*Changed:\*\* Created this project memory file\./);
  assert.doesNotMatch(content, /\r/);

  // Agents are pointed at it in the files they read on their own.
  const claude = fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8");
  const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
  assert.ok(claude.includes(POINTER_START) && claude.includes(`@${MEMORY_FILE_NAME}`), "Claude Code imports the file");
  assert.ok(agents.includes(POINTER_START) && !agents.includes(`@${MEMORY_FILE_NAME}`));
  assert.equal(fs.existsSync(path.join(project, "GEMINI.md")), false, "GEMINI.md is only added to when it exists");

  const after = memory.status();
  assert.equal(after.enabled, true);
  assert.equal(after.prompt, null);
  assert.equal(after.entries.count, 1);
  assert.deepEqual(after.pointers, { "CLAUDE.md": true, "AGENTS.md": true, "GEMINI.md": null });
});

test("files the project already has are added to, never replaced", async t => {
  const { file, project, make } = fixture(t);
  fs.writeFileSync(path.join(project, "CLAUDE.md"), "# House rules\nUse tabs.\n");
  fs.writeFileSync(path.join(project, "GEMINI.md"), "Be brief.\n");
  fs.writeFileSync(file, "# Our notes\nWe deploy on Fridays.\n");
  const memory = make();
  const result = await memory.enable({ pointers: true });
  assert.equal(result.adopted, true);
  const content = fs.readFileSync(file, "utf8");
  assert.ok(content.startsWith("# Our notes\nWe deploy on Fridays.\n"), "the team's text stays first and whole");
  assert.ok(content.includes(MEMORY_MARKER));
  assert.ok(fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8").startsWith("# House rules\nUse tabs.\n"));
  assert.ok(fs.readFileSync(path.join(project, "GEMINI.md"), "utf8").includes(POINTER_START));
  await memory.enable({ pointers: true });
  const claude = fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8");
  assert.equal(claude.split(POINTER_START).length - 1, 1, "a second enable adds nothing twice");
});

test("not now asks again next launch; don't ask again stops asking for every project; Settings still reaches it", async t => {
  const { make } = fixture(t);
  const first = make();
  first.decline({ never: false });
  assert.equal(first.status().prompt, null, "not again this session");
  const nextLaunch = make();
  assert.equal(nextLaunch.status().prompt, "open", "asked again the next time OUTARCH opens");
  nextLaunch.decline({ never: true });
  const later = make();
  assert.equal(later.status().prompt, null);
  assert.equal(later.status().askOnOpen, false);
  const enabled = await later.enable({ pointers: false });
  assert.equal(enabled.status.enabled, true, "turning it on from Settings works after declining");
  later.configure({ askOnOpen: true });
  assert.equal(make().status().askOnOpen, true);
  assert.throws(() => later.configure({ askOnOpen: "yes" }), /true or false/);
  assert.throws(() => later.configure({ somethingElse: true }), /Unknown project memory setting/);
});

test("Mission AI's entry is formatted by OUTARCH, appended after everything, and scrubbed", async t => {
  const assistant = assistantAnswering({
    kind: "fix",
    changed: "## Fixed the login redirect\nso users land on the dashboard. Token sk-live-abcdefghijklmnopqrstuvwx1234 removed.",
    why: "Users were sent back to the sign-in page after logging in.",
    files: ["src/auth/login.ts", "src/app`.ts"],
    errorsAndFixes: "The redirect looped because the session cookie was not set; it is now set before redirecting."
  });
  const { file, make, advance } = fixture(t, { assistant });
  const memory = make();
  await memory.enable({ pointers: false });
  const before = fs.readFileSync(file, "utf8");
  advance(60 * 60 * 1000);
  const result = await memory.update({ reason: "close", note: "Fixed the login loop" });
  assert.equal(result.written, true);
  const after = fs.readFileSync(file, "utf8");
  assert.ok(after.startsWith(before.slice(0, before.indexOf(FACTS_START))), "nothing before the facts changes");
  const entry = after.slice(after.lastIndexOf("### "));
  assert.match(entry, /^### 2026-09-22 11:00 · OUTARCH Mission AI \(gemini-2\.5-flash\) · fix\n/);
  assert.match(entry, /- \*\*Source:\*\* Work done by hand, recorded when OUTARCH closed\./);
  assert.match(entry, /- \*\*Changed:\*\* Fixed the login redirect so users land on the dashboard\./);
  assert.doesNotMatch(entry, /sk-live-abcdefghij/, "a key never reaches the file");
  assert.doesNotMatch(entry, /\n## /, "a model cannot add a heading");
  assert.match(entry, /- \*\*Files:\*\* `src\/auth\/login\.ts`, `src\/app'\.ts`/);
  assert.match(entry, /- \*\*Errors and fixes:\*\* The redirect looped/);
  const request = assistant.calls[0];
  assert.equal(request.surface, "memory");
  assert.match(request.text, /The developer's own note about what they did and why: Fixed the login loop/);
  assert.match(request.system, /one JSON object and nothing else/);
  assert.equal(memory.status().entries.count, 2);
});

test("an unusable answer writes nothing; a skip writes nothing; with nothing new Mission AI is not asked", async t => {
  const assistant = assistantAnswering("Sure! Here is your entry: it went well.", { skip: true });
  const { file, make, advance } = fixture(t, { assistant, activity: [] });
  const memory = make();
  await memory.enable({ pointers: false });
  advance(1000);
  const before = fs.readFileSync(file, "utf8");
  await assert.rejects(memory.update({ note: "did things" }), /could not be used, so nothing was written/);
  assert.equal(fs.readFileSync(file, "utf8"), before);
  assert.match(memory.status().lastError, /could not be used/);
  const skipped = await memory.update({ note: "did things" });
  assert.equal(skipped.written, false);
  assert.equal(skipped.reason, "skip");
  assert.equal(fs.readFileSync(file, "utf8"), before);
  const nothing = await memory.update({});
  assert.equal(nothing.reason, "nothing-new");
  assert.equal(assistant.calls.length, 2, "no model call when nothing changed");
});

test("a terminal failure since the last update is evidence, and the close check asks about it", async t => {
  const start = new Date("2026-09-22T10:00:00").getTime();
  const activity = [{ type: "session:exit", name: "API", exitCode: 1, timestamp: start + 5000, reason: "port 4000 in use" }];
  const assistant = assistantAnswering({ kind: "fix", changed: "Freed port 4000 and restarted the API.", why: "The API could not start.", files: [], errorsAndFixes: "" });
  const { make, advance } = fixture(t, { assistant, activity });
  const memory = make();
  await memory.enable({ pointers: false });
  advance(10_000);
  const check = await memory.closeCheck();
  assert.equal(check.ask, true);
  assert.equal(check.mode, "update");
  assert.match(check.summary, /1 terminal failure/);
  await memory.update({ reason: "manual" });
  assert.match(assistant.calls[0].text, /Terminal failures since the last update:\nAPI: session:exit \(exit 1\), port 4000 in use/);
  assert.equal((await memory.closeCheck()).ask, false, "once recorded, closing does not ask again");
});

test("closing: never waits before the window is ready, asks when there is something to record, and falls back to closing", async t => {
  const { make } = fixture(t);
  const memory = make();
  assert.equal(await memory.requestClose(), "close", "not ready yet: close at once");
  memory.closePrompt("ready");
  const requests = [];
  memory.on("close-request", payload => { requests.push(payload); setTimeout(() => memory.closePrompt("shown"), 5); });
  assert.equal(await memory.requestClose(), "prompt", "no memory yet: offered on the way out");
  assert.deepEqual(requests.map(item => item.mode), ["create"]);
  assert.equal(await memory.requestClose(), "prompt", "a second click right away keeps the dialog");
  memory.closePrompt("cancel");
  memory.removeAllListeners("close-request");
  assert.equal(await memory.requestClose(), "close", "a dialog that never appears does not keep the app open");
  memory.decline({ never: false });
  assert.equal(await memory.requestClose(), "close", "declined this session: not asked on the way out");
  assert.throws(() => memory.closePrompt("maybe"), /Unknown close prompt state/);
});

test("the About block is Mission AI's and can be written again; nothing else moves", async t => {
  const assistant = assistantAnswering({ summary: "Acme is a dashboard for the acme team.", howItRuns: "The web dev server runs npm run dev on port 5173." }, "not json");
  const { file, make } = fixture(t, { assistant });
  const memory = make();
  await memory.enable({ pointers: false });
  assert.equal(memory.status().summaryWritten, false);
  await memory.summarize();
  const content = fs.readFileSync(file, "utf8");
  assert.match(content, /Acme is a dashboard for the acme team\.\n\n\*\*How it runs:\*\* The web dev server runs npm run dev on port 5173\.\n\n_Written by OUTARCH Mission AI \(gemini-2\.5-flash\) on 2026-09-22\._/);
  assert.equal(memory.status().summaryWritten, true);
  await assert.rejects(memory.summarize(), /could not be used/);
  assert.equal(fs.readFileSync(file, "utf8"), content);
  assert.match(assistant.calls[0].text, /package\.json description: Dashboard for acme/);
});

test("an agent writing at the same moment is kept: OUTARCH reads again and adds after it", async t => {
  const assistant = assistantAnswering({ kind: "docs", changed: "Documented the release steps.", why: "Asked for it.", files: ["RELEASE.md"], errorsAndFixes: "" });
  const { file, make, advance } = fixture(t, { assistant });
  const memory = make();
  await memory.enable({ pointers: false });
  advance(1000);
  const agentEntry = "\n### 2026-09-22 10:00 · Claude Code (claude-sonnet-4-5) · feature\n- **Changed:** Added CSV export.\n- **Why:** Requested in issue 12.\n";
  const originalCompose = assistant.compose;
  assistant.compose = async request => {
    fs.appendFileSync(file, agentEntry);
    return originalCompose(request);
  };
  await memory.update({ note: "wrote release docs" });
  const content = fs.readFileSync(file, "utf8");
  assert.ok(content.includes("Added CSV export."), "the agent's entry survives");
  assert.ok(content.indexOf("Added CSV export.") < content.indexOf("Documented the release steps."), "and OUTARCH's comes after it");
  const entries = parseEntries(content);
  assert.deepEqual(entries.map(entry => [entry.tool, entry.model, entry.kind]).slice(-2), [["Claude Code", "claude-sonnet-4-5", "feature"], ["OUTARCH Mission AI", "gemini-2.5-flash", "docs"]]);
});

test("without a saved project there is nothing to write to, and the helpers hold their contracts", t => {
  const memory = new ProjectMemoryFile({ getEngineApi: () => ({ getWorkspace: () => ({ persistent: false, directory: os.tmpdir() }) }) });
  assert.equal(memory.status().available, false);
  assert.equal(memory.status().prompt, null);
  assert.throws(() => memory.preview(), /Open a saved project first/);
  assert.deepEqual(parseModelJson("```json\n{\"skip\": true}\n```"), { skip: true });
  assert.equal(parseModelJson("no json here"), null);
  assert.equal(parseModelJson("[1,2]"), null);
  assert.ok(ENTRY_KINDS.includes("fix") && ENTRY_KINDS.includes("session"));
});

test("with git, the close check sees the changes and Mission AI is given the files and a diff excerpt, never the memory itself", async t => {
  const { execFileSync } = require("node:child_process");
  try { execFileSync("git", ["--version"], { stdio: "ignore" }); } catch { t.skip("git is not installed"); return; }
  const assistant = assistantAnswering({ kind: "feature", changed: "Added a health endpoint.", why: "Needed for the load balancer.", files: ["src/health.ts"], errorsAndFixes: "" });
  const { project, make, advance } = fixture(t, { assistant });
  const git = (...args) => execFileSync("git", args, { cwd: project, stdio: ["ignore", "pipe", "ignore"] }).toString();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "Initial commit");
  const memory = make();
  await memory.enable({ pointers: false });
  git("add", "-A");
  git("commit", "-q", "-m", "Add project memory");
  advance(1000);
  assert.equal((await memory.closeCheck()).ask, false, "nothing changed since the memory was made");
  fs.writeFileSync(path.join(project, "src", "health.ts"), "export const health = () => 'ok';\n");
  fs.appendFileSync(path.join(project, "src", "app.ts"), "export const version = 2;\n");
  const check = await memory.closeCheck();
  assert.equal(check.ask, true);
  assert.match(check.summary, /2 files changed/);
  const result = await memory.update({ reason: "close" });
  assert.equal(result.written, true);
  const sent = assistant.calls[0].text;
  assert.match(sent, /Uncommitted changed files:\n[\s\S]*src\/health\.ts/);
  assert.match(sent, /Diff excerpt:\n[\s\S]*export const version = 2;/);
  assert.doesNotMatch(sent.slice(sent.indexOf("Diff excerpt:")), /arch_memory\.md/, "the memory's own changes are not evidence");
  assert.equal((await memory.closeCheck()).ask, false, "recorded: closing does not ask again");
  fs.appendFileSync(path.join(project, "arch_memory.md"), "\n### 2026-09-22 12:00 · Claude Code (claude-sonnet-4-5) · docs\n- **Changed:** Wrote a note.\n- **Why:** Asked.\n");
  assert.equal((await memory.closeCheck()).ask, false, "an agent adding its entry is not work to record");
  fs.appendFileSync(path.join(project, "src", "app.ts"), "export const version = 3;\n");
  assert.equal((await memory.closeCheck()).ask, true, "more edits to a file that was already changed count");
});

test("the facts are rewritten only when a fact changed, and keep themselves current as terminals change", async t => {
  const sessions = [{ id: "web", name: "Web dev server", command: "npm", args: ["run", "dev"], cwd: "", autoStart: true }];
  const { file, make, advance } = fixture(t, { sessions });
  let listener = null;
  let unsubscribed = 0;
  const engineApi = { subscribe: (channel, callback) => { assert.equal(channel, "all"); listener = callback; return () => { unsubscribed += 1; }; } };
  const memory = make({ factsSettleMs: 20 });
  t.after(() => memory.dispose());
  await memory.enable({ pointers: false });
  const first = fs.readFileSync(file, "utf8");

  advance(60 * 60 * 1000);
  const same = memory.refreshFacts();
  assert.equal(same.changed, false, "a new time alone is not a change");
  assert.equal(same.status.enabled, true);
  assert.equal(fs.readFileSync(file, "utf8"), first, "the file is not touched");

  sessions.push({ id: "api", name: "API server", command: "node", args: ["server.js"], cwd: "", autoStart: false });
  const moved = memory.refreshFacts();
  assert.equal(moved.changed, true);
  const second = fs.readFileSync(file, "utf8");
  assert.match(second, /API server: `node server.js`/);
  assert.equal(parseEntries(second).length, parseEntries(first).length, "no entry is added or lost");

  let changes = 0;
  memory.on("change", () => { changes += 1; });
  memory.observe(engineApi);
  assert.equal(typeof listener, "function");
  listener({ type: "session:output", id: "web" });
  await new Promise(resolve => { setTimeout(resolve, 60); });
  assert.equal(changes, 0, "terminal output is not a fact");

  sessions.push({ id: "jobs", name: "Job runner", command: "npm", args: ["run", "jobs"], cwd: "", autoStart: false });
  listener({ type: "session:created", id: "jobs" });
  listener({ type: "session:renamed", id: "jobs" });
  await new Promise(resolve => { setTimeout(resolve, 80); });
  assert.match(fs.readFileSync(file, "utf8"), /Job runner: `npm run jobs`/);
  assert.equal(changes, 1, "a burst of changes is one look at the project");

  memory.observe(null);
  assert.equal(unsubscribed, 1, "watching a new project lets go of the old one");
});

test("the memory is arch_memory.md; one OUTARCH wrote as PROJECT_MEMORY.md is renamed and the agents' notes follow it", async t => {
  assert.equal(MEMORY_FILE_NAME, "arch_memory.md");
  assert.deepEqual([...LEGACY_FILE_NAMES], ["PROJECT_MEMORY.md"]);
  const { file, project, make } = fixture(t);
  await make().enable({ pointers: true });
  const content = fs.readFileSync(file, "utf8");
  // How a project looked before the rename: the old name, and notes naming it.
  const legacy = path.join(project, "PROJECT_MEMORY.md");
  fs.renameSync(file, legacy);
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const note = path.join(project, name);
    const old = fs.readFileSync(note, "utf8").split("arch_memory.md").join("PROJECT_MEMORY.md");
    fs.writeFileSync(note, `# House rules\n\nUse tabs.\n\n${old}`);
  }

  const status = make().status();
  assert.equal(status.enabled, true, "the old memory is still this project's memory");
  assert.equal(status.path, file);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.readFileSync(file, "utf8"), content, "not a character of it changed");
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const note = fs.readFileSync(path.join(project, name), "utf8");
    assert.match(note, /^# House rules\n\nUse tabs\.\n\n/, `${name}: the project's own text is kept`);
    assert.doesNotMatch(note, /PROJECT_MEMORY/);
    assert.equal(note.split(POINTER_START).length, 2, `${name}: still one note`);
  }
  assert.match(fs.readFileSync(path.join(project, "CLAUDE.md"), "utf8"), /\n@arch_memory\.md\n/);
  assert.match(fs.readFileSync(path.join(project, "AGENTS.md"), "utf8"), /shared memory in `arch_memory\.md`/);
});

test("a PROJECT_MEMORY.md that OUTARCH did not write is someone else's and stays", async t => {
  const { file, project, make } = fixture(t);
  const theirs = path.join(project, "PROJECT_MEMORY.md");
  fs.writeFileSync(theirs, "# Our notes\n\nDeploy on Fridays.\n");
  const memory = make();
  assert.equal(memory.status().enabled, false);
  assert.equal(memory.status().prompt, "open");
  await memory.enable({ pointers: false });
  assert.equal(fs.readFileSync(theirs, "utf8"), "# Our notes\n\nDeploy on Fridays.\n");
  assert.ok(fs.readFileSync(file, "utf8").includes(MEMORY_MARKER));
});

test("with git, renaming the old memory is not work to record", async t => {
  const { execFileSync } = require("node:child_process");
  const { file, project, make, advance } = fixture(t);
  const git = (...args) => execFileSync("git", args, { cwd: project, stdio: ["ignore", "pipe", "ignore"] }).toString();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  git("add", "-A");
  git("commit", "-q", "-m", "Initial commit");
  // The last update is recorded here, before the memory had its old name.
  await make().enable({ pointers: true });
  fs.renameSync(file, path.join(project, "PROJECT_MEMORY.md"));
  for (const name of ["CLAUDE.md", "AGENTS.md"]) {
    const note = path.join(project, name);
    fs.writeFileSync(note, fs.readFileSync(note, "utf8").split("arch_memory.md").join("PROJECT_MEMORY.md"));
  }
  git("add", "-A");
  git("commit", "-q", "-m", "Commit the old memory");
  const memory = make();
  assert.equal(memory.status().enabled, true);
  assert.equal(fs.existsSync(file), true, "renamed on first look");
  advance(1000);
  assert.equal((await memory.closeCheck()).ask, false, "a commit of only the memory, the rename and the updated notes are not the operator's work");
  fs.appendFileSync(path.join(project, "src", "app.ts"), "export const version = 2;\n");
  assert.equal((await memory.closeCheck()).ask, true, "real work still counts");
});
