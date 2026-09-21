// OUTARCH ai-proxy — the only place the built-in Mission AI keys are used.
//
// The desktop app never holds a built-in key. It sends the provider request it
// would have made (path + body) here with the signed-in user's JWT, and this
// function:
//   1. verifies the user (the platform checks the JWT; getUser confirms it),
//   2. allows only the exact provider endpoints Mission AI uses,
//   3. for a model call, requires a live "turn" — one Mission AI message the
//      user's plan paid for through begin_ai_turn() — so the Free quota cannot
//      be bypassed by calling this function directly,
//   4. tries the keys in public.ai_provider_keys best-first; a key the provider
//      refuses (quota, rate limit, revoked) is reported and put on cooldown and
//      the same request moves to the next key.
//
// Replacing a used-up key is a database edit: insert a row into
// public.ai_provider_keys (or `select admin.add_ai_key(...)`), or disable one.

import { createClient } from "npm:@supabase/supabase-js@2";

type Provider = "gemini" | "nvidia";

const UPSTREAM: Record<Provider, string> = {
  gemini: "https://generativelanguage.googleapis.com",
  nvidia: "https://integrate.api.nvidia.com",
};

const ROUTES: Array<{ provider: Provider; method: "GET" | "POST"; pattern: RegExp; metered: boolean }> = [
  { provider: "gemini", method: "GET", pattern: /^\/v1beta\/models(?:\?[A-Za-z0-9=&%_.-]{0,200})?$/, metered: false },
  { provider: "gemini", method: "POST", pattern: /^\/v1beta\/models\/[A-Za-z0-9._-]{1,120}:generateContent$/, metered: true },
  { provider: "nvidia", method: "GET", pattern: /^\/v1\/models$/, metered: false },
  { provider: "nvidia", method: "POST", pattern: /^\/v1\/chat\/completions$/, metered: true },
];

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 170_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function proxyError(status: number, code: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { "Content-Type": "application/json", "x-outarch-proxy-error": code },
  });
}

// How long a refused key sits at the back of the queue.
function cooldownFor(status: number, payload: string): number {
  if (status === 401 || status === 403) return 30 * 60;
  if (status === 429) return /per ?day|daily|PerDay/i.test(payload) ? 60 * 60 : 45;
  if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(payload)) return 30 * 60;
  return 0;
}

function isKeyProblem(status: number, payload: string): boolean {
  if (status === 401 || status === 402 || status === 403 || status === 429) return true;
  return status === 400 && /API_KEY_INVALID|API key not valid|RESOURCE_EXHAUSTED|quota/i.test(payload);
}

function scrub(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) if (secret) out = out.split(secret).join("[key]");
  return out;
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") return proxyError(405, "METHOD_NOT_ALLOWED", "Use POST.");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return proxyError(500, "MISCONFIGURED", "The AI proxy is not configured.");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return proxyError(401, "UNAUTHENTICATED", "Sign in to OUTARCH to use Mission AI.");
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return proxyError(401, "UNAUTHENTICATED", "Your OUTARCH session has expired. Sign in again.");

  const raw = await request.text();
  if (raw.length > MAX_REQUEST_BYTES) return proxyError(413, "TOO_LARGE", "That request is too large.");
  let envelope: { provider?: string; method?: string; path?: string; body?: unknown };
  try { envelope = JSON.parse(raw); } catch { return proxyError(400, "BAD_REQUEST", "The request was not JSON."); }

  const provider = envelope.provider as Provider;
  const method = envelope.method === "GET" ? "GET" : "POST";
  const path = typeof envelope.path === "string" ? envelope.path : "";
  const route = ROUTES.find(item => item.provider === provider && item.method === method && item.pattern.test(path));
  if (!route) return proxyError(400, "ROUTE_NOT_ALLOWED", "Mission AI does not use that endpoint.");

  if (route.metered) {
    const turn = request.headers.get("x-outarch-turn") || "";
    if (!UUID.test(turn)) return proxyError(428, "TURN_REQUIRED", "Start a Mission AI message first.");
    const { data: claimed, error: claimError } = await admin.rpc("claim_ai_turn_call", { p_turn: turn, p_user: user.id });
    if (claimError) return proxyError(500, "TURN_CHECK_FAILED", "Mission AI could not check this message. Try again.");
    if (claimed !== true) return proxyError(409, "TURN_EXPIRED", "This Mission AI message has ended. Send it again.");
  }

  const { data: keys, error: keysError } = await admin.rpc("next_ai_keys", { p_provider: provider });
  if (keysError) return proxyError(500, "KEYS_UNAVAILABLE", "Mission AI could not read its keys. Try again.");
  if (!Array.isArray(keys) || !keys.length) {
    return proxyError(503, "NO_KEYS", "Mission AI has no key for this model on the server yet. Pick another model, or try again later.");
  }

  const secrets = keys.map((key: { api_key: string }) => key.api_key);
  const body = method === "POST" ? JSON.stringify(envelope.body ?? {}) : undefined;
  let last: { status: number; payload: string; type: string } | null = null;

  for (const key of keys as Array<{ id: string; api_key: string }>) {
    const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
    if (provider === "gemini") headers["x-goog-api-key"] = key.api_key;
    else headers["Authorization"] = `Bearer ${key.api_key}`;

    let upstream: Response;
    try {
      upstream = await fetch(`${UPSTREAM[provider]}${path}`, { method, headers, body, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
    } catch (error) {
      // A network failure is not the key's fault; another key would fail the same way.
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "The model did not answer in time."
        : "Mission AI could not reach the model provider.";
      return proxyError(504, "UPSTREAM_UNREACHABLE", message);
    }

    const payload = await upstream.text();
    const type = upstream.headers.get("content-type") || "application/json";
    if (upstream.ok) {
      await admin.rpc("report_ai_key_result", { p_key: key.id, p_ok: true, p_status: upstream.status, p_error: null, p_cooldown_seconds: 0 });
      return new Response(payload, { status: upstream.status, headers: { "Content-Type": type } });
    }

    const refused = isKeyProblem(upstream.status, payload);
    await admin.rpc("report_ai_key_result", {
      p_key: key.id,
      p_ok: false,
      p_status: upstream.status,
      p_error: scrub(payload, secrets).slice(0, 500),
      p_cooldown_seconds: refused ? cooldownFor(upstream.status, payload) : 0,
    });
    last = { status: upstream.status, payload, type };
    // Only a refused key is worth trying again with the next one. A model the
    // provider does not know, or a malformed request, fails the same everywhere.
    if (!refused) break;
  }

  const status = last?.status ?? 502;
  return new Response(scrub(last?.payload ?? "", secrets) || JSON.stringify({ error: { message: "The model provider refused the request." } }), {
    status,
    headers: { "Content-Type": last?.type || "application/json" },
  });
});
