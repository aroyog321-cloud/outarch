"use strict";

// Model pricing catalog and cost calculator for OUTARCH Token & Cost Ledger.
// Prices are normalized per 1 Million tokens (USD).
// Reference: September 2026 public API rates.

const MODEL_PRICING = {
  // Google Gemini & Gemma
  "gemini-3.5-flash-lite": { inputPerM: 0.0375, outputPerM: 0.15, cacheReadPerM: 0.009375 },
  "gemini-3.1-flash-lite": { inputPerM: 0.0375, outputPerM: 0.15, cacheReadPerM: 0.009375 },
  "gemini-3.6-flash": { inputPerM: 0.075, outputPerM: 0.30, cacheReadPerM: 0.01875 },
  "gemini-3.7-flash": { inputPerM: 0.075, outputPerM: 0.30, cacheReadPerM: 0.01875 },
  "gemini-3.8-flash": { inputPerM: 0.075, outputPerM: 0.30, cacheReadPerM: 0.01875 },
  "gemini-3.1-pro-preview": { inputPerM: 1.25, outputPerM: 5.00, cacheReadPerM: 0.3125 },
  "gemini-2.5-flash": { inputPerM: 0.075, outputPerM: 0.30, cacheReadPerM: 0.01875 },
  "gemini-2.5-flash-lite": { inputPerM: 0.0375, outputPerM: 0.15, cacheReadPerM: 0.009375 },
  "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 5.00, cacheReadPerM: 0.3125 },
  "gemini-2.0-flash": { inputPerM: 0.10, outputPerM: 0.40, cacheReadPerM: 0.025 },
  "gemini-2.0-flash-lite": { inputPerM: 0.05, outputPerM: 0.20, cacheReadPerM: 0.0125 },
  "gemini-1.5-flash": { inputPerM: 0.075, outputPerM: 0.30, cacheReadPerM: 0.01875 },
  "gemini-1.5-pro": { inputPerM: 1.25, outputPerM: 5.00, cacheReadPerM: 0.3125 },
  "gemini-1.5-flash-8b": { inputPerM: 0.0375, outputPerM: 0.15, cacheReadPerM: 0.009375 },
  "gemma-2-27b-it": { inputPerM: 0.05, outputPerM: 0.20, cacheReadPerM: 0.01 },
  "gemma-2-9b-it": { inputPerM: 0.03, outputPerM: 0.12, cacheReadPerM: 0.0075 },
  "gemma-4-31b-it": { inputPerM: 0.05, outputPerM: 0.20, cacheReadPerM: 0.01 },
  "gemma-4-26b-a4b-it": { inputPerM: 0.05, outputPerM: 0.20, cacheReadPerM: 0.01 },

  // Anthropic Claude
  "claude-3-5-sonnet": { inputPerM: 3.00, outputPerM: 15.00, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },
  "claude-3-7-sonnet": { inputPerM: 3.00, outputPerM: 15.00, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },
  "claude-3-5-haiku": { inputPerM: 0.80, outputPerM: 4.00, cacheReadPerM: 0.08, cacheWritePerM: 1.00 },

  // OpenAI
  "gpt-4o": { inputPerM: 2.50, outputPerM: 10.00, cacheReadPerM: 1.25 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.60, cacheReadPerM: 0.075 },
  "o1": { inputPerM: 15.00, outputPerM: 60.00 },
  "o3-mini": { inputPerM: 1.10, outputPerM: 4.40 },

  // NVIDIA NIM
  "nvidia/nemotron-3.5-lightning-30b-a3b": { inputPerM: 0.15, outputPerM: 0.60 },
  "nvidia/nemotron-3-super-120b-a12b": { inputPerM: 0.30, outputPerM: 1.20 },
  "nvidia/nemotron-3-ultra-550b-a55b": { inputPerM: 0.60, outputPerM: 2.40 },
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning": { inputPerM: 0.15, outputPerM: 0.60 },
  "meta/llama-3.2-11b-vision-instruct": { inputPerM: 0.10, outputPerM: 0.30 },
  "meta/muse-glimmer-30b": { inputPerM: 0.10, outputPerM: 0.30 },
  "openai/gpt-oss-20b": { inputPerM: 0.10, outputPerM: 0.30 },
  "z-ai/glm-5.3": { inputPerM: 0.20, outputPerM: 0.80 },
  "google/diffusiongemma-26b-a4b-it": { inputPerM: 0.10, outputPerM: 0.40 },
  "moonshotai/kimi-k3": { inputPerM: 0.40, outputPerM: 1.60 }
};

const DEFAULT_PRICING = { inputPerM: 0.10, outputPerM: 0.40, cacheReadPerM: 0.025 };

/**
 * Calculates estimated USD cost for a given token breakdown and model.
 * @param {string} model - Model identifier (e.g., 'gemini-2.5-flash').
 * @param {object} tokens - { input, output, cacheRead, cacheWrite, reasoning }
 * @returns {object} { amount, currency: 'USD', basis, priceVersion }
 */
function calculateCost(model, tokens = {}) {
  const normModel = String(model || "").toLowerCase().trim();
  const pricing = MODEL_PRICING[normModel] || DEFAULT_PRICING;

  const input = Number(tokens.input || 0);
  const output = Number(tokens.output || 0) + Number(tokens.reasoning || 0);
  const cacheRead = Number(tokens.cacheRead || 0);
  const cacheWrite = Number(tokens.cacheWrite || 0);

  const inputCost = (input / 1_000_000) * pricing.inputPerM;
  const outputCost = (output / 1_000_000) * pricing.outputPerM;
  const cacheReadCost = (cacheRead / 1_000_000) * (pricing.cacheReadPerM || 0);
  const cacheWriteCost = (cacheWrite / 1_000_000) * (pricing.cacheWritePerM || 0);

  const total = inputCost + outputCost + cacheReadCost + cacheWriteCost;

  return {
    amount: Number(total.toFixed(6)),
    currency: "USD",
    basis: MODEL_PRICING[normModel] ? "estimated-api" : "api-equivalent",
    priceVersion: "2026.09"
  };
}

module.exports = {
  MODEL_PRICING,
  calculateCost
};
