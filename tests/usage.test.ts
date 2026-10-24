import { describe, expect, it } from "vitest";
import { chargeFor } from "@/lib/billing";
import { SSEParser } from "@/relay/sse";
import { StreamUsageTracker, usageFromBody } from "@/relay/usage";
import type { Protocol } from "@/relay/types";

function track(protocol: Protocol, raw: string, chunkSize = 5) {
  const t = new StreamUsageTracker(protocol);
  const p = new SSEParser((e, d) => t.onEvent(e, d));
  const bytes = new TextEncoder().encode(raw);
  for (let i = 0; i < bytes.length; i += chunkSize) p.push(bytes.subarray(i, i + chunkSize));
  p.end();
  return t.result();
}

describe("usage extraction", () => {
  it("OpenAI chat excludes cached tokens from input", () => {
    expect(usageFromBody("openai-chat", { usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 30 } } })).toEqual({
      input: 70, output: 20, cacheRead: 30, cacheWrite: 0,
    });
  });

  it("OpenAI chat stream reads the trailing usage chunk (CRLF framing)", () => {
    const raw = 'data: {"choices":[{"delta":{"content":"hi"}}]}\r\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":3}}\r\n\r\ndata: [DONE]\r\n\r\n';
    expect(track("openai-chat", raw)).toEqual({ input: 9, output: 3, cacheRead: 0, cacheWrite: 0 });
  });

  it("Responses stream reads response.completed", () => {
    const raw = 'event: response.created\ndata: {"type":"response.created","response":{}}\n\nevent: response.completed\ndata: {"type":"response.completed","response":{"usage":{"input_tokens":50,"output_tokens":7,"input_tokens_details":{"cached_tokens":10}}}}\n\n';
    expect(track("openai-responses", raw)).toEqual({ input: 40, output: 7, cacheRead: 10, cacheWrite: 0 });
  });

  it("Anthropic stream merges message_start and message_delta", () => {
    const raw =
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1,"cache_read_input_tokens":100,"cache_creation_input_tokens":4}}}\n\n' +
      'event: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":42}}\n\n';
    expect(track("anthropic-messages", raw)).toEqual({ input: 12, output: 42, cacheRead: 100, cacheWrite: 4 });
  });

  it("Gemini counts thinking tokens as output", () => {
    const raw = 'data: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":2}}\n\ndata: {"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":5,"thoughtsTokenCount":20,"cachedContentTokenCount":4}}\n\n';
    expect(track("gemini", raw)).toEqual({ input: 6, output: 25, cacheRead: 4, cacheWrite: 0 });
  });
});

describe("chargeFor", () => {
  const price = { model: "m", inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, cacheWritePrice: null, markup: 1.2, maxOutputTokens: null, tierThreshold: null, tierInputPrice: null, tierOutputPrice: null, perRequestPrice: null, flexMarkup: null, batchMarkup: null, priorityMultiplier: null, enabled: true, updatedAt: new Date() };
  it("prices in micro-USD and applies markup and cost multiplier", () => {
    // 1000*3 + 100*15 + 1000*0.3 + 10*3 (cache write falls back to input) = 4830 list
    const r = chargeFor({ input: 1000, output: 100, cacheRead: 1000, cacheWrite: 10 }, price, { costMultiplier: 0.7 });
    expect(r).toEqual({ cost: Math.ceil(4830 * 1.2), upstreamCost: Math.round(4830 * 0.7) });
  });

  const tiered = { ...price, flexMarkup: 0.8, batchMarkup: 0.8, priorityMultiplier: 2 };
  it("prices flex and batch at their own markup, against half-price upstream", () => {
    const u = { input: 1000, output: 100, cacheRead: 1000, cacheWrite: 10 };
    expect(chargeFor(u, tiered, { costMultiplier: 1 }, "batch")).toEqual({ cost: Math.ceil(4830 * 0.8), upstreamCost: Math.round(4830 * 0.5) });
    expect(chargeFor(u, tiered, { costMultiplier: 1 }, "flex")).toEqual({ cost: Math.ceil(4830 * 0.8), upstreamCost: Math.round(4830 * 0.5) });
  });
  it("prices priority at the vendor multiple times markup", () => {
    const u = { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(chargeFor(u, tiered, { costMultiplier: 1 }, "priority")).toEqual({ cost: Math.ceil(3000 * 2 * 1.2), upstreamCost: 6000 });
  });
  it("falls back to standard when the tier is not offered", () => {
    const u = { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(chargeFor(u, price, { costMultiplier: 1 }, "flex")).toEqual({ cost: 3600, upstreamCost: 3000 });
  });
  it("has no marginal upstream cost on committed-capacity channels", () => {
    const u = { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 };
    expect(chargeFor(u, price, { costMultiplier: 1, fixedCostHourly: 5 }).upstreamCost).toBe(0);
  });
});

describe("service_tier handling", async () => {
  const { applyRequestedTier } = await import("@/lib/tiers");
  const price = { model: "m", inputPrice: 3, outputPrice: 15, cacheReadPrice: null, cacheWritePrice: null, markup: 1, maxOutputTokens: null, tierThreshold: null, tierInputPrice: null, tierOutputPrice: null, perRequestPrice: null, flexMarkup: null, batchMarkup: null, priorityMultiplier: null, enabled: true, updatedAt: new Date() };
  const tiered = { ...price, flexMarkup: 0.8, priorityMultiplier: 2 };
  it("only passes tiers the model is offered on", () => {
    const b1: Record<string, unknown> = { service_tier: "priority" };
    expect(applyRequestedTier("openai-chat", b1, price)).toBe("standard");
    expect(b1.service_tier).toBeUndefined();
    const b2: Record<string, unknown> = { service_tier: "flex" };
    expect(applyRequestedTier("openai-responses", b2, tiered)).toBe("flex");
    expect(b2.service_tier).toBe("flex");
    const b3: Record<string, unknown> = { service_tier: "auto" };
    expect(applyRequestedTier("openai-chat", b3, tiered)).toBe("standard");
    expect(b3.service_tier).toBeUndefined();
  });
  it("strips Anthropic's service_tier", () => {
    const b: Record<string, unknown> = { service_tier: "auto" };
    expect(applyRequestedTier("anthropic-messages", b, tiered)).toBe("standard");
    expect(b).toEqual({});
  });
});

describe("formatting", async () => {
  const { formatUsd } = await import("@/lib/money");
  const { perMillion } = await import("@/lib/catalog");
  it("formats balances and per-request costs", () => {
    expect(formatUsd(0)).toBe("$0.00");
    expect(formatUsd(25_000_000)).toBe("$25.00");
    expect(formatUsd(-1_500_000)).toBe("-$1.50");
    expect(formatUsd(123)).toBe("$0.000123");
    expect(formatUsd(45_600)).toBe("$0.0456");
  });
  it("formats per-million prices consistently", () => {
    expect(perMillion(2.5)).toBe("$2.50");
    expect(perMillion(0.6)).toBe("$0.60");
    expect(perMillion(0.075)).toBe("$0.075");
    expect(perMillion(null)).toBe("—");
  });
});

describe("worst-case cost planning", async () => {
  const r = await import("@/lib/reservations");
  const price = { model: "m", inputPrice: 2, outputPrice: 10, cacheReadPrice: null, cacheWritePrice: null, markup: 1.5, maxOutputTokens: null, tierThreshold: null, tierInputPrice: null, tierOutputPrice: null, perRequestPrice: null, flexMarkup: null, batchMarkup: null, priorityMultiplier: null, enabled: true, updatedAt: new Date() };

  it("counts text at 3 bytes/token and base64 blobs per blob", () => {
    expect(r.estimateInputTokens("x".repeat(300))).toBe(100);
    const blob = "A".repeat(100_000);
    expect(r.estimateInputTokens(`{"img":"${blob}"}`)).toBe(Math.ceil(12 / 3) + 4000);
  });

  it("uses the request's limit, else the model max, else the default", () => {
    expect(r.planCost("anthropic-messages", { max_tokens: 100 }, "", price).outputCap).toBe(100);
    expect(r.planCost("openai-chat", {}, "", price).outputCap).toBe(r.DEFAULT_MAX_OUTPUT);
    expect(r.planCost("openai-chat", {}, "", { ...price, maxOutputTokens: 8000 }).outputCap).toBe(8000);
    expect(r.planCost("openai-chat", { max_tokens: 1e9 }, "", { ...price, maxOutputTokens: 8000 }).outputCap).toBe(8000);
    expect(r.planCost("gemini", { generationConfig: { maxOutputTokens: 10 } }, "", price).outputCap).toBe(10);
    expect(r.planCost("openai-embeddings", { max_tokens: 99 }, "", price).outputCap).toBe(0);
  });

  it("prices n choices, cache writes and markup", () => {
    const p = r.planCost("openai-chat", { n: 3, max_tokens: 10 }, "x".repeat(30), { ...price, cacheWritePrice: 4 });
    expect(p.cost(10)).toBe(Math.ceil((10 * 4 + 10 * 3 * 10) * 1.5));
  });

  it("shrinks the output cap to what the balance covers", () => {
    const p = r.planCost("openai-chat", { max_tokens: 1000 }, "", price); // 15 micro-USD per output token
    expect(r.affordableOutput(p, 1e9)).toBe(1000);
    expect(r.affordableOutput(p, 15 * 400)).toBe(400);
    expect(p.cost(r.affordableOutput(p, 15 * 400 + 7))).toBeLessThanOrEqual(15 * 400 + 7);
    const withInput = r.planCost("openai-chat", { max_tokens: 1000 }, "x".repeat(3000), price); // 1000 input tokens
    expect(r.affordableOutput(withInput, 100)).toBe(-1);
  });

  it("writes the cap into each protocol's own field", () => {
    const chat: Record<string, unknown> = { max_tokens: 5000 };
    r.applyOutputCap("openai-chat", chat, 100);
    expect(chat).toEqual({ max_tokens: 100 });
    const chat2: Record<string, unknown> = {};
    r.applyOutputCap("openai-chat", chat2, 100);
    expect(chat2).toEqual({ max_completion_tokens: 100 });
    const gem: Record<string, unknown> = { generationConfig: { temperature: 0 } };
    r.applyOutputCap("gemini", gem, 7);
    expect(gem).toEqual({ generationConfig: { temperature: 0, maxOutputTokens: 7 } });
  });
});

describe("committed capacity", async () => {
  const { fixedCostBetween } = await import("@/lib/capacity");
  const ch = { fixedCostHourly: 2, createdAt: new Date("2026-01-01T00:00:00Z"), commitmentEndsAt: new Date("2026-01-02T00:00:00Z") };
  it("charges the hourly rate only while the commitment runs", () => {
    expect(fixedCostBetween(ch, new Date("2026-01-01T10:00:00Z"), new Date("2026-01-01T13:00:00Z"))).toBe(6_000_000);
    expect(fixedCostBetween(ch, new Date("2025-12-31T00:00:00Z"), new Date("2026-01-01T01:00:00Z"))).toBe(2_000_000);
    expect(fixedCostBetween(ch, new Date("2026-01-01T23:00:00Z"), new Date("2026-01-03T00:00:00Z"))).toBe(2_000_000);
    expect(fixedCostBetween({ ...ch, fixedCostHourly: null }, new Date(0), new Date())).toBe(0);
  });
});
