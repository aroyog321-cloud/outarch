"use strict";

// Where OUTARCH's account backend lives.
//
// The publishable key is meant to be in the app: it only identifies the
// project. Everything it can reach is guarded by row level security, and the
// built-in AI keys never leave the ai-proxy Edge Function. No secret belongs in
// this file.
//
// Every value can be overridden for development:
//   OUTARCH_SUPABASE_URL, OUTARCH_SUPABASE_KEY, OUTARCH_WEBSITE_URL

const SUPABASE_URL = "https://qswiqzootfwkbbbvhfyj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_Hzu_YYvjpON_JuygUzx3EA_Ti7O-fu5";
// Used until the app has read `website_url` from the public app_config table.
const DEFAULT_WEBSITE_URL = "http://localhost:5173";
// outarch://auth/callback is where the website hands a signed-in session back.
const DEEP_LINK_SCHEME = "outarch";

function httpsOrLoopback(value) {
  try {
    const url = new URL(String(value));
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url;
    if (url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url;
    return null;
  } catch {
    return null;
  }
}

function cleanOrigin(value) {
  const url = httpsOrLoopback(value);
  if (!url) return null;
  // A path is allowed (a site served under /outarch), a query or hash is not.
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function cloudConfig(env = process.env) {
  const supabaseUrl = cleanOrigin(env.OUTARCH_SUPABASE_URL) || SUPABASE_URL;
  const publishableKey = typeof env.OUTARCH_SUPABASE_KEY === "string" && /^[A-Za-z0-9._-]{20,400}$/.test(env.OUTARCH_SUPABASE_KEY)
    ? env.OUTARCH_SUPABASE_KEY
    : SUPABASE_PUBLISHABLE_KEY;
  const websiteOverride = cleanOrigin(env.OUTARCH_WEBSITE_URL);
  return Object.freeze({
    supabaseUrl,
    publishableKey,
    websiteUrl: websiteOverride || DEFAULT_WEBSITE_URL,
    websiteLocked: Boolean(websiteOverride),
    scheme: DEEP_LINK_SCHEME
  });
}

module.exports = { DEEP_LINK_SCHEME, DEFAULT_WEBSITE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, cleanOrigin, cloudConfig, httpsOrLoopback };
