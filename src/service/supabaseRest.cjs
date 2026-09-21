"use strict";

// The few Supabase calls the desktop app makes, over plain fetch. A client
// library would bring its own session storage and background refresh timers;
// here the session lives in the main process, encrypted, and is refreshed by
// AccountService on its own schedule.

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 512 * 1024;

class CloudError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CloudError";
    this.status = Number.isInteger(details.status) ? details.status : null;
    this.code = typeof details.code === "string" ? details.code : null;
    // The request never reached Supabase (no network, DNS, timeout).
    this.offline = details.offline === true;
    // The refresh token is gone for good: signed out elsewhere, reused, revoked.
    this.sessionRevoked = details.sessionRevoked === true;
  }
}

function describeFailure(data, status) {
  if (data && typeof data === "object") {
    const text = data.msg || data.message || data.error_description || data.hint || (typeof data.error === "string" ? data.error : data.error?.message);
    if (typeof text === "string" && text.trim()) return text.trim().slice(0, 300);
  }
  return `Request failed (${status})`;
}

function failureCode(data) {
  if (!data || typeof data !== "object") return null;
  const code = data.error_code || data.code || (typeof data.error === "string" ? data.error : data.error?.code);
  return typeof code === "string" ? code.slice(0, 80) : null;
}

class SupabaseRest {
  #url;
  #key;
  #fetch;
  #timeoutMs;

  constructor(options = {}) {
    if (!options.url || !options.key) throw new TypeError("SupabaseRest requires a url and a key");
    this.#url = String(options.url).replace(/\/+$/, "");
    this.#key = String(options.key);
    this.#fetch = options.fetch || global.fetch;
    this.#timeoutMs = Number.isInteger(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : DEFAULT_TIMEOUT_MS;
    if (typeof this.#fetch !== "function") throw new TypeError("SupabaseRest requires fetch");
  }

  get url() { return this.#url; }
  get key() { return this.#key; }

  headers(token = null, extra = {}) {
    // The publishable key is not a JWT: it goes in apikey, never in Authorization.
    const headers = { apikey: this.#key, Accept: "application/json", ...extra };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  async request(path, { method = "GET", token = null, body = undefined, headers = {}, timeoutMs = null, signal = null } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs || this.#timeoutMs);
    timer.unref?.();
    const forward = () => controller.abort();
    signal?.addEventListener?.("abort", forward, { once: true });
    let response;
    try {
      response = await this.#fetch(`${this.#url}${path}`, {
        method,
        headers: this.headers(token, body === undefined ? headers : { "Content-Type": "application/json", ...headers }),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      const cancelled = signal?.aborted;
      throw new CloudError(cancelled ? "The request was cancelled" : "OUTARCH could not reach its account service. Check your internet connection.", { offline: !cancelled, code: cancelled ? "CANCELLED" : "OFFLINE" });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", forward);
    }
    const raw = await response.text().catch(() => "");
    if (raw.length > MAX_RESPONSE_BYTES) throw new CloudError("The account service sent an unexpectedly large answer", { status: response.status });
    let data = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
    if (!response.ok) {
      const code = failureCode(data);
      const message = describeFailure(data, response.status);
      const revoked = path.startsWith("/auth/v1/token") && (response.status === 400 || response.status === 401)
        && /refresh[_ ]token|invalid_grant|session_not_found|already used|not found/i.test(`${code || ""} ${message}`);
      throw new CloudError(message, { status: response.status, code, sessionRevoked: revoked });
    }
    return data;
  }

  // ---------------------------------------------------------------- auth

  refreshSession(refreshToken) {
    return this.request("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: String(refreshToken || "") } });
  }

  getUser(accessToken) {
    return this.request("/auth/v1/user", { token: accessToken });
  }

  signOut(accessToken) {
    // local scope ends this device's session only; the website stays signed in.
    return this.request("/auth/v1/logout?scope=local", { method: "POST", token: accessToken, body: {} });
  }

  // ---------------------------------------------------------------- data

  rpc(name, args = {}, token = null, options = {}) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name)) throw new TypeError("rpc name is invalid");
    return this.request(`/rest/v1/rpc/${name}`, { method: "POST", token, body: args, ...options });
  }

  select(table, query = "", token = null, options = {}) {
    if (!/^[a-z_][a-z0-9_]{0,62}$/.test(table)) throw new TypeError("table name is invalid");
    return this.request(`/rest/v1/${table}${query ? `?${query}` : ""}`, { token, ...options });
  }

  // The raw response of an Edge Function, for callers that relay it.
  async invokeRaw(name, { body, token, headers = {}, signal = null, timeoutMs = 180_000 } = {}) {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(name)) throw new TypeError("function name is invalid");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    timer.unref?.();
    const forward = () => controller.abort();
    signal?.addEventListener?.("abort", forward, { once: true });
    try {
      return await this.#fetch(`${this.#url}/functions/v1/${name}`, {
        method: "POST",
        headers: this.headers(token, { "Content-Type": "application/json", ...headers }),
        body: JSON.stringify(body ?? {}),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", forward);
    }
  }
}

module.exports = { CloudError, SupabaseRest };
