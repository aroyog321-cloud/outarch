"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  GEMINI_INTERACTIONS_ENDPOINT,
  MissionAIService,
  PLAN_SYSTEM_INSTRUCTION,
  SYSTEM_INSTRUCTION,
  questionText,
  responseText
} = require("../src/service/missionAi.cjs");

function credentialStore(overrides = {}) {
  return {
    status: () => ({ configured: true, model: "gemini-2.5-flash", includeTerminalEvidence: false, available: true }),
    preferences: () => ({ model: "gemini-2.5-flash", includeTerminalEvidence: true }),
    apiKey: () => "AIzaSyExampleMissionControlKey123456789",
    configure: value => ({ configured: true, model: value.model || "gemini-2.5-flash", includeTerminalEvidence: value.includeTerminalEvidence === true }),
    clear: () => true,
    ...overrides
  };
}

function missionContext(calls) {
  return {
    snapshot: options => {
      calls.push(options);
      return {
        contextVersion: 1,
        generatedAt: 100,
        project: { name: "Test", workerCount: 2 },
        visibility: { terminalOutput: options.includeOutput ? "sanitized-bounded" : "omitted" },
        privacy: { redactionCount: 3 },
        workers: [{ id: "api", state: "failed" }]
      };
    }
  };
}

test("Mission AI sends one stateless observe-only Gemini request grounded in Mission Context", async () => {
  const contextCalls = [];
  const fetchCalls = [];
  const service = new MissionAIService({
    credentialStore: credentialStore(),
    missionContext: missionContext(contextCalls),
    now: () => 200,
    fetch: async (url, options) => {
      fetchCalls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Backend failed from recorded lifecycle evidence." }] } }]
        })
      };
    }
  });

  const result = await service.ask({ question: "What is broken? token=do-not-send" });
  assert.equal(result.text, "Backend failed from recorded lifecycle evidence.");
  assert.equal(result.authority, "observe");
  assert.equal(result.grounded, true);
  assert.equal(result.context.terminalEvidence, "sanitized-bounded");
  assert.deepEqual(contextCalls, [{ afterSequence: 0, includeOutput: true }]);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent");
  assert.equal(fetchCalls[0].options.headers["x-goog-api-key"], "AIzaSyExampleMissionControlKey123456789");
  const body = JSON.parse(fetchCalls[0].options.body);
  assert.equal(body.systemInstruction.parts[0].text, SYSTEM_INSTRUCTION);
  assert.equal(body.contents[0].parts[0].text.includes("do-not-send"), false);
  assert.equal(fetchCalls[0].options.body.includes("AIzaSyExampleMissionControlKey"), false);
});

test("Mission AI bounds questions and extracts only model text", () => {
  assert.equal(questionText("  What changed?  "), "What changed?");
  assert.throws(() => questionText(""), /cannot be empty/);
  assert.throws(() => questionText("x".repeat(1201)), /cannot exceed/);
  assert.equal(responseText({
    candidates: [
      { content: { parts: [{ text: "Grounded answer" }] } }
    ]
  }), "Grounded answer");
});

test("Mission AI validates evidence citations and returns estimate ranges with uncertainty", async () => {
  let sent;
  const service = new MissionAIService({
    credentialStore: credentialStore(),
    missionContext: missionContext([]),
    projectSupervision: { snapshot: options => ({ supervisionVersion: 1, contextVersion: 1, generatedAt: 100, project: { workerCount: 1 }, overview: {}, facts: {}, inferences: [], evidenceIndex: [{ id: "worker:api", kind: "fact", source: "EngineAPI", label: "API running" }], visibility: { terminalEvidence: options.includeOutput ? "sanitized-bounded" : "omitted" }, privacy: { redactionCount: 0 } }) },
    fetch: async (_url, options) => {
      sent = JSON.parse(options.body);
      const answerPayload = JSON.stringify({
        answer: "The remaining work may take 4–8 hours.",
        citations: ["worker:api", "worker:invented"],
        estimate: {
          minimumHours: 4,
          maximumHours: 8,
          confidence: "low",
          assumptions: ["Scope remains stable"],
          missingEvidence: ["No comparable completed run"]
        }
      });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: answerPayload }]
            }
          }]
        })
      };
    }
  });
  const result = await service.ask({ question: "How long may this take?" });
  assert.deepEqual(result.citations, ["worker:api"]);
  assert.deepEqual(result.estimate, { minimumHours: 4, maximumHours: 8, confidence: "low", assumptions: ["Scope remains stable"], missingEvidence: ["No comparable completed run"] });
  assert.equal(result.structured, true);
  const promptText = sent.contents[0].parts[0].text;
  assert.match(promptText, /projectSupervision/);
  assert.equal(promptText.includes("worker:invented"), false);
});

test("Mission AI discards unsolicited estimate data for a non-time question", async () => {
  const service = new MissionAIService({
    credentialStore: credentialStore(),
    missionContext: missionContext([]),
    fetch: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                answer: "The API is running.",
                citations: [],
                estimate: {
                  minimumHours: 1,
                  maximumHours: 2,
                  confidence: "high",
                  assumptions: [],
                  missingEvidence: []
                }
              })
            }]
          }
        }]
      })
    })
  });
  const result = await service.ask({ question: "What is happening?" });
  assert.equal(result.estimate, null);
});

test("Mission AI redacts a bare Gemini API key from the question", async () => {
  let sent;
  const service = new MissionAIService({
    credentialStore: credentialStore(),
    missionContext: missionContext([]),
    fetch: async (_url, options) => {
      sent = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: "Redacted." }] } }] })
      };
    }
  });
  const key = "AIzaSyExampleMissionControlKey123456789";
  await service.ask({ question: `Check ${key} without revealing it` });
  const promptText = sent.contents[0].parts[0].text;
  assert.equal(promptText.includes(key), false);
  assert.match(promptText, /\[REDACTED:token\]/);
});

test("Mission AI exposes safe provider errors and serializes concurrent questions", async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const service = new MissionAIService({
    credentialStore: credentialStore(),
    missionContext: missionContext([]),
    fetch: async () => {
      await pending;
      return { ok: false, status: 429, headers: { get: () => null }, text: async () => JSON.stringify({ error: { message: "quota token=private-value" } }) };
    }
  });
  const first = service.ask({ question: "Summarize" });
  await assert.rejects(() => service.ask({ question: "Try again" }), /already answering/);
  release();
  await assert.rejects(first, /quota token=\[REDACTED\]/);
  assert.equal(service.status().busy, false);
  assert.equal(service.status().lastError.includes("private-value"), false);
});

test("Mission AI configuration and clear never return credentials", () => {
  const service = new MissionAIService({ credentialStore: credentialStore(), missionContext: missionContext([]), fetch: async () => {} });
  const configured = service.configure({ apiKey: "AIzaSyExampleMissionControlKey123456789", includeTerminalEvidence: false });
  assert.equal(JSON.stringify(configured).includes("AIza"), false);
  assert.equal(service.clear().removed, true);
});

test("Mission AI automatically fails over to secondary key when primary returns 429 quota exhausted", async () => {
  const primaryKey = "AIzaSyPrimaryFailKey123456789012345";
  const secondaryKey = "AIzaSySecondaryPassKey9876543210123";
  const attempts = [];

  const store = {
    status: () => ({ configured: true, model: "gemini-2.5-flash", includeTerminalEvidence: false, available: true, keyState: { primary: { configured: true }, secondary: { configured: true } }, activeSlot: "primary" }),
    preferences: () => ({ model: "gemini-2.5-flash", includeTerminalEvidence: false }),
    apiKey: (slot = "primary") => slot === "secondary" ? secondaryKey : primaryKey,
    getSlotApiKey: slot => ({ slot, apiKey: slot === "secondary" ? secondaryKey : primaryKey }),
    configure: () => {},
    clear: () => true
  };

  const service = new MissionAIService({
    credentialStore: store,
    missionContext: missionContext([]),
    fetch: async (_url, options) => {
      const usedKey = options.headers["x-goog-api-key"];
      attempts.push(usedKey);
      if (usedKey === primaryKey) {
        return {
          ok: false,
          status: 429,
          headers: { get: () => null },
          text: async () => JSON.stringify({ error: { code: 429, message: "RESOURCE_EXHAUSTED: quota exceeded" } })
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Answered via failover secondary key." }] } }]
        })
      };
    }
  });

  const result = await service.ask({ question: "Will failover work?" });
  assert.equal(result.text, "Answered via failover secondary key.");
  assert.deepEqual(attempts, [primaryKey, secondaryKey]);
  assert.equal(service.status().activeSlot, "secondary");
});

test("Mission AI produces JSON-only proposal plans without execution authority", async () => {
  const contextCalls = [];
  let requestBody;
  const service = new MissionAIService({
    credentialStore: credentialStore(),
    missionContext: missionContext(contextCalls),
    now: () => 300,
    fetch: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => JSON.stringify({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify({
                  summary: "Create a backend worker",
                  assumptions: ["npm script exists"],
                  actions: [{ type: "create-worker", id: "backend", command: "npm", args: ["run", "dev"], reason: "Requested workspace role" }]
                })
              }]
            }
          }]
        })
      };
    }
  });

  const result = await service.plan({ instruction: "Create a backend worker" });
  assert.equal(result.authority, "proposal-only");
  assert.equal(result.plan.actions[0].type, "create-worker");
  assert.equal(requestBody.systemInstruction.parts[0].text, PLAN_SYSTEM_INSTRUCTION);
  assert.deepEqual(contextCalls, [{ afterSequence: 0, includeOutput: true }]);
});
