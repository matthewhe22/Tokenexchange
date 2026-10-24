import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Usage } from "@/relay/types";
import { waitUntil } from "@vercel/functions";
import { cached } from "./cache";
import { maybeNotifyLowBalance } from "./notifications";

export type ModelPrice = typeof schema.modelPrices.$inferSelect;

export async function getPrices(): Promise<Map<string, ModelPrice>> {
  return cached("prices", async () => {
    const rows = await getDb().select().from(schema.modelPrices);
    return new Map(rows.map((r) => [r.model, r]));
  });
}

export interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** USD-per-1M-token rates for a request whose prompt is `promptTokens` long (long-context tiers). */
export function ratesFor(price: ModelPrice, promptTokens: number): Rates {
  const base = {
    input: price.inputPrice,
    output: price.outputPrice,
    cacheRead: price.cacheReadPrice ?? price.inputPrice,
    cacheWrite: price.cacheWritePrice ?? price.inputPrice,
  };
  if (price.tierThreshold == null || promptTokens <= price.tierThreshold) return base;
  const input = price.tierInputPrice ?? base.input;
  const scale = base.input > 0 ? input / base.input : 1;
  return {
    input,
    output: price.tierOutputPrice ?? base.output,
    cacheRead: base.cacheRead * scale,
    cacheWrite: base.cacheWrite * scale,
  };
}

/** List-price cost of a request in micro-USD (USD per 1M tokens == micro-USD per token). */
export function listCost(usage: Usage, price: ModelPrice): number {
  const r = ratesFor(price, usage.input + usage.cacheRead + usage.cacheWrite);
  return (
    usage.input * r.input +
    usage.output * r.output +
    usage.cacheRead * r.cacheRead +
    usage.cacheWrite * r.cacheWrite +
    (usage.units ?? 0) * (price.perRequestPrice ?? 0) * 1_000_000
  );
}

export function chargeFor(usage: Usage, price: ModelPrice, channelCostMultiplier: number) {
  const list = listCost(usage, price);
  return { cost: Math.ceil(list * price.markup), upstreamCost: Math.round(list * channelCostMultiplier) };
}

export interface UsageEntry {
  userId: number;
  apiKeyId: number;
  channelId: number | null;
  endpoint: string;
  model: string;
  upstreamModel: string | null;
  stream: boolean;
  status: number;
  usage: Usage | null;
  cost: number;
  upstreamCost: number;
  latencyMs: number;
  error?: string | null;
  /** Funds held for this request by `reserve()`, released here. */
  reservationId?: number | null;
}

/**
 * Writes the usage log and settles the request in one transaction: the reservation (if it is
 * still held) is returned and the actual cost is charged to the user and the key.
 */
export async function recordUsage(e: UsageEntry): Promise<void> {
  const u = e.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let lowBalanceCheck: { balance: number; threshold: number | null } | null = null;
  await getDb().transaction(async (tx) => {
    let held = 0;
    if (e.reservationId != null) {
      // If the stale-reservation sweeper already returned these funds, nothing is held any more.
      const [r] = await tx.delete(schema.reservations).where(eq(schema.reservations.id, e.reservationId)).returning();
      held = r?.amount ?? 0;
    }
    await tx.insert(schema.usageLogs).values({
      userId: e.userId,
      apiKeyId: e.apiKeyId,
      channelId: e.channelId,
      endpoint: e.endpoint,
      model: e.model,
      upstreamModel: e.upstreamModel,
      stream: e.stream,
      status: e.status,
      inputTokens: u.input,
      outputTokens: u.output,
      cacheReadTokens: u.cacheRead,
      cacheWriteTokens: u.cacheWrite,
      cost: e.cost,
      upstreamCost: e.upstreamCost,
      latencyMs: e.latencyMs,
      error: e.error?.slice(0, 2000) ?? null,
    });
    const delta = e.cost - held;
    if (delta !== 0) {
      const [after] = await tx
        .update(schema.users)
        .set({ balance: sql`${schema.users.balance} - ${delta}` })
        .where(eq(schema.users.id, e.userId))
        .returning({ balance: schema.users.balance, threshold: schema.users.lowBalanceThreshold, notifiedAt: schema.users.lowBalanceNotifiedAt });
      if (after && e.cost > 0 && !after.notifiedAt) {
        lowBalanceCheck = { balance: after.balance, threshold: after.threshold };
      }
    }
    await tx
      .update(schema.apiKeys)
      .set({ used: sql`${schema.apiKeys.used} + ${delta}`, lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, e.apiKeyId));
  });
  if (lowBalanceCheck) {
    const { balance, threshold } = lowBalanceCheck;
    waitUntil(maybeNotifyLowBalance(e.userId, balance, threshold).catch((err) => console.error("low-balance email failed", err)));
  }
}
