import { describe, expect, it } from "vitest";
import { benchmarkIndex, compare, matchBenchmark, normalizeModel, parseOpenRouter } from "@/lib/benchmark";

const list = parseOpenRouter({
  data: [
    { id: "anthropic/claude-opus-5.5", pricing: { prompt: "0.000004", completion: "0.00002" } },
    { id: "meta-llama/llama-3.3-70b-instruct", pricing: { prompt: "0.0000001", completion: "0.00000032" } },
    { id: "meta-llama/llama-4-scout", pricing: { prompt: "0.0000001", completion: "0.0000003" } },
    { id: "someone/llama-3.3-70b-instruct", pricing: { prompt: "0.0000003", completion: "0.0000006" } },
    { id: "meta-llama/llama-3.3-70b-instruct:free", pricing: { prompt: "0", completion: "0" } },
    { id: "openrouter/auto", pricing: { prompt: "-1", completion: "-1" } },
  ],
});

describe("OpenRouter benchmark", () => {
  it("reads per-token prices as USD per 1M and skips free and variable entries", () => {
    expect(list.map((p) => p.id)).toEqual([
      "anthropic/claude-opus-5.5",
      "meta-llama/llama-3.3-70b-instruct",
      "meta-llama/llama-4-scout",
      "someone/llama-3.3-70b-instruct",
    ]);
    expect(list[0]).toEqual({ id: "anthropic/claude-opus-5.5", input: 4, output: 20 });
  });

  it("matches by normalized name, keeps the cheapest listing, and honours an explicit id", () => {
    const index = benchmarkIndex(list);
    expect(normalizeModel("anthropic/claude-opus-5.5")).toBe("claude-opus-5-5");
    expect(matchBenchmark("claude-opus-5-5", null, index)?.id).toBe("anthropic/claude-opus-5.5");
    expect(matchBenchmark("llama-3.3-70b-instruct", null, index)?.id).toBe("meta-llama/llama-3.3-70b-instruct");
    expect(matchBenchmark("llama-4-scout-17b-16e-instruct", null, index)).toBeNull();
    expect(matchBenchmark("llama-4-scout-17b-16e-instruct", "meta-llama/llama-4-scout", index)?.input).toBe(0.1);
  });

  it("reports how far our price and batch price are from the benchmark", () => {
    const price = { model: "claude-opus-5-5", inputPrice: 4, outputPrice: 20, cacheReadPrice: null, cacheWritePrice: null, markup: 1.2, maxOutputTokens: null, tierThreshold: null, tierInputPrice: null, tierOutputPrice: null, perRequestPrice: null, flexMarkup: null, batchMarkup: 0.9, priorityMultiplier: null, benchmarkId: null, enabled: true, updatedAt: new Date() };
    const r = compare(price, { id: "anthropic/claude-opus-5.5", input: 4, output: 20 });
    expect(r.diff).toBeCloseTo(0.2);
    expect(r.batchDiff).toBeCloseTo(-0.1);
  });
});
