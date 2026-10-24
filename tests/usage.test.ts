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
  const price = { model: "m", inputPrice: 3, outputPrice: 15, cacheReadPrice: 0.3, cacheWritePrice: null, markup: 1.2, enabled: true, updatedAt: new Date() };
  it("prices in micro-USD and applies markup and cost multiplier", () => {
    // 1000*3 + 100*15 + 1000*0.3 + 10*3 (cache write falls back to input) = 4830 list
    const r = chargeFor({ input: 1000, output: 100, cacheRead: 1000, cacheWrite: 10 }, price, 0.7);
    expect(r).toEqual({ cost: Math.ceil(4830 * 1.2), upstreamCost: Math.round(4830 * 0.7) });
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
