"use strict";

// Normalized Token & Cost Usage Ledger for OUTARCH.
// Stores structured UsageRecords without logging raw prompts, responses, or credentials.
// Provides fast aggregation across project, worker, mission, and model scopes.

const { calculateCost } = require("./usagePricing.cjs");
const { usageAttribution } = require("./usageAttribution.cjs");

// Returns a finite count, or null when the provider reported nothing for it.
function countOrUnknown(...candidates) {
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

class UsageLedger {
  /** @type {Array<object>} */
  #records = [];
  #maxRecords = 5000;
  /** @type {Set<Function>} */
  #listeners = new Set();

  constructor(maxRecords = 5000) {
    this.#maxRecords = maxRecords;
  }

  recordUsage(params = {}) {
    const eventId = params.eventId || `usage_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const provider = String(params.provider || "gemini").toLowerCase();
    const model = params.model || "gemini-2.5-flash";

    // An absent count means the provider did not report one. That is different
    // from a reported zero, and collapsing the two would understate real spend
    // on every failed or unattributed request.
    const tokens = {
      input: countOrUnknown(params.tokens?.input, params.inputTokens),
      output: countOrUnknown(params.tokens?.output, params.outputTokens),
      cacheRead: countOrUnknown(params.tokens?.cacheRead, params.cacheReadTokens),
      cacheWrite: countOrUnknown(params.tokens?.cacheWrite, params.cacheWriteTokens),
      reasoning: countOrUnknown(params.tokens?.reasoning, params.reasoningTokens)
    };
    const tokensKnown = Object.values(tokens).some(value => value !== null);

    // Cost is only ever derived from counts that exist. Pricing an unknown
    // request at zero would quietly report a cheaper session than the real one.
    const cost = params.cost || (tokensKnown
      ? calculateCost(model, tokens)
      : { amount: null, currency: "USD", basis: "unknown", priceVersion: null });
    const attribution = usageAttribution.resolveAttribution(params);

    const record = {
      version: 1,
      eventId,
      provider,
      model,
      source: params.source || "api",
      sourceEventId: params.sourceEventId || null,
      projectId: attribution.projectId,
      workerId: attribution.workerId,
      workerRunId: attribution.workerRunId,
      agentSessionId: params.agentSessionId || null,
      missionId: attribution.missionId,
      recipeRunId: attribution.recipeRunId,
      logicalRequestId: params.logicalRequestId || null,
      attemptId: params.attemptId || null,
      at: params.at || Date.now(),
      // Which surface spent it. "workspace" is a model call made on behalf of a
      // terminal in this project — the thing the Usage panel is asked to
      // account for. "assistant" is Mission AI or a bring-your-own-key model
      // answering a question in the app: real spend, but not the project's
      // work, and mixing the two made the panel unable to answer either
      // question. Recorded either way; the panel chooses which it reports.
      surface: params.surface === "assistant" ? "assistant" : "workspace",
      outcome: params.outcome || "success",
      httpStatus: params.httpStatus ? Number(params.httpStatus) : 200,
      latencyMs: params.latencyMs ? Number(params.latencyMs) : null,
      tokens,
      countSemantics: params.countSemantics || (tokensKnown ? "disjoint" : "unknown"),
      cost,
      keySlot: params.keySlot || null,
      attribution: attribution.attribution,
      coverage: params.coverage || (tokensKnown ? "complete" : "unknown")
    };

    this.#records.push(record);
    if (this.#records.length > this.#maxRecords) {
      this.#records.shift();
    }

    this.#notify({ type: "usage:record", record });
    return record;
  }

  record(params = {}) {
    return this.recordUsage(params);
  }

  query(filter = {}) {
    return this.queryUsage(filter).records;
  }

  getAggregate(filter = {}) {
    const res = this.queryUsage(filter);
    return {
      callCount: res.requestCount,
      totalTokens: res.totalTokens.total,
      totalCost: res.totalCost,
      currency: res.currency,
      breakdown: res.totalTokens,
      byModel: res.byModel,
      unknownTokenRequests: res.unknownTokenRequests,
      unpricedRequests: res.unpricedRequests,
      failedRequests: res.failedRequests,
      coverage: res.coverage
    };
  }

  queryUsage(filter = {}) {
    let list = this.#records;

    // The Usage panel reports what this project's terminals spent. Mission AI's
    // own answers are metered too, but they are the app talking to the
    // operator, not the project doing work: counting them here made "what is
    // this project costing me?" unanswerable, because asking the assistant
    // about the cost moved the number. Pass `surface: "assistant"` to read the
    // other side, or `surface: "all"` for the combined figure.
    if (filter.surface !== "all") {
      const wanted = filter.surface === "assistant" ? "assistant" : "workspace";
      list = list.filter(r => (r.surface || "workspace") === wanted);
    }
    if (filter.projectId) {
      list = list.filter(r => r.projectId === filter.projectId);
    }
    if (filter.workerId) {
      list = list.filter(r => r.workerId === filter.workerId);
    }
    if (filter.missionId) {
      list = list.filter(r => r.missionId === filter.missionId);
    }
    if (filter.provider) {
      list = list.filter(r => r.provider === filter.provider);
    }
    if (filter.since) {
      list = list.filter(r => r.at >= Number(filter.since));
    }

    const totalTokens = {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      reasoning: 0,
      total: 0
    };

    let totalCost = 0;
    // Requests whose counts or price the provider never reported are counted
    // separately, so the UI can say the total is partial instead of implying
    // that everything is accounted for.
    let unknownTokenRequests = 0;
    let unpricedRequests = 0;
    let failedRequests = 0;
    const byModel = {};

    for (const r of list) {
      const input = r.tokens.input ?? 0;
      const output = r.tokens.output ?? 0;
      const reasoning = r.tokens.reasoning ?? 0;
      const billable = input + output + reasoning;
      const tokensKnown = Object.values(r.tokens).some(value => value !== null);

      totalTokens.input += input;
      totalTokens.output += output;
      totalTokens.cacheRead += r.tokens.cacheRead ?? 0;
      totalTokens.cacheWrite += r.tokens.cacheWrite ?? 0;
      totalTokens.reasoning += reasoning;
      totalTokens.total += billable;

      if (!tokensKnown) unknownTokenRequests += 1;
      if (typeof r.cost?.amount === "number") totalCost += r.cost.amount;
      else unpricedRequests += 1;
      if (r.outcome && r.outcome !== "success") failedRequests += 1;

      const m = r.model || "unknown";
      if (!byModel[m]) {
        byModel[m] = { requests: 0, tokens: 0, cost: 0, unpriced: 0 };
      }
      byModel[m].requests += 1;
      byModel[m].tokens += billable;
      if (typeof r.cost?.amount === "number") byModel[m].cost += r.cost.amount;
      else byModel[m].unpriced += 1;
    }

    return {
      requestCount: list.length,
      totalTokens,
      totalCost: Number(totalCost.toFixed(4)),
      currency: "USD",
      unknownTokenRequests,
      unpricedRequests,
      failedRequests,
      coverage: list.length === 0 ? "complete" : (unknownTokenRequests || unpricedRequests) ? "partial" : "complete",
      byModel,
      records: list.slice(-50).reverse()
    };
  }

  subscribe(callback) {
    if (typeof callback === "function") {
      this.#listeners.add(callback);
      return () => this.#listeners.delete(callback);
    }
    return () => {};
  }

  #notify(event) {
    for (const listener of this.#listeners) {
      try {
        listener(event);
      } catch {}
    }
  }
}

const usageLedger = new UsageLedger();

module.exports = {
  UsageLedger,
  usageLedger
};
