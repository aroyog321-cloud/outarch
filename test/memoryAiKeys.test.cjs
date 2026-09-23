"use strict";

// Project memory's own AI keys (2026-09-23): arch_memory.md is written with
// keys kept apart from Mission AI's. On the server every built-in key has a
// purpose, the ai-proxy serves a memory turn only from memory keys, and the app
// offers project memory only the built-in models its own keys can serve.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { test } = require("node:test");
const { AiAssistant } = require("../src/service/aiAssistant.cjs");
const { BuiltinMissionAiCredentials } = require("../src/service/missionAiBuiltinKeys.cjs");
const { MANAGED_KEY_PLACEHOLDER } = require("../src/service/managedAiTransport.cjs");

const root = path.resolve(__dirname, "..");

function engine() {
  return { getWorkspace: () => ({ name: "acme", directory: "D:/acme" }), list: () => [], getSnapshot: () => null, listAttention: () => [], listRecipes: () => [] };
}

function managedAssistant({ mission = ["gemini", "nvidia"], memory = ["gemini"] } = {}) {
  const turns = [];
  const builtin = new BuiltinMissionAiCredentials({ managed: { providers: () => mission, memoryProviders: () => memory } });
  const missionFetch = async (url, init, turn) => {
    turns.push({ url: String(url), surface: turn?.surface || null, key: init.headers?.["x-goog-api-key"] || null });
    const body = { candidates: [{ content: { parts: [{ text: JSON.stringify({ changed: "Wrote the note.", why: "Asked." }) }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) };
  };
  const ai = new AiAssistant({ builtin, missionFetch, getEngineApi: () => engine(), fetch: async () => { throw new Error("no direct provider calls"); }, settleMs: 0 });
  return { ai, builtin, turns };
}

test("the credential layer answers per purpose: memory keys are their own pool", () => {
  const builtin = new BuiltinMissionAiCredentials({ managed: { providers: () => ["gemini", "nvidia"], memoryProviders: () => ["nvidia"] } });
  assert.equal(builtin.separateMemoryKeys(), true);
  assert.equal(builtin.hasKey("primary", "gemini"), true, "Mission AI is unchanged");
  assert.equal(builtin.hasKey("primary", "gemini", "memory"), false, "a Mission AI key never serves project memory");
  assert.equal(builtin.hasKey("primary", "nvidia", "memory"), true);
  assert.equal(builtin.apiKey("primary", "nvidia", "memory"), MANAGED_KEY_PLACEHOLDER);
  assert.throws(() => builtin.apiKey("primary", "gemini", "memory"), /Project memory's AI keys are not available/);

  // A server that has not reported memory keys (an older one) has none.
  const older = new BuiltinMissionAiCredentials({ managed: { providers: () => ["gemini"] } });
  assert.equal(older.hasKey("primary", "gemini", "memory"), false);

  // A development build's own keys serve both purposes; nothing is kept apart.
  const local = new BuiltinMissionAiCredentials({ keys: { primary: "AIzaPRIMARYkey000000000000000000000" } });
  assert.equal(local.separateMemoryKeys(), false);
  assert.equal(local.hasKey("primary", "gemini", "memory"), true);
});

test("project memory is offered only the built-in models its own keys can serve", () => {
  const { ai } = managedAssistant({ mission: ["gemini", "nvidia"], memory: ["gemini"] });
  const status = ai.status();
  assert.equal(status.mission.memory.separateKeys, true);
  assert.equal(status.mission.memory.available, true);
  assert.ok(status.mission.memory.models.length > 0);
  assert.ok(status.mission.memory.models.every(model => !model.id.includes("/")), "only Gemini models: memory has no NVIDIA key");
  assert.ok(status.mission.models.some(model => model.id.includes("/")), "Mission AI still has its NVIDIA models");
  assert.equal(status.selections.memory.provider, "gemini");

  const nvidia = status.mission.models.find(model => model.id.includes("/"));
  assert.throws(() => ai.setSelection("memory", { source: "mission", model: nvidia.id }), /Project memory has no AI key for that model/);
  ai.setSelection("missionAi", { source: "mission", model: nvidia.id });
  assert.equal(ai.status().selections.missionAi.model, nvidia.id, "chats can still use it");
});

test("a memory key for a provider Mission AI has no key for still gives memory its models", () => {
  const { ai } = managedAssistant({ mission: ["gemini"], memory: ["nvidia"] });
  const status = ai.status();
  assert.ok(status.mission.memory.models.length > 0);
  assert.ok(status.mission.memory.models.every(model => model.id.includes("/")));
  assert.equal(status.selections.memory.provider, "nvidia");
  assert.ok(status.mission.models.every(model => !model.id.includes("/")), "and chats still see only their own");
});

test("with no memory key, project memory has no built-in model, and chats are untouched", () => {
  const { ai } = managedAssistant({ mission: ["gemini", "nvidia"], memory: [] });
  const status = ai.status();
  assert.equal(status.mission.memory.available, false);
  assert.deepEqual(status.mission.memory.models, []);
  assert.equal(status.selections.memory, null, "the close dialog and Settings show their no-model state");
  assert.ok(status.selections.missionAi, "Mission AI still answers");
});

test("writing arch_memory.md opens a memory turn, which the server serves from memory keys", async () => {
  const { ai, turns } = managedAssistant({ mission: ["gemini"], memory: ["gemini"] });
  const answer = await ai.compose({ surface: "memory", system: "Write one entry.", text: "What changed?" });
  assert.match(answer.text, /Wrote the note/);
  const call = turns.find(item => item.url.includes(":generateContent"));
  assert.ok(call, "a model call was made");
  assert.equal(call.surface, "memory", "the turn is begun for memory, so the proxy picks memory keys");
  assert.equal(call.key, MANAGED_KEY_PLACEHOLDER, "no real key is in the app");
});

test("the ai-proxy serves a memory turn only from memory keys, and still works against the old database", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-proxy-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(root, "supabase", "functions", "ai-proxy", "index.ts"), "utf8")
    .replace(`import { createClient } from "npm:@supabase/supabase-js@2";`, "const createClient = (...args) => globalThis.__outarchCreateClient(...args);");
  assert.ok(source.includes("globalThis.__outarchCreateClient"), "the proxy imports its client the way this test expects");
  const tsFile = path.join(directory, "proxy.ts");
  const jsFile = path.join(directory, "proxy.mjs");
  fs.writeFileSync(tsFile, source);
  execFileSync(process.execPath, [path.join(root, "node_modules", "esbuild", "bin", "esbuild"), tsFile, "--format=esm", `--outfile=${jsFile}`, "--log-level=warning"]);

  const saved = { Deno: globalThis.Deno, fetch: globalThis.fetch, client: globalThis.__outarchCreateClient };
  t.after(() => {
    globalThis.Deno = saved.Deno;
    globalThis.fetch = saved.fetch;
    globalThis.__outarchCreateClient = saved.client;
  });
  let handler = null;
  let db = null;
  const upstream = [];
  globalThis.Deno = { serve: fn => { handler = fn; }, env: { get: name => ({ SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service" })[name] } };
  globalThis.__outarchCreateClient = () => ({
    auth: { getUser: async token => (token === "jwt" ? { data: { user: { id: "u1" } }, error: null } : { data: null, error: { message: "bad" } }) },
    rpc: async (name, args) => db(name, args)
  });
  globalThis.fetch = async (url, init) => {
    upstream.push({ url, key: init.headers["x-goog-api-key"] });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await import(pathToFileURL(jsFile).href);
  assert.equal(typeof handler, "function");

  const MEMORY_TURN = "11111111-1111-4111-8111-111111111111";
  const CHAT_TURN = "22222222-2222-4222-8222-222222222222";
  const KEYS = { mission: [{ id: "m1", api_key: "MISSION-KEY-0000000000000" }], memory: [{ id: "k1", api_key: "MEMORY-KEY-00000000000000" }] };
  const migrated = ({ memoryKeys = true } = {}) => async (name, args) => {
    if (name === "claim_ai_turn") return { data: { [MEMORY_TURN]: "memory", [CHAT_TURN]: "missionAi" }[args.p_turn] ?? null, error: null };
    if (name === "next_ai_keys") return { data: args.p_purpose === "memory" && !memoryKeys ? [] : KEYS[args.p_purpose] || [], error: null };
    if (name === "report_ai_key_result") return { data: null, error: null };
    return { data: null, error: { code: "PGRST202", message: "missing" } };
  };
  const before = async (name, args) => {
    if (name === "claim_ai_turn") return { data: null, error: { code: "PGRST202", message: "missing" } };
    if (name === "claim_ai_turn_call") return { data: true, error: null };
    if (name === "next_ai_keys") return "p_purpose" in args ? { data: null, error: { code: "PGRST202", message: "missing" } } : { data: KEYS.mission, error: null };
    if (name === "report_ai_key_result") return { data: null, error: null };
    return { data: null, error: { code: "PGRST202", message: "missing" } };
  };
  const send = (turn, { method = "POST", path: route = "/v1beta/models/gemini-2.5-flash:generateContent" } = {}) => handler(new Request("https://example/functions/v1/ai-proxy", {
    method: "POST",
    headers: { Authorization: "Bearer jwt", ...(turn ? { "x-outarch-turn": turn } : {}) },
    body: JSON.stringify({ provider: "gemini", method, path: route, body: {} })
  }));

  db = migrated();
  upstream.length = 0;
  assert.equal((await send(MEMORY_TURN)).status, 200);
  assert.equal(upstream[0].key, "MEMORY-KEY-00000000000000", "a memory turn uses a memory key");

  upstream.length = 0;
  assert.equal((await send(CHAT_TURN)).status, 200);
  assert.equal(upstream[0].key, "MISSION-KEY-0000000000000", "a chat uses a Mission AI key");

  upstream.length = 0;
  assert.equal((await send(null, { method: "GET", path: "/v1beta/models" })).status, 200);
  assert.equal(upstream[0].key, "MISSION-KEY-0000000000000", "listing models never touches the memory keys");

  db = migrated({ memoryKeys: false });
  upstream.length = 0;
  const refused = await send(MEMORY_TURN);
  assert.equal(refused.status, 503);
  assert.equal(refused.headers.get("x-outarch-proxy-error"), "NO_MEMORY_KEYS");
  assert.equal(upstream.length, 0, "without a memory key no provider is called, not even with a Mission AI key");

  db = migrated();
  assert.equal((await send("33333333-3333-4333-8333-333333333333")).status, 409, "an unknown turn is refused");

  db = before;
  upstream.length = 0;
  assert.equal((await send(CHAT_TURN)).status, 200, "deployed before the migration, Mission AI keeps working");
  assert.equal(upstream[0].key, "MISSION-KEY-0000000000000");
});
