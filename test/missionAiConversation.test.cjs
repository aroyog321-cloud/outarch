"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { MissionAIConversation } = require("../src/service/missionAiConversation.cjs");

// Mission AI publishes one usage record per real network attempt. The mock
// reports the same shape the Gemini adapter does.
function createMockAi(usagePerCall = { input: 120, output: 40 }) {
  const observers = new Set();
  return {
    onUsage(observer) {
      observers.add(observer);
      return () => observers.delete(observer);
    },
    ask: async ({ question }) => {
      for (const observer of observers) {
        observer({
          provider: "gemini",
          model: "gemini-2.5-flash",
          outcome: "success",
          tokens: { input: usagePerCall.input, output: usagePerCall.output, cacheRead: 0, cacheWrite: null, reasoning: 0 },
          cost: { amount: 0.000021, currency: "USD", basis: "estimated-api" }
        });
      }
      return { answer: `Answer to: ${question}`, citations: ["supervision:overview"], estimate: null };
    }
  };
}

test("MissionAIConversation handles ask, plan, and auto routing with usage tracking", async () => {
  const mockAi = createMockAi();
  const mockSupervisor = {
    propose: async ({ instruction }) => ({
      summary: `Plan for: ${instruction}`,
      plan: { actions: [{ type: "create-worker", name: "api" }] }
    })
  };

  const convo = new MissionAIConversation({
    missionAi: mockAi,
    missionSupervisor: mockSupervisor
  });

  // Auto routing to "ask"
  const res1 = await convo.send({ text: "What is running currently?" });
  assert.equal(res1.message.role, "assistant");
  assert.equal(res1.message.mode, "ask");
  assert.match(res1.message.text, /Answer to: What is running/);
  // The counts come from what the provider reported, not from the text length.
  assert.equal(res1.message.tokens.inputTokens, 120);
  assert.equal(res1.message.tokens.outputTokens, 40);
  assert.equal(res1.message.usage.coverage, "complete");
  assert.equal(res1.message.cost, 0.000021);

  // Auto routing to "plan"
  const res2 = await convo.send({ text: "Create a new worker for backend tests" });
  assert.equal(res2.message.role, "assistant");
  assert.equal(res2.message.mode, "plan");
  assert.match(res2.message.text, /Plan for: Create a new worker/);
  assert.ok(res2.message.plan);

  // History check
  const history = convo.getHistory("default");
  assert.equal(history.length, 4); // 2 user + 2 asst

  // The plan turn went through the supervisor, which reports no usage of its
  // own, so this turn says so rather than inventing a number for it.
  assert.equal(res2.message.usage.coverage, "unavailable");
  assert.equal(res2.message.cost, null);
});

test("a turn whose provider reported no counts is marked unknown, not free", async () => {
  const mockAi = {
    onUsage(observer) {
      // One attempt happened; the provider returned no usage metadata for it.
      this._emit = () => observer({ provider: "gemini", outcome: "failed", tokens: {} });
      return () => { this._emit = null; };
    },
    ask: async () => {
      mockAi._emit?.();
      return { answer: "partial answer", citations: [] };
    }
  };

  const convo = new MissionAIConversation({ missionAi: mockAi });
  const res = await convo.send({ text: "What is running currently?" });

  assert.equal(res.message.usage.coverage, "unknown");
  assert.equal(res.message.usage.attempts, 1);
  assert.equal(res.message.cost, null, "an unmeasured turn must not be displayed as costing zero");
  assert.equal(res.message.tokens.totalTokens, 0);
});

test("retries and key fallbacks within one turn are summed, not counted once", async () => {
  const mockAi = {
    onUsage(observer) {
      mockAi._observer = observer;
      return () => { mockAi._observer = null; };
    },
    ask: async () => {
      // First key exhausted, second succeeded: two real network attempts.
      mockAi._observer?.({ outcome: "failed", tokens: {} });
      mockAi._observer?.({
        outcome: "success",
        tokens: { input: 200, output: 60, reasoning: 15 },
        cost: { amount: 0.00004, currency: "USD" }
      });
      return { answer: "done", citations: [] };
    }
  };

  const convo = new MissionAIConversation({ missionAi: mockAi });
  const res = await convo.send({ text: "What is running currently?" });

  assert.equal(res.message.usage.attempts, 2);
  assert.equal(res.message.usage.unreportedAttempts, 1);
  assert.equal(res.message.tokens.inputTokens, 200);
  assert.equal(res.message.tokens.outputTokens, 75, "reasoning tokens count toward output");
  assert.equal(res.message.usage.coverage, "partial");
});
