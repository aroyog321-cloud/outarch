"use strict";

const { EventEmitter } = require("node:events");
const crypto = require("node:crypto");

const MAX_CONVERSATION_MESSAGES = 50;

// One turn can cost several network attempts (a retry, or a fallback key). The
// summary adds up only what the provider reported and says so when nothing was.
function summarizeTurnUsage(records) {
  const tokens = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let cost = null;
  let reported = false;
  let unreportedAttempts = 0;

  for (const record of records) {
    const input = record?.tokens?.input;
    const output = record?.tokens?.output;
    const reasoning = record?.tokens?.reasoning;
    const hasCounts = [input, output, reasoning].some(value => typeof value === "number");
    if (!hasCounts) {
      unreportedAttempts += 1;
      continue;
    }
    reported = true;
    tokens.inputTokens += input ?? 0;
    tokens.outputTokens += (output ?? 0) + (reasoning ?? 0);
    if (typeof record?.cost?.amount === "number") cost = (cost ?? 0) + record.cost.amount;
  }
  tokens.totalTokens = tokens.inputTokens + tokens.outputTokens;

  return {
    tokens,
    cost,
    attempts: records.length,
    unreportedAttempts,
    // "unknown" is a real answer here, and a truer one than a zero.
    coverage: records.length === 0 ? "unavailable" : reported && !unreportedAttempts ? "complete" : reported ? "partial" : "unknown"
  };
}

// A request for work starts with the verb. Matching the verb anywhere sent
// ordinary questions — "why did the build fail?", "how do I fix this?" — to the
// planner, which answered them with an action plan nobody asked for.
const AUTO_PLAN_REGEX = /^\s*(?:please\s+|can you\s+|could you\s+)?(?:create|build|start|restart|stop|deploy|install|set\s*up|run|execute|launch|add|make)\b/i;

function wantsPlan(text) {
  return AUTO_PLAN_REGEX.test(text) && !/\?\s*$/.test(text);
}

class MissionAIConversation extends EventEmitter {
  #missionAi;
  #missionSupervisor;
  #threads;
  #now;

  constructor(options = {}) {
    super();
    this.#missionAi = options.missionAi || null;
    this.#missionSupervisor = options.missionSupervisor || null;
    this.#threads = new Map();
    this.#now = typeof options.now === "function" ? options.now : Date.now;
  }

  getHistory(conversationId = "default") {
    const thread = this.#threads.get(conversationId);
    return thread ? thread.map(msg => ({ ...msg, citations: [...(msg.citations || [])] })) : [];
  }

  clearHistory(conversationId = "default") {
    const deleted = this.#threads.delete(conversationId);
    this.emit("clear", { conversationId });
    return Boolean(deleted);
  }

  async send({ text, mode = "auto", conversationId = "default", projectId = null, afterSequence = 0 } = {}) {
    if (typeof text !== "string" || !text.trim()) {
      throw new TypeError("Message text is required");
    }
    const cleanText = text.trim();
    const resolvedMode = (mode === "auto" && wantsPlan(cleanText)) ? "plan" : (mode === "auto" ? "ask" : mode);

    const userMsg = {
      id: `msg-user-${crypto.randomUUID().slice(0, 8)}`,
      role: "user",
      mode: resolvedMode,
      text: cleanText,
      timestamp: this.#now()
    };

    let thread = this.#threads.get(conversationId);
    if (!thread) {
      thread = [];
      this.#threads.set(conversationId, thread);
    }
    thread.push(userMsg);

    let assistantMsg = {
      id: `msg-asst-${crypto.randomUUID().slice(0, 8)}`,
      role: "assistant",
      mode: resolvedMode,
      text: "",
      citations: [],
      estimate: null,
      plan: null,
      tokens: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      cost: 0,
      timestamp: this.#now()
    };

    // Mission AI reports what the provider actually charged for. Watching that
    // channel for the duration of the turn is the only honest way to attach a
    // number here: the alternative — dividing the text length by four — is a
    // guess that would be displayed as if it were metering.
    const turnUsage = [];
    let stopWatchingUsage = () => {};
    if (this.#missionAi && typeof this.#missionAi.onUsage === "function") {
      stopWatchingUsage = this.#missionAi.onUsage(record => turnUsage.push(record));
    }

    try {
      if (resolvedMode === "plan" && this.#missionSupervisor && typeof this.#missionSupervisor.propose === "function") {
        const planResult = await this.#missionSupervisor.propose({ instruction: cleanText, afterSequence });
        assistantMsg.text = planResult.summary || planResult.plan?.summary || "Here is the proposed operational plan:";
        assistantMsg.plan = planResult.plan || planResult;
        assistantMsg.citations = planResult.citations || ["supervision:overview"];
      } else if (this.#missionAi && typeof this.#missionAi.ask === "function") {
        const askResult = await this.#missionAi.ask({ question: cleanText, afterSequence });
        // MissionAIService.ask() returns the reply as `text`. Reading `answer`
        // alone rendered every real reply empty; the older field is still
        // accepted for callers that return it.
        assistantMsg.text = askResult.text || askResult.answer || "";
        assistantMsg.citations = askResult.citations || [];
        assistantMsg.estimate = askResult.estimate || null;
      } else {
        assistantMsg.text = "Mission AI service is not available on this connection.";
      }

      assistantMsg.usage = summarizeTurnUsage(turnUsage);
      assistantMsg.tokens = assistantMsg.usage.tokens;
      assistantMsg.cost = assistantMsg.usage.cost;
    } catch (error) {
      assistantMsg.text = `Error from Mission AI: ${error.message}`;
      assistantMsg.error = error.message;
      assistantMsg.usage = summarizeTurnUsage(turnUsage);
      assistantMsg.tokens = assistantMsg.usage.tokens;
      assistantMsg.cost = assistantMsg.usage.cost;
    } finally {
      stopWatchingUsage();
    }

    thread.push(assistantMsg);
    if (thread.length > MAX_CONVERSATION_MESSAGES) {
      thread.splice(0, thread.length - MAX_CONVERSATION_MESSAGES);
    }

    this.emit("message", { conversationId, user: userMsg, assistant: assistantMsg });
    return {
      message: assistantMsg,
      history: this.getHistory(conversationId)
    };
  }
}

module.exports = { MissionAIConversation, MAX_CONVERSATION_MESSAGES };
