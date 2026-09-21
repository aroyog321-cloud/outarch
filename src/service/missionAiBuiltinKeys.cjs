"use strict";

// ============================================================================
//  MISSION AI — BUILT-IN KEYS
//
//  No built-in key ships in the app any more. The keys live in the OUTARCH
//  Supabase project (table public.ai_provider_keys) and are used only by the
//  ai-proxy Edge Function, which the app reaches with the signed-in user's
//  session. To replace a key that is used up, add a row to that table (or run
//  `select admin.add_ai_key('gemini', '<key>', 'label');`) — no rebuild.
//
//  The constants stay, empty, so a development build can still be pointed at
//  keys of its own through the `keys` option (the tests do exactly that).
// ============================================================================

const MISSION_AI_PRIMARY_KEY = "";
const MISSION_AI_FALLBACK_KEY = "";

const MISSION_AI_NVIDIA_PRIMARY_KEY = "";
const MISSION_AI_NVIDIA_FALLBACK_KEY = "";

// ----------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const { isMissionModelId } = require("./aiProviders.cjs");
const { MANAGED_KEY_PLACEHOLDER } = require("./managedAiTransport.cjs");

const PREFERENCES_VERSION = 1;
const MAX_PREFERENCES_BYTES = 16 * 1024;

function usableKey(value) {
  return typeof value === "string" && value.trim().length >= 20 && !/\s/.test(value.trim());
}

function builtinKeys(override = null) {
  // Tests inject their own keys; the shipped app reads the constants above.
  if (override && typeof override === "object") {
    if (override.gemini || override.nvidia) {
      return {
        gemini: {
          primary: usableKey(override.gemini?.primary) ? override.gemini.primary.trim() : null,
          fallback: usableKey(override.gemini?.fallback) ? override.gemini.fallback.trim() : null
        },
        nvidia: {
          primary: usableKey(override.nvidia?.primary) ? override.nvidia.primary.trim() : null,
          fallback: usableKey(override.nvidia?.fallback) ? override.nvidia.fallback.trim() : null
        }
      };
    }
    const hasNvidia = Boolean(override.nvidiaPrimary || override.nvidiaFallback || (override.primary && override.primary.startsWith("nvapi-")));
    return {
      gemini: {
        primary: usableKey(override.primary) && !override.primary.startsWith("nvapi-") ? override.primary.trim() : null,
        fallback: usableKey(override.fallback) && !override.fallback.startsWith("nvapi-") ? override.fallback.trim() : null
      },
      nvidia: {
        primary: usableKey(override.nvidiaPrimary) ? override.nvidiaPrimary.trim() : (override.primary && override.primary.startsWith("nvapi-") ? override.primary.trim() : null),
        fallback: usableKey(override.nvidiaFallback) ? override.nvidiaFallback.trim() : (override.fallback && override.fallback.startsWith("nvapi-") ? override.fallback.trim() : null)
      }
    };
  }

  return {
    gemini: {
      primary: usableKey(MISSION_AI_PRIMARY_KEY) ? MISSION_AI_PRIMARY_KEY.trim() : null,
      fallback: usableKey(MISSION_AI_FALLBACK_KEY) ? MISSION_AI_FALLBACK_KEY.trim() : null
    },
    nvidia: {
      primary: usableKey(MISSION_AI_NVIDIA_PRIMARY_KEY) ? MISSION_AI_NVIDIA_PRIMARY_KEY.trim() : null,
      fallback: usableKey(MISSION_AI_NVIDIA_FALLBACK_KEY) ? MISSION_AI_NVIDIA_FALLBACK_KEY.trim() : null
    }
  };
}

// Mission AI's credential source. It speaks the same interface the encrypted
// operator credential store did, so MissionAIService and the Mission Supervisor
// keep working unchanged — but it has no way to accept a key. The only thing an
// operator can change here is which model answers, which is a preference and is
// kept in a plain file of its own.
class BuiltinMissionAiCredentials {
  #keys;
  #preferencesPath;
  #fs;
  #managed;

  constructor(options = {}) {
    this.#keys = builtinKeys(options.keys || null);
    // Managed mode: the keys are on the server and the ai-proxy uses them.
    // `providers()` says which providers the server has a key for right now.
    this.#managed = !options.keys && options.managed && typeof options.managed.providers === "function" ? options.managed : null;
    this.#preferencesPath = typeof options.preferencesPath === "string" && options.preferencesPath
      ? path.resolve(options.preferencesPath)
      : null;
    this.#fs = options.fs || fs;
  }

  #readPreferences() {
    if (!this.#preferencesPath) return { model: null, includeTerminalEvidence: false };
    try {
      const raw = this.#fs.readFileSync(this.#preferencesPath);
      if (raw.length > MAX_PREFERENCES_BYTES) return { model: null, includeTerminalEvidence: false };
      const value = JSON.parse(raw.toString("utf8"));
      return {
        // Only curated built-in models run on the built-in keys, whatever the file says.
        model: isMissionModelId(value?.model) ? value.model : null,
        includeTerminalEvidence: value?.includeTerminalEvidence === true
      };
    } catch {
      return { model: null, includeTerminalEvidence: false };
    }
  }

  #writePreferences(value) {
    if (!this.#preferencesPath) return;
    const directory = path.dirname(this.#preferencesPath);
    this.#fs.mkdirSync(directory, { recursive: true });
    const temporary = `${this.#preferencesPath}.${process.pid}.${Date.now()}.tmp`;
    this.#fs.writeFileSync(temporary, `${JSON.stringify({ version: PREFERENCES_VERSION, ...value, updatedAt: Date.now() }, null, 2)}\n`, { encoding: "utf8" });
    this.#fs.renameSync(temporary, this.#preferencesPath);
  }

  #managedProviders() {
    try {
      const listed = this.#managed.providers();
      return Array.isArray(listed) ? listed.filter(item => item === "gemini" || item === "nvidia") : [];
    } catch {
      return [];
    }
  }

  hasKey(slot = "primary", provider = null) {
    const wantsFallback = slot === "secondary" || slot === "fallback";
    if (this.#managed) {
      // The server rotates its own keys; there is one managed slot per provider.
      if (wantsFallback) return false;
      const providers = this.#managedProviders();
      return provider ? providers.includes(provider) : providers.length > 0;
    }
    const subSlot = wantsFallback ? "fallback" : "primary";
    if (provider === "nvidia") {
      return Boolean(this.#keys.nvidia?.[subSlot]);
    }
    if (provider === "gemini") {
      return Boolean(this.#keys.gemini?.[subSlot]);
    }
    return Boolean(this.#keys.gemini?.[subSlot] || this.#keys.nvidia?.[subSlot]);
  }

  protectionStatus() {
    return this.#managed
      ? { available: true, backend: "managed", protection: "server" }
      : { available: true, backend: "built-in", protection: "built-in" };
  }

  status() {
    const preferences = this.#readPreferences();
    const primaryGemini = this.hasKey("primary", "gemini");
    const fallbackGemini = this.hasKey("fallback", "gemini");
    const primaryNvidia = this.hasKey("primary", "nvidia");
    const fallbackNvidia = this.hasKey("fallback", "nvidia");
    const primary = primaryGemini || primaryNvidia;
    const fallback = fallbackGemini || fallbackNvidia;
    return {
      configured: primary || fallback,
      builtin: true,
      keyState: {
        primary: { configured: primary },
        secondary: { configured: fallback },
        gemini: { primary: primaryGemini, fallback: fallbackGemini },
        nvidia: { primary: primaryNvidia, fallback: fallbackNvidia }
      },
      activeSlot: primary ? "primary" : fallback ? "secondary" : null,
      secondaryConfigured: fallback,
      model: preferences.model || "gemini-2.5-flash",
      includeTerminalEvidence: preferences.includeTerminalEvidence,
      managed: Boolean(this.#managed),
      ...this.protectionStatus(),
      error: primary || fallback ? null : this.#managed ? "Sign in to OUTARCH to use Mission AI" : "Mission AI keys are not set in this build"
    };
  }

  preferences() {
    const preferences = this.#readPreferences();
    return { model: preferences.model || "gemini-2.5-flash", includeTerminalEvidence: preferences.includeTerminalEvidence };
  }

  // Keys are not configurable here, by design. A request that tries is refused
  // with the reason rather than silently ignored.
  configure(value = {}) {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Mission AI configuration must be an object");
    if (["apiKey", "apiKeySecondary", "clearSecondary"].some(field => Object.hasOwn(value, field))) {
      throw new Error("Mission AI uses the keys built into this app and cannot be given another one. Add your own key under Mission AI → Keys & models instead.");
    }
    const current = this.#readPreferences();
    const next = {
      model: Object.hasOwn(value, "model") && isMissionModelId(value.model) ? value.model : current.model,
      includeTerminalEvidence: Object.hasOwn(value, "includeTerminalEvidence") ? value.includeTerminalEvidence === true : current.includeTerminalEvidence
    };
    this.#writePreferences(next);
    return this.status();
  }

  apiKey(slot = "primary", provider = null) {
    const wantsFallback = slot === "secondary" || slot === "fallback";
    if (this.#managed) {
      // A placeholder the provider layer accepts; the managed transport drops it.
      if (this.hasKey(wantsFallback ? "fallback" : "primary", provider)) return MANAGED_KEY_PLACEHOLDER;
      throw new Error("Mission AI is not available right now. Sign in to OUTARCH, or try again shortly.");
    }
    const targetProvider = provider === "nvidia" ? "nvidia" : (provider === "gemini" ? "gemini" : (this.#keys.gemini?.primary || this.#keys.gemini?.fallback ? "gemini" : "nvidia"));
    const bucket = this.#keys[targetProvider] || this.#keys.gemini;
    const key = wantsFallback ? (bucket.fallback || bucket.primary) : (bucket.primary || bucket.fallback);
    if (!key) {
      if (provider === "nvidia") throw new Error("Mission AI NVIDIA keys are not set in this build");
      throw new Error("Mission AI keys are not set in this build");
    }
    return key;
  }

  clear() {
    throw new Error("Mission AI's built-in keys cannot be removed from inside the app");
  }
}

module.exports = { BuiltinMissionAiCredentials, builtinKeys, usableKey };
