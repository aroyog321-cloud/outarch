"use strict";

// Model pricing catalog and cost calculator for Mission Control Token & Cost Ledger.
// Prices are normalized per 1 Million tokens (USD).
// Reference: September 2026 public API rates.

const MODEL_PRICING = {
  // Google Gemini
  "gemini-2.5-flash": { inputPerM: 0.075, outputPerM: 0.30, cacheReadPerM: 0.01875 },
  "gemini-2.5-flash-lite": { inputPerM: 0.0375, outputPerM: 0.15, cacheReadPerM: 0.009375 },
  "gemini-2.5-pro": { inputPerM: 1.25, outputPerM: 5.00, cacheReadPerM: 0.3125 },
  "gemini-2.0-flash": { inputPerM: 0.10, outputPerM: 0.40, cacheReadPerM: 0.025 },

  // Anthropic Claude
  "claude-3-5-sonnet": { inputPerM: 3.00, outputPerM: 15.00, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },
  "claude-3-7-sonnet": { inputPerM: 3.00, outputPerM: 15.00, cacheReadPerM: 0.30, cacheWritePerM: 3.75 },
  "claude-3-5-haiku": { inputPerM: 0.80, outputPerM: 4.00, cacheReadPerM: 0.08, cacheWritePerM: 1.00 },

  // OpenAI
  "gpt-4o": { inputPerM: 2.50, outputPerM: 10.00, cacheReadPerM: 1.25 },
  "gpt-4o-mini": { inputPerM: 0.15, outputPerM: 0.60, cacheReadPerM: 0.075 },
  "o1": { inputPerM: 15.00, outputPerM: 60.00 },
  "o3-mini": { inputPerM: 1.10, outputPerM: 4.40 }
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
