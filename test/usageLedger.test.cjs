"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { UsageLedger } = require("../src/service/usageLedger.cjs");
const { calculateCost } = require("../src/service/usagePricing.cjs");

test("calculateCost computes pricing accurately for Gemini and Claude models", () => {
  const geminiCost = calculateCost("gemini-2.5-flash", { input: 10000, output: 2000 });
  // (10,000 / 1M * 0.075) + (2,000 / 1M * 0.30) = 0.00075 + 0.0006 = 0.00135
  assert.equal(geminiCost.amount, 0.00135);
  assert.equal(geminiCost.currency, "USD");
  assert.equal(geminiCost.basis, "estimated-api");

  const claudeCost = calculateCost("claude-3-5-sonnet", { input: 1000, output: 500, cacheRead: 2000 });
  // (1000/1M * 3.0) + (500/1M * 15.0) + (2000/1M * 0.30) = 0.003 + 0.0075 + 0.0006 = 0.0111
  assert.equal(claudeCost.amount, 0.0111);
});

test("UsageLedger records usage and computes scoped aggregates", () => {
  const ledger = new UsageLedger();

  ledger.recordUsage({
    projectId: "proj-alpha",
    workerId: "storefront",
    model: "gemini-2.5-flash",
    tokens: { input: 1000, output: 500, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  });

  ledger.recordUsage({
    projectId: "proj-alpha",
    workerId: "api-worker",
    model: "gemini-2.5-flash",
    tokens: { input: 2000, output: 1000, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  });

  ledger.recordUsage({
    projectId: "proj-beta",
    workerId: "other",
    model: "gemini-2.5-flash",
    tokens: { input: 5000, output: 5000 }
  });

  const projAlpha = ledger.queryUsage({ projectId: "proj-alpha" });
  assert.equal(projAlpha.requestCount, 2);
  assert.equal(projAlpha.totalTokens.total, 4500);

  const storefrontOnly = ledger.queryUsage({ projectId: "proj-alpha", workerId: "storefront" });
  assert.equal(storefrontOnly.requestCount, 1);
  assert.equal(storefrontOnly.totalTokens.total, 1500);
});
