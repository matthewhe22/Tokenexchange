import { describe, expect, it } from "vitest";
import { orderChannels, type RoutableChannel } from "@/relay/router";
import { DEFAULT_ROUTING } from "@/lib/settings";

const ch = (id: number, over: Partial<RoutableChannel> = {}): RoutableChannel => ({
  id, provider: "openai", source: "official", models: ["gpt-4o"], priority: 0, weight: 1, enabled: true, ...over,
});

describe("orderChannels", () => {
  it("filters by model, protocol support, enabled and source", () => {
    const chans = [
      ch(1),
      ch(2, { enabled: false }),
      ch(3, { models: ["other"] }),
      ch(4, { provider: "anthropic" }), // cannot serve openai-chat
      ch(5, { provider: "openai_compatible", source: "reseller" }),
    ];
    const ids = orderChannels(chans, "gpt-4o", "openai-chat", { ...DEFAULT_ROUTING, enabledSources: ["official", "cloud"] }).map((c) => c.id);
    expect(ids).toEqual([1]);
  });

  it("orders by priority tiers, then falls back", () => {
    const chans = [ch(1, { priority: 0 }), ch(2, { priority: 10 }), ch(3, { priority: 5 })];
    expect(orderChannels(chans, "gpt-4o", "openai-chat", DEFAULT_ROUTING).map((c) => c.id)).toEqual([2, 3, 1]);
  });

  it("respects per-model source restrictions", () => {
    const chans = [ch(1, { source: "reseller", provider: "openai_compatible" }), ch(2, { source: "cloud", provider: "azure_openai" })];
    const routing = { ...DEFAULT_ROUTING, modelSources: { "gpt-4o": ["cloud" as const] } };
    expect(orderChannels(chans, "gpt-4o", "openai-chat", routing).map((c) => c.id)).toEqual([2]);
  });

  it("weights selection within a tier", () => {
    const chans = [ch(1, { weight: 1 }), ch(2, { weight: 3 })];
    const first = (r: number) => orderChannels(chans, "gpt-4o", "openai-chat", DEFAULT_ROUTING, () => r)[0].id;
    expect(first(0.1)).toBe(1); // 0.4 of 4 total -> falls in channel 1's [0,1)
    expect(first(0.5)).toBe(2);
  });
});

describe("channel affinity", () => {
  const chans = [ch(1, { weight: 1 }), ch(2, { weight: 1 }), ch(3, { weight: 2 })];
  it("is deterministic per key", () => {
    const a = orderChannels(chans, "gpt-4o", "openai-chat", DEFAULT_ROUTING, Math.random, "key:7:gpt-4o").map((c) => c.id);
    for (let i = 0; i < 5; i++) {
      expect(orderChannels(chans, "gpt-4o", "openai-chat", DEFAULT_ROUTING, Math.random, "key:7:gpt-4o").map((c) => c.id)).toEqual(a);
    }
  });
  it("still spreads keys roughly by weight", () => {
    const firsts = new Map<number, number>();
    for (let k = 0; k < 4000; k++) {
      const id = orderChannels(chans, "gpt-4o", "openai-chat", DEFAULT_ROUTING, Math.random, `key:${k}`)[0].id;
      firsts.set(id, (firsts.get(id) ?? 0) + 1);
    }
    expect(firsts.get(3)! / 4000).toBeGreaterThan(0.44);
    expect(firsts.get(3)! / 4000).toBeLessThan(0.56);
    expect(firsts.get(1)! / 4000).toBeGreaterThan(0.2);
  });
  it("respects priority tiers", () => {
    const tiered = [ch(1, { priority: 0 }), ch(2, { priority: 5 })];
    expect(orderChannels(tiered, "gpt-4o", "openai-chat", DEFAULT_ROUTING, Math.random, "anything")[0].id).toBe(2);
  });
});

describe("multi-protocol providers", () => {
  it("routes Vertex by model family", () => {
    const vertex = [ch(1, { provider: "vertex", source: "cloud", models: ["claude-x", "gemini-x"] })];
    expect(orderChannels(vertex, "claude-x", "anthropic-messages", DEFAULT_ROUTING)).toHaveLength(1);
    expect(orderChannels(vertex, "claude-x", "gemini", DEFAULT_ROUTING)).toHaveLength(0);
    expect(orderChannels(vertex, "gemini-x", "gemini", DEFAULT_ROUTING)).toHaveLength(1);
    expect(orderChannels(vertex, "gemini-x", "anthropic-messages", DEFAULT_ROUTING)).toHaveLength(0);
  });
});
