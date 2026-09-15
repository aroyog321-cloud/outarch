"use strict";

// Harness fixtures for the assistant: Mission AI's built-in Gemini keys plus
// two keys the operator brought, and conversations in the two states every
// chat surface has to draw well — an answer with its working shown, and an
// action waiting for approval.

module.exports = function aiFixtures({ now, MINUTE }) {
  const describe = (id, label, family, tier) => ({ id, label, family, tier });
  // What Mission AI offers on its built-in keys: the two newest stable Flash
  // models and the newest Flash-Lite.
  const gemini = [
    describe("gemini-3.8-flash", "Gemini 3.8 Flash", "gemini", "balanced"),
    describe("gemini-3.7-flash", "Gemini 3.7 Flash", "gemini", "balanced"),
    describe("gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite", "gemini", "fast")
  ];
  const nvidia = [
    { ...describe("meta/llama-3.3-70b-instruct", "Llama 3.3 70B Instruct", "llama", "capable"), verified: true },
    describe("nvidia/llama-3.3-nemotron-super-49b-v1.5", "Llama 3.3 Nemotron Super 49B v1.5", "nvidia", "balanced"),
    describe("deepseek-ai/deepseek-r1", "Deepseek R1", "deepseek", "balanced"),
    describe("qwen/qwen3-coder-480b-a35b-instruct", "Qwen3 Coder 480B A35B Instruct", "qwen", "capable"),
    describe("mistralai/mistral-medium-3-instruct", "Mistral Medium 3 Instruct", "mistral", "balanced"),
    describe("google/gemma-3-27b-it", "Gemma 3 27B IT", "gemma", "fast"),
    describe("moonshotai/kimi-k2-instruct", "Kimi K2 Instruct", "kimi", "balanced")
  ];
  const openai = [
    describe("gpt-5", "GPT-5", "gpt", "capable"),
    describe("gpt-5-mini", "GPT-5 mini", "gpt", "fast"),
    describe("gpt-4.1", "GPT-4.1", "gpt", "balanced")
  ];
  const anthropic = [
    describe("claude-sonnet-4-5", "Claude Sonnet 4.5", "claude", "balanced"),
    describe("claude-opus-4-1", "Claude Opus 4.1", "claude", "capable"),
    describe("claude-3-5-haiku", "Claude 3.5 Haiku", "claude", "fast")
  ];
  const selection = { source: "mission", keyId: null, keyLabel: "Mission AI", provider: "gemini", model: "gemini-3.8-flash", label: "Gemini 3.8 Flash", family: "gemini", tier: "balanced" };
  const model = { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash", family: "gemini", source: "mission", keyLabel: "Mission AI" };
  const tick = "`";
  const fence = tick + tick + tick;

  return {
    "ai.status": () => ({
      mission: { available: true, keys: { primary: true, fallback: true }, models: gemini, modelsCheckedAt: now - 2 * MINUTE, modelsError: null, loadingModels: false },
      keys: [
        { id: "key-openai", label: "Work OpenAI", provider: "openai", baseUrl: null, hint: "8f2c", models: openai, modelsCheckedAt: now - 30 * MINUTE, lastError: null, createdAt: now - 3 * 24 * 60 * MINUTE },
        { id: "key-nvidia", label: "NVIDIA NIM", provider: "nvidia", baseUrl: null, hint: "Qr78", models: nvidia, defaultModel: "meta/llama-3.3-70b-instruct", modelsCheckedAt: now - MINUTE, lastError: null, createdAt: now - MINUTE },
        { id: "key-anthropic", label: "Anthropic", provider: "anthropic", baseUrl: null, hint: "k9Qa", models: anthropic, modelsCheckedAt: now - 5 * MINUTE, lastError: null, createdAt: now - 24 * 60 * MINUTE }
      ],
      keysError: null,
      keyProtection: true,
      providers: [
        { id: "gemini", label: "Google Gemini" }, { id: "openai", label: "OpenAI" }, { id: "anthropic", label: "Anthropic" },
        { id: "openrouter", label: "OpenRouter" }, { id: "nvidia", label: "NVIDIA NIM" }, { id: "groq", label: "Groq" }, { id: "xai", label: "xAI" },
        { id: "deepseek", label: "DeepSeek" }, { id: "mistral", label: "Mistral" }, { id: "together", label: "Together AI" },
        { id: "custom", label: "OpenAI-compatible", needsBaseUrl: true }
      ],
      selections: { missionAi: selection, workspace: selection }
    }),

    "ai.chat.history": params => {
      const id = String(params?.conversationId || "mission-ai");
      if (id.startsWith("workspace:")) {
        return {
          conversationId: id, surface: "workspace", busy: false, autoApprove: false, pending: null,
          messages: [
            { id: "w1", role: "user", text: "why is the API gateway not answering?", at: now - 2 * MINUTE },
            {
              id: "w2", role: "assistant", at: now - 2 * MINUTE, model, error: null,
              activity: [{ id: "a1", tool: "read_terminal_output", label: "Read API gateway output", state: "done" }],
              text: ["Port ", tick, "8080", tick, " is already taken, so **API gateway** exited on start.", "", "Stop whatever holds that port, then restart the gateway."].join("")
                .replace("start.Stop", "start.\n\nStop")
            }
          ]
        };
      }
      // AI_SCENARIO=empty shows the welcome; AI_SCENARIO=error a failed answer.
      if (process.env.AI_SCENARIO === "empty") return { conversationId: id, surface: "missionAi", busy: false, autoApprove: false, pending: null, messages: [] };
      if (process.env.AI_SCENARIO === "error") {
        return { conversationId: id, surface: "missionAi", busy: false, autoApprove: false, pending: null, messages: [
          { id: "e1", role: "user", text: "What is failing right now?", at: now - MINUTE },
          { id: "e2", role: "assistant", at: now - MINUTE, model, text: "", activity: [], error: "Mission AI's free-tier limit is used up on both built-in keys for now. Try again in a minute, or switch to one of your own keys in the model menu." }
        ] };
      }
      return {
        conversationId: id, surface: "missionAi", busy: false, autoApprove: false,
        pending: { messageId: "m4", actions: [{ id: "c1", tool: "type_in_terminal", title: "Type into Unit tests (watch)", detail: "npm test -- --runInBand billing  ⏎", code: true, risk: "high" }] },
        messages: [
          { id: "m1", role: "user", text: "Why did the test run fail?", at: now - 4 * MINUTE },
          {
            id: "m2", role: "assistant", at: now - 4 * MINUTE, model, error: null,
            activity: [
              { id: "t1", tool: "list_workers", label: "Checked the workers", state: "done" },
              { id: "t2", tool: "read_terminal_output", label: "Read Unit tests (watch) output", state: "done" }
            ],
            text: [
              "One test failed out of 85 in **Unit tests (watch)**:",
              "",
              "- " + tick + "billing/invoice.test.ts" + tick + " — *rounds tax to two decimals* expected " + tick + "12.35" + tick + " but got " + tick + "12.349999" + tick,
              "",
              "The tax is multiplied in floating point before it is rounded. Work in cents instead:",
              "",
              fence + "ts",
              "const taxCents = Math.round(subtotalCents * rate);",
              fence,
              "",
              "Everything else passed."
            ].join("\n")
          },
          { id: "m3", role: "user", text: "re-run just the billing tests", at: now - MINUTE },
          {
            id: "m4", role: "assistant", at: now - MINUTE, model, error: null, text: "I'll run the billing suite on its own.",
            activity: [{ id: "c1", tool: "type_in_terminal", label: "Type into Unit tests (watch)", state: "waiting", detail: "npm test -- --runInBand billing", code: true }]
          }
        ]
      };
    },

    // The capability handshake the integration hub gates on. Every id the hub
    // and the diagnostics read, reported ready, so each section renders.
    "system.hello": () => ({
      protocolVersion: 1,
      capabilities: Object.fromEntries(["engine", "projects", "intelligence", "mission-supervisor", "vscode", "mcp", "automation", "companion", "extensions", "notifications", "services", "usage", "assistant"].map(id => [id, { id, support: "supported", state: "ready", methods: [], checkedAt: now }]))
    }),
    "ai.byok.detect": params => ({ candidates: require("../../src/service/aiProviders.cjs").detectProviderCandidates(params?.apiKey).map(id => ({ id, label: require("../../src/service/aiProviders.cjs").PROVIDERS[id].label })) }),
    "ai.chat.send": params => ({ conversationId: params?.conversationId, busy: false, autoApprove: false, pending: null, messages: [] })
  };
};
