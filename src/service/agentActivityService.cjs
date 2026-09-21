"use strict";

const { EventEmitter } = require("node:events");

const AGENT_PATTERNS = Object.freeze([
  {
    type: "claude",
    detectRegex: /(?:claude\s+(?:code|cli)|anthropic\s+claude|welcome to claude code)/i,
    thinkingRegex: /(?:claude is thinking|thinking\.\.\.|analyzing project)/i,
    toolRegex: /(?:running command|executing tool|reading file|editing file|tool use:\s*([a-zA-Z0-9_-]+))/i,
    approvalRegex: /(?:do you want to run|allow claude to|approve execution|confirm\s*\[y\/n\]|approve\?)/i,
    costTokenRegex: /(?:tokens?:\s*([0-9,]+)|cost:\s*\$([0-9.]+)|usage:\s*([0-9,]+)\s*tokens)/i,
    turnCompleteRegex: /(?:task completed|completed in [0-9.]+s|cost for this turn)/i
  },
  {
    type: "codex",
    detectRegex: /(?:codex\s+cli|openai\s+codex|welcome to codex)/i,
    thinkingRegex: /(?:codex is working|planning changes|reasoning\.\.\.)/i,
    toolRegex: /(?:tool call:\s*([a-zA-Z0-9_-]+)|executing shell command)/i,
    approvalRegex: /(?:approval required|run this command\?|press enter to confirm)/i,
    costTokenRegex: /(?:total tokens:\s*([0-9,]+)|session cost:\s*\$([0-9.]+))/i,
    turnCompleteRegex: /(?:turn completed|finished task)/i
  },
  {
    type: "gemini",
    detectRegex: /(?:gemini\s+cli|google\s+gemini|gemini assistant)/i,
    thinkingRegex: /(?:gemini thinking|processing request\.\.\.)/i,
    toolRegex: /(?:calling tool:\s*([a-zA-Z0-9_-]+)|running shell)/i,
    approvalRegex: /(?:execute command\?\s*\(y\/n\)|permit access\?)/i,
    costTokenRegex: /(?:tokens:\s*([0-9,]+)|estimated cost:\s*\$([0-9.]+))/i,
    turnCompleteRegex: /(?:response complete|done\.)/i
  },
  {
    type: "opencode",
    detectRegex: /(?:opencode\s+cli|opencode interpreter)/i,
    thinkingRegex: /(?:opencode thinking|interpreting\.\.\.)/i,
    toolRegex: /(?:tool:\s*([a-zA-Z0-9_-]+)|executing step)/i,
    approvalRegex: /(?:approve this step\?|confirm\s*\(y\/n\))/i,
    costTokenRegex: /(?:tokens used:\s*([0-9,]+))/i,
    turnCompleteRegex: /(?:step complete|finished execution)/i
  }
]);

// Evidence that a CLI has handed the terminal back: an explicit goodbye, or a
// shell prompt reappearing on its own line. Both are weak on their own, which is
// why they only ever downgrade a classification, never create one.
const AGENT_EXIT_PATTERN = /(?:^|\s)(?:goodbye!?|session ended|exiting (?:claude|codex|gemini|opencode)|agent session closed)\b|^(?:PS\s+[A-Za-z]:\\[^\n]*>|\$|>)\s*$/i;

class AgentActivityService extends EventEmitter {
  #workers;
  #now;

  constructor(options = {}) {
    super();
    this.#workers = new Map();
    this.#now = typeof options.now === "function" ? options.now : Date.now;
  }

  getWorkerActivity(workerId) {
    if (!workerId) return null;
    const activity = this.#workers.get(workerId);
    if (!activity) {
      return {
        workerId,
        runId: null,
        isAgent: false,
        agentType: null,
        state: "idle",
        currentTool: null,
        lastTurnTokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
        lastTurnCost: 0,
        updatedAt: this.#now()
      };
    }
    return { ...activity };
  }

  listActivities() {
    return Array.from(this.#workers.values()).map(act => ({ ...act }));
  }

  setProcessState(workerId, runId, { command = "", processName = "" } = {}) {
    if (!workerId) return;
    const combined = `${command} ${processName}`.toLowerCase();
    let detectedType = null;
    if (combined.includes("claude")) detectedType = "claude";
    else if (combined.includes("codex")) detectedType = "codex";
    else if (combined.includes("gemini")) detectedType = "gemini";
    else if (combined.includes("opencode")) detectedType = "opencode";

    const prev = this.getWorkerActivity(workerId);
    const isAgent = Boolean(detectedType);
    const updated = {
      ...prev,
      workerId,
      runId: runId || prev.runId,
      isAgent,
      agentType: detectedType || prev.agentType,
      state: isAgent ? (prev.state === "idle" ? "idle" : prev.state) : "idle",
      updatedAt: this.#now()
    };
    this.#workers.set(workerId, updated);
    this.emit("change", updated);
  }

  recordOutput(workerId, runId, text, options = {}) {
    if (!workerId || !text) return;
    const raw = String(text);
    const clean = raw.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").trim();
    if (!clean) return;

    let current = this.getWorkerActivity(workerId);
    let isAgent = current.isAgent;
    let agentType = current.agentType;
    let state = current.state;
    let currentTool = current.currentTool;
    let lastTurnTokens = { ...current.lastTurnTokens };
    let lastTurnCost = current.lastTurnCost;
    let stateChanged = false;

    // Detect agent presence if not yet set
    if (!isAgent) {
      for (const pat of AGENT_PATTERNS) {
        if (pat.detectRegex.test(clean)) {
          isAgent = true;
          agentType = pat.type;
          state = "idle";
          stateChanged = true;
          break;
        }
      }
    } else if (AGENT_EXIT_PATTERN.test(clean)) {
      // Classification has to be reversible. A PowerShell terminal that ran
      // Claude is an AI agent while Claude is running and a shell again once it
      // exits — leaving it labelled an agent forever would put an ordinary
      // terminal in the AI agents folder permanently.
      isAgent = false;
      agentType = null;
      state = "idle";
      currentTool = null;
      stateChanged = true;
    }

    if (isAgent && agentType) {
      const pat = AGENT_PATTERNS.find(p => p.type === agentType) || AGENT_PATTERNS[0];

      if (pat.approvalRegex.test(clean)) {
        if (state !== "awaiting_approval") {
          state = "awaiting_approval";
          stateChanged = true;
          this.emit("awaiting_approval", {
            workerId,
            runId: runId || current.runId,
            agentType,
            promptSnippet: clean.slice(0, 140),
            timestamp: this.#now()
          });
        }
      } else if (pat.toolRegex.test(clean)) {
        const match = clean.match(pat.toolRegex);
        currentTool = match && match[1] ? match[1] : "tool";
        if (state !== "executing_tool") {
          state = "executing_tool";
          stateChanged = true;
        }
      } else if (pat.thinkingRegex.test(clean)) {
        if (state !== "thinking") {
          state = "thinking";
          stateChanged = true;
        }
      } else if (pat.turnCompleteRegex.test(clean)) {
        state = "idle";
        currentTool = null;
        stateChanged = true;
        this.emit("turn_completed", {
          workerId,
          runId: runId || current.runId,
          agentType,
          tokens: lastTurnTokens,
          cost: lastTurnCost,
          timestamp: this.#now()
        });
      }

      // Check token / cost updates
      const tokenMatch = clean.match(/(?:tokens?:\s*([0-9,]+)|usage:\s*([0-9,]+)\s*tokens|total tokens:\s*([0-9,]+))/i);
      if (tokenMatch) {
        const rawTokens = tokenMatch[1] || tokenMatch[2] || tokenMatch[3];
        if (rawTokens) {
          lastTurnTokens.totalTokens = parseInt(rawTokens.replace(/,/g, ""), 10) || 0;
          stateChanged = true;
        }
      }
      const costMatch = clean.match(/(?:cost:\s*\$([0-9.]+)|session cost:\s*\$([0-9.]+)|estimated cost:\s*\$([0-9.]+))/i);
      if (costMatch) {
        const rawCost = costMatch[1] || costMatch[2] || costMatch[3];
        if (rawCost) {
          lastTurnCost = parseFloat(rawCost) || 0;
          stateChanged = true;
        }
      }
    }

    const updated = {
      workerId,
      runId: runId || current.runId,
      isAgent,
      agentType,
      state,
      currentTool,
      lastTurnTokens,
      lastTurnCost,
      updatedAt: this.#now()
    };
    this.#workers.set(workerId, updated);

    if (stateChanged) {
      this.emit("change", updated);
    }
  }

  // A permission prompt found by the prompt detector, which reads the whole
  // screen rather than one line, so it sees dialogs the per-line patterns miss.
  setAwaitingApproval(workerId, prompt = null) {
    if (!workerId) return;
    const current = this.getWorkerActivity(workerId);
    const waiting = Boolean(prompt);
    if (waiting && current.state === "awaiting_approval") return;
    if (!waiting && current.state !== "awaiting_approval") return;
    const updated = {
      ...current,
      isAgent: waiting ? true : current.isAgent,
      agentType: current.agentType || (waiting && prompt.agent && prompt.agent !== "agent" ? prompt.agent : current.agentType),
      state: waiting ? "awaiting_approval" : "idle",
      updatedAt: this.#now()
    };
    this.#workers.set(workerId, updated);
    this.emit("change", updated);
  }

  clearWorker(workerId) {
    if (this.#workers.has(workerId)) {
      this.#workers.delete(workerId);
      this.emit("removed", { workerId });
    }
  }

  reset() {
    this.#workers.clear();
  }
}

module.exports = { AgentActivityService, AGENT_PATTERNS };
