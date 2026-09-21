"use strict";

// The fetch Mission AI's built-in models use.
//
// Mission AI still builds the exact provider request it always did (Gemini's
// generateContent, NVIDIA's chat/completions); this transport sends that
// request to the ai-proxy Edge Function instead of to the provider, and the
// proxy adds a key from the database. The app therefore holds no built-in key,
// and the owner replaces a used-up key by editing public.ai_provider_keys.
//
// A model call (POST) belongs to a "turn": one Mission AI message, counted
// against the plan once. The caller passes a small mutable context object per
// message; the first call opens the turn and the rest of that message's tool
// rounds reuse it.

const PROVIDER_HOSTS = Object.freeze({
  "generativelanguage.googleapis.com": "gemini",
  "integrate.api.nvidia.com": "nvidia"
});

// The placeholder the credential store hands to the provider layer, which
// insists on a key-shaped string. It is stripped before anything is sent.
const MANAGED_KEY_PLACEHOLDER = "outarch-managed-key-00000000000000000000";

function managedError(message, status, code, extra = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.managed = true;
  Object.assign(error, extra);
  return error;
}

async function readProxyMessage(response) {
  try {
    const data = await response.clone().json();
    return typeof data?.error?.message === "string" ? data.error.message : null;
  } catch {
    return null;
  }
}

function createManagedAiFetch({ account, rest }) {
  if (!account || !rest) throw new TypeError("createManagedAiFetch requires an account and a Supabase client");

  return async function managedAiFetch(url, init = {}, context = null) {
    let target;
    try { target = new URL(String(url)); } catch { throw managedError("Mission AI tried to reach an invalid address.", 400, "BAD_URL"); }
    const provider = PROVIDER_HOSTS[target.host];
    if (!provider || target.protocol !== "https:") throw managedError("Mission AI can only reach its own model providers.", 400, "HOST_NOT_ALLOWED");
    target.searchParams.delete("key");
    const method = String(init.method || "GET").toUpperCase() === "POST" ? "POST" : "GET";
    let body = null;
    if (method === "POST" && typeof init.body === "string") {
      try { body = JSON.parse(init.body); } catch { throw managedError("Mission AI built a request that was not JSON.", 400, "BAD_BODY"); }
    }
    const turn = context && typeof context === "object" ? context : {};

    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (method === "POST" && !turn.id) {
        const begun = await account.beginAiTurn(turn.surface || "mission");
        turn.id = begun.turnId;
      }
      const token = await account.accessToken({ force: attempt > 0 && turn.lastFailure === "auth" });
      let response;
      try {
        response = await rest.invokeRaw("ai-proxy", {
          token,
          signal: init.signal || null,
          headers: method === "POST" ? { "x-outarch-turn": turn.id } : {},
          body: { provider, method, path: `${target.pathname}${target.search}`, body }
        });
      } catch (error) {
        if (error?.name === "AbortError") throw error;
        throw managedError("Mission AI could not reach OUTARCH's AI service. Check your internet connection.", 503, "OFFLINE", { retryable: false });
      }

      const code = response.headers?.get?.("x-outarch-proxy-error") || null;
      if (!code && response.status !== 401) return response;

      if (code === "TURN_EXPIRED" || code === "TURN_REQUIRED") {
        // The message outlived its turn (a long approval, say). One new turn.
        turn.id = null;
        turn.lastFailure = "turn";
        if (attempt === 0) continue;
      }
      if (response.status === 401) {
        turn.lastFailure = "auth";
        if (attempt < 2) continue;
        throw managedError("Your OUTARCH session has expired. Sign in again to use Mission AI.", 401, "UNAUTHENTICATED", { signedOut: true });
      }
      const message = await readProxyMessage(response) || "Mission AI's service refused the request.";
      throw managedError(message, response.status, code || "PROXY_ERROR", { retryable: false });
    }
    throw managedError("Mission AI could not start this message. Send it again.", 409, "TURN_EXPIRED", { retryable: false });
  };
}

module.exports = { MANAGED_KEY_PLACEHOLDER, PROVIDER_HOSTS, createManagedAiFetch, managedError };
