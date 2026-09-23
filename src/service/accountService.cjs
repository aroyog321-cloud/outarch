"use strict";

// The OUTARCH account: who is signed in, what their plan allows, and the
// browser round trip that signs them in.
//
// Signing in happens on the OUTARCH website, never in the app. The app opens
//   <website>/auth?client=desktop&state=<random>
// and the website, once the operator has signed in with email and password or
// with Google, sends the session back through the outarch:// protocol:
//   outarch://auth/callback?state=<same random>#access_token=…&refresh_token=…
// A callback is accepted only if it carries the state this app issued in the
// last fifteen minutes, so a link crafted by someone else cannot sign this app
// into their account. The access token is then confirmed with Supabase before
// anything is saved.
//
// The session is refreshed here, in the main process, and stored encrypted.
// The renderer only ever sees status(): no token crosses to it.
//
// The plan is read from Supabase (get_entitlements) at sign-in, every few
// minutes, when the window comes back into focus, and on request. If Supabase
// cannot be reached, the last verified plan keeps working for OFFLINE_GRACE_MS.

const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const { CloudError } = require("./supabaseRest.cjs");
const { Entitlements, normalizeLimits, normalizePlanCatalogue } = require("./entitlements.cjs");
const { cleanOrigin } = require("./cloudConfig.cjs");

const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const FOCUS_REFRESH_MIN_MS = 60 * 1000;
const REFRESH_AHEAD_MS = 90 * 1000;
const SIGN_IN_TTL_MS = 15 * 60 * 1000;
const PUBLIC_REFRESH_MS = 30 * 60 * 1000;

class PlanLimitError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "PlanLimitError";
    this.code = "PLAN_REQUIRED";
    this.status = 402;
    this.planLimit = true;
    this.managed = true;
    this.feature = details.feature || "missionAiMessages";
    this.requiredPlan = details.requiredPlan || null;
    this.resetsAt = details.resetsAt || null;
  }
}

function signedOutError() {
  const error = new CloudError("Sign in to OUTARCH to continue.", { status: 401, code: "SIGNED_OUT" });
  error.managed = true;
  error.signedOut = true;
  return error;
}

function parseCallback(raw, scheme) {
  let url;
  try { url = new URL(String(raw)); } catch { return null; }
  if (url.protocol !== `${scheme}:`) return null;
  // outarch://auth/callback parses with host "auth" and path "/callback".
  const route = `${url.host}${url.pathname}`.replace(/\/+$/, "");
  if (route !== "auth/callback") return null;
  const params = new URLSearchParams(url.search);
  for (const [key, value] of new URLSearchParams(url.hash.replace(/^#/, ""))) params.set(key, value);
  return params;
}

// outarch://account/refresh is what the website opens after a purchase. It
// carries nothing: it only asks a signed-in app to read its plan now rather
// than at the next five-minute check.
function isAccountRefreshLink(raw, scheme) {
  let url;
  try { url = new URL(String(raw)); } catch { return false; }
  return url.protocol === `${scheme}:` && `${url.host}${url.pathname}`.replace(/\/+$/, "") === "account/refresh";
}

function isDeepLink(value, scheme) {
  return typeof value === "string" && value.toLowerCase().startsWith(`${scheme}://`);
}

class AccountService extends EventEmitter {
  #rest;
  #store;
  #config;
  #openExternal;
  #now;
  #random;
  #session;
  #snapshot;
  #verifiedAt;
  #state;
  #error;
  #signIn;
  #refreshing;
  #pollTimer;
  #lastFocusRefresh;
  #websiteUrl;
  #supportEmail;
  #plans;
  #publicReadAt;
  #engineReady;
  #waiters;
  #disposed;

  constructor(options = {}) {
    super();
    if (!options.rest) throw new TypeError("AccountService requires a Supabase client");
    if (!options.store) throw new TypeError("AccountService requires a session store");
    this.#rest = options.rest;
    this.#store = options.store;
    this.#config = options.config || { scheme: "outarch", websiteUrl: "http://localhost:5173", websiteLocked: false };
    this.#openExternal = typeof options.openExternal === "function" ? options.openExternal : async () => {};
    this.#now = typeof options.now === "function" ? options.now : Date.now;
    this.#random = typeof options.random === "function" ? options.random : size => crypto.randomBytes(size);
    this.#session = null;
    this.#snapshot = null;
    this.#verifiedAt = null;
    this.#state = "checking";
    this.#error = null;
    this.#signIn = null;
    this.#refreshing = null;
    this.#pollTimer = null;
    this.#lastFocusRefresh = 0;
    this.#websiteUrl = this.#config.websiteUrl;
    this.#supportEmail = "";
    this.#plans = [];
    this.#publicReadAt = 0;
    this.#engineReady = false;
    this.#waiters = [];
    this.#disposed = false;
  }

  static isDeepLink(value, scheme = "outarch") { return isDeepLink(value, scheme); }

  get websiteUrl() { return this.#websiteUrl; }

  // ------------------------------------------------------------------ status

  isAuthorized() { return this.#state === "authorized"; }

  entitlements() {
    return new Entitlements({ ...(this.#snapshot || {}), plans: this.#plans }, { now: this.#now });
  }

  status() {
    const snapshot = this.#snapshot || {};
    const authorized = this.#state === "authorized";
    const offline = authorized && this.#isOffline();
    return {
      state: this.#state,
      authorized,
      engineReady: authorized && this.#engineReady,
      offline,
      graceEndsAt: offline && this.#verifiedAt ? this.#verifiedAt + OFFLINE_GRACE_MS : null,
      user: authorized || this.#state === "signing-in" ? snapshot.user || null : null,
      plan: snapshot.plan || { id: "free", name: "Free", rank: 0 },
      subscription: snapshot.subscription || null,
      limits: normalizeLimits(snapshot.limits),
      usage: snapshot.usage || null,
      recipeTrial: snapshot.recipeTrial || null,
      builtinAiProviders: Array.isArray(snapshot.builtinAiProviders) ? snapshot.builtinAiProviders.filter(item => typeof item === "string") : [],
      // Providers with a key for arch_memory.md, kept apart from Mission AI's.
      builtinMemoryProviders: Array.isArray(snapshot.builtinMemoryProviders) ? snapshot.builtinMemoryProviders.filter(item => typeof item === "string") : [],
      plans: this.#plans.map(plan => ({ ...plan, limits: { ...plan.limits }, highlights: [...plan.highlights] })),
      verifiedAt: this.#verifiedAt,
      signIn: this.#signIn ? { mode: this.#signIn.mode, startedAt: this.#signIn.startedAt, expiresAt: this.#signIn.startedAt + SIGN_IN_TTL_MS } : null,
      error: this.#error,
      websiteUrl: this.#websiteUrl,
      supportEmail: this.#supportEmail
    };
  }

  #isOffline() {
    return Boolean(this.#snapshot?.__offline);
  }

  #emit() {
    if (this.#disposed) return;
    this.emit("change", this.status());
    if (this.#state === "authorized") {
      const waiters = this.#waiters;
      this.#waiters = [];
      for (const resolve of waiters) resolve(true);
    }
  }

  #setState(state, error = null) {
    this.#state = state;
    this.#error = error;
    this.#emit();
  }

  setEngineReady(ready) {
    this.#engineReady = ready === true;
    this.#emit();
  }

  whenAuthorized() {
    if (this.#state === "authorized") return Promise.resolve(true);
    return new Promise(resolve => this.#waiters.push(resolve));
  }

  // ------------------------------------------------------------ public data

  async #readPublic(force = false) {
    if (!force && this.#now() - this.#publicReadAt < PUBLIC_REFRESH_MS && this.#plans.length) return;
    try {
      const [config, plans] = await Promise.all([
        this.#rest.select("app_config", "select=key,value&key=in.(website_url,support_email)"),
        this.#rest.select("plans", "select=id,name,rank,tagline,price_label,highlights,limits,purchasable&order=rank.asc")
      ]);
      for (const row of Array.isArray(config) ? config : []) {
        if (row?.key === "website_url" && !this.#config.websiteLocked) {
          const origin = cleanOrigin(row.value);
          if (origin) this.#websiteUrl = origin;
        }
        if (row?.key === "support_email" && typeof row.value === "string") this.#supportEmail = row.value.slice(0, 200);
      }
      const catalogue = normalizePlanCatalogue(plans);
      if (catalogue.length) this.#plans = catalogue;
      this.#publicReadAt = this.#now();
    } catch {
      // The defaults stand in until the next read succeeds.
    }
  }

  // ---------------------------------------------------------------- session

  #sessionFrom(data, fallbackUserId = null) {
    const accessToken = typeof data?.access_token === "string" ? data.access_token : null;
    const refreshToken = typeof data?.refresh_token === "string" ? data.refresh_token : null;
    if (!accessToken || !refreshToken) return null;
    const expiresAt = Number(data.expires_at) > 0
      ? Number(data.expires_at) * 1000
      : this.#now() + Math.max(60, Number(data.expires_in) || 3600) * 1000;
    return { accessToken, refreshToken, expiresAt, userId: data.user?.id || fallbackUserId || null };
  }

  #persist() {
    if (!this.#session) return;
    try {
      const { __offline, ...entitlements } = this.#snapshot || {};
      this.#store.save({ session: this.#session, entitlements: this.#snapshot ? entitlements : null, verifiedAt: this.#verifiedAt });
    } catch {
      // The session still works for this run; the next launch asks again.
    }
  }

  async accessToken({ force = false } = {}) {
    if (!this.#session) throw signedOutError();
    if (!force && this.#session.expiresAt - REFRESH_AHEAD_MS > this.#now()) return this.#session.accessToken;
    if (!this.#refreshing) {
      this.#refreshing = (async () => {
        try {
          const data = await this.#rest.refreshSession(this.#session.refreshToken);
          const next = this.#sessionFrom(data, this.#session.userId);
          if (!next) throw new CloudError("The account service returned an unusable session");
          this.#session = next;
          this.#persist();
          return next.accessToken;
        } catch (error) {
          if (error instanceof CloudError && error.sessionRevoked) this.#endSession("Your session ended. Sign in again to keep using OUTARCH.");
          throw error;
        } finally {
          this.#refreshing = null;
        }
      })();
    }
    return this.#refreshing;
  }

  #endSession(message = null) {
    this.#session = null;
    this.#snapshot = null;
    this.#verifiedAt = null;
    try { this.#store.clear(); } catch { /* nothing to clear */ }
    this.#stopPolling();
    this.#setState("signed-out", message);
    this.emit("signed-out");
  }

  async #loadEntitlements() {
    const token = await this.accessToken();
    let data;
    try {
      data = await this.#rest.rpc("get_entitlements", {}, token);
    } catch (error) {
      // An access token the server no longer accepts gets one fresh try.
      if (error instanceof CloudError && error.status === 401) data = await this.#rest.rpc("get_entitlements", {}, await this.accessToken({ force: true }));
      else throw error;
    }
    if (!data || typeof data !== "object" || !data.user?.id) throw new CloudError("The account service returned no plan for this account");
    this.#snapshot = data;
    this.#verifiedAt = this.#now();
    this.#persist();
    return data;
  }

  /**
   * At launch: pick up the saved session and confirm it. Never throws.
   * Resolves to the resulting status.
   */
  async restore() {
    await this.#readPublic(true);
    let saved = null;
    try { saved = this.#store.read(); } catch { saved = null; }
    if (!saved?.session) {
      this.#setState("signed-out");
      return this.status();
    }
    this.#session = saved.session;
    this.#snapshot = saved.entitlements || null;
    this.#verifiedAt = saved.verifiedAt || null;
    try {
      await this.#loadEntitlements();
      this.#setState("authorized");
      this.#startPolling();
    } catch (error) {
      if (this.#state === "signed-out") return this.status();
      if (error instanceof CloudError && error.offline && this.#snapshot && this.#verifiedAt && this.#now() - this.#verifiedAt < OFFLINE_GRACE_MS) {
        this.#snapshot = { ...this.#snapshot, __offline: true };
        this.#setState("authorized");
        this.#startPolling();
      } else if (error instanceof CloudError && error.offline) {
        this.#session = null;
        this.#setState("signed-out", "OUTARCH could not reach its account service to confirm your plan. Check your connection and sign in again.");
      } else {
        this.#endSession(error instanceof CloudError && error.sessionRevoked ? "Your session ended. Sign in again to keep using OUTARCH." : `We couldn't confirm your account: ${error.message}`);
      }
    }
    return this.status();
  }

  /** Re-read a session another OUTARCH process saved (used while waiting at the sign-in screen). */
  async reloadFromDisk() {
    if (this.#state === "authorized") return false;
    let saved = null;
    try { saved = this.#store.read(); } catch { saved = null; }
    if (!saved?.session) return false;
    await this.restore();
    return this.isAuthorized();
  }

  // ---------------------------------------------------------------- sign in

  #portalUrl(page, query = {}) {
    const url = new URL(`${this.#websiteUrl}/${page}`);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return url.toString();
  }

  async beginSignIn({ mode = "signin" } = {}) {
    await this.#readPublic();
    const state = this.#random(32).toString("base64url");
    const safeMode = mode === "signup" ? "signup" : "signin";
    this.#signIn = { state, mode: safeMode, startedAt: this.#now() };
    try { this.#store.rememberPending(state); } catch { /* the in-memory copy still matches */ }
    const url = this.#portalUrl("auth", { client: "desktop", state, mode: safeMode });
    this.#setState(this.#state === "authorized" ? "authorized" : "signing-in");
    try {
      await this.#openExternal(url);
    } catch {
      this.#setState(this.#state === "authorized" ? "authorized" : "signing-in", "Your browser did not open. Copy the sign-in link instead.");
    }
    return { url };
  }

  cancelSignIn() {
    this.#signIn = null;
    try { this.#store.clearPending(); } catch { /* nothing pending */ }
    if (this.#state === "signing-in") this.#setState("signed-out");
    return this.status();
  }

  #stateMatches(state) {
    if (typeof state !== "string" || state.length < 20) return false;
    const live = this.#signIn && this.#now() - this.#signIn.startedAt < SIGN_IN_TTL_MS ? this.#signIn.state : null;
    if (live) {
      const a = Buffer.from(live);
      const b = Buffer.from(state);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
    }
    try { return this.#store.matchesPending(state); } catch { return false; }
  }

  /**
   * The website handing a session back. Returns { ok, error }.
   */
  async handleDeepLink(raw) {
    if (isAccountRefreshLink(raw, this.#config.scheme || "outarch")) {
      if (!this.#session) return { ok: false, error: "Sign in to OUTARCH first." };
      await this.refresh();
      return { ok: true, refreshed: true };
    }
    const params = parseCallback(raw, this.#config.scheme || "outarch");
    if (!params) return { ok: false, error: "That link is not an OUTARCH sign-in link." };
    if (!this.#stateMatches(params.get("state"))) {
      // The same link delivered twice while the first is still being checked:
      // the first one answers; this one is not news.
      if (this.#state === "checking") return { ok: false, error: "duplicate" };
      const message = "This sign-in link has expired or was not started from this app. Start again from OUTARCH.";
      if (this.#state !== "authorized") this.#setState(this.#signIn ? "signing-in" : "signed-out", message);
      return { ok: false, error: message };
    }
    this.#signIn = null;
    try { this.#store.clearPending(); } catch { /* nothing pending */ }

    const failure = params.get("error_description") || params.get("error");
    if (failure) {
      const message = `Sign-in did not finish: ${String(failure).slice(0, 200)}`;
      if (this.#state !== "authorized") this.#setState("signed-out", message);
      return { ok: false, error: message };
    }

    const session = this.#sessionFrom({
      access_token: params.get("access_token"),
      refresh_token: params.get("refresh_token"),
      expires_at: params.get("expires_at"),
      expires_in: params.get("expires_in")
    });
    if (!session) {
      if (this.#state !== "authorized") this.#setState("signed-out", "The website did not send a complete session. Try signing in again.");
      return { ok: false, error: "incomplete session" };
    }

    this.#setState("checking");
    try {
      // The token is confirmed by Supabase before it is trusted or saved.
      const user = await this.#rest.getUser(session.accessToken);
      if (!user?.id) throw new CloudError("The account service did not recognise this session");
      this.#session = { ...session, userId: user.id };
      await this.#loadEntitlements();
      this.#setState("authorized");
      this.#startPolling();
      this.emit("signed-in", this.status());
      return { ok: true };
    } catch (error) {
      this.#session = null;
      this.#snapshot = null;
      this.#setState("signed-out", error instanceof CloudError && error.offline
        ? "OUTARCH could not reach its account service. Check your connection and try again."
        : `We couldn't finish signing you in: ${error.message}`);
      return { ok: false, error: error.message };
    }
  }

  async signOut() {
    const token = this.#session?.accessToken;
    if (token) {
      try { await this.#rest.signOut(token); } catch { /* the local session ends either way */ }
    }
    this.#endSession(null);
    return this.status();
  }

  // ---------------------------------------------------------------- refresh

  async refresh({ force = true } = {}) {
    if (!this.#session) return this.status();
    await this.#readPublic(force);
    try {
      await this.#loadEntitlements();
      if (this.#state !== "authorized") this.#setState("authorized");
      else this.#emit();
    } catch (error) {
      if (this.#state !== "authorized") return this.status();
      if (error instanceof CloudError && error.offline) {
        if (this.#verifiedAt && this.#now() - this.#verifiedAt >= OFFLINE_GRACE_MS) {
          this.#setState("signed-out", "OUTARCH has been offline too long to confirm your plan. Connect to the internet and sign in again.");
          this.#session = null;
          return this.status();
        }
        this.#snapshot = { ...(this.#snapshot || {}), __offline: true };
        this.#emit();
      } else if (!(error instanceof CloudError && error.sessionRevoked)) {
        this.#error = `Plan check failed: ${error.message}`;
        this.#emit();
      }
    }
    return this.status();
  }

  noteWindowFocus() {
    if (this.#state !== "authorized") return;
    if (this.#now() - this.#lastFocusRefresh < FOCUS_REFRESH_MIN_MS) return;
    this.#lastFocusRefresh = this.#now();
    void this.refresh({ force: false });
  }

  #startPolling() {
    this.#stopPolling();
    this.#pollTimer = setInterval(() => { void this.refresh({ force: false }); }, POLL_INTERVAL_MS);
    this.#pollTimer.unref?.();
  }

  #stopPolling() {
    if (this.#pollTimer) clearInterval(this.#pollTimer);
    this.#pollTimer = null;
  }

  // ---------------------------------------------------------------- portal

  async openPortal(page = "account", query = {}) {
    const allowed = new Set(["account", "pricing"]);
    const target = allowed.has(page) ? page : "account";
    const clean = {};
    if (typeof query.plan === "string" && /^[a-z][a-z0-9_-]{1,31}$/.test(query.plan)) clean.plan = query.plan;
    if (typeof query.feature === "string" && /^[A-Za-z]{1,40}$/.test(query.feature)) clean.feature = query.feature;
    const url = this.#portalUrl(target, clean);
    await this.#openExternal(url);
    return { url };
  }

  // ------------------------------------------------------------- Mission AI

  /** One metered Mission AI message. Throws PlanLimitError when the plan's quota is used. */
  async beginAiTurn(surface = "mission") {
    if (!this.#session) throw signedOutError();
    const token = await this.accessToken();
    let result;
    try {
      result = await this.#rest.rpc("begin_ai_turn", { p_surface: String(surface).slice(0, 32) }, token);
    } catch (error) {
      if (error instanceof CloudError && error.status === 401) {
        result = await this.#rest.rpc("begin_ai_turn", { p_surface: String(surface).slice(0, 32) }, await this.accessToken({ force: true }));
      } else {
        const wrapped = new Error(error instanceof CloudError && error.offline ? "Mission AI needs an internet connection." : `Mission AI could not start: ${error.message}`);
        wrapped.managed = true;
        wrapped.status = error.status || 503;
        throw wrapped;
      }
    }
    if (this.#snapshot && result && Number.isFinite(Number(result.used))) {
      const usage = this.#snapshot.usage?.missionAiMessages || {};
      this.#snapshot = { ...this.#snapshot, usage: { ...(this.#snapshot.usage || {}), missionAiMessages: { ...usage, used: Number(result.used), limit: result.limit ?? usage.limit ?? null, period: result.period || usage.period, resetsAt: result.resetsAt ?? usage.resetsAt ?? null } } };
      this.#emit();
    }
    if (!result?.allowed || typeof result.turnId !== "string") {
      const limit = Number(result?.limit);
      const period = result?.period === "month" ? "this month" : result?.period === "lifetime" ? "on your plan" : "today";
      const required = this.entitlements().requiredPlanFor("missionAiMessages");
      const message = result?.reason === "daily-ceiling"
        ? "Mission AI has reached its daily safety limit for this account. It resets within a day."
        : `You've used ${Number.isFinite(limit) ? `all ${limit}` : "all your"} Mission AI messages ${period}. Upgrade to ${required.name} for unlimited Mission AI.`;
      throw new PlanLimitError(message, { requiredPlan: required, resetsAt: result?.resetsAt || null });
    }
    return result;
  }

  dispose() {
    this.#disposed = true;
    this.#stopPolling();
    for (const resolve of this.#waiters) resolve(false);
    this.#waiters = [];
    this.removeAllListeners();
  }
}

module.exports = { AccountService, OFFLINE_GRACE_MS, PlanLimitError, isDeepLink, parseCallback, signedOutError };
