import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Usage } from "@/relay/types";
import { cached } from "./cache";

export type ModelPrice = typeof schema.modelPrices.$inferSelect;

export async function getPrices(): Promise<Map<string, ModelPrice>> {
  return cached("prices", async () => {
    const rows = await getDb().select().from(schema.modelPrices);
    return new Map(rows.map((r) => [r.model, r]));
  });
}

/** List-price cost of a request in micro-USD (USD per 1M tokens == micro-USD per token). */
export function listCost(usage: Usage, price: ModelPrice): number {
  return (
    usage.input * price.inputPrice +
    usage.output * price.outputPrice +
    usage.cacheRead * (price.cacheReadPrice ?? price.inputPrice) +
    usage.cacheWrite * (price.cacheWritePrice ?? price.inputPrice)
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
}

/** Writes the usage log and debits the user and the key in one transaction. */
export async function recordUsage(e: UsageEntry): Promise<void> {
  const u = e.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  await getDb().transaction(async (tx) => {
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
    if (e.cost > 0) {
      await tx
        .update(schema.users)
        .set({ balance: sql`${schema.users.balance} - ${e.cost}` })
        .where(eq(schema.users.id, e.userId));
    }
    await tx
      .update(schema.apiKeys)
      .set({ used: sql`${schema.apiKeys.used} + ${e.cost}`, lastUsedAt: new Date() })
      .where(eq(schema.apiKeys.id, e.apiKeyId));
  });
}
