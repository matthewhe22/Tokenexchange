import { createHash } from "node:crypto";
import type { Provider, Source } from "@/db/schema";
import type { RoutingSettings } from "@/lib/settings";
import { supportsModel } from "./providers/info";
import type { Protocol } from "./types";

export interface RoutableChannel {
  id: number;
  provider: Provider;
  source: Source;
  models: string[];
  priority: number;
  weight: number;
  enabled: boolean;
  modelMapping?: Record<string, string>;
}

/** Deterministic value in (0, 1) for a (key, channel) pair. */
function unitHash(key: string, channelId: number): number {
  const h = createHash("sha256").update(`${key}|${channelId}`).digest();
  return (h.readUIntBE(0, 6) + 1) / (2 ** 48 + 2);
}

/**
 * Orders the channels that can serve `model` over `protocol`: highest priority first,
 * weighted within a priority tier. The caller tries them in order on retryable failures.
 *
 * With an `affinityKey` (e.g. API key + model), the weighted choice is deterministic: weighted
 * rendezvous hashing sends the same key to the same channel every time, so the upstream's prompt
 * cache keeps hitting, while different keys still spread across channels in proportion to weight.
 * Adding or removing a channel only moves the keys that hashed to it.
 */
export function orderChannels<T extends RoutableChannel>(
  channels: T[],
  model: string,
  protocol: Protocol,
  routing: RoutingSettings,
  random: () => number = Math.random,
  affinityKey?: string,
): T[] {
  const allowed = new Set(routing.modelSources[model] ?? routing.enabledSources);
  const enabledGlobally = new Set(routing.enabledSources);
  const eligible = channels.filter(
    (c) =>
      c.enabled &&
      enabledGlobally.has(c.source) &&
      allowed.has(c.source) &&
      c.models.includes(model) &&
      supportsModel(c.provider, protocol, c.modelMapping?.[model] ?? model),
  );

  const tiers = new Map<number, T[]>();
  for (const c of eligible) tiers.set(c.priority, [...(tiers.get(c.priority) ?? []), c]);

  const out: T[] = [];
  for (const priority of [...tiers.keys()].sort((a, b) => b - a)) {
    const pool = [...tiers.get(priority)!];
    if (affinityKey) {
      const score = (c: T) => -Math.log(unitHash(affinityKey, c.id)) / Math.max(1, c.weight);
      out.push(...pool.sort((a, b) => score(a) - score(b)));
      continue;
    }
    while (pool.length) {
      const total = pool.reduce((s, c) => s + Math.max(1, c.weight), 0);
      let r = random() * total;
      let i = 0;
      for (; i < pool.length - 1; i++) {
        r -= Math.max(1, pool[i].weight);
        if (r < 0) break;
      }
      out.push(pool.splice(i, 1)[0]);
    }
  }
  return out;
}
