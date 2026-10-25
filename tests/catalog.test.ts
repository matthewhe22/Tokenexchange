import { describe, expect, it } from "vitest";
import { chargeFor } from "@/lib/billing";
import { parseDeepInfra, parseNovita, suggestPublicName } from "@/lib/upstream-catalog";

describe("upstream catalogs", () => {
  it("reads DeepInfra prices (cents per token) and skips non-text, deprecated and unpriced models", () => {
    const models = parseDeepInfra([
      { model_name: "meta-llama/Llama-3.3-70B-Instruct-Turbo", type: "text-generation", max_tokens: 131072, pricing: { type: "tokens", cents_per_input_token: 0.00001, cents_per_output_token: 0.000032, rate_per_input_token_cached: 0.5 } },
      { model_name: "deepseek-ai/DeepSeek-V3", type: "text-generation", pricing: { cents_per_input_token: 0.000032, cents_per_output_token: 0.000089, rate_per_input_token_cached: 7 } },
      { model_name: "BAAI/bge-m3", type: "embeddings", pricing: { cents_per_input_token: 0.000001 } },
      { model_name: "old/model", type: "text-generation", deprecated: 1700000000, pricing: { cents_per_input_token: 0.00001, cents_per_output_token: 0.00001 } },
      { model_name: "timed/model", type: "text-generation", pricing: { cents_per_sec: 0.01 } },
    ]);
    expect(models).toEqual([
      { id: "meta-llama/Llama-3.3-70B-Instruct-Turbo", cost: { input: 0.1, output: 0.32, cacheRead: 0.05 }, contextSize: 131072 },
      // a cache rate that is not a fraction of the input price is ignored
      { id: "deepseek-ai/DeepSeek-V3", cost: { input: 0.32, output: 0.89 }, contextSize: null },
    ]);
  });

  it("reads Novita prices (0.0001 USD per 1M tokens)", () => {
    expect(parseNovita({ data: [{ id: "meta-llama/llama-3.3-70b-instruct", input_token_price_per_m: 1350, output_token_price_per_m: 4000, context_size: 131072 }, { id: "x/no-price" }] })).toEqual([
      { id: "meta-llama/llama-3.3-70b-instruct", cost: { input: 0.135, output: 0.4 }, contextSize: 131072 },
    ]);
  });

  it("suggests one public name for the same model on different providers", () => {
    expect(suggestPublicName("meta-llama/Llama-3.3-70B-Instruct-Turbo")).toBe("llama-3.3-70b-instruct");
    expect(suggestPublicName("meta-llama/llama-3.3-70b-instruct")).toBe("llama-3.3-70b-instruct");
  });
});

describe("per-model upstream costs", () => {
  const price = { model: "llama", inputPrice: 0.135, outputPrice: 0.4, cacheReadPrice: null, cacheWritePrice: null, markup: 1, maxOutputTokens: null, tierThreshold: null, tierInputPrice: null, tierOutputPrice: null, perRequestPrice: null, flexMarkup: null, batchMarkup: 0.8, priorityMultiplier: null, benchmarkId: null, enabled: true, updatedAt: new Date() };
  const u = { input: 3_000_000, output: 1_000_000, cacheRead: 0, cacheWrite: 0 };
  const deepinfra = { costMultiplier: 1, modelCosts: { llama: { input: 0.1, output: 0.32 } }, config: { batchCostFactor: "0.8" } };

  it("uses the channel's own price for the model instead of list x multiplier", () => {
    // sold at Novita's price, bought at DeepInfra's: 0.805 vs 0.62 per 3M in + 1M out
    expect(chargeFor(u, price, deepinfra)).toEqual({ cost: 805_000, upstreamCost: 620_000 });
    expect(chargeFor(u, { ...price, model: "other" }, deepinfra).upstreamCost).toBe(805_000);
  });

  it("applies the channel's batch factor to its own price", () => {
    expect(chargeFor(u, price, deepinfra, "batch")).toEqual({ cost: 644_000, upstreamCost: 496_000 });
  });
});
