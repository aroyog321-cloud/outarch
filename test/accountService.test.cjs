"use strict";

// The OUTARCH account in the main process: the website hands a session back
// through outarch://, only for a sign-in this app started; the session is
// kept encrypted, refreshed and confirmed; a revoked or long-offline session
// locks the app; Mission AI's built-in models are reached only through the
// ai-proxy with a metered turn.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { AccountService, OFFLINE_GRACE_MS, PlanLimitError, parseCallback } = require("../src/service/accountService.cjs");
const { AccountSessionStore } = require("../src/service/accountSessionStore.cjs");
const { CloudError } = require("../src/service/supabaseRest.cjs");
const { createManagedAiFetch, MANAGED_KEY_PLACEHOLDER } = require("../src/service/managedAiTransport.cjs");

const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => "dpapi",
  encryptString: text => Buffer.from(`sealed:${Buffer.from(text).toString("base64")}`),
  decryptString: buffer => Buffer.from(String(buffer).replace(/^sealed:/, ""), "base64").toString()
};

function tempFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "outarch-account-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "account-session.json");
}

const ENTITLEMENTS = {
  user: { id: "user-1", email: "dev@example.com", name: "Dev", provider: "google" },
  plan: { id: "free", name: "Free", rank: 0 },
  limits: { terminals: 3, mcp: "none", missionAiMessages: 3, missionAiPeriod: "day" },
  usage: { missionAiMessages: { used: 0, limit: 3, period: "day", resetsAt: null } },
  builtinAiProviders: ["gemini"]
};

function fakeRest(overrides = {}) {
  const calls = [];
  let refreshCount = 0;
  const rest = {
    calls,
    select: async table => { calls.push(["select", table]); return table === "plans" ? [{ id: "free", name: "Free", rank: 0, limits: {} }] : [{ key: "website_url", value: "https://outarch.example" }]; },
    getUser: async token => { calls.push(["getUser", token]); if (token !== "access-1" && token !== "access-2") throw new CloudError("bad token", { status: 401 }); return { id: "user-1" }; },
    refreshSession: async token => { calls.push(["refresh", token]); refreshCount += 1; return { access_token: `access-r${refreshCount}`, refresh_token: `refresh-r${refreshCount}`, expires_in: 3600, user: { id: "user-1" } }; },
    rpc: async (name, args, token) => { calls.push(["rpc", name, token]); if (name === "get_entitlements") return ENTITLEMENTS; if (name === "begin_ai_turn") return { allowed: true, turnId: "11111111-1111-4111-8111-111111111111", used: 1, limit: 3, period: "day" }; return null; },
    signOut: async token => { calls.push(["signOut", token]); return {}; },
    ...overrides
  };
  return rest;
}

function service(t, { rest = fakeRest(), now = () => 1_000_000, opened = [] } = {}) {
  const store = new AccountSessionStore(tempFile(t), { safeStorage: fakeSafeStorage, now });
  let counter = 0;
  const account = new AccountService({
    rest,
    store,
    now,
    config: { scheme: "outarch", websiteUrl: "http://localhost:5173", websiteLocked: false },
    openExternal: async url => { opened.push(url); },
    random: size => Buffer.alloc(size, ++counter)
  });
  t.after(() => account.dispose());
  return { account, store, rest, opened };
}

function callbackFor(url, tokens = {}) {
  const state = new URL(url).searchParams.get("state");
  const fragment = new URLSearchParams({ access_token: "access-1", refresh_token: "refresh-1", expires_in: "3600", ...tokens });
  return `outarch://auth/callback?state=${encodeURIComponent(state)}#${fragment}`;
}

test("with no saved session the app starts at the sign-in screen", async t => {
  const { account } = service(t);
  const status = await account.restore();
  assert.equal(status.state, "signed-out");
  assert.equal(status.authorized, false);
  assert.equal(status.websiteUrl, "https://outarch.example", "the website address comes from app_config");
});

test("signing in opens the website with a one-time state, and only that state is accepted back", async t => {
  const { account, opened, store } = service(t);
  await account.restore();
  const { url } = await account.beginSignIn({ mode: "signup" });
  assert.equal(opened[0], url);
  const parsed = new URL(url);
  assert.equal(parsed.origin + parsed.pathname, "https://outarch.example/auth");
  assert.equal(parsed.searchParams.get("client"), "desktop");
  assert.equal(parsed.searchParams.get("mode"), "signup");
  assert.equal(account.status().state, "signing-in");

  const forged = await account.handleDeepLink("outarch://auth/callback?state=someone-elses-state-value-123#access_token=access-1&refresh_token=refresh-1");
  assert.equal(forged.ok, false, "a link this app did not start is refused");
  assert.equal(account.isAuthorized(), false);

  const accepted = await account.handleDeepLink(callbackFor(url));
  assert.equal(accepted.ok, true);
  assert.equal(account.isAuthorized(), true);
  assert.equal(account.status().user.email, "dev@example.com");
  assert.equal(account.status().plan.id, "free");
  assert.equal(JSON.stringify(account.status()).includes("refresh-1"), false, "no token reaches the renderer's status");
  assert.ok(store.read()?.session?.refreshToken, "the session is saved");
  assert.equal(fs.readFileSync(store.filePath, "utf8").includes("refresh-1"), false, "and saved encrypted");

  const replay = await account.handleDeepLink(callbackFor(url));
  assert.equal(replay.ok, false, "a state is single-use");
});

test("the website's refresh link re-reads the plan at once, and never signs anyone in", async t => {
  const { account, rest } = service(t);
  await account.restore();
  const signedOut = await account.handleDeepLink("outarch://account/refresh");
  assert.equal(signedOut.ok, false, "a signed-out app has no plan to refresh");
  assert.equal(account.isAuthorized(), false);

  const { url } = await account.beginSignIn();
  await account.handleDeepLink(callbackFor(url));
  const before = rest.calls.filter(call => call[1] === "get_entitlements").length;
  const refreshed = await account.handleDeepLink("outarch://account/refresh/");
  assert.equal(refreshed.ok, true);
  assert.equal(rest.calls.filter(call => call[1] === "get_entitlements").length, before + 1, "the plan is read again");
  assert.equal(account.isAuthorized(), true);
});

test("the website's link is confirmed with Supabase before it is trusted", async t => {
  const { account } = service(t);
  await account.restore();
  const { url } = await account.beginSignIn();
  const result = await account.handleDeepLink(callbackFor(url, { access_token: "forged-token" }));
  assert.equal(result.ok, false);
  assert.equal(account.isAuthorized(), false);
  assert.match(account.status().error, /couldn't finish signing you in/);
});

test("a saved session is refreshed when it nears expiry, and the new refresh token is kept", async t => {
  let now = 1_000_000;
  const { account, store, rest } = service(t, { now: () => now });
  await account.restore();
  const { url } = await account.beginSignIn();
  await account.handleDeepLink(callbackFor(url, { expires_in: "120" }));
  now += 60_000;
  const token = await account.accessToken();
  assert.equal(token, "access-r1");
  assert.equal(store.read().session.refreshToken, "refresh-r1");
  assert.ok(rest.calls.some(call => call[0] === "refresh" && call[1] === "refresh-1"));
});

test("a revoked session signs the app out", async t => {
  const rest = fakeRest({ refreshSession: async () => { throw new CloudError("Invalid Refresh Token: Already Used", { status: 400, sessionRevoked: true }); } });
  let now = 1_000_000;
  const { account, store } = service(t, { rest, now: () => now });
  await account.restore();
  const { url } = await account.beginSignIn();
  await account.handleDeepLink(callbackFor(url, { expires_in: "60" }));
  now += 120_000;
  await assert.rejects(() => account.accessToken());
  assert.equal(account.status().state, "signed-out");
  assert.equal(store.read(), null);
});

test("offline, the last confirmed plan keeps working for the grace period only", async t => {
  const file = tempFile(t);
  const saved = new AccountSessionStore(file, { safeStorage: fakeSafeStorage });
  saved.save({ session: { accessToken: "access-1", refreshToken: "refresh-1", expiresAt: 2_000_000_000_000, userId: "user-1" }, entitlements: ENTITLEMENTS, verifiedAt: 1_000_000 });
  const offline = fakeRest({ rpc: async () => { throw new CloudError("offline", { offline: true }); }, select: async () => { throw new CloudError("offline", { offline: true }); } });

  const within = new AccountService({ rest: offline, store: new AccountSessionStore(file, { safeStorage: fakeSafeStorage }), now: () => 1_000_000 + OFFLINE_GRACE_MS - 1000 });
  t.after(() => within.dispose());
  const inside = await within.restore();
  assert.equal(inside.authorized, true);
  assert.equal(inside.offline, true);

  const beyond = new AccountService({ rest: offline, store: new AccountSessionStore(file, { safeStorage: fakeSafeStorage }), now: () => 1_000_000 + OFFLINE_GRACE_MS + 1000 });
  t.after(() => beyond.dispose());
  assert.equal((await beyond.restore()).authorized, false);
});

test("a Mission AI message past the plan's quota is a PlanLimitError naming the upgrade", async t => {
  const rest = fakeRest({ rpc: async name => (name === "get_entitlements" ? { ...ENTITLEMENTS, plans: undefined } : { allowed: false, used: 3, limit: 3, period: "day" }) });
  const { account } = service(t, { rest });
  await account.restore();
  const { url } = await account.beginSignIn();
  await account.handleDeepLink(callbackFor(url));
  await assert.rejects(() => account.beginAiTurn("mission"), error => error instanceof PlanLimitError && /all 3 Mission AI messages today/.test(error.message) && error.planLimit === true);
});

test("signing out ends the session on this device", async t => {
  const { account, store, rest } = service(t);
  await account.restore();
  const { url } = await account.beginSignIn();
  await account.handleDeepLink(callbackFor(url));
  await account.signOut();
  assert.equal(account.isAuthorized(), false);
  assert.equal(store.read(), null);
  assert.ok(rest.calls.some(call => call[0] === "signOut"));
});

test("only outarch://auth/callback links are read", () => {
  assert.equal(parseCallback("https://example.com/auth/callback?state=x", "outarch"), null);
  assert.equal(parseCallback("outarch://evil/callback?state=x", "outarch"), null);
  assert.equal(parseCallback("outarch://auth/callback?state=abc#access_token=t", "outarch").get("access_token"), "t");
});

// ---------------------------------------------------------------- transport

test("built-in model calls go to the ai-proxy with a turn, never to the provider with a key", async () => {
  const sent = [];
  const account = {
    turns: 0,
    beginAiTurn: async () => { account.turns += 1; return { turnId: `turn-${account.turns}` }; },
    accessToken: async () => "user-jwt"
  };
  let answer = { status: 200, headers: new Map(), body: "{}" };
  const rest = {
    invokeRaw: async (name, options) => {
      sent.push({ name, ...options });
      return { status: answer.status, ok: answer.status < 400, headers: { get: key => answer.headers.get(key) || null }, clone() { return { json: async () => JSON.parse(answer.body) }; } };
    }
  };
  const fetch = createManagedAiFetch({ account, rest });
  const turn = { surface: "mission" };
  await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${MANAGED_KEY_PLACEHOLDER}`, { method: "POST", headers: { "x-goog-api-key": MANAGED_KEY_PLACEHOLDER }, body: JSON.stringify({ contents: [] }) }, turn);
  await fetch("https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", { method: "POST", body: "{}" }, turn);
  assert.equal(account.turns, 1, "one message is one turn, however many rounds it takes");
  assert.equal(sent[0].name, "ai-proxy");
  assert.equal(sent[0].token, "user-jwt");
  assert.equal(sent[0].headers["x-outarch-turn"], "turn-1");
  assert.equal(sent[0].body.path, "/v1beta/models/gemini-2.5-flash:generateContent", "the placeholder key is stripped");
  assert.equal(JSON.stringify(sent).includes(MANAGED_KEY_PLACEHOLDER), false);

  await assert.rejects(() => fetch("https://api.openai.com/v1/chat/completions", { method: "POST", body: "{}" }, {}), /only reach its own model providers/);

  // A turn that expired (a long approval) is replaced once.
  answer = { status: 409, headers: new Map([["x-outarch-proxy-error", "TURN_EXPIRED"]]), body: JSON.stringify({ error: { message: "ended" } }) };
  const expired = { surface: "mission", id: "old" };
  await assert.rejects(() => fetch("https://integrate.api.nvidia.com/v1/chat/completions", { method: "POST", body: "{}" }, expired));
  assert.equal(account.turns, 2);
});
