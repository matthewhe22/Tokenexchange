import type { Provider, Source } from "@/db/schema";
import type { RoutingSettings } from "@/lib/settings";
import { supports } from "./providers/info";
import type { Protocol } from "./types";

export interface RoutableChannel {
  id: number;
  provider: Provider;
  source: Source;
  models: string[];
  priority: number;
  weight: number;
  enabled: boolean;
}

/**
 * Orders the channels that can serve `model` over `protocol`: highest priority first,
 * weighted-random within a priority tier. The caller tries them in order on retryable failures.
 */
export function orderChannels<T extends RoutableChannel>(
  channels: T[],
  model: string,
  protocol: Protocol,
  routing: RoutingSettings,
  random: () => number = Math.random,
): T[] {
  const allowed = new Set(routing.modelSources[model] ?? routing.enabledSources);
  const enabledGlobally = new Set(routing.enabledSources);
  const eligible = channels.filter(
    (c) =>
      c.enabled &&
      enabledGlobally.has(c.source) &&
      allowed.has(c.source) &&
      c.models.includes(model) &&
      supports(c.provider, protocol),
  );

  const tiers = new Map<number, T[]>();
  for (const c of eligible) tiers.set(c.priority, [...(tiers.get(c.priority) ?? []), c]);

  const out: T[] = [];
  for (const priority of [...tiers.keys()].sort((a, b) => b - a)) {
    const pool = [...tiers.get(priority)!];
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
