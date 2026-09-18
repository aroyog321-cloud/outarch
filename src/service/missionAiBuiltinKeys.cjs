"use strict";

// ============================================================================
//  MISSION AI — BUILT-IN GEMINI KEYS
//
//  Paste this build's two Google AI Studio keys between the quotes below.
//  The primary key answers every request; when Google refuses it (quota
//  exhausted, rate limited, revoked) the fallback key takes the same request.
//
//  How these are protected, and the limit of that protection:
//    - They live only in the Electron main process. No IPC method, status
//      payload, audit record, usage record or error message ever carries them;
//      the renderer can learn that a key is configured and nothing else.
//    - There is no UI that can read, replace or clear them.
//    - They are part of the shipped application, so anyone who unpacks the
//      installed app can recover them. Restrict them in Google AI Studio (API
//      restrictions, quota caps) accordingly, and rotate them by editing this
//      file and rebuilding.
// ============================================================================

const MISSION_AI_PRIMARY_KEY = "AQ.Ab8RN6JvljUGoIzVbZms0iDcRZdsMYn_ZmBOP_4E7DevQihklg";
const MISSION_AI_FALLBACK_KEY = "AQ.Ab8RN6J0gq3tUL-4tHvV6w1T9lGawVl-ieV-pKeJR_Kr_6geeg";

const MISSION_AI_NVIDIA_PRIMARY_KEY = "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";
const MISSION_AI_NVIDIA_FALLBACK_KEY = "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";

// ----------------------------------------------------------------------------

const fs = require("node:fs");
const path = require("node:path");
const { isMissionModelId } = require("./aiProviders.cjs");

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

  constructor(options = {}) {
    this.#keys = builtinKeys(options.keys || null);
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

  hasKey(slot = "primary", provider = null) {
    const wantsFallback = slot === "secondary" || slot === "fallback";
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
    return { available: true, backend: "built-in", protection: "built-in" };
  }

  status() {
    const preferences = this.#readPreferences();
    const primaryGemini = Boolean(this.#keys.gemini?.primary);
    const fallbackGemini = Boolean(this.#keys.gemini?.fallback);
    const primaryNvidia = Boolean(this.#keys.nvidia?.primary);
    const fallbackNvidia = Boolean(this.#keys.nvidia?.fallback);
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
      ...this.protectionStatus(),
      error: primary || fallback ? null : "Mission AI keys are not set in this build"
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
