"use strict";

// The assistant's own workbench: read-only file tools and a private terminal.
//
// Before this, the assistant had one way to look at the code or run a check:
// type into one of the operator's terminals. The command, everything it
// printed and any error it hit then landed in a pane the operator was using.
// Nothing here touches the workspace. Files are read straight from disk, and a
// command runs in a hidden process of its own — no pane, tab, worker list or
// console window shows it — and what it printed comes back to the chat, under
// the step that ran it.
//
// Reading stays inside the open project folder and skips the files that hold
// secrets. Running a command can change anything a shell can, so it is an
// action: the operator approves it, exactly as written, before it runs.

const fs = require("node:fs");
const path = require("node:path");
const childProcess = require("node:child_process");
const { StringDecoder } = require("node:string_decoder");
const { stripAnsi } = require("../engine/ansi.cjs");
const { redactText } = require("./contextSanitizer.cjs");

const DEFAULT_TIMEOUT_SECONDS = 60;
const MIN_TIMEOUT_SECONDS = 5;
const MAX_TIMEOUT_SECONDS = 300;
const MAX_COMMAND_LENGTH = 4000;
const CAPTURE_HEAD_CHARS = 8_000;
const CAPTURE_TAIL_CHARS = 120_000;
const MODEL_OUTPUT_LINES = 160;
const MODEL_OUTPUT_HEAD_LINES = 30;
const SHOWN_OUTPUT_LINES = 120;
const OUTPUT_LINE_CHARS = 400;
const LIVE_OUTPUT_MS = 250;
const EXIT_DRAIN_MS = 400;
const KILL_GRACE_MS = 2000;
const KILL_GIVE_UP_MS = 5000;
const READ_DEFAULT_LINES = 250;
const READ_MAX_LINES = 500;
const READ_MAX_CHARS = 32_000;
const READ_MAX_BYTES = 4 * 1024 * 1024;
const READ_LINE_CHARS = 500;
const LIST_DEFAULT_DEPTH = 2;
const LIST_MAX_DEPTH = 5;
const LIST_MAX_ENTRIES = 300;
const SEARCH_MAX_MATCHES = 80;
const SEARCH_MAX_FILES = 8000;
const SEARCH_MAX_FILE_BYTES = 512 * 1024;
const SEARCH_BUDGET_MS = 6000;
const SEARCH_LINE_CHARS = 240;
const SEARCH_SCAN_CHARS = 2000;

// Folders that hold dependencies, build output or tool caches. They are listed
// so the model knows they exist, but not opened or searched unless asked for
// by name: they are large, generated, and rarely what a question is about.
const SKIPPED_FOLDERS = new Set([
  "node_modules", "bower_components", ".git", ".hg", ".svn", "dist", "build", "out", "coverage",
  ".next", ".nuxt", ".svelte-kit", ".turbo", ".cache", ".parcel-cache", ".vite", ".venv", "venv",
  "__pycache__", ".pytest_cache", ".mypy_cache", "target", ".gradle", ".idea", ".vs", ".terraform"
]);

const SECRET_NAMES = new Set([".npmrc", ".pypirc", ".netrc", "_netrc", ".git-credentials", ".htpasswd", "credentials", "credentials.json", "secrets.json"]);

const FOLDER = { type: "string", description: "A folder inside the project, relative to its root. Defaults to the root." };

const WORKBENCH_TOOLS = Object.freeze([
  {
    name: "list_files",
    kind: "read",
    description: "List the files and folders of the open project, or of one folder in it, with file sizes. Dependency and build folders such as node_modules are named but not opened unless asked for directly. Reads the disk directly; no terminal is used.",
    parameters: {
      type: "object",
      properties: {
        folder: FOLDER,
        depth: { type: "integer", description: "How many folder levels to list, 1 to 5. Defaults to 2." }
      }
    }
  },
  {
    name: "read_file",
    kind: "read",
    description: "Read a text file in the open project, with line numbers. Long files are read one range at a time. Values that look like secrets come back as [REDACTED], and files that hold secrets (.env, private keys, credential files) are not read. No terminal is used.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "The file's path, relative to the project root." },
        start_line: { type: "integer", description: "The first line to read, counting from 1. Defaults to 1." },
        end_line: { type: "integer", description: "The last line to read. At most 500 lines come back per call." }
      },
      required: ["path"]
    }
  },
  {
    name: "search_files",
    kind: "read",
    description: "Search the text of the project's files and return the matching lines with their file and line number. Matching ignores case unless the query has a capital letter. Dependency and build folders, binary files and files that hold secrets are skipped. No terminal is used.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The text to find." },
        regex: { type: "boolean", description: "Treat the query as a regular expression. Defaults to false." },
        folder: { type: "string", description: "Only search inside this folder, relative to the project root." },
        file_pattern: { type: "string", description: "Only search files whose name matches this pattern, for example \"*.ts\" or \"*.test.js\"." }
      },
      required: ["query"]
    }
  },
  {
    name: "run_command",
    kind: "action",
    description: "Run one shell command in your own private terminal, in the project folder, and get back its exit code and output. This terminal is hidden from the operator's workspace: their terminals are never used or disturbed, and the output is shown to them in this chat. It has no keyboard, so it cannot answer prompts, and it is stopped at its time limit — never use it for dev servers, watchers or anything interactive; add a worker for those.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line to run, exactly as it would be typed." },
        folder: FOLDER,
        timeout_seconds: { type: "integer", description: "Stop the command after this many seconds, 5 to 300. Defaults to 60." }
      },
      required: ["command"]
    }
  }
]);

const TOOL_NAMES = new Set(WORKBENCH_TOOLS.map(tool => tool.name));
const FILE_TOOL_NAMES = Object.freeze(WORKBENCH_TOOLS.filter(tool => tool.kind === "read").map(tool => tool.name));

function shellName(platform = process.platform) {
  if (platform === "win32") return "PowerShell";
  return platform === "darwin" ? "zsh" : "bash";
}

// What the model is told about its workbench. It sits under "Acting" in the
// system prompt, so it is only said to a model that can use tools and act.
function workbenchPrompt(platform = process.platform) {
  return [
    "",
    "Your own workbench",
    "- To look at the code, use list_files, read_file and search_files. They read the project folder directly and need no approval.",
    `- To run anything else — git, a build, the tests, a version check — use run_command. It runs in your own private terminal (${shellName(platform)}, in the project folder), which the operator's workspace never shows; the output reaches them in this chat.`,
    "- Never use the operator's terminals for your own work. Type into a worker's terminal only when the operator asks you to, or to answer a prompt that worker is waiting on.",
    "- Add a worker only for something the operator wants to keep running and watch, such as a dev server or a test watcher.",
    "- Prefer the file tools to shell commands for reading, and read only the files the question needs."
  ];
}

function clip(value, limit) {
  const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function clampInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}

function formatBytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function isSecretFile(name) {
  const lower = String(name || "").toLowerCase();
  if (/^\.env(\..+)?$/.test(lower)) return !/\.(example|sample|template|dist|defaults?)$/.test(lower);
  if (/^id_(rsa|dsa|ecdsa|ed25519)$/.test(lower)) return true;
  if (/\.(pem|key|p12|pfx|jks|keystore|kdbx|ppk)$/.test(lower)) return true;
  return SECRET_NAMES.has(lower);
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

function globToRegExp(pattern) {
  const text = String(pattern || "").trim().replace(/\\/g, "/");
  if (!text) return null;
  const source = text.split("").map(char => (char === "*" ? "[^/]*" : char === "?" ? "[^/]" : char.replace(/[.+^${}()|[\]\\]/g, "\\$&"))).join("");
  return { matchesPath: text.includes("/"), expression: new RegExp(`^${source}$`, "i") };
}

// Masks the body of a private key block line by line, so line numbers stay
// true while nothing between the markers is shown.
const KEY_BEGINS = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;
const KEY_ENDS = /-----END [A-Z0-9 ]*PRIVATE KEY-----/;

function keyBlockMasker() {
  let open = false;
  return line => {
    if (KEY_BEGINS.test(line)) {
      open = !KEY_ENDS.test(line);
      return "[REDACTED:private-key]";
    }
    if (!open) return line;
    if (KEY_ENDS.test(line)) open = false;
    return "[REDACTED:private-key]";
  };
}

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function toPosix(relative) {
  return relative ? relative.split(path.sep).join("/") : ".";
}

function abortError() {
  const error = new Error("Stopped before it finished");
  error.name = "AbortError";
  return error;
}

// Output as a terminal would show it: colour codes removed, and a line that
// was redrawn with carriage returns (a progress bar) kept as its last drawing.
function outputLines(raw) {
  const lines = stripAnsi(String(raw || "")).replace(/\r\n/g, "\n").split("\n").map(line => {
    if (!line.includes("\r")) return line;
    const drawings = line.split("\r").filter(Boolean);
    return drawings.length ? drawings[drawings.length - 1] : "";
  });
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

function redactLine(line, limit) {
  return redactText(line, { maxLength: limit }).value;
}

// The chat shows the end of the output, where results and errors are.
function shownOutput(lines) {
  const kept = lines.slice(-SHOWN_OUTPUT_LINES).map(line => redactLine(line, OUTPUT_LINE_CHARS));
  const hidden = lines.length - kept.length;
  return [...(hidden > 0 ? [`… ${hidden} earlier lines not shown`] : []), ...kept].join("\n");
}

// The model gets the start as well, where a command says what it is doing.
function modelOutput(lines) {
  const masked = lines.map(line => redactLine(line, OUTPUT_LINE_CHARS));
  if (masked.length <= MODEL_OUTPUT_LINES) return masked.join("\n");
  const head = masked.slice(0, MODEL_OUTPUT_HEAD_LINES);
  const tail = masked.slice(-(MODEL_OUTPUT_LINES - MODEL_OUTPUT_HEAD_LINES));
  return [...head, `… ${masked.length - head.length - tail.length} lines left out …`, ...tail].join("\n");
}

// The command line for the platform's shell, with no terminal attached.
//
// On Windows the command reaches PowerShell as base64 text rebuilt into a
// script block, so no quote or backslash in it is reinterpreted on the way.
// It is run through -Command rather than -EncodedCommand because the encoded
// form reports errors as CLIXML markup instead of the text a person reads. The
// script records whether its last statement succeeded; the exit happens after
// the output has been written, so a formatted table is never cut off.
function commandLaunch(command, platform = process.platform) {
  if (platform === "win32") {
    const script = `${command}\n$__mcOk = $?; $__mcCode = $global:LASTEXITCODE`;
    const encoded = Buffer.from(script, "utf8").toString("base64");
    const boot = [
      "$ProgressPreference = 'SilentlyContinue'",
      "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "$global:LASTEXITCODE = 0",
      "$__mcOk = $false",
      "$__mcCode = 0",
      `. ([ScriptBlock]::Create([System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${encoded}')))) | Out-Default`,
      "if ($__mcOk) { exit 0 } elseif ($__mcCode) { exit $__mcCode } else { exit 1 }"
    ].join("; ");
    return { file: "powershell.exe", args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", boot] };
  }
  const shell = platform === "darwin" ? "/bin/zsh" : fs.existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
  return { file: shell, args: ["-l", "-c", command] };
}

// A command's output, kept within bounds however much it prints: the start,
// and a moving window over the end.
function outputCapture() {
  let head = "";
  let tail = "";
  let omitted = 0;
  return {
    push(text) {
      if (head.length < CAPTURE_HEAD_CHARS) {
        const room = CAPTURE_HEAD_CHARS - head.length;
        head += text.slice(0, room);
        text = text.slice(room);
      }
      if (!text) return;
      tail += text;
      if (tail.length > CAPTURE_TAIL_CHARS) {
        const cut = tail.length - CAPTURE_TAIL_CHARS;
        omitted += cut;
        tail = tail.slice(cut);
      }
    },
    text: () => (omitted ? `${head}\n… ${omitted} characters of output left out …\n${tail.slice(tail.indexOf("\n") + 1)}` : head + tail)
  };
}

class AssistantWorkbench {
  #getRoot;
  #platform;
  #spawn;
  #now;
  #env;
  #minTimeoutSeconds;
  #running;

  constructor(options = {}) {
    this.#getRoot = typeof options.getRoot === "function" ? options.getRoot : () => null;
    this.#platform = options.platform || process.platform;
    this.#spawn = typeof options.spawn === "function" ? options.spawn : childProcess.spawn;
    this.#now = typeof options.now === "function" ? options.now : Date.now;
    this.#env = options.env && typeof options.env === "object" ? options.env : process.env;
    this.#minTimeoutSeconds = Number.isFinite(options.minTimeoutSeconds) ? Math.max(0.05, options.minTimeoutSeconds) : MIN_TIMEOUT_SECONDS;
    this.#running = new Set();
  }

  handles(name) {
    return TOOL_NAMES.has(name);
  }

  // What the approval card says: the command exactly as it will run.
  describe(call) {
    const args = call.arguments || {};
    const folder = String(args.folder || "").trim().replace(/\\/g, "/").replace(/^\.\/?/, "").replace(/\/+$/, "");
    return {
      title: folder ? `Run in a private terminal, in ${clip(folder, 60)}` : "Run in a private terminal",
      detail: String(args.command || "").slice(0, MAX_COMMAND_LENGTH),
      code: true,
      risk: "high"
    };
  }

  // How a command's step reads while it runs.
  runningActivity(call) {
    if (call?.name !== "run_command") return null;
    const command = String(call.arguments?.command || "").trim().slice(0, MAX_COMMAND_LENGTH);
    return { label: `Running ${clip(command, 72)}`, command, output: "", exitCode: null, detail: null, code: false };
  }

  async execute(call, context = {}) {
    const args = call.arguments || {};
    switch (call.name) {
      case "list_files": return this.#list(args);
      case "read_file": return this.#read(args);
      case "search_files": return this.#search(args);
      case "run_command": return this.#run(args, context);
      default: throw new Error(`Unknown tool ${call.name}`);
    }
  }

  // Ends every command still running. The app calls this as it closes.
  dispose() {
    for (const stop of [...this.#running]) stop();
    this.#running.clear();
  }

  async #root() {
    const root = this.#getRoot();
    if (!root) throw new Error("Open a project folder first. Files and commands are limited to the open project.");
    try {
      return await fs.promises.realpath(root);
    } catch {
      throw new Error("The project folder cannot be found on disk");
    }
  }

  async #resolve(root, wanted) {
    const text = String(wanted ?? "").trim() || ".";
    const target = path.resolve(root, text);
    if (!inside(root, target)) throw new Error("Only files and folders inside the project can be used");
    let real;
    try {
      real = await fs.promises.realpath(target);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") throw new Error(`Nothing called "${clip(text, 80)}" exists in the project`);
      throw new Error(`"${clip(text, 80)}" cannot be opened: ${error.message}`);
    }
    if (!inside(root, real)) throw new Error("Only files and folders inside the project can be used");
    return { real, rel: toPosix(path.relative(root, real)) };
  }

  async #list(args) {
    const root = await this.#root();
    const start = await this.#resolve(root, args.folder);
    const stat = await fs.promises.stat(start.real);
    if (!stat.isDirectory()) throw new Error(`${start.rel} is a file, not a folder. Read it instead.`);
    const depth = clampInt(args.depth, 1, LIST_MAX_DEPTH, LIST_DEFAULT_DEPTH);
    const entries = [];
    let full = false;
    const walk = async (dir, rel, level) => {
      let items;
      try {
        items = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch {
        entries.push(`${rel}/  (cannot be read)`);
        return;
      }
      items.sort((a, b) => (Number(b.isDirectory()) - Number(a.isDirectory())) || a.name.localeCompare(b.name));
      for (const item of items) {
        if (entries.length >= LIST_MAX_ENTRIES) { full = true; return; }
        const childRel = rel === "." ? item.name : `${rel}/${item.name}`;
        const childPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          const skipped = SKIPPED_FOLDERS.has(item.name);
          entries.push(`${childRel}/${skipped ? "  (dependencies, build output or tool data; not opened)" : ""}`);
          if (!skipped && level < depth) await walk(childPath, childRel, level + 1);
          if (full) return;
        } else if (item.isSymbolicLink()) {
          entries.push(`${childRel}  (link)`);
        } else {
          let size = "";
          try { size = formatBytes((await fs.promises.stat(childPath)).size); } catch { /* listed without a size */ }
          entries.push(`${childRel}${size ? `  ${size}` : ""}${isSecretFile(item.name) ? "  (holds secrets; not readable)" : ""}`);
        }
      }
    };
    await walk(start.real, start.rel, 1);
    return {
      label: start.rel === "." ? "Looked through the project's files" : `Looked through ${clip(start.rel, 60)}`,
      result: {
        folder: start.rel,
        entries: entries.length ? entries : ["(empty folder)"],
        ...(full ? { note: `Only the first ${LIST_MAX_ENTRIES} entries are listed. List a folder inside it to see more.` } : {})
      }
    };
  }

  async #read(args) {
    const root = await this.#root();
    if (!String(args.path ?? "").trim()) throw new Error("Say which file to read");
    const target = await this.#resolve(root, args.path);
    const stat = await fs.promises.stat(target.real);
    if (stat.isDirectory()) throw new Error(`${target.rel} is a folder. List it instead.`);
    if (target.rel.split("/").includes(".git")) throw new Error("Git's own files are not read. Run a git command instead.");
    if (isSecretFile(path.basename(target.real))) throw new Error(`${target.rel} holds secrets, so it is not read. Ask the operator for what you need from it, or read an example file.`);
    if (stat.size > READ_MAX_BYTES) throw new Error(`${target.rel} is ${formatBytes(stat.size)}, too large to read. Search it instead.`);
    const buffer = await fs.promises.readFile(target.real);
    if (looksBinary(buffer)) throw new Error(`${target.rel} is a binary file, not text`);
    const lines = buffer.toString("utf8").replace(/^﻿/, "").split(/\r?\n/);
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
    const total = lines.length;
    const from = clampInt(args.start_line, 1, Math.max(1, total), 1);
    const hasEnd = args.end_line !== undefined && args.end_line !== null && args.end_line !== "" && Number.isFinite(Number(args.end_line));
    const wantedEnd = hasEnd ? clampInt(args.end_line, from, total, total) : from + READ_DEFAULT_LINES - 1;
    const to = Math.min(total, wantedEnd, from + READ_MAX_LINES - 1);
    const mask = keyBlockMasker();
    for (let index = 0; index < from - 1; index += 1) mask(lines[index]);
    const width = String(to).length;
    const shown = [];
    let chars = 0;
    let last = from - 1;
    for (let number = from; number <= to; number += 1) {
      const text = redactLine(mask(lines[number - 1]), READ_LINE_CHARS);
      const line = `${String(number).padStart(width)} | ${text}`;
      if (shown.length && chars + line.length > READ_MAX_CHARS) break;
      shown.push(line);
      chars += line.length + 1;
      last = number;
    }
    return {
      label: `Read ${clip(target.rel, 72)}`,
      result: {
        path: target.rel,
        totalLines: total,
        lines: `${from}-${last}`,
        content: total === 1 && lines[0] === "" ? "(empty file)" : shown.join("\n"),
        ...(last < total ? { more: `Lines ${last + 1} to ${total} were not read. Read them with start_line ${last + 1}.` } : {})
      }
    };
  }

  async #search(args) {
    const root = await this.#root();
    const query = String(args.query ?? "");
    if (!query.trim()) throw new Error("Say what to search for");
    if (query.length > 300) throw new Error("That search is too long");
    const caseSensitive = /[A-Z]/.test(query);
    let test;
    if (args.regex === true) {
      let expression;
      try { expression = new RegExp(query, caseSensitive ? "" : "i"); }
      catch (error) { throw new Error(`That is not a valid regular expression: ${error.message}`); }
      test = line => expression.test(line);
    } else {
      const needle = caseSensitive ? query : query.toLowerCase();
      test = line => (caseSensitive ? line : line.toLowerCase()).includes(needle);
    }
    const names = args.file_pattern ? globToRegExp(args.file_pattern) : null;
    const start = await this.#resolve(root, args.folder);
    const deadline = this.#now() + SEARCH_BUDGET_MS;
    const matches = [];
    let searched = 0;
    let stopped = null;

    const searchFile = async (file, rel) => {
      let buffer;
      try {
        const stat = await fs.promises.stat(file);
        if (!stat.size || stat.size > SEARCH_MAX_FILE_BYTES) return;
        buffer = await fs.promises.readFile(file);
      } catch {
        return;
      }
      if (looksBinary(buffer)) return;
      searched += 1;
      const mask = keyBlockMasker();
      const lines = buffer.toString("utf8").split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        const line = mask(lines[index]);
        if (!test(line.length > SEARCH_SCAN_CHARS ? line.slice(0, SEARCH_SCAN_CHARS) : line)) continue;
        matches.push(`${rel}:${index + 1}: ${redactLine(line.trim(), SEARCH_LINE_CHARS)}`);
        if (matches.length >= SEARCH_MAX_MATCHES) { stopped = "matches"; return; }
      }
    };

    const startStat = await fs.promises.stat(start.real);
    if (!startStat.isDirectory()) {
      if (isSecretFile(path.basename(start.real))) throw new Error(`${start.rel} holds secrets, so it is not searched`);
      await searchFile(start.real, start.rel);
    } else {
      const stack = [{ dir: start.real, rel: start.rel }];
      while (stack.length && !stopped) {
        const { dir, rel } = stack.pop();
        let items;
        try { items = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { continue; }
        items.sort((a, b) => a.name.localeCompare(b.name));
        const folders = [];
        for (const item of items) {
          const childRel = rel === "." ? item.name : `${rel}/${item.name}`;
          if (item.isDirectory()) {
            if (!SKIPPED_FOLDERS.has(item.name)) folders.push({ dir: path.join(dir, item.name), rel: childRel });
            continue;
          }
          if (!item.isFile() || isSecretFile(item.name)) continue;
          if (names && !names.expression.test(names.matchesPath ? childRel : item.name)) continue;
          if (searched >= SEARCH_MAX_FILES) { stopped = "files"; break; }
          if (this.#now() > deadline) { stopped = "time"; break; }
          await searchFile(path.join(dir, item.name), childRel);
          if (stopped) break;
        }
        for (let index = folders.length - 1; index >= 0; index -= 1) stack.push(folders[index]);
      }
    }

    const notes = {
      matches: `Stopped at ${SEARCH_MAX_MATCHES} matches. Narrow the search with folder or file_pattern.`,
      files: `Stopped after ${SEARCH_MAX_FILES} files. Narrow the search with folder or file_pattern.`,
      time: "Stopped at the time limit before every file was searched. Narrow the search with folder or file_pattern."
    };
    return {
      label: `Searched the code for "${clip(query, 48)}"`,
      result: {
        query,
        folder: start.rel,
        filesSearched: searched,
        matches: matches.length ? matches : ["(no matches)"],
        ...(stopped ? { note: notes[stopped] } : {})
      }
    };
  }

  async #run(args, context) {
    const root = await this.#root();
    const command = String(args.command ?? "").trim();
    if (!command) throw new Error("Say which command to run");
    if (command.length > MAX_COMMAND_LENGTH) throw new Error("That command is too long to run at once");
    const where = await this.#resolve(root, args.folder);
    if (!(await fs.promises.stat(where.real)).isDirectory()) throw new Error(`${where.rel} is a file, not a folder`);
    const requested = [undefined, null, ""].includes(args.timeout_seconds) ? NaN : Number(args.timeout_seconds);
    const timeoutSeconds = Math.min(MAX_TIMEOUT_SECONDS, Math.max(this.#minTimeoutSeconds, Number.isFinite(requested) ? requested : DEFAULT_TIMEOUT_SECONDS));
    const outcome = await this.#spawnCommand({ command, cwd: where.real, timeoutMs: Math.round(timeoutSeconds * 1000), signal: context.signal, onOutput: context.onOutput });

    const lines = outputLines(outcome.raw);
    const shown = shownOutput(lines);
    const seconds = Math.round(outcome.durationMs / 100) / 10;
    const failed = outcome.timedOut || outcome.exitCode !== 0;
    const detail = outcome.timedOut
      ? `Stopped at the ${timeoutSeconds} s time limit`
      : outcome.exitCode === null ? `Ended by ${outcome.endedBy || "a signal"}`
      : outcome.exitCode !== 0 ? `Exited with code ${outcome.exitCode}` : null;
    return {
      label: `Ran ${clip(command, 72)}`,
      result: {
        command,
        folder: where.rel,
        shell: shellName(this.#platform),
        exitCode: outcome.timedOut ? null : outcome.exitCode,
        seconds,
        output: lines.length ? modelOutput(lines) : "(no output)",
        ...(outcome.timedOut ? { note: `It was still running after ${timeoutSeconds} seconds, so it was stopped. For something that keeps running, such as a server or a watcher, add a worker instead.` } : {})
      },
      activity: { state: failed ? "failed" : "done", detail, command, output: shown, exitCode: outcome.timedOut ? null : outcome.exitCode }
    };
  }

  #spawnCommand({ command, cwd, timeoutMs, signal, onOutput }) {
    if (signal?.aborted) return Promise.reject(abortError());
    const launch = commandLaunch(command, this.#platform);
    const posix = this.#platform !== "win32";
    // No colour, no pager and no credential prompt: nothing here can answer
    // one, and colour codes are only noise in a chat.
    const env = {
      ...this.#env,
      NO_COLOR: "1",
      FORCE_COLOR: "0",
      CLICOLOR: "0",
      TERM: "dumb",
      GIT_PAGER: "cat",
      GIT_TERMINAL_PROMPT: "0",
      ...(posix ? { PAGER: "cat" } : {}),
      MISSION_CONTROL_ASSISTANT: "1"
    };
    const startedAt = this.#now();

    return new Promise((resolve, reject) => {
      let child;
      try {
        // Hidden in every sense: no console window, no keyboard, no pane.
        child = this.#spawn(launch.file, launch.args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], detached: posix });
      } catch (error) {
        reject(new Error(`The private terminal could not start: ${error.message}`));
        return;
      }

      const capture = outputCapture();
      const decoders = { out: new StringDecoder("utf8"), err: new StringDecoder("utf8") };
      const timers = { limit: null, live: null, drain: null, giveUp: null, hardKill: null };
      let timedOut = false;
      let cancelled = false;
      let exited = false;
      let exitCode = null;
      let endedBy = null;
      let settled = false;

      const report = () => {
        timers.live = null;
        if (typeof onOutput !== "function") return;
        try { onOutput(shownOutput(outputLines(capture.text()))); } catch { /* the chat only watches */ }
      };

      const finish = (error = null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timers.limit);
        clearTimeout(timers.live);
        clearTimeout(timers.drain);
        clearTimeout(timers.giveUp);
        if (exited) clearTimeout(timers.hardKill);
        signal?.removeEventListener?.("abort", stop);
        this.#running.delete(stop);
        capture.push(decoders.out.end() + decoders.err.end());
        try { child.stdout?.destroy(); child.stderr?.destroy(); } catch { /* already closed */ }
        report();
        if (error) reject(error);
        else if (cancelled) reject(abortError());
        else resolve({ exitCode, endedBy, timedOut, raw: capture.text(), durationMs: this.#now() - startedAt });
      };

      const kill = () => {
        if (!child.pid || exited) return;
        if (posix) {
          // The shell leads its own process group, so the whole group goes.
          try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* already gone */ } }
          timers.hardKill = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already gone */ } }, KILL_GRACE_MS);
        } else {
          try {
            const killer = this.#spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
            killer?.on?.("error", () => { try { child.kill(); } catch { /* already gone */ } });
          } catch {
            try { child.kill(); } catch { /* already gone */ }
          }
        }
        // A process that will not die does not keep the conversation waiting.
        if (!timers.giveUp) timers.giveUp = setTimeout(() => finish(), KILL_GIVE_UP_MS);
      };

      function stop() {
        cancelled = true;
        kill();
      }

      child.stdout?.on("data", chunk => {
        capture.push(decoders.out.write(chunk));
        if (!timers.live && typeof onOutput === "function") timers.live = setTimeout(report, LIVE_OUTPUT_MS);
      });
      child.stderr?.on("data", chunk => {
        capture.push(decoders.err.write(chunk));
        if (!timers.live && typeof onOutput === "function") timers.live = setTimeout(report, LIVE_OUTPUT_MS);
      });
      child.on("error", error => finish(new Error(`The private terminal could not start: ${error.message}`)));
      child.on("exit", (code, exitSignal) => {
        exited = true;
        exitCode = Number.isInteger(code) ? code : null;
        endedBy = exitSignal || null;
        // A background process the command left behind can hold the output
        // open; what was printed by the time the command ended is its output.
        timers.drain = setTimeout(() => finish(), EXIT_DRAIN_MS);
      });
      child.on("close", () => finish());

      timers.limit = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
      signal?.addEventListener?.("abort", stop, { once: true });
      this.#running.add(stop);
    });
  }
}

module.exports = { AssistantWorkbench, WORKBENCH_TOOLS, FILE_TOOL_NAMES, workbenchPrompt, commandLaunch, isSecretFile };
