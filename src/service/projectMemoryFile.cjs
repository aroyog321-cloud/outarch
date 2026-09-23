"use strict";

// Project memory: an arch_memory.md in the project folder that says what the
// project is for, how it runs, and every change, error and fix with who made it
// and why. People and AI agents keep it; this service is OUTARCH's part.
//
// What OUTARCH writes, and how:
// - The file itself, once, when the operator agrees to it. It opens with the
//   rules every AI agent follows, so an agent that reads it knows to add an
//   entry when it finishes and never to delete one.
// - A "Project facts" block (languages, frameworks, terminals, scripts) that is
//   worked out from the folder and the workspace, not guessed, and refreshed in
//   place. The block is OUTARCH's; the rules tell agents to leave it alone.
// - An "About this project" block that Mission AI writes from the README and
//   the facts.
// - Entries for work done by hand. Mission AI is asked for a small JSON object
//   (what changed, why, which files, what failed and how it was fixed) and
//   OUTARCH formats the entry itself, so a model can never put a heading, a
//   stray paragraph or anything else in the file. Entries are only appended.
// - Optionally, a short note in CLAUDE.md and AGENTS.md, the files agents read
//   on their own, pointing them at the memory.

const crypto = require("node:crypto");
const EventEmitter = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { redactText } = require("./contextSanitizer.cjs");

const MEMORY_FILE_NAME = "arch_memory.md";
// Names the memory had before. A memory OUTARCH wrote under one of them is
// renamed to MEMORY_FILE_NAME the first time its project is open.
const LEGACY_FILE_NAMES = Object.freeze(["PROJECT_MEMORY.md"]);
// How long to wait before trying a refused rename again.
const LEGACY_RETRY_MS = 60 * 1000;
const MEMORY_MARKER = "<!-- outarch:project-memory v1 -->";
const POINTER_START = "<!-- outarch:project-memory -->";
const POINTER_END = "<!-- /outarch:project-memory -->";
// Files agents read by themselves: Claude Code reads CLAUDE.md; Codex, Cursor,
// Copilot and most others read AGENTS.md. GEMINI.md is only added to when the
// project already has one.
const POINTER_FILES = Object.freeze(["CLAUDE.md", "AGENTS.md"]);
const OPTIONAL_POINTER_FILES = Object.freeze(["GEMINI.md"]);
const ABOUT_START = "<!-- outarch:about:start -->";
const ABOUT_END = "<!-- outarch:about:end -->";
const FACTS_START = "<!-- outarch:facts:start -->";
const FACTS_END = "<!-- outarch:facts:end -->";
// Git paths that never count as work on the project: the memory itself and the
// notes that point agents to it.
const MEMORY_EXCLUDES = Object.freeze([MEMORY_FILE_NAME, ...LEGACY_FILE_NAMES].map(name => `:(exclude)${name}`));
const MEMORY_PATHSPEC = Object.freeze(["--", ".", ...MEMORY_EXCLUDES, ":(exclude)CLAUDE.md", ":(exclude)AGENTS.md", ":(exclude)GEMINI.md"]);
const ENTRY_KINDS = Object.freeze(["feature", "fix", "refactor", "config", "docs", "tests", "dependency", "investigation", "session"]);
const PREFERENCES_VERSION = 1;
const MAX_MEMORY_BYTES = 4 * 1024 * 1024;
const MAX_PROJECT_RECORDS = 200;
const MAX_NOTE_LENGTH = 600;
const GIT_TIMEOUT_MS = 4000;
const CLOSE_CHECK_TIMEOUT_MS = 2500;
const CLOSE_ACK_TIMEOUT_MS = 4000;
// How long after the terminals change the facts are checked again, so a burst
// of changes is one look at the project.
const FACTS_SETTLE_MS = 8000;
// Engine events that can change a fact: terminals added, removed, renamed or
// reconfigured, and a server reporting the port it listens on.
const FACT_EVENTS = new Set(["session:created", "session:removed", "session:renamed", "session:reconfigured"]);
const SCAN_LIMITS = Object.freeze({ entries: 6000, depth: 7, fileBytesCap: 1024 * 1024 });
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "build", "out", "target", "vendor", "venv", "env", "__pycache__", "coverage", "bin", "obj", "tmp", "temp", "logs", "Pods", "DerivedData"]);
const LANGUAGE_BY_EXTENSION = Object.freeze({
  ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
  ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".kt": "Kotlin", ".kts": "Kotlin",
  ".swift": "Swift", ".rb": "Ruby", ".php": "PHP", ".cs": "C#", ".fs": "F#",
  ".cpp": "C++", ".cc": "C++", ".cxx": "C++", ".hpp": "C++", ".hh": "C++", ".c": "C", ".h": "C",
  ".m": "Objective-C", ".mm": "Objective-C", ".dart": "Dart", ".scala": "Scala", ".lua": "Lua",
  ".r": "R", ".ex": "Elixir", ".exs": "Elixir", ".erl": "Erlang", ".hs": "Haskell", ".clj": "Clojure",
  ".zig": "Zig", ".sol": "Solidity", ".vue": "Vue", ".svelte": "Svelte", ".astro": "Astro",
  ".css": "CSS", ".scss": "SCSS", ".sass": "SCSS", ".less": "Less", ".html": "HTML", ".htm": "HTML",
  ".sql": "SQL", ".sh": "Shell", ".bash": "Shell", ".zsh": "Shell", ".ps1": "PowerShell", ".bat": "Batch", ".cmd": "Batch"
});
const PACKAGE_FRAMEWORKS = Object.freeze({
  react: "React", "react-dom": "React", next: "Next.js", vue: "Vue", nuxt: "Nuxt", svelte: "Svelte", "@sveltejs/kit": "SvelteKit",
  "@angular/core": "Angular", "solid-js": "Solid", astro: "Astro", vite: "Vite", webpack: "webpack", electron: "Electron",
  express: "Express", fastify: "Fastify", koa: "Koa", "@nestjs/core": "NestJS", hono: "Hono", tailwindcss: "Tailwind CSS",
  typescript: "TypeScript", jest: "Jest", vitest: "Vitest", mocha: "Mocha", "@playwright/test": "Playwright", cypress: "Cypress",
  prisma: "Prisma", "@prisma/client": "Prisma", "drizzle-orm": "Drizzle", mongoose: "Mongoose", "@supabase/supabase-js": "Supabase",
  firebase: "Firebase", "react-native": "React Native", expo: "Expo", "socket.io": "Socket.IO", graphql: "GraphQL", "node-pty": "node-pty"
});
const PYTHON_FRAMEWORKS = Object.freeze([["django", "Django"], ["flask", "Flask"], ["fastapi", "FastAPI"], ["pytest", "pytest"], ["numpy", "NumPy"], ["pandas", "pandas"], ["torch", "PyTorch"], ["sqlalchemy", "SQLAlchemy"]]);

// ------------------------------------------------------------------ helpers

function clean(value, limit = 300) {
  const text = redactText(String(value ?? ""), { maxLength: limit * 2 }).value
    .replace(/<!--|-->/g, "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[#>*\-\s]+/, "")
    .trim();
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

function localStamp(at) {
  const date = new Date(at);
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function replaceBlock(content, start, end, body) {
  const from = content.indexOf(start);
  const to = content.indexOf(end, from + start.length);
  if (from === -1 || to === -1) return null;
  return `${content.slice(0, from + start.length)}\n${body.trim()}\n${content.slice(to)}`;
}

function readBlock(content, start, end) {
  const from = content.indexOf(start);
  const to = content.indexOf(end, from + start.length);
  if (from === -1 || to === -1) return "";
  return content.slice(from + start.length, to).trim();
}

// The facts without the "last checked" line, to tell a real change from a
// new timestamp.
function factsBody(text) {
  return String(text || "").split("\n").filter(line => !line.startsWith("_Kept current by OUTARCH")).join("\n").trim();
}

// The file with its facts block replaced, or unchanged when no fact changed.
function withFacts(content, facts) {
  if (factsBody(readBlock(content, FACTS_START, FACTS_END)) === factsBody(facts)) return content;
  return replaceBlock(content, FACTS_START, FACTS_END, facts) ?? content;
}

// The first JSON object in a model's answer, with or without a code fence.
function parseModelJson(text) {
  const source = String(text || "");
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first === -1 || last <= first) return null;
  try {
    const value = JSON.parse(source.slice(first, last + 1));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

// Settles with `fallback` after `ms` unless the promise settles first; the
// timer is cleared either way, so it never outlives the race.
function within(promise, ms, fallback) {
  let timer = null;
  const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function hash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("base64url").slice(0, 22);
}

// ------------------------------------------------------------------ file text

function rulesSection() {
  return [
    "## Rules for AI agents",
    "",
    "Every AI agent that works in this project follows these rules: Claude Code, Codex, Gemini CLI, Cursor, Copilot, OUTARCH Mission AI and any other.",
    "",
    "1. **Read this file first.** Read all of it before you change anything. It says what the project is for, how it runs, and what was already tried.",
    "2. **Add an entry when you finish.** When you finish a task that changed code, configuration or how the project runs, add one entry at the very end of this file, under \"Change log\". One entry per task, not one per file.",
    "3. **Only add, never remove.** Do not delete, rewrite, reorder or reformat anything already here, including other agents' entries. If an earlier entry is wrong, add a new entry that corrects it.",
    "4. **Use exactly this format:**",
    "",
    "   ```",
    "   ### YYYY-MM-DD HH:MM · <tool> (<exact model>) · <kind>",
    "   - **Changed:** What you changed, in one or two sentences.",
    "   - **Why:** The reason, or the request that led to it.",
    "   - **Files:** `path/one`, `path/two`",
    "   - **Errors and fixes:** An error you hit and how it was fixed. Leave this line out if there was none.",
    "   ```",
    "",
    "   - `<tool>` is the agent's name, for example Claude Code, Codex CLI, Gemini CLI or Cursor.",
    "   - `<exact model>` is the model you are running on, for example claude-sonnet-4-5 or gpt-5-codex. Write \"model unknown\" rather than guessing.",
    `   - \`<kind>\` is one of: ${ENTRY_KINDS.filter(kind => kind !== "session").join(", ")}.`,
    "   - Use the local date and time.",
    "5. **Keep it short and plain.** Six lines at most. Plain English in full sentences. No filler, no emoji, no pasted logs or long code. Name files and commands exactly.",
    "6. **Never write secrets.** No API keys, tokens, passwords, connection strings, personal data or the contents of .env files.",
    "7. **Leave the OUTARCH blocks alone.** OUTARCH keeps \"About this project\" and \"Project facts\" current by itself.",
    "8. **Nothing changed? Add nothing.** If you only read code or answered a question, do not add an entry."
  ].join("\n");
}

function aboutPlaceholder() {
  return "_Mission AI has not written this summary yet. In OUTARCH, open Settings, then Project defaults, and choose Write summary._";
}

function memoryTemplate({ projectName, facts, about, createdAt }) {
  return [
    `# Project memory: ${clean(projectName || "this project", 120)}`,
    "",
    MEMORY_MARKER,
    "This is the shared memory of this project: what it is for, how it runs, and every change, error and fix, with who made it and why. People and AI agents keep it up to date, and OUTARCH helps. Commit it with the code.",
    "",
    rulesSection(),
    "",
    "## About this project",
    "",
    ABOUT_START,
    about || aboutPlaceholder(),
    ABOUT_END,
    "",
    "## Project facts",
    "",
    FACTS_START,
    facts,
    FACTS_END,
    "",
    "## Change log",
    "",
    "Newest entries at the bottom. Add yours after the last one.",
    "",
    formatEntry({ at: createdAt, author: "OUTARCH", model: "no model", kind: "docs", changed: "Created this project memory file.", why: "The project owner turned on project memory in OUTARCH." })
  ].join("\n") + "\n";
}

function formatEntry({ at, author, model, kind, changed, why, files = [], errorsAndFixes = "", source = "" }) {
  const lines = [`### ${localStamp(at)} · ${author} (${model}) · ${ENTRY_KINDS.includes(kind) ? kind : "session"}`];
  if (source) lines.push(`- **Source:** ${source}`);
  lines.push(`- **Changed:** ${changed}`);
  lines.push(`- **Why:** ${why || "Not stated."}`);
  if (files.length) lines.push(`- **Files:** ${files.map(file => `\`${file}\``).join(", ")}`);
  if (errorsAndFixes) lines.push(`- **Errors and fixes:** ${errorsAndFixes}`);
  return lines.join("\n");
}

function pointerBlock(fileName) {
  return [POINTER_START, pointerBody(fileName), POINTER_END].join("\n");
}

// What goes between the pointer markers.
function pointerBody(fileName) {
  const lines = [
    "## Project memory",
    "",
    `This project keeps a shared memory in \`${MEMORY_FILE_NAME}\`. Read it before you change anything, and follow the rules at its top: when you finish a task, add one short entry at the end of it saying what you changed, why, and your tool and exact model. Only add to it; never delete or rewrite what is there.`
  ];
  // Claude Code pulls an @-mentioned file into its context on its own.
  if (fileName === "CLAUDE.md") lines.push("", `@${MEMORY_FILE_NAME}`);
  return lines.join("\n");
}

// The entries already in the file, newest last, parsed from their headings.
function parseEntries(content) {
  const entries = [];
  const lines = String(content || "").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^### (\d{4}-\d{2}-\d{2} \d{2}:\d{2}) · (.+?) · ([a-z-]+)\s*$/i.exec(lines[index]);
    if (!match) continue;
    const author = match[2];
    const modelMatch = /^(.*) \((.+)\)$/.exec(author);
    let changed = "";
    for (let look = index + 1; look < Math.min(lines.length, index + 7); look += 1) {
      const line = /^- \*\*Changed:\*\* (.+)$/.exec(lines[look]);
      if (line) { changed = line[1].trim(); break; }
      if (/^### /.test(lines[look])) break;
    }
    entries.push({ stamp: match[1], tool: modelMatch ? modelMatch[1] : author, model: modelMatch ? modelMatch[2] : "", kind: match[3].toLowerCase(), changed });
  }
  return entries;
}

// ------------------------------------------------------------------ service

class ProjectMemoryFile extends EventEmitter {
  #getEngineApi;
  #missionContext;
  #assistant;
  #preferencesPath;
  #fs;
  #now;
  #execFile;
  #openPath;
  #prefs;
  #declinedThisSession;
  #busy;
  #lastError;
  #scanCache;
  #fileCache;
  #closing;
  #closeReady;
  #closeCheckTimeoutMs;
  #closeAckTimeoutMs;
  #legacyRetryAt;
  #unobserve;
  #factsTimer;
  #factsSettleMs;

  constructor(options = {}) {
    super();
    if (typeof options.getEngineApi !== "function") throw new TypeError("ProjectMemoryFile requires getEngineApi");
    this.#getEngineApi = options.getEngineApi;
    this.#missionContext = options.missionContext || null;
    this.#assistant = options.assistant || null;
    this.#preferencesPath = typeof options.preferencesPath === "string" ? path.resolve(options.preferencesPath) : null;
    this.#fs = options.fs || fs;
    this.#now = typeof options.now === "function" ? options.now : Date.now;
    this.#execFile = options.execFile || execFile;
    this.#openPath = typeof options.openPath === "function" ? options.openPath : null;
    this.#prefs = this.#readPreferences();
    this.#declinedThisSession = new Set();
    this.#busy = null;
    this.#lastError = null;
    this.#scanCache = new Map();
    this.#fileCache = { path: null, mtimeMs: 0, size: 0, content: "" };
    this.#closing = null;
    // Set once the app's window can show the close dialog. Before that (the
    // sign-in screen, a window still loading) closing never waits.
    this.#closeReady = false;
    this.#closeCheckTimeoutMs = Number.isInteger(options.closeCheckTimeoutMs) ? options.closeCheckTimeoutMs : CLOSE_CHECK_TIMEOUT_MS;
    this.#closeAckTimeoutMs = Number.isInteger(options.closeAckTimeoutMs) ? options.closeAckTimeoutMs : CLOSE_ACK_TIMEOUT_MS;
    this.#unobserve = null;
    this.#factsTimer = null;
    this.#legacyRetryAt = new Map();
    this.#factsSettleMs = Number.isInteger(options.factsSettleMs) ? options.factsSettleMs : FACTS_SETTLE_MS;
  }

  // ---------------------------------------------------------------- preferences

  #readPreferences() {
    const empty = { version: PREFERENCES_VERSION, askOnOpen: true, askOnClose: true, projects: {} };
    if (!this.#preferencesPath) return empty;
    try {
      const value = JSON.parse(this.#fs.readFileSync(this.#preferencesPath, "utf8"));
      const projects = {};
      for (const [key, record] of Object.entries(value?.projects || {})) {
        if (!/^[A-Za-z0-9_-]{8,64}$/.test(key) || !record || typeof record !== "object") continue;
        projects[key] = {
          name: typeof record.name === "string" ? record.name.slice(0, 120) : "",
          decision: ["enabled", "declined", "never"].includes(record.decision) ? record.decision : null,
          decidedAt: Number.isFinite(record.decidedAt) ? record.decidedAt : null,
          lastUpdate: record.lastUpdate && typeof record.lastUpdate === "object" ? {
            at: Number.isFinite(record.lastUpdate.at) ? record.lastUpdate.at : null,
            git: record.lastUpdate.git && typeof record.lastUpdate.git === "object" && typeof record.lastUpdate.git.head === "string" ? { head: record.lastUpdate.git.head.slice(0, 64), status: String(record.lastUpdate.git.status || "").slice(0, 64) } : null,
            by: typeof record.lastUpdate.by === "string" ? record.lastUpdate.by.slice(0, 120) : null
          } : null
        };
      }
      return { version: PREFERENCES_VERSION, askOnOpen: value?.askOnOpen !== false, askOnClose: value?.askOnClose !== false, projects };
    } catch {
      return empty;
    }
  }

  #writePreferences() {
    if (!this.#preferencesPath) return;
    const keys = Object.keys(this.#prefs.projects);
    if (keys.length > MAX_PROJECT_RECORDS) {
      keys.sort((a, b) => (this.#prefs.projects[a].decidedAt || 0) - (this.#prefs.projects[b].decidedAt || 0));
      for (const key of keys.slice(0, keys.length - MAX_PROJECT_RECORDS)) delete this.#prefs.projects[key];
    }
    try {
      this.#fs.mkdirSync(path.dirname(this.#preferencesPath), { recursive: true });
      const temporary = `${this.#preferencesPath}.${process.pid}.${this.#now()}.tmp`;
      this.#fs.writeFileSync(temporary, `${JSON.stringify(this.#prefs, null, 2)}\n`, "utf8");
      this.#fs.renameSync(temporary, this.#preferencesPath);
    } catch {
      // A preference that fails to persist still applies for this session.
    }
  }

  // ---------------------------------------------------------------- project

  #project() {
    let workspace = null;
    try { workspace = this.#getEngineApi()?.getWorkspace?.() || null; } catch { workspace = null; }
    if (!workspace || workspace.persistent !== true || !workspace.directory) return null;
    const directory = path.resolve(workspace.directory);
    const key = hash(workspace.path || directory);
    return { name: String(workspace.name || path.basename(directory)).slice(0, 120), directory, key, file: this.#memoryFile(directory, key) };
  }

  // The memory's path. A memory OUTARCH wrote under an earlier name is
  // renamed to the current one, and the notes for agents follow it. A file of
  // an earlier name that OUTARCH did not write is someone else's and stays. If
  // the rename is refused (an editor holds the file), the old name keeps
  // working until a later try succeeds.
  #memoryFile(directory, key) {
    const file = path.join(directory, MEMORY_FILE_NAME);
    try { if (this.#fs.statSync(file).isFile()) return file; } catch { /* not made yet */ }
    for (const name of LEGACY_FILE_NAMES) {
      const legacy = path.join(directory, name);
      let content = null;
      try { content = this.#readMemory(legacy); } catch { content = null; }
      if (!content || !content.includes(MEMORY_MARKER)) continue;
      const retryAt = this.#legacyRetryAt.get(key) || 0;
      if (retryAt > Date.now()) return legacy;
      try {
        this.#fs.renameSync(legacy, file);
      } catch {
        this.#legacyRetryAt.set(key, Date.now() + LEGACY_RETRY_MS);
        return legacy;
      }
      this.#legacyRetryAt.delete(key);
      this.#repointAgents(directory);
      return file;
    }
    return file;
  }

  // Notes for agents that name an earlier file are rewritten to name this one.
  // Only notes that are already there are touched.
  #repointAgents(directory) {
    const results = [];
    for (const name of [...POINTER_FILES, ...OPTIONAL_POINTER_FILES]) {
      const file = path.join(directory, name);
      let content = null;
      try { content = this.#fs.readFileSync(file, "utf8"); } catch { continue; }
      if (!content.includes(POINTER_START)) continue;
      if (readBlock(content, POINTER_START, POINTER_END) === pointerBody(name)) continue;
      const next = replaceBlock(content, POINTER_START, POINTER_END, pointerBody(name));
      if (next === null) continue;
      try {
        this.#writeFileSafely(file, content, next);
        results.push({ file: name, action: "updated" });
      } catch (error) {
        results.push({ file: name, action: "failed", error: error.message });
      }
    }
    return results;
  }

  #record(project, create = false) {
    let record = this.#prefs.projects[project.key];
    if (!record && create) {
      record = { name: project.name, decision: null, decidedAt: null, lastUpdate: null };
      this.#prefs.projects[project.key] = record;
    }
    return record || null;
  }

  #readMemory(file) {
    let stat;
    try { stat = this.#fs.statSync(file); } catch { return null; }
    if (!stat.isFile()) return null;
    if (stat.size > MAX_MEMORY_BYTES) {
      const error = new Error(`${MEMORY_FILE_NAME} is larger than ${Math.round(MAX_MEMORY_BYTES / 1024 / 1024)} MB, so OUTARCH leaves it alone.`);
      error.tooLarge = true;
      throw error;
    }
    const cache = this.#fileCache;
    if (cache.path === file && cache.mtimeMs === stat.mtimeMs && cache.size === stat.size) return cache.content;
    const content = this.#fs.readFileSync(file, "utf8");
    this.#fileCache = { path: file, mtimeMs: stat.mtimeMs, size: stat.size, content };
    return content;
  }

  #pointerState(project) {
    const state = {};
    for (const name of [...POINTER_FILES, ...OPTIONAL_POINTER_FILES]) {
      const file = path.join(project.directory, name);
      let content = null;
      try { content = this.#fs.readFileSync(file, "utf8"); } catch { content = null; }
      state[name] = content === null ? (OPTIONAL_POINTER_FILES.includes(name) ? null : false) : content.includes(POINTER_START);
    }
    return state;
  }

  #describeModel() {
    try {
      const target = this.#assistant?.resolveSelection?.("memory") || null;
      return target ? { label: target.label, model: target.model, source: target.source, keyLabel: target.keyLabel } : null;
    } catch {
      return null;
    }
  }

  status() {
    const project = this.#project();
    const base = {
      fileName: MEMORY_FILE_NAME,
      askOnOpen: this.#prefs.askOnOpen,
      askOnClose: this.#prefs.askOnClose,
      busy: this.#busy,
      lastError: this.#lastError,
      model: this.#describeModel(),
      entryKinds: ENTRY_KINDS
    };
    if (!project) return { ...base, available: false, reason: "no-project", project: null, enabled: false, exists: false, prompt: null };
    const record = this.#record(project);
    let content = null;
    let fileError = null;
    try { content = this.#readMemory(project.file); } catch (error) { fileError = error.message; }
    const exists = content !== null || Boolean(fileError);
    const ours = Boolean(content && content.includes(MEMORY_MARKER));
    const decision = record?.decision || null;
    // A memory file that is already in the project (a teammate committed it,
    // or it was made on another computer) counts as turned on.
    const enabled = ours && decision !== "never";
    const entries = content ? parseEntries(content) : [];
    const prompt = !enabled && this.#prefs.askOnOpen && decision !== "never" && !this.#declinedThisSession.has(project.key) ? "open" : null;
    return {
      ...base,
      available: true,
      reason: null,
      project: { name: project.name, directory: project.directory },
      path: project.file,
      exists,
      ours,
      enabled,
      decision,
      prompt,
      fileError,
      pointers: this.#pointerState(project),
      summaryWritten: Boolean(ours && readBlock(content, ABOUT_START, ABOUT_END) && !readBlock(content, ABOUT_START, ABOUT_END).startsWith("_Mission AI has not")),
      entries: { count: entries.length, latest: entries.slice(-3).reverse() },
      lastUpdate: record?.lastUpdate?.at ? { at: record.lastUpdate.at, by: record.lastUpdate.by || null } : null
    };
  }

  // What OUTARCH found in the folder, for the introduction and the facts block.
  preview() {
    const project = this.#project();
    if (!project) throw new Error("Open a saved project first");
    const scan = this.#scan(project);
    return { project: { name: project.name, directory: project.directory }, fileName: MEMORY_FILE_NAME, languages: scan.languages, frameworks: scan.frameworks, terminals: this.#terminals().slice(0, 8), packageManagers: scan.packageManagers };
  }

  configure(value = {}) {
    if (!value || typeof value !== "object") throw new TypeError("Project memory settings must be an object");
    const unknown = Object.keys(value).find(key => !["askOnOpen", "askOnClose"].includes(key));
    if (unknown) throw new TypeError(`Unknown project memory setting: ${unknown}`);
    for (const key of ["askOnOpen", "askOnClose"]) {
      if (value[key] === undefined) continue;
      if (typeof value[key] !== "boolean") throw new TypeError(`${key} must be true or false`);
      this.#prefs[key] = value[key];
    }
    this.#writePreferences();
    this.#emitChange();
    return this.status();
  }

  // "Not now" asks again the next time OUTARCH opens; "never" does not ask again
  // for any project, and project memory stays one click away in Settings.
  decline({ never = false } = {}) {
    const project = this.#project();
    if (project) {
      this.#declinedThisSession.add(project.key);
      const record = this.#record(project, true);
      if (record.decision !== "enabled") {
        record.decision = "declined";
        record.decidedAt = this.#now();
      }
    }
    if (never === true) this.#prefs.askOnOpen = false;
    this.#writePreferences();
    this.#emitChange();
    return this.status();
  }

  // Turning it off for a project stops OUTARCH asking and writing. The file stays.
  disable() {
    const project = this.#requireProject();
    const record = this.#record(project, true);
    record.decision = "never";
    record.decidedAt = this.#now();
    this.#writePreferences();
    this.#emitChange();
    return this.status();
  }

  #requireProject() {
    const project = this.#project();
    if (!project) throw new Error("Open a saved project first. Project memory lives in the project's folder.");
    return project;
  }

  // ---------------------------------------------------------------- enable

  async enable({ pointers = true } = {}) {
    const project = this.#requireProject();
    if (this.#busy) throw new Error("Project memory is already being written");
    this.#busy = "enable";
    this.#emitChange();
    try {
      const at = this.#now();
      const facts = this.#factsBlock(project, at);
      let created = false;
      let adopted = false;
      const existing = this.#readMemory(project.file);
      if (existing === null) {
        this.#writeFileSafely(project.file, null, memoryTemplate({ projectName: project.name, facts, about: null, createdAt: at }));
        created = true;
      } else if (!existing.includes(MEMORY_MARKER)) {
        // A file of that name that OUTARCH did not write keeps everything in
        // it; OUTARCH's sections go after it.
        const body = memoryTemplate({ projectName: project.name, facts, about: null, createdAt: at }).split("\n").slice(2).join("\n");
        this.#writeFileSafely(project.file, existing, `${existing.replace(/\s*$/, "")}\n\n---\n\n${body}`);
        adopted = true;
      }
      const pointerResults = pointers === true ? this.#writePointers(project) : [];
      const record = this.#record(project, true);
      record.name = project.name;
      record.decision = "enabled";
      record.decidedAt = at;
      record.lastUpdate = { at, git: await this.#gitState(project), by: "OUTARCH" };
      this.#declinedThisSession.delete(project.key);
      this.#lastError = null;
      this.#writePreferences();
      return { created, adopted, path: project.file, pointers: pointerResults, status: this.status() };
    } catch (error) {
      this.#lastError = error.message;
      throw error;
    } finally {
      this.#busy = null;
      this.#emitChange();
    }
  }

  addPointers() {
    const project = this.#requireProject();
    const results = this.#writePointers(project);
    this.#emitChange();
    return { pointers: results, status: this.status() };
  }

  #writePointers(project) {
    const results = this.#repointAgents(project.directory);
    const updated = new Set(results.map(item => item.file));
    for (const name of [...POINTER_FILES, ...OPTIONAL_POINTER_FILES]) {
      if (updated.has(name)) continue;
      const file = path.join(project.directory, name);
      let content = null;
      try { content = this.#fs.readFileSync(file, "utf8"); } catch { content = null; }
      if (content === null && OPTIONAL_POINTER_FILES.includes(name)) continue;
      if (content !== null && content.includes(POINTER_START)) { results.push({ file: name, action: "present" }); continue; }
      try {
        const next = content === null ? `${pointerBlock(name)}\n` : `${content.replace(/\s*$/, "")}\n\n${pointerBlock(name)}\n`;
        this.#writeFileSafely(file, content, next);
        results.push({ file: name, action: content === null ? "created" : "added" });
      } catch (error) {
        results.push({ file: name, action: "failed", error: error.message });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------- writing

  // Writes beside the file and renames over it, and only if nobody else
  // changed the file in between; an agent adding its entry at the same moment
  // is read again and kept.
  #writeFileSafely(file, expected, next) {
    const current = (() => { try { return this.#fs.readFileSync(file, "utf8"); } catch { return null; } })();
    if (current !== expected) {
      const error = new Error(`${path.basename(file)} changed while OUTARCH was writing it`);
      error.conflict = true;
      throw error;
    }
    const temporary = path.join(path.dirname(file), `.${path.basename(file)}.outarch-${process.pid}-${this.#now()}.tmp`);
    try {
      this.#fs.writeFileSync(temporary, next, "utf8");
      try {
        this.#fs.renameSync(temporary, file);
      } catch (error) {
        // An editor holding the file open can refuse a rename on Windows.
        if (!["EPERM", "EACCES", "EBUSY"].includes(error?.code)) throw error;
        this.#fs.writeFileSync(file, next, "utf8");
        try { this.#fs.unlinkSync(temporary); } catch { /* already gone */ }
      }
    } catch (error) {
      try { this.#fs.unlinkSync(temporary); } catch { /* never written */ }
      throw error;
    }
    if (file === this.#fileCache.path) this.#fileCache = { path: null, mtimeMs: 0, size: 0, content: "" };
  }

  // Reads, changes and writes, once more if an agent wrote in between.
  #edit(file, change) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const content = this.#readMemory(file);
      if (content === null) throw new Error(`${MEMORY_FILE_NAME} is missing. Turn project memory on again to recreate it.`);
      const next = change(content);
      if (next === content) return content;
      try {
        this.#writeFileSafely(file, content, next);
        return next;
      } catch (error) {
        if (!error.conflict || attempt === 2) throw error;
        this.#fileCache = { path: null, mtimeMs: 0, size: 0, content: "" };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------- facts

  #scan(project) {
    const cached = this.#scanCache.get(project.key);
    if (cached && this.#now() - cached.at < 60_000) return cached.value;
    const bytes = new Map();
    const queue = [[project.directory, 0]];
    let seen = 0;
    const rootNames = new Set();
    while (queue.length && seen < SCAN_LIMITS.entries) {
      const [directory, depth] = queue.shift();
      let entries = [];
      try { entries = this.#fs.readdirSync(directory, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (++seen > SCAN_LIMITS.entries) break;
        if (depth === 0) rootNames.add(entry.name);
        if (entry.isSymbolicLink?.()) continue;
        if (entry.isDirectory()) {
          if (entry.name.startsWith(".") || SKIP_DIRECTORIES.has(entry.name) || depth + 1 > SCAN_LIMITS.depth) continue;
          queue.push([path.join(directory, entry.name), depth + 1]);
          continue;
        }
        const language = LANGUAGE_BY_EXTENSION[path.extname(entry.name).toLowerCase()];
        if (!language) continue;
        let size = 0;
        try { size = this.#fs.statSync(path.join(directory, entry.name)).size; } catch { size = 0; }
        if (/\.min\.(js|css)$/i.test(entry.name)) continue;
        bytes.set(language, (bytes.get(language) || 0) + Math.min(size, SCAN_LIMITS.fileBytesCap));
      }
    }
    const total = [...bytes.values()].reduce((sum, value) => sum + value, 0);
    const languages = [...bytes.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, share: total ? Math.round((value / total) * 100) : 0 }))
      .filter(item => item.share >= 1)
      .slice(0, 6);
    const frameworks = new Set();
    const packageManagers = new Set();
    const scripts = [];
    let packageInfo = null;
    const readRoot = name => { try { return this.#fs.readFileSync(path.join(project.directory, name), "utf8"); } catch { return null; } };
    const packageJson = readRoot("package.json");
    if (packageJson) {
      try {
        packageInfo = JSON.parse(packageJson);
        const dependencies = { ...(packageInfo.dependencies || {}), ...(packageInfo.devDependencies || {}) };
        for (const [dependency, label] of Object.entries(PACKAGE_FRAMEWORKS)) if (Object.hasOwn(dependencies, dependency)) frameworks.add(label);
        frameworks.add("Node.js");
        for (const [name, command] of Object.entries(packageInfo.scripts || {}).slice(0, 12)) scripts.push({ name: clean(name, 40), command: clean(command, 120) });
      } catch { packageInfo = null; }
    }
    const python = [readRoot("requirements.txt"), readRoot("pyproject.toml"), readRoot("Pipfile")].filter(Boolean).join("\n").toLowerCase();
    if (python) for (const [needle, label] of PYTHON_FRAMEWORKS) if (new RegExp(`(^|[^a-z])${needle}([^a-z]|$)`, "m").test(python)) frameworks.add(label);
    const markers = [["go.mod", "Go modules"], ["Cargo.toml", "Cargo"], ["pom.xml", "Maven"], ["build.gradle", "Gradle"], ["build.gradle.kts", "Gradle"], ["Gemfile", "Bundler"], ["composer.json", "Composer"], ["Dockerfile", "Docker"], ["docker-compose.yml", "Docker Compose"], ["docker-compose.yaml", "Docker Compose"], ["compose.yaml", "Docker Compose"], ["pubspec.yaml", "Flutter / Dart"]];
    for (const [name, label] of markers) if (rootNames.has(name)) frameworks.add(label);
    for (const [name, label] of [["package-lock.json", "npm"], ["pnpm-lock.yaml", "pnpm"], ["yarn.lock", "Yarn"], ["bun.lockb", "Bun"], ["bun.lock", "Bun"], ["poetry.lock", "Poetry"], ["Pipfile.lock", "Pipenv"], ["uv.lock", "uv"], ["Cargo.lock", "Cargo"], ["go.sum", "Go modules"]]) if (rootNames.has(name)) packageManagers.add(label);
    const value = { languages, frameworks: [...frameworks].slice(0, 14), packageManagers: [...packageManagers], scripts, packageInfo: packageInfo ? { name: clean(packageInfo.name || "", 80), description: clean(packageInfo.description || "", 300) } : null };
    this.#scanCache.set(project.key, { at: this.#now(), value });
    return value;
  }

  // The terminals and servers OUTARCH runs for this project, from the workspace.
  #terminals() {
    let sessions = [];
    try { sessions = this.#getEngineApi()?.list?.() || []; } catch { sessions = []; }
    let ports = new Map();
    try {
      const context = this.#missionContext?.snapshot?.({ includeOutput: false }) || null;
      ports = new Map((context?.workers || []).map(worker => [worker.id, worker.evidence?.service?.port || null]));
    } catch { ports = new Map(); }
    const root = this.#project()?.directory || null;
    return sessions.slice(0, 20).map(session => ({
      name: clean(session.name || session.id, 60),
      command: clean([session.command, ...(Array.isArray(session.args) ? session.args : [])].filter(Boolean).join(" "), 140),
      cwd: clean(session.cwd && root ? path.relative(root, session.cwd) || "." : ".", 80),
      autoStart: session.autoStart === true,
      port: ports.get(session.id) || null
    }));
  }

  #factsBlock(project, at) {
    const scan = this.#scan(project);
    const terminals = this.#terminals();
    const lines = [`_Kept current by OUTARCH. Last checked ${localStamp(at)}._`, ""];
    lines.push(`- **Languages:** ${scan.languages.length ? scan.languages.map(item => `${item.name} ${item.share}%`).join(", ") : "none detected yet"}`);
    if (scan.frameworks.length) lines.push(`- **Frameworks and tools:** ${scan.frameworks.join(", ")}`);
    if (scan.packageManagers.length) lines.push(`- **Package managers:** ${scan.packageManagers.join(", ")}`);
    if (terminals.length) {
      lines.push("- **Terminals and servers in OUTARCH:**");
      for (const terminal of terminals) {
        const details = [terminal.command ? `\`${terminal.command.replace(/`/g, "'")}\`` : "no command", terminal.cwd && terminal.cwd !== "." ? `in \`${terminal.cwd.replace(/`/g, "'")}\`` : "", terminal.port ? `port ${terminal.port}` : "", terminal.autoStart ? "starts with the project" : ""].filter(Boolean).join(", ");
        lines.push(`  - ${terminal.name}: ${details}`);
      }
    } else {
      lines.push("- **Terminals and servers in OUTARCH:** none yet");
    }
    if (scan.scripts.length) lines.push(`- **Scripts:** ${scan.scripts.map(script => `\`${script.name}\``).join(", ")}`);
    return lines.join("\n");
  }

  refreshFacts() {
    const project = this.#requireProject();
    this.#scanCache.delete(project.key);
    const facts = this.#factsBlock(project, this.#now());
    const before = this.#readMemory(project.file);
    const after = this.#edit(project.file, content => withFacts(content, facts));
    this.#emitChange();
    return { changed: before !== after, status: this.status() };
  }

  // Watches the engine of the open project, and checks the facts again a few
  // seconds after its terminals change. Called again when the project changes.
  observe(engineApi) {
    try { this.#unobserve?.(); } catch { /* the old engine is gone */ }
    this.#unobserve = null;
    if (!engineApi || typeof engineApi.subscribe !== "function") return;
    this.#unobserve = engineApi.subscribe("all", event => {
      const type = String(event?.type || "");
      const port = type === "session:evidence" && event?.category === "service" && event?.evidence?.port;
      if (FACT_EVENTS.has(type) || port) this.#scheduleFacts();
    });
  }

  #scheduleFacts() {
    if (this.#factsTimer) clearTimeout(this.#factsTimer);
    this.#factsTimer = setTimeout(() => {
      this.#factsTimer = null;
      this.#refreshFactsQuietly();
    }, this.#factsSettleMs);
    this.#factsTimer.unref?.();
  }

  // Writes the facts only when the project has a memory, nothing else is being
  // written, and a fact actually changed.
  #refreshFactsQuietly() {
    try {
      const project = this.#project();
      if (!project || this.#busy || !this.status().enabled) return false;
      this.#scanCache.delete(project.key);
      const facts = this.#factsBlock(project, this.#now());
      const before = this.#readMemory(project.file);
      const after = this.#edit(project.file, content => withFacts(content, facts));
      if (before !== after) this.#emitChange();
      return before !== after;
    } catch {
      return false;
    }
  }

  dispose() {
    try { this.#unobserve?.(); } catch { /* already gone */ }
    this.#unobserve = null;
    if (this.#factsTimer) clearTimeout(this.#factsTimer);
    this.#factsTimer = null;
  }

  // ---------------------------------------------------------------- evidence

  #git(project, args, limit = 20000) {
    return new Promise(resolve => {
      try {
        this.#execFile("git", args, {
          cwd: project.directory,
          timeout: GIT_TIMEOUT_MS,
          maxBuffer: 2 * 1024 * 1024,
          windowsHide: true,
          // Read-only, and never taking git's index lock out from under an agent.
          env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" }
        }, (error, stdout) => resolve(error ? null : String(stdout || "").slice(0, limit)));
      } catch {
        resolve(null);
      }
    });
  }

  // Where the work stands: the commit, and a fingerprint of what is not yet
  // committed (files and how many lines changed in each, and new files).
  async #gitState(project) {
    const head = await this.#git(project, ["rev-parse", "HEAD"], 200);
    if (head === null) return null;
    const numbers = await this.#git(project, ["diff", "HEAD", "--numstat", "--no-color", ...MEMORY_PATHSPEC], 200000) || "";
    const untracked = await this.#git(project, ["ls-files", "--others", "--exclude-standard", ...MEMORY_PATHSPEC], 200000) || "";
    return { head: head.trim(), status: hash(`${numbers}\n${untracked}`), dirty: Boolean(numbers.trim() || untracked.trim()) };
  }

  async #uncommitted(project) {
    const status = await this.#git(project, ["status", "--porcelain=v1", ...MEMORY_PATHSPEC], 60000) || "";
    return status.split(/\r?\n/).filter(Boolean).map(line => line.slice(3).trim().replace(/^"|"$/g, ""));
  }

  async #evidence(project, record) {
    const since = record?.lastUpdate?.at || null;
    const git = { repository: false, branch: null, changedFiles: [], commits: [], stat: "", diff: "", state: null };
    const inside = await this.#git(project, ["rev-parse", "--is-inside-work-tree"], 20);
    if (inside && inside.trim() === "true") {
      git.repository = true;
      git.branch = (await this.#git(project, ["rev-parse", "--abbrev-ref", "HEAD"], 200))?.trim() || null;
      git.changedFiles = (await this.#uncommitted(project)).slice(0, 60);
      const logArgs = ["log", "-n", "15", "--pretty=format:%h %ad %s", "--date=short"];
      if (since) logArgs.push(`--since=${new Date(since).toISOString()}`);
      logArgs.push(...MEMORY_PATHSPEC);
      git.commits = ((await this.#git(project, logArgs, 8000)) || "").split(/\r?\n/).filter(Boolean).map(line => clean(line, 160));
      const exclusions = ["--", ".", ":(exclude)package-lock.json", ":(exclude)pnpm-lock.yaml", ":(exclude)yarn.lock", ":(exclude)*.lock", ":(exclude)*.min.js", ...MEMORY_EXCLUDES];
      git.stat = redactText((await this.#git(project, ["diff", "HEAD", "--stat", "--no-color", ...exclusions], 6000)) || "", { maxLength: 4000 }).value;
      git.diff = redactText((await this.#git(project, ["diff", "HEAD", "--no-color", "-U1", "--no-ext-diff", ...exclusions], 40000)) || "", { maxLength: 7000 }).value;
      git.state = await this.#gitState(project);
    }
    let context = null;
    try { context = this.#missionContext?.snapshot?.({ includeOutput: true }) || null; } catch { context = null; }
    let activity = [];
    try {
      const events = this.#getEngineApi()?.getActivity?.({ limit: 200 })?.events || [];
      activity = events.filter(event => !since || Number(event.timestamp) > since);
    } catch { activity = []; }
    const failures = activity.filter(event => /failed|error|spawn-error/i.test(String(event.type)) || (event.type === "session:exit" && Number.isInteger(event.exitCode) && event.exitCode !== 0 && event.intentional !== true));
    const workers = (context?.workers || []).slice(0, 12).map(worker => ({
      name: worker.name,
      state: worker.state,
      command: worker.command,
      exitCode: worker.exitCode,
      attention: worker.attention?.required ? worker.attention.reason : null,
      output: Array.isArray(worker.recentOutput) ? worker.recentOutput.slice(-6) : []
    }));
    return { since, git, activity, failures, workers };
  }

  // Whether anything worth recording happened since the last update.
  async #changes(project, record) {
    const since = record?.lastUpdate?.at || null;
    const state = await this.#gitState(project);
    const base = record?.lastUpdate?.git || null;
    let changedFiles = 0;
    let commits = 0;
    if (state) {
      // Uncommitted work counts when it differs from what was there at the last update.
      if (state.dirty && state.status !== base?.status) changedFiles = (await this.#uncommitted(project)).length;
      // Commits count when they touch something other than the memory files.
      if (base?.head && state.head !== base.head) {
        const counted = await this.#git(project, ["rev-list", "--count", `${base.head}..${state.head}`, ...MEMORY_PATHSPEC], 40);
        commits = counted === null ? 1 : Number(counted.trim()) || 0;
      } else if (!base?.head && since) {
        commits = Number(((await this.#git(project, ["rev-list", "--count", `--since=${new Date(since).toISOString()}`, "HEAD", ...MEMORY_PATHSPEC], 40)) || "0").trim()) || 0;
      }
    }
    const gitChanged = changedFiles > 0 || commits > 0;
    let failures = 0;
    try {
      const events = this.#getEngineApi()?.getActivity?.({ limit: 200 })?.events || [];
      failures = events.filter(event => (!since || Number(event.timestamp) > since) && (/failed|error|spawn-error/i.test(String(event.type)) || (event.type === "session:exit" && Number.isInteger(event.exitCode) && event.exitCode !== 0 && event.intentional !== true))).length;
    } catch { failures = 0; }
    const parts = [];
    if (changedFiles) parts.push(`${changedFiles} file${changedFiles === 1 ? "" : "s"} changed`);
    if (commits) parts.push(`${commits} commit${commits === 1 ? "" : "s"}`);
    if (failures) parts.push(`${failures} terminal failure${failures === 1 ? "" : "s"}`);
    return { any: gitChanged || failures > 0, changedFiles, commits, failures, summary: parts.join(" · ") };
  }

  // ---------------------------------------------------------------- Mission AI

  async #compose(system, text) {
    if (!this.#assistant || typeof this.#assistant.compose !== "function") throw new Error("Mission AI is not available on this computer");
    return this.#assistant.compose({ surface: "memory", system, text, timeoutMs: 120_000 });
  }

  // Writes "About this project" from the README and the facts. Mission AI's
  // block, so it may be written again on request.
  async summarize() {
    const project = this.#requireProject();
    const status = this.status();
    if (!status.enabled) throw new Error("Turn project memory on first");
    if (this.#busy) throw new Error("Project memory is already being written");
    this.#busy = "summary";
    this.#emitChange();
    try {
      const scan = this.#scan(project);
      const readme = (() => {
        for (const name of ["README.md", "README.MD", "readme.md", "README.txt", "README", "Readme.md"]) {
          try { return redactText(this.#fs.readFileSync(path.join(project.directory, name), "utf8"), { maxLength: 5000 }).value; } catch { /* next */ }
        }
        return "";
      })();
      const evidence = [
        `Project name: ${project.name}`,
        scan.packageInfo?.description ? `package.json description: ${scan.packageInfo.description}` : "",
        `Languages by size: ${scan.languages.map(item => `${item.name} ${item.share}%`).join(", ") || "unknown"}`,
        scan.frameworks.length ? `Frameworks and tools: ${scan.frameworks.join(", ")}` : "",
        scan.scripts.length ? `Scripts: ${scan.scripts.map(script => `${script.name}: ${script.command}`).join("; ")}` : "",
        `Terminals in OUTARCH: ${this.#terminals().map(terminal => `${terminal.name} (${terminal.command || "no command"}${terminal.port ? `, port ${terminal.port}` : ""})`).join("; ") || "none"}`,
        readme ? `README (start):\n${readme}` : "There is no README."
      ].filter(Boolean).join("\n");
      const system = [
        "You write the \"About this project\" section of a project's arch_memory.md, the file that developers and AI coding agents read before they work on the project.",
        "Use only the evidence given. Do not invent features, users or history. If something is not known, leave it out.",
        "Answer with one JSON object and nothing else, in this shape:",
        "{\"summary\": \"...\", \"howItRuns\": \"...\"}",
        "- summary: two to four plain sentences saying what the project is, what it does and who it is for. At most 600 characters.",
        "- howItRuns: one or two sentences on how it runs during development, naming the terminals, servers or commands from the evidence. At most 300 characters.",
        "Plain English. No markdown, no headings, no lists, no emoji, no marketing words. Never include secrets."
      ].join("\n");
      const answer = await this.#compose(system, evidence);
      const value = parseModelJson(answer.text);
      const summary = clean(value?.summary, 620);
      const howItRuns = clean(value?.howItRuns, 320);
      if (!summary) throw new Error("Mission AI's answer could not be used, so nothing was written. Try again, or pick another model.");
      const about = [summary, howItRuns ? `**How it runs:** ${howItRuns}` : "", `_Written by OUTARCH Mission AI (${clean(answer.model?.id || answer.model?.label || "model unknown", 80)}) on ${localStamp(this.#now()).slice(0, 10)}._`].filter(Boolean).join("\n\n");
      this.#edit(project.file, content => replaceBlock(content, ABOUT_START, ABOUT_END, about) ?? content);
      this.#lastError = null;
      return { written: true, about, status: this.status() };
    } catch (error) {
      this.#lastError = error.message;
      throw error;
    } finally {
      this.#busy = null;
      this.#emitChange();
    }
  }

  // Records work done by hand since the last update. `note` is what the
  // operator says they did; Mission AI turns the evidence and the note into
  // one entry, and OUTARCH writes it.
  async update({ reason = "manual", note = "" } = {}) {
    const project = this.#requireProject();
    const status = this.status();
    if (!status.enabled) throw new Error("Turn project memory on first");
    if (this.#busy) throw new Error("Project memory is already being written");
    const operatorNote = clean(note, MAX_NOTE_LENGTH);
    this.#busy = "update";
    this.#emitChange();
    try {
      const record = this.#record(project, true);
      const evidence = await this.#evidence(project, record);
      const nothingNew = !evidence.git.changedFiles.length && !evidence.git.commits.length && !evidence.failures.length && !operatorNote;
      const at = this.#now();
      if (nothingNew) {
        this.#edit(project.file, content => withFacts(content, this.#factsBlock(project, at)));
        record.lastUpdate = { at, git: evidence.git.state, by: record.lastUpdate?.by || null };
        this.#writePreferences();
        this.#lastError = null;
        return { written: false, reason: "nothing-new", message: "Nothing new since the last update. The facts were checked.", status: this.status() };
      }
      const memory = this.#readMemory(project.file) || "";
      const recent = parseEntries(memory).slice(-6).map(entry => `${entry.stamp} · ${entry.tool} (${entry.model}) · ${entry.kind}: ${entry.changed}`).join("\n");
      const lines = [
        `Project: ${project.name}`,
        evidence.since ? `Last memory update: ${localStamp(evidence.since)}` : "This is the first update.",
        `Recorded because: ${reason === "close" ? "the developer is closing OUTARCH" : "the developer asked for an update"}`,
        operatorNote ? `The developer's own note about what they did and why: ${operatorNote}` : "The developer did not add a note.",
        "",
        "Recent entries already in the memory (do not repeat these):",
        recent || "(none)",
        "",
        evidence.git.repository ? `Git branch: ${evidence.git.branch || "unknown"}` : "This folder is not a git repository.",
        evidence.git.changedFiles.length ? `Uncommitted changed files:\n${evidence.git.changedFiles.join("\n")}` : "",
        evidence.git.commits.length ? `Commits since the last update:\n${evidence.git.commits.join("\n")}` : "",
        evidence.git.stat ? `Diff summary:\n${evidence.git.stat}` : "",
        evidence.git.diff ? `Diff excerpt:\n${evidence.git.diff}` : "",
        evidence.failures.length ? `Terminal failures since the last update:\n${evidence.failures.slice(-10).map(event => clean(`${event.name || event.id || "terminal"}: ${event.type}${Number.isInteger(event.exitCode) ? ` (exit ${event.exitCode})` : ""}${event.reason ? `, ${event.reason}` : ""}`, 200)).join("\n")}` : "",
        evidence.workers.length ? `Terminals now:\n${evidence.workers.map(worker => `${worker.name}: ${worker.state}${worker.attention ? `, needs attention: ${worker.attention}` : ""}${worker.output.length ? `\n  last output: ${worker.output.map(line => clean(line, 160)).join(" | ")}` : ""}`).join("\n")}` : ""
      ].filter(Boolean).join("\n");
      const system = [
        "You write one entry for a project's arch_memory.md, the shared log that developers and AI coding agents read before they work on the project.",
        "The entry records work the developer did by hand since the last entry. Use only the evidence given: git changes, commits, terminal events and output, and the developer's note. Do not invent anything the evidence does not show.",
        "If the evidence shows nothing worth recording, answer {\"skip\": true}.",
        "Otherwise answer with one JSON object and nothing else, in this shape:",
        `{"skip": false, "kind": "one of ${ENTRY_KINDS.join(", ")}", "changed": "...", "why": "...", "files": ["..."], "errorsAndFixes": "..."}`,
        "- changed: one or two plain sentences, at most 300 characters, saying what changed.",
        "- why: one sentence, at most 200 characters. Use the developer's note when there is one. If the reason is not in the evidence, write \"Not stated.\"",
        "- files: up to 8 repository paths that changed, most important first, or [].",
        "- errorsAndFixes: one sentence about an error that happened and how it was fixed, or \"\" if there was none.",
        "- kind: session when the work mixes several kinds.",
        "Plain English. No markdown, no headings, no emoji, no filler, no marketing words. Never include secrets, keys, tokens, passwords or personal data. Do not repeat what an entry already in the memory says."
      ].join("\n");
      const answer = await this.#compose(system, lines);
      const value = parseModelJson(answer.text);
      if (!value) throw new Error("Mission AI's answer could not be used, so nothing was written. Try again, or pick another model in Settings.");
      const modelId = clean(answer.model?.id || answer.model?.label || "model unknown", 80);
      if (value.skip === true) {
        record.lastUpdate = { at, git: evidence.git.state, by: `OUTARCH Mission AI (${modelId})` };
        this.#writePreferences();
        this.#lastError = null;
        return { written: false, reason: "skip", message: "Mission AI found nothing worth recording.", status: this.status() };
      }
      const changed = clean(value.changed, 320);
      if (!changed) throw new Error("Mission AI's answer did not say what changed, so nothing was written. Try again.");
      const files = (Array.isArray(value.files) ? value.files : []).map(file => clean(file, 140).replace(/`/g, "'")).filter(file => file && !/\s{2,}/.test(file)).slice(0, 8);
      const entry = formatEntry({
        at,
        author: "OUTARCH Mission AI",
        model: modelId,
        kind: ENTRY_KINDS.includes(value.kind) ? value.kind : "session",
        source: reason === "close" ? "Work done by hand, recorded when OUTARCH closed." : "Work done by hand, recorded on request.",
        changed,
        why: clean(value.why, 220) || "Not stated.",
        files,
        errorsAndFixes: clean(value.errorsAndFixes, 320)
      });
      const facts = this.#factsBlock(project, at);
      this.#edit(project.file, content => {
        return `${withFacts(content, facts).replace(/\s*$/, "")}\n\n${entry}\n`;
      });
      record.lastUpdate = { at, git: evidence.git.state, by: `OUTARCH Mission AI (${modelId})` };
      this.#writePreferences();
      this.#lastError = null;
      return { written: true, entry, status: this.status() };
    } catch (error) {
      this.#lastError = error.message;
      throw error;
    } finally {
      this.#busy = null;
      this.#emitChange();
    }
  }

  // ---------------------------------------------------------------- open

  async reveal() {
    const project = this.#requireProject();
    if (!this.#openPath) throw new Error("Opening files is not available here");
    const failure = await this.#openPath(project.file);
    if (failure) throw new Error(String(failure));
    return { opened: project.file };
  }

  // ---------------------------------------------------------------- closing

  // Called when the window is asked to close. "prompt" means the renderer is
  // showing the dialog and will close the app itself; "close" means go ahead.
  async requestClose() {
    if (!this.#closeReady) return "close";
    if (this.#closing) {
      // A second click on the close button while the dialog is up closes.
      if (this.#now() - this.#closing.at > 1500) { this.#closing = null; return "close"; }
      return "prompt";
    }
    let check;
    try {
      check = await within(this.closeCheck(), this.#closeCheckTimeoutMs, { ask: false });
    } catch {
      check = { ask: false };
    }
    if (!check.ask) return "close";
    let acknowledge;
    const acknowledged = new Promise(resolve => { acknowledge = resolve; });
    this.#closing = { at: this.#now(), acknowledge };
    this.emit("close-request", { mode: check.mode, summary: check.summary || "", project: check.project || null });
    const shown = await within(acknowledged.then(() => true), this.#closeAckTimeoutMs, false);
    if (!shown) {
      this.#closing = null;
      return "close";
    }
    return "prompt";
  }

  // The renderer's side of the close dialog.
  closePrompt(state) {
    if (state === "ready") {
      this.#closeReady = true;
      return { ok: true };
    }
    if (state === "shown") {
      this.#closing?.acknowledge?.();
      return { ok: true };
    }
    if (state === "cancel" || state === "close") {
      this.#closing = null;
      return { ok: true };
    }
    throw new TypeError("Unknown close prompt state");
  }

  async closeCheck() {
    const project = this.#project();
    if (!project) return { ask: false };
    const status = this.status();
    if (!status.enabled) return status.prompt === "open" ? { ask: true, mode: "create", project: project.name } : { ask: false };
    if (!this.#prefs.askOnClose || status.busy) return { ask: false };
    const changes = await this.#changes(project, this.#record(project));
    return changes.any ? { ask: true, mode: "update", summary: changes.summary, project: project.name } : { ask: false };
  }

  #emitChange() {
    try { this.emit("change", { at: this.#now() }); } catch { /* listeners never break a write */ }
  }
}

module.exports = {
  ABOUT_END,
  ABOUT_START,
  ENTRY_KINDS,
  FACTS_END,
  FACTS_START,
  LEGACY_FILE_NAMES,
  MEMORY_FILE_NAME,
  MEMORY_MARKER,
  POINTER_END,
  POINTER_FILES,
  POINTER_START,
  ProjectMemoryFile,
  formatEntry,
  memoryTemplate,
  parseEntries,
  parseModelJson
};
