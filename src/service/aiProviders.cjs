"use strict";

// One adapter per wire protocol, not per company.
//
// Almost every model an operator can bring a key for speaks one of three
// dialects: Google's `generateContent`, OpenAI's `chat/completions` (which
// OpenRouter, Groq, xAI, DeepSeek, Mistral and Together all expose), or
// Anthropic's `messages`. The assistant loop talks to one normalized shape and
// these adapters translate it, so adding a provider is a catalog entry rather
// than a fourth code path.
//
// Keys never leave this module in any form: they go into a request header and
// nowhere else, and every error that could echo a request is scrubbed of the
// key before it is thrown.

const { redactText } = require("./contextSanitizer.cjs");

const REQUEST_TIMEOUT_MS = 60 * 1000;
const LIST_TIMEOUT_MS = 15 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
// Every model a key's listing returns is offered, so the cap only guards
// against a runaway listing; OpenRouter alone lists several hundred.
const MAX_MODELS = 400;
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_MAX_TOKENS = 4096;


const PROVIDERS = Object.freeze({
  gemini: { id: "gemini", label: "Google Gemini", style: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
  openai: { id: "openai", label: "OpenAI", style: "openai", baseUrl: "https://api.openai.com/v1" },
  anthropic: { id: "anthropic", label: "Anthropic", style: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
  openrouter: { id: "openrouter", label: "OpenRouter", style: "openai", baseUrl: "https://openrouter.ai/api/v1" },
  nvidia: { id: "nvidia", label: "NVIDIA NIM", style: "openai", baseUrl: "https://integrate.api.nvidia.com/v1" },
  groq: { id: "groq", label: "Groq", style: "openai", baseUrl: "https://api.groq.com/openai/v1" },
  xai: { id: "xai", label: "xAI", style: "openai", baseUrl: "https://api.x.ai/v1" },
  deepseek: { id: "deepseek", label: "DeepSeek", style: "openai", baseUrl: "https://api.deepseek.com/v1" },
  mistral: { id: "mistral", label: "Mistral", style: "openai", baseUrl: "https://api.mistral.ai/v1" },
  together: { id: "together", label: "Together AI", style: "openai", baseUrl: "https://api.together.xyz/v1" },
  cerebras: { id: "cerebras", label: "Cerebras", style: "openai", baseUrl: "https://api.cerebras.ai/v1" },
  fireworks: { id: "fireworks", label: "Fireworks AI", style: "openai", baseUrl: "https://api.fireworks.ai/inference/v1" },
  huggingface: { id: "huggingface", label: "Hugging Face", style: "openai", baseUrl: "https://router.huggingface.co/v1" },
  moonshot: { id: "moonshot", label: "Moonshot (Kimi)", style: "openai", baseUrl: "https://api.moonshot.ai/v1" },
  qwen: { id: "qwen", label: "Alibaba Qwen", style: "openai", baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  sambanova: { id: "sambanova", label: "SambaNova", style: "openai", baseUrl: "https://api.sambanova.ai/v1" },
  deepinfra: { id: "deepinfra", label: "DeepInfra", style: "openai", baseUrl: "https://api.deepinfra.com/v1/openai" },
  // Perplexity publishes no model listing, so its models are named here.
  perplexity: { id: "perplexity", label: "Perplexity", style: "openai", baseUrl: "https://api.perplexity.ai", staticModels: ["sonar-pro", "sonar", "sonar-reasoning-pro"] },
  custom: { id: "custom", label: "OpenAI-compatible", style: "openai", baseUrl: null }
});

// What a key's shape says about who issued it. Most providers stamp a prefix
// on their keys and are identified outright. A few shapes are shared — DeepSeek
// and Qwen both issue `sk-` plus 32 hex characters, Mistral and DeepInfra both
// issue 32 bare characters — so a shape maps to an ordered list, and adding a
// key asks each in turn until one accepts it. The list is only ever the
// providers whose keys look like this one: a key is never offered to a
// provider that could not have issued it.
const KEY_SHAPES = [
  [/^AIza[0-9A-Za-z_-]{20,}$/, ["gemini"]],
  [/^sk-ant-/, ["anthropic"]],
  [/^sk-or-/, ["openrouter"]],
  [/^nvapi-/, ["nvidia"]],
  [/^gsk_/, ["groq"]],
  [/^xai-/, ["xai"]],
  [/^pplx-/, ["perplexity"]],
  [/^csk[-_]/, ["cerebras"]],
  [/^fw_/, ["fireworks"]],
  [/^hf_/, ["huggingface"]],
  [/^tgp_/, ["together"]],
  [/^sk-(proj|svcacct|admin)-/, ["openai"]],
  [/^sk-[0-9a-f]{32}$/i, ["deepseek", "qwen"]],
  [/^sk-/, ["openai", "moonshot", "deepseek"]],
  [/^[0-9a-f]{64}$/i, ["together"]],
  [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ["sambanova"]],
  [/^[A-Za-z0-9]{32}$/i, ["mistral", "deepinfra"]]
];

function sanitizeApiKey(apiKey) {
  let key = String(apiKey || "").trim();
  // Strip surrounding quotes
  key = key.replace(/^["'`]|["'`]$/g, "").trim();
  // Strip leading 'Bearer ' prefix if pasted with header
  key = key.replace(/^bearer\s+/i, "").trim();
  // Strip zero-width spaces and control characters
  key = key.replace(/[\u200B-\u200D\uFEFF\u0000-\u001F]/g, "").trim();
  return key;
}

function detectProviderCandidates(apiKey) {
  const key = sanitizeApiKey(apiKey);
  for (const [shape, ids] of KEY_SHAPES) if (shape.test(key)) return [...ids];
  return [];
}

function detectProvider(apiKey) {
  return detectProviderCandidates(apiKey)[0] || null;
}

function providerSpec(provider, baseUrl = null) {
  const spec = PROVIDERS[provider];
  if (!spec) throw new TypeError(`Unsupported AI provider: ${provider}`);
  const base = spec.id === "custom" ? normalizeBaseUrl(baseUrl) : (baseUrl ? normalizeBaseUrl(baseUrl) : spec.baseUrl);
  if (!base) throw new TypeError("An OpenAI-compatible provider needs its base URL");
  return { ...spec, baseUrl: base };
}

function normalizeBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  let raw = value.trim().replace(/\/(chat\/completions|models|messages)\/?$/i, "").replace(/\/+$/, "");
  let url;
  try { url = new URL(raw); } catch { throw new TypeError("Base URL is not a valid URL"); }
  // A remote key sent over plain HTTP is a key sent to anyone on the path.
  // Loopback is the one exception, for locally hosted OpenAI-compatible servers.
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new TypeError("Base URL must use HTTPS (plain HTTP is allowed only for localhost)");
  }
  let pathname = url.pathname.replace(/\/+$/, "");
  if (loopback && (!pathname || pathname === "")) {
    pathname = "/v1";
  }
  url.pathname = pathname;
  return url.toString().replace(/\/+$/, "");
}

function scrub(message, apiKey) {
  let text = String(message || "");
  if (apiKey && apiKey.length >= 8) text = text.split(apiKey).join("[key]");
  return redactText(text, { maxLength: 400 }).value;
}

// ---------------------------------------------------------------- model naming

function modelFamily(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (id.includes("gemma")) return "gemma";
  if (id.includes("gemini")) return "gemini";
  if (id.includes("claude")) return "claude";
  if (/(^|\/)(gpt|o\d|chatgpt|codex)/.test(id) || id.startsWith("openai/")) return "gpt";
  if (id.includes("llama")) return "llama";
  if (id.includes("mistral") || id.includes("mixtral") || id.includes("codestral") || id.includes("magistral") || id.includes("ministral") || id.includes("devstral")) return "mistral";
  if (id.includes("deepseek")) return "deepseek";
  if (id.includes("grok")) return "grok";
  if (id.includes("qwen") || id.includes("qwq")) return "qwen";
  if (id.includes("kimi") || id.includes("moonshot")) return "kimi";
  if (id.includes("nemotron") || id.startsWith("nvidia/")) return "nvidia";
  if (id.includes("sonar")) return "perplexity";
  return "other";
}

const WORDS = { gpt: "GPT", o1: "o1", o3: "o3", o4: "o4", ai: "AI", xai: "xAI", qwq: "QwQ", vl: "VL", it: "IT" };

function titleWord(word) {
  const lower = word.toLowerCase();
  if (WORDS[lower]) return WORDS[lower];
  if (/^\d+(\.\d+)?b$/i.test(word)) return word.toUpperCase();
  if (/^\d/.test(word)) return word;
  if (/^[a-z]\d/i.test(word)) return word.toLowerCase();
  if (lower === "mini" || lower === "nano") return lower;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function prettyModelName(modelId, displayName = null) {
  if (typeof displayName === "string" && displayName.trim()) return displayName.trim().slice(0, 80);
  let id = String(modelId || "").replace(/^models\//, "");
  if (id.includes("/")) id = id.slice(id.lastIndexOf("/") + 1);
  // Anthropic dates its snapshots; the date is noise in a picker.
  id = id.replace(/-(\d{8}|latest)$/i, "");
  // claude-sonnet-4-5 reads as "Claude Sonnet 4.5".
  // A size such as "3.1-8b" must stay two words, so the join stops at a letter.
  id = id.replace(/(\d)-(\d)(?![\da-z])/gi, "$1.$2");
  if (/^gpt-/i.test(id)) {
    const rest = id.slice(4).split("-");
    return `GPT-${rest[0]}${rest.length > 1 ? ` ${rest.slice(1).join(" ")}` : ""}`;
  }
  return id.split(/[-_]/).filter(Boolean).map(titleWord).join(" ").slice(0, 80);
}

// A coarse, honest label: which end of the speed/capability trade-off a model
// sits at. It is read from the name the provider gave the model and says no
// more than that name does.
function modelTier(modelId) {
  // Matched as whole name tokens: "mini" is a substring of "gemini", and an
  // unbounded match filed every Gemini model under the fast tier.
  const tokens = String(modelId || "").toLowerCase().split(/[-_/.:\s]+/).filter(Boolean);
  const has = pattern => tokens.some(token => pattern.test(token));
  const large = /^(70b|72b|90b|123b|235b|405b|480b)$/;
  if (has(/^(lite|mini|nano|haiku|small|tiny|instant)$/) || (has(/^\d+(\.\d+)?b$/) && !has(large))) return "fast";
  if (has(/^(pro|opus|ultra|large|reasoner|thinking|max)$/) || has(large)) return "capable";
  if (tokens[0] === "gpt" && tokens[1] === "5") return "capable";
  if (tokens[0] === "o3" || tokens[0] === "o1") return "capable";
  return "balanced";
}

function versionOf(modelId) {
  // Extract version like 3.3, 3.1, 2.5, 4, etc.
  // Strip parameter counts (70b, 8b, 405b) and 4-8 digit dates/snapshots (2407, 2411, 2024, 20240929)
  const clean = String(modelId || "")
    .replace(/\b\d+(\.\d+)?b\b/gi, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .replace(/\b\d{4,8}\b/g, "");
  const match = clean.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 0;
  const num = Number(match[1]);
  return num < 100 ? num : 0;
}

function stability(modelId) {
  const id = String(modelId || "").toLowerCase();
  if (/exp|experimental/.test(id)) return 0;
  if (/preview|beta/.test(id)) return 1;
  return 2;
}

function flagshipScore(modelId) {
  const id = String(modelId || "").toLowerCase();
  let score = 0;
  // Modern standard flagship workhorse models (fastest, warm, most reliable)
  if (/llama-3\.3|llama-3\.1-(70b|8b)|llama-3\.1-nemotron-70b|gpt-(5|4|o\d)|claude-3-7|claude-3-5|deepseek-(r1|v3|chat)|qwen2\.5-(72b|coder|7b)|mistral-large/i.test(id)) {
    score += 100;
  } else if (/llama-3|llama3|qwen2\.5|gemma-2|mistral-small|phi-4|phi-3\.5/i.test(id)) {
    score += 50;
  } else if (/instruct|chat|nemotron/i.test(id)) {
    score += 20;
  }

  // De-prioritize massive models that take long cold starts on serverless clusters
  if (/340b|405b|480b/i.test(id)) score -= 60;
  if (/jamba/i.test(id)) score -= 30;
  // De-prioritize dated snapshot versions when standard models are available
  if (/\b(19|20)\d{2}\d{2,4}\b|\b0731\b|\b2407\b|\b2411\b/i.test(id)) score -= 15;
  return score;
}

// Newest first, then stable before preview before experimental, then the
// balanced tier ahead of the extremes so the top of a list is a sensible pick.
function rankModels(models) {
  const tierOrder = { balanced: 0, capable: 1, fast: 2 };
  return [...models].sort((left, right) => {
    const scoreDiff = flagshipScore(right.id) - flagshipScore(left.id);
    if (scoreDiff !== 0) return scoreDiff;

    const version = versionOf(right.id) - versionOf(left.id);
    if (version) return version;
    const stable = stability(right.id) - stability(left.id);
    if (stable) return stable;
    return (tierOrder[left.tier] ?? 3) - (tierOrder[right.tier] ?? 3);
  });
}

// For a key the operator has not chosen a model on yet: the newest balanced
// model that can use tools, picked by name alone, which on Gemini's free tier
// is the newest Flash rather than a Pro that will hit its quota on the second
// question.
function defaultModel(models) {
  const verified = (models || []).find(model => model.verified === true);
  if (verified) return verified;
  const ranked = rankModels(models || []);
  const withTools = ranked.filter(model => model.tools !== false);
  return withTools.find(model => model.tier === "balanced") || ranked.find(model => model.tier === "balanced") || withTools[0] || ranked[0] || null;
}

// ---------------------------------------------------------- Mission AI models
//
// Mission AI runs on the two keys built into the app, on Google's free tier.
// It offers only stable Flash and Flash-Lite models: a Pro model or a preview
// spends a free quota in a handful of questions, dated snapshots and aliases
// duplicate a stable model, and image, audio, live and TTS models cannot hold
// a chat. From what the keys can reach it keeps the two newest Flash models and
// the newest Flash-Lite — fast, balanced, and light on the limits. The rule is
// a shape, not a list of names, so it keeps working as Google ships versions.
const MISSION_MODEL_ID = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?$/;
const MISSION_FALLBACK_MODELS = Object.freeze([
  ["gemini-2.5-flash", "Gemini 2.5 Flash"],
  ["gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite"]
]);

function isMissionModelId(modelId) {
  return MISSION_MODEL_ID.test(String(modelId || ""));
}

function curateMissionModels(models) {
  const stable = (Array.isArray(models) ? models : []).filter(model => isMissionModelId(model?.id));
  const newest = list => [...list].sort((left, right) => versionOf(right.id) - versionOf(left.id));
  const flash = newest(stable.filter(model => !model.id.endsWith("-lite"))).slice(0, 2);
  const lite = newest(stable.filter(model => model.id.endsWith("-lite"))).slice(0, 1);
  const curated = [...flash, ...lite];
  return curated.length ? curated : missionFallbackModels();
}

function missionFallbackModels() {
  return MISSION_FALLBACK_MODELS.map(([id, label]) => describeModel(id, label));
}

function describeModel(id, displayName = null, extra = {}) {
  const clean = String(id).replace(/^models\//, "");
  return {
    id: clean,
    label: prettyModelName(clean, displayName),
    family: modelFamily(clean),
    tier: modelTier(clean),
    ...extra
  };
}

// ------------------------------------------------------------------- transport

async function readJson(response, apiKey) {
  const declared = Number(response.headers?.get?.("content-length"));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error("The provider response exceeded the safety limit");
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) throw new Error("The provider response exceeded the safety limit");
  let data = null;
  try { data = raw ? JSON.parse(raw) : {}; } catch { data = null; }
  if (!response.ok) {
    const detail = errorDetail(data) || `status ${response.status}`;
    const error = new Error(scrub(`${friendlyStatus(response.status)}${detail ? ` — ${detail}` : ""}`, apiKey));
    error.status = response.status;
    error.retryable = response.status === 429 || response.status >= 500;
    error.keyProblem = response.status === 401 || response.status === 403 || /api[_ ]?key|invalid.*key|permission/i.test(String(detail));
    throw error;
  }
  if (data === null) throw new Error("The provider returned a response that was not JSON");
  return data;
}

// Providers disagree on where an error's words go. OpenAI-style hosts use
// error.message, NVIDIA uses detail and title (detail is a list when a request
// fails validation), and OpenRouter wraps the upstream provider's own reason
// in error.metadata.raw behind a generic message.
function errorDetail(data) {
  if (!data || typeof data !== "object") return "";
  const nested = data.error && typeof data.error === "object" ? data.error : null;
  const detail = typeof data.detail === "string" ? data.detail
    : Array.isArray(data.detail) ? data.detail.map(item => item?.msg || "").filter(Boolean).join("; ")
      : "";
  let text = nested?.message || nested?.type || detail || data.message || data.title || (typeof data.error === "string" ? data.error : "");
  const raw = nested?.metadata?.raw;
  if (typeof raw === "string" && raw.trim() && !String(text).includes(raw.trim().slice(0, 40))) text = `${text}${text ? " — " : ""}${raw.trim().slice(0, 240)}`;
  return String(text || "");
}

// An error a host put in a 200 response body, with its status kept.
function providerError(value, fallback) {
  const message = typeof value?.message === "string" && value.message ? value.message : typeof value?.type === "string" ? value.type : fallback;
  const error = new Error(String(message).slice(0, 400));
  const status = Number(value?.code ?? value?.status);
  if (Number.isInteger(status) && status >= 400 && status < 600) error.status = status;
  const raw = value?.metadata?.raw;
  if (typeof raw === "string" && raw.trim()) error.message = `${error.message} — ${raw.trim().slice(0, 240)}`;
  return error;
}

function friendlyStatus(status) {
  if (status === 400) return "The provider rejected the request";
  if (status === 401) return "The API key was not accepted";
  if (status === 402) return "Account requires payment or has no active credit";
  if (status === 403) return "The API key does not have access";
  if (status === 404) return "The model or endpoint was not found";
  if (status === 410) return "The provider has retired this model";
  if (status === 429) return "Rate limit or quota reached";
  if (status >= 500) return "The provider is having problems";
  return `Request failed (${status})`;
}

async function send(fetchImpl, url, init, { apiKey, timeoutMs, signal }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  const onAbort = () => controller.abort();
  signal?.addEventListener?.("abort", onAbort, { once: true });
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return await readJson(response, apiKey);
  } catch (error) {
    if (error?.name === "AbortError") {
      const wrapped = new Error(signal?.aborted ? "The request was cancelled" : `The provider did not answer within ${Math.round(timeoutMs / 1000)} seconds`);
      wrapped.name = signal?.aborted ? "AbortError" : "TimeoutError";
      wrapped.retryable = !signal?.aborted;
      throw wrapped;
    }
    if (error?.status) throw error;
    const wrapped = new Error(scrub(`Could not reach the provider — ${error?.message || error}`, apiKey));
    wrapped.retryable = true;
    throw wrapped;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener?.("abort", onAbort);
  }
}

// Models a listing reports that cannot hold a chat: embeddings, speech, image
// and video generation, safety classifiers, rerankers, massive 340b/405b multi-node
// preview clusters, and specialized non-chat microservices.
const NON_CHAT = /(embed|whisper|tts|transcri|audio|dall-e|image|imagen|veo|moderation|aqa|search|realtime|speech|rerank|guard|safety|reward|retriev|nvclip|clip|parakeet|riva|canary|fastpitch|cosmos|flux|stable-diffusion|sdxl|kosmos|deplot|ocr|topic-control|pii|detector|calibrat|bge-|arctic-embed|colbert|live|robotics|computer-use|learnlm|diffdock|genmol|molmim|esm1nv|esm2nv|alphafold|clara|cuopt|protein|dnaseq|docking|visual-prompt|neva-|fuyu-|vila-|minitron|steerlm|340b|405b|480b|benchmark|eval-|0731)/i;
// OpenAI's own legacy completion models. On OpenAI a name ending in "instruct"
// is a completion model; everywhere else it is how chat models are named
// (meta/llama-3.3-70b-instruct), so this applies to OpenAI alone.
const OPENAI_LEGACY = /(babbage|davinci|instruct$)/i;

async function listModels({ provider, apiKey, baseUrl = null, fetch: fetchImpl = global.fetch, signal } = {}) {
  apiKey = sanitizeApiKey(apiKey);
  const cleanKey = apiKey;
  const spec = providerSpec(provider, baseUrl);
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
  const options = { apiKey: cleanKey, timeoutMs: LIST_TIMEOUT_MS, signal };
  let models = [];

  if (Array.isArray(spec.staticModels)) {
    models = spec.staticModels.map(id => describeModel(id, null, { tools: false }));
  } else if (spec.style === "gemini") {
    let pageToken = "";
    for (let page = 0; page < 4; page += 1) {
      const url = `${spec.baseUrl}/models?pageSize=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
      const data = await send(fetchImpl, url, { method: "GET", headers: { "x-goog-api-key": apiKey } }, options);
      for (const entry of Array.isArray(data.models) ? data.models : []) {
        const id = String(entry.name || "").replace(/^models\//, "");
        const methods = Array.isArray(entry.supportedGenerationMethods) ? entry.supportedGenerationMethods : [];
        if (!/^(gemini|gemma)/.test(id) || !methods.includes("generateContent") || NON_CHAT.test(id)) continue;
        models.push(describeModel(id, entry.displayName, { contextWindow: Number(entry.inputTokenLimit) || null }));
      }
      pageToken = data.nextPageToken || "";
      if (!pageToken) break;
    }
  } else if (spec.style === "anthropic") {
    const data = await send(fetchImpl, `${spec.baseUrl}/models?limit=100`, {
      method: "GET",
      headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION }
    }, options);
    for (const entry of Array.isArray(data.data) ? data.data : []) {
      if (!entry?.id) continue;
      models.push(describeModel(entry.id, entry.display_name));
    }
  } else {
    const data = await send(fetchImpl, `${spec.baseUrl}/models`, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` }
    }, options);
    for (const entry of Array.isArray(data.data) ? data.data : []) {
      const id = String(entry?.id || "");
      if (!id || NON_CHAT.test(id)) continue;
      // OpenAI's own list includes every legacy completion and fine-tune base.
      if (spec.id === "openai" && (OPENAI_LEGACY.test(id) || !/^(gpt-|o\d|chatgpt-|codex)/.test(id))) continue;
      // A listing that says what a model accepts (OpenRouter does) is taken at
      // its word about tool calling; the rest are found out on first use.
      const parameters = Array.isArray(entry.supported_parameters) ? entry.supported_parameters : null;
      if (Array.isArray(entry.architecture?.output_modalities) && !entry.architecture.output_modalities.includes("text")) continue;
      models.push(describeModel(id, entry.name || null, {
        contextWindow: Number(entry.context_length || entry.context_window) || null,
        ...(parameters ? { tools: parameters.includes("tools") } : null)
      }));
    }
  }

  const seen = new Set();
  models = models.filter(model => (seen.has(model.id) ? false : (seen.add(model.id), true)));
  return rankModels(models).slice(0, MAX_MODELS);
}

// ------------------------------------------------------------------------ chat
//
// Normalized conversation shape the assistant loop speaks:
//   { role: "user", text }
//   { role: "assistant", text, toolCalls: [{ id, name, arguments }], providerParts? }
//   { role: "tool", toolCallId, name, result }   (result is a JSON-able value)
//
// `providerParts` carries whatever a provider needs echoed back verbatim on the
// next turn. Gemini's newer models sign their function calls and refuse a
// follow-up that drops the signature, so the model turn is replayed as it came.

function toolResultText(result) {
  if (typeof result === "string") return result;
  try { return JSON.stringify(result); } catch { return String(result); }
}

function geminiBody({ system, messages, tools }) {
  const contents = [];
  for (const message of messages) {
    if (message.role === "user") {
      contents.push({ role: "user", parts: [{ text: message.text }] });
    } else if (message.role === "assistant") {
      if (Array.isArray(message.providerParts) && message.providerParts.length) {
        contents.push({ role: "model", parts: message.providerParts });
      } else {
        const parts = [];
        if (message.text) parts.push({ text: message.text });
        for (const call of message.toolCalls || []) parts.push({ functionCall: { name: call.name, args: call.arguments || {} } });
        if (parts.length) contents.push({ role: "model", parts });
      }
    } else if (message.role === "tool") {
      const part = { functionResponse: { name: message.name, response: { result: message.result } } };
      const previous = contents[contents.length - 1];
      // Several results for one model turn travel as one user turn.
      if (previous?.role === "user" && previous.parts.every(item => item.functionResponse)) previous.parts.push(part);
      else contents.push({ role: "user", parts: [part] });
    }
  }
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (tools?.length) {
    body.tools = [{
      functionDeclarations: tools.map(tool => {
        const decl = { name: tool.name, description: tool.description };
        if (tool.parameters && Object.keys(tool.parameters.properties || {}).length > 0) {
          decl.parameters = tool.parameters;
        }
        return decl;
      })
    }];
  }
  return body;
}

function parseGemini(data) {
  const candidate = data?.candidates?.[0];
  const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts.filter(part => typeof part.text === "string" && !part.thought).map(part => part.text).join("");
  const toolCalls = parts.filter(part => part.functionCall).map((part, index) => ({
    id: `call-${index}-${part.functionCall.name}`,
    name: part.functionCall.name,
    arguments: part.functionCall.args && typeof part.functionCall.args === "object" ? part.functionCall.args : {}
  }));
  const usage = data?.usageMetadata || {};
  const cached = Number(usage.cachedContentTokenCount) || 0;
  const blocked = !parts.length && (candidate?.finishReason === "SAFETY" || data?.promptFeedback?.blockReason);
  return {
    text,
    toolCalls,
    providerParts: parts,
    finishReason: candidate?.finishReason || null,
    blocked: Boolean(blocked),
    usage: {
      input: Number.isFinite(Number(usage.promptTokenCount)) ? Math.max(0, Number(usage.promptTokenCount) - cached) : null,
      output: Number.isFinite(Number(usage.candidatesTokenCount)) ? Number(usage.candidatesTokenCount) : null,
      reasoning: Number.isFinite(Number(usage.thoughtsTokenCount)) ? Number(usage.thoughtsTokenCount) : null,
      cacheRead: cached || null
    }
  };
}

function openAiBody({ model, system, messages, tools, maxTokens = null, temperature = null }) {
  const isReasoning = /^(o1|o3|o4)/i.test(String(model || ""));
  const systemRole = isReasoning ? "developer" : "system";
  const out = system ? [{ role: systemRole, content: system }] : [];
  for (const message of messages) {
    if (message.role === "user") out.push({ role: "user", content: message.text });
    else if (message.role === "assistant") {
      const entry = { role: "assistant", content: message.text || null };
      if (message.toolCalls?.length) {
        entry.tool_calls = message.toolCalls.map(call => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments || {}) } }));
      }
      out.push(entry);
    } else if (message.role === "tool") {
      out.push({ role: "tool", tool_call_id: message.toolCallId, content: toolResultText(message.result) });
    }
  }
  const body = { model, messages: out };
  if (tools?.length) body.tools = tools.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  if (Number.isInteger(maxTokens) && maxTokens > 0) body.max_tokens = maxTokens;
  if (typeof temperature === "number") body.temperature = temperature;
  return body;
}

function parseOpenAi(data) {
  // Some hosts answer 200 and put the failure in the body: OpenRouter when the
  // upstream provider fails, vLLM-based hosts as an "error" object.
  if (data?.error && typeof data.error === "object") throw providerError(data.error, "The provider returned an error");
  if (data?.object === "error") throw providerError(data, "The provider returned an error");
  const choice = data?.choices?.[0];
  if (choice?.error && typeof choice.error === "object") throw providerError(choice.error, "The provider returned an error");
  const message = choice?.message || {};
  const toolCalls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).map((call, index) => {
    let args = {};
    try { args = JSON.parse(call?.function?.arguments || "{}"); } catch { args = {}; }
    return { id: call.id || `call-${index}`, name: call?.function?.name, arguments: args && typeof args === "object" ? args : {} };
  }).filter(call => call.name);
  const usage = data?.usage || {};
  const cached = Number(usage.prompt_tokens_details?.cached_tokens) || 0;
  const reasoning = Number(usage.completion_tokens_details?.reasoning_tokens) || 0;
  let raw = typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.map(item => item?.text || "").join("") : "";
  if (!raw && !toolCalls.length && typeof data?.text === "string") {
    raw = data.text;
  }
  return {
    // Reasoning models served through OpenAI-compatible hosts (DeepSeek R1,
    // QwQ, Nemotron) put their thinking inline between think tags.
    text: raw.replace(/<think>[\s\S]*?<\/think>\s*/gi, "").trim(),
    toolCalls,
    finishReason: choice?.finish_reason || null,
    blocked: false,
    usage: {
      input: Number.isFinite(Number(usage.prompt_tokens)) ? Math.max(0, Number(usage.prompt_tokens) - cached) : null,
      // Reasoning tokens are billed as output and reported inside the output count.
      output: Number.isFinite(Number(usage.completion_tokens)) ? Math.max(0, Number(usage.completion_tokens) - reasoning) : null,
      reasoning: reasoning || null,
      cacheRead: cached || null
    }
  };
}

function anthropicBody({ model, system, messages, tools }) {
  const out = [];
  for (const message of messages) {
    if (message.role === "user") out.push({ role: "user", content: [{ type: "text", text: message.text }] });
    else if (message.role === "assistant") {
      const content = [];
      if (message.text) content.push({ type: "text", text: message.text });
      for (const call of message.toolCalls || []) content.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments || {} });
      if (content.length) out.push({ role: "assistant", content });
    } else if (message.role === "tool") {
      const block = { type: "tool_result", tool_use_id: message.toolCallId, content: toolResultText(message.result) };
      const previous = out[out.length - 1];
      // Anthropic requires every result for one tool turn in a single user turn.
      if (previous?.role === "user" && previous.content.every(item => item.type === "tool_result")) previous.content.push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  const body = { model, max_tokens: ANTHROPIC_MAX_TOKENS, messages: out };
  if (system) body.system = system;
  if (tools?.length) body.tools = tools.map(tool => ({ name: tool.name, description: tool.description, input_schema: tool.parameters && Object.keys(tool.parameters).length ? tool.parameters : { type: "object", properties: {} } }));
  return body;
}

function parseAnthropic(data) {
  const content = Array.isArray(data?.content) ? data.content : [];
  const usage = data?.usage || {};
  return {
    text: content.filter(block => block.type === "text").map(block => block.text).join(""),
    toolCalls: content.filter(block => block.type === "tool_use").map(block => ({ id: block.id, name: block.name, arguments: block.input && typeof block.input === "object" ? block.input : {} })),
    finishReason: data?.stop_reason || null,
    blocked: false,
    usage: {
      input: Number.isFinite(Number(usage.input_tokens)) ? Number(usage.input_tokens) : null,
      output: Number.isFinite(Number(usage.output_tokens)) ? Number(usage.output_tokens) : null,
      reasoning: null,
      cacheRead: Number(usage.cache_read_input_tokens) || null
    }
  };
}

// A model that cannot call tools, or will not take a system prompt, says so
// with a 400. Hosts that serve many open models (NVIDIA, Together, Hugging
// Face) have plenty of both, and Gemma on Google's API takes neither. The
// request is sent once more without the part it refused, and the caller is
// told, so the next turn does not pay for the same refusal.
function refusesTools(error) {
  const msg = String(error?.message || "");
  // A 404 names tools outright when that is the reason (OpenRouter: "No
  // endpoints found that support tool use"). NVIDIA's 404 for a model the
  // account cannot reach begins "Function ...", which is not about tools, and
  // sending it again would only repeat the failed request.
  if (error?.status === 404) return /tool/i.test(msg);
  return [400, 422].includes(error?.status) && (/tool|function|call|schema|additionalproperties|unsupported parameter/i.test(msg));
}

function refusesSystem(error) {
  const msg = String(error?.message || "");
  return [400, 422].includes(error?.status) && (/system|developer|developer instruction|role.*not support/i.test(msg));
}

function withSystemInFirstTurn(system, messages) {
  const copy = messages.map(message => ({ ...message }));
  const first = copy.find(message => message.role === "user");
  if (first && system) first.text = `${system}\n\n---\n\n${first.text}`;
  return copy;
}

async function chat(request = {}) {
  let attempt = { ...request };
  let toolsDropped = false;
  let systemMerged = false;
  for (let round = 0; round < 3; round += 1) {
    try {
      const result = await chatOnce(attempt);
      return { ...result, toolsDropped, systemMerged };
    } catch (error) {
      if (!toolsDropped && attempt.tools?.length && refusesTools(error)) {
        toolsDropped = true;
        attempt = { ...attempt, tools: [] };
        continue;
      }
      if (!systemMerged && attempt.system && refusesSystem(error)) {
        systemMerged = true;
        attempt = { ...attempt, messages: withSystemInFirstTurn(attempt.system, attempt.messages || []), system: "" };
        continue;
      }
      throw error;
    }
  }
  throw new Error("The provider rejected the request");
}

async function chatOnce({ provider, apiKey, baseUrl = null, model, system, messages, tools = [], maxTokens = null, temperature = null, fetch: fetchImpl = global.fetch, signal, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const cleanKey = sanitizeApiKey(apiKey);
  const spec = providerSpec(provider, baseUrl);
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is unavailable");
  if (typeof model !== "string" || !model.trim()) throw new TypeError("A model is required");
  const options = { apiKey: cleanKey, timeoutMs, signal };

  if (spec.style === "gemini") {
    const data = await send(fetchImpl, `${spec.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": cleanKey },
      body: JSON.stringify(geminiBody({ system, messages, tools }))
    }, options);
    return parseGemini(data);
  }
  if (spec.style === "anthropic") {
    const data = await send(fetchImpl, `${spec.baseUrl}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": cleanKey, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify(anthropicBody({ model, system, messages, tools }))
    }, options);
    return parseAnthropic(data);
  }
  const headers = { "Content-Type": "application/json", Accept: "application/json", Authorization: `Bearer ${cleanKey}` };
  // OpenRouter attributes traffic by these; they carry no user data.
  if (spec.id === "openrouter") { headers["HTTP-Referer"] = "https://mission-control.local"; headers["X-Title"] = "Mission Control"; }
  const data = await send(fetchImpl, `${spec.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(openAiBody({ model, system, messages, tools, maxTokens, temperature }))
  }, options);
  try {
    return parseOpenAi(data);
  } catch (error) {
    error.message = scrub(error.message, cleanKey);
    throw error;
  }
}

module.exports = {
  PROVIDERS,
  REQUEST_TIMEOUT_MS,
  sanitizeApiKey,
  detectProvider,
  detectProviderCandidates,
  providerSpec,
  normalizeBaseUrl,
  listModels,
  chat,
  modelFamily,
  modelTier,
  prettyModelName,
  rankModels,
  defaultModel,
  describeModel,
  isMissionModelId,
  curateMissionModels,
  missionFallbackModels,
  // Exported for tests: the translation layer is where provider bugs live.
  geminiBody,
  parseGemini,
  openAiBody,
  parseOpenAi,
  anthropicBody,
  parseAnthropic
};
