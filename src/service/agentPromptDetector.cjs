"use strict";

// Recognises an AI agent stopping to ask the operator for permission — "Do you
// want to proceed?", "Allow execution of 'npm'?", "Would you like to run the
// following command?" — in a terminal's output, so OUTARCH can say so with a
// notification that opens that terminal.
//
// Agent CLIs draw these prompts as full-screen TUIs: the question arrives in
// pieces, wrapped in colour and cursor codes, often without a trailing
// newline, and is repainted while it waits. So each worker keeps a short
// window of recent screen text (escape codes removed), and the window's tail is
// matched after every chunk. One prompt raises one notice: the same question is
// not reported again until the operator types into that terminal or the prompt
// leaves the screen.
//
// Strong patterns are specific to each agent's permission dialog and apply to
// any terminal (the agent may not have been classified yet). Generic "[y/N]"
// questions apply only to a terminal already known to be running an agent, so
// an ordinary `npm init` never interrupts anybody.

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");

const WINDOW_CHARS = 6000;
const TAIL_LINES = 28;
const CLEAR_AFTER_MS = 4000;

// OSC (title, hyperlinks), CSI, and single-character escapes.
const ANSI = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b\[[0-9;?<>=!]*[ -/]*[@-~]|\u001b[@-Z\\-_]|\u009b[0-9;?]*[@-~]/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
// Box drawing and the selection markers agents draw around choices.
const DECORATION = /[─-╿▀-▟■-◿←-⇿❯›•●○◉]/g;

const STRONG_PATTERNS = Object.freeze([
  // Claude Code
  { agent: "claude", question: /\bDo you want to (?:proceed|make this edit|create|run|allow|apply|overwrite|delete|execute|fetch|use|continue|edit|write)\b[^\n]{0,160}\?/i },
  { agent: "claude", question: /\bClaude (?:needs|wants|requests) (?:your )?permission\b[^\n]{0,160}/i },
  { agent: "claude", question: /\bAllow Claude to\b[^\n]{0,160}\??/i },
  // Codex CLI
  { agent: "codex", question: /\bWould you like to (?:run the following command|make the following edits|apply (?:these|the following) (?:changes|edits)|grant|allow)\b[^\n]{0,160}\??/i },
  { agent: "codex", question: /\bAllow Codex to\b[^\n]{0,160}\??/i },
  // Gemini CLI and Qwen Code (a Gemini CLI fork)
  { agent: "gemini", question: /\bAllow execution of\b[^\n]{0,160}\??/i },
  { agent: "gemini", question: /\bApply this change\?/i },
  { agent: "gemini", question: /\bWaiting for user confirmation\b/i },
  // GitHub Copilot CLI, Cursor agent, OpenCode, Goose, Amp, Aider
  { agent: "copilot", question: /\bDo you want to (?:run|allow) this (?:command|tool)\b[^\n]{0,160}\??/i },
  { agent: "cursor", question: /\bRun this command\?/i },
  { agent: "opencode", question: /\bPermission required\b[^\n]{0,160}/i },
  { agent: "goose", question: /\bDo you allow this tool call\?/i },
  { agent: "agent", question: /\b(?:Approve|Allow) (?:this )?(?:tool call|command|action|edit)s?\?/i },
  { agent: "aider", question: /[^\n]{0,160}\?\s*\(Y\)es\/\(N\)o\b[^\n]{0,80}/i }
]);

// Choices an agent offers under a permission question. One of these near a
// question is what makes a strong pattern certain rather than conversational.
const CHOICE = /(?:^|\s)(?:1[.)]\s*Yes\b|Yes,? (?:and )?(?:don'?t ask|allow|approve)|Yes \(y\)|Allow once|Allow always|\(Y\)es\/\(N\)o|No, (?:and )?(?:tell|suggest)|Reject\b|\[y\/N\]|\[Y\/n\]|\(y\/n\)|Esc to cancel|Press enter to confirm)/i;

// A plain yes/no question: only reported for a terminal known to run an agent.
const GENERIC = /[^\n]{3,160}\?\s*(?:\[[yY]\/[nN]\]|\[[yY]es\/[nN]o\]|\([yY]\/[nN]\)|\([yY]es\/[nN]o\))\s*:?\s*$/m;

function cleanScreen(text) {
  return String(text || "")
    .replace(ANSI, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(CONTROL, "")
    .replace(DECORATION, " ")
    .replace(/[ \t]{2,}/g, " ");
}

function fingerprint(workerId, question) {
  return crypto.createHash("sha1").update(`${workerId}\u0000${question.toLowerCase().replace(/\s+/g, " ").trim()}`).digest("hex").slice(0, 16);
}

function choicesNear(lines) {
  const out = [];
  for (const line of lines) {
    const match = line.match(/^\s*(?:\d[.)]\s*)?(Yes[^\n]{0,70}|No[^\n]{0,70}|Allow (?:once|always)[^\n]{0,40}|Reject[^\n]{0,40})$/i);
    if (match) out.push(match[1].trim());
    if (out.length >= 4) break;
  }
  return out;
}

class AgentPromptDetector extends EventEmitter {
  #workers;
  #now;

  constructor(options = {}) {
    super();
    this.#workers = new Map();
    this.#now = typeof options.now === "function" ? options.now : Date.now;
  }

  #entry(workerId) {
    let entry = this.#workers.get(workerId);
    if (!entry) {
      entry = { text: "", active: null, missingSince: null };
      this.#workers.set(workerId, entry);
    }
    return entry;
  }

  #match(tail, isAgent) {
    const lines = tail.split("\n").map(line => line.trim()).filter(Boolean);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index];
      for (const pattern of STRONG_PATTERNS) {
        const found = line.match(pattern.question);
        if (!found) continue;
        const after = lines.slice(index + 1, index + 9);
        const around = [line, ...after].join("\n");
        // A strong question needs the choices drawn under it (or inline), so an
        // agent merely saying "do you want to proceed?" in prose is not a prompt.
        if (!CHOICE.test(around) && pattern.agent !== "gemini") continue;
        return { agent: pattern.agent, question: found[0].trim().slice(0, 200), choices: choicesNear(after) };
      }
      if (isAgent) {
        const generic = line.match(GENERIC);
        if (generic) return { agent: "agent", question: generic[0].trim().slice(0, 200), choices: [] };
      }
    }
    return null;
  }

  /**
   * Feed a chunk of a worker's output. Returns the prompt it raised, if any.
   * `context`: { isAgent, agentType, workerName, runId }
   */
  observe(workerId, chunk, context = {}) {
    if (!workerId || typeof chunk !== "string" || !chunk) return null;
    const entry = this.#entry(workerId);
    entry.text = `${entry.text}${cleanScreen(chunk)}`.slice(-WINDOW_CHARS);
    const tail = entry.text.split("\n").slice(-TAIL_LINES).join("\n");
    const found = this.#match(tail, context.isAgent === true);
    const now = this.#now();

    if (!found) {
      if (entry.active) {
        entry.missingSince = entry.missingSince || now;
        // The prompt left the screen: answered from somewhere we did not see
        // (a keyboard shortcut in a pop-out, the agent timing out).
        if (now - entry.missingSince >= CLEAR_AFTER_MS) this.#clear(workerId, entry, "gone");
      }
      return null;
    }
    entry.missingSince = null;
    const id = fingerprint(workerId, found.question);
    if (entry.active?.id === id) return null;
    entry.active = { id, question: found.question, at: now };
    const prompt = {
      id,
      workerId,
      runId: context.runId || null,
      workerName: context.workerName || null,
      agent: context.agentType || found.agent,
      question: found.question,
      choices: found.choices,
      detectedAt: now
    };
    this.emit("prompt", prompt);
    return prompt;
  }

  /** The operator typed into this terminal: whatever was asked is answered. */
  noteInput(workerId) {
    const entry = this.#workers.get(workerId);
    if (!entry) return false;
    // What was on screen is history now; only new output can ask again.
    entry.text = "";
    if (!entry.active) return false;
    this.#clear(workerId, entry, "answered");
    return true;
  }

  #clear(workerId, entry, reason) {
    const cleared = entry.active;
    entry.active = null;
    entry.missingSince = null;
    if (cleared) this.emit("cleared", { workerId, id: cleared.id, reason });
  }

  active(workerId) {
    const active = this.#workers.get(workerId)?.active;
    return active ? { ...active } : null;
  }

  forget(workerId) {
    const entry = this.#workers.get(workerId);
    if (entry?.active) this.#clear(workerId, entry, "stopped");
    this.#workers.delete(workerId);
  }

  reset() {
    for (const [workerId, entry] of this.#workers) if (entry.active) this.#clear(workerId, entry, "reset");
    this.#workers.clear();
  }
}

module.exports = { AgentPromptDetector, cleanScreen, STRONG_PATTERNS };
