import { and, gte, inArray, isNotNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";

type Channel = typeof schema.channels.$inferSelect;

const HOUR = 3_600_000;

/** Take-or-pay cost (micro-USD) of a channel's commitment between two instants. */
export function fixedCostBetween(
  ch: Pick<Channel, "fixedCostHourly" | "createdAt" | "commitmentEndsAt">,
  from: Date,
  to: Date,
): number {
  if (ch.fixedCostHourly == null) return 0;
  const start = Math.max(from.getTime(), ch.createdAt.getTime());
  const end = Math.min(to.getTime(), ch.commitmentEndsAt?.getTime() ?? Infinity);
  return end > start ? Math.round(((end - start) / HOUR) * ch.fixedCostHourly * 1_000_000) : 0;
}

export interface CapacityRow {
  channel: Channel;
  requests: number;
  tokens: number;
  revenue: number;
  fixedCost: number;
  /** Tokens served ÷ tokens the capacity could have served in the window (null without a TPM). */
  utilization: number | null;
  /** Busiest single minute ÷ capacity. */
  peakUtilization: number | null;
  /** Utilization at which revenue would cover the fixed cost, at this window's revenue per token. */
  breakEven: number | null;
  /** Utilization per hour of the last 24 hours, oldest first. */
  hourly: (number | null)[];
  daysLeft: number | null;
}

/** Utilization and take-or-pay margin of every committed-capacity channel over the last `hours`. */
export async function capacityReport(hours: number, now = new Date()): Promise<CapacityRow[]> {
  const db = getDb();
  const channels = await db
    .select()
    .from(schema.channels)
    .where(or(isNotNull(schema.channels.fixedCostHourly), isNotNull(schema.channels.capacityTpm)));
  if (!channels.length) return [];
  const ids = channels.map((c) => c.id);
  const since = new Date(now.getTime() - hours * HOUR);
  const day = new Date(now.getTime() - 24 * HOUR);
  const l = schema.usageLogs;
  const tokens = sql<number>`(${l.inputTokens} + ${l.outputTokens} + ${l.cacheReadTokens} + ${l.cacheWriteTokens})`;
  const window = and(inArray(l.channelId, ids), gte(l.createdAt, since));

  const totals = await db
    .select({
      channelId: l.channelId,
      requests: sql<number>`count(*)::int`,
      tokens: sql<number>`coalesce(sum(${tokens}), 0)::bigint`,
      revenue: sql<number>`coalesce(sum(${l.cost}), 0)::bigint`,
    })
    .from(l)
    .where(window)
    .groupBy(l.channelId);
  const peaks = await db.execute<{ channel_id: number; peak: number }>(sql`
    select channel_id, max(t)::bigint as peak from (
      select ${l.channelId} as channel_id, date_trunc('minute', ${l.createdAt}) as m, sum(${tokens}) as t
      from ${l} where ${window} group by 1, 2
    ) per_minute group by 1`);
  const hourlyRows = await db.execute<{ channel_id: number; h: number; t: number }>(sql`
    select ${l.channelId} as channel_id, floor(extract(epoch from (${now.toISOString()}::timestamptz - ${l.createdAt})) / 3600)::int as h,
      sum(${tokens})::bigint as t
    from ${l} where ${and(inArray(l.channelId, ids), gte(l.createdAt, day))} group by 1, 2`);

  return channels.map((channel) => {
    const t = totals.find((r) => r.channelId === channel.id);
    const served = Number(t?.tokens ?? 0);
    const revenue = Number(t?.revenue ?? 0);
    const tpm = channel.capacityTpm && channel.capacityTpm > 0 ? channel.capacityTpm : null;
    // Capacity only counts while the channel existed and the commitment ran.
    const activeFrom = Math.max(since.getTime(), channel.createdAt.getTime());
    const activeTo = Math.min(now.getTime(), channel.commitmentEndsAt?.getTime() ?? Infinity);
    const minutes = Math.max(0, (activeTo - activeFrom) / 60_000);
    const capacityTokens = tpm ? tpm * minutes : 0;
    const peak = Number(peaks.find((p) => Number(p.channel_id) === channel.id)?.peak ?? 0);
    const fixedCost = fixedCostBetween(channel, since, now);
    const hourly = Array.from({ length: 24 }, (_, i) => {
      if (!tpm) return null;
      const h = 23 - i;
      const row = hourlyRows.find((r) => Number(r.channel_id) === channel.id && Number(r.h) === h);
      return Number(row?.t ?? 0) / (tpm * 60);
    });
    return {
      channel,
      requests: Number(t?.requests ?? 0),
      tokens: served,
      revenue,
      fixedCost,
      utilization: capacityTokens ? served / capacityTokens : null,
      peakUtilization: tpm ? peak / tpm : null,
      breakEven: capacityTokens && served && fixedCost ? fixedCost / ((revenue / served) * capacityTokens) : null,
      hourly,
      daysLeft: channel.commitmentEndsAt ? Math.ceil((channel.commitmentEndsAt.getTime() - now.getTime()) / (24 * HOUR)) : null,
    };
  });
}

/** Fixed commitment cost per procurement source between two instants (for the margin dashboard). */
export async function fixedCostsBySource(from: Date, to: Date): Promise<Map<string, number>> {
  const rows = await getDb().select().from(schema.channels).where(isNotNull(schema.channels.fixedCostHourly));
  const out = new Map<string, number>();
  for (const ch of rows) out.set(ch.source, (out.get(ch.source) ?? 0) + fixedCostBetween(ch, from, to));
  return out;
}
