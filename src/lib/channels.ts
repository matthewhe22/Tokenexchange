import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { cached, invalidate } from "./cache";
import { decrypt } from "./crypto";
import { getRoutingSettings } from "./settings";
import { batchCapable } from "@/relay/batch/upstream";

export type ChannelRow = typeof schema.channels.$inferSelect;
export type LoadedChannel = Omit<ChannelRow, "credentials"> & { credentials: Record<string, string> };

/** Enabled channels with decrypted credentials. Channels whose credentials fail to decrypt are skipped. */
export async function getActiveChannels(): Promise<LoadedChannel[]> {
  return cached("channels", async () => {
    const rows = await getDb().select().from(schema.channels).where(eq(schema.channels.enabled, true));
    const out: LoadedChannel[] = [];
    for (const row of rows) {
      try {
        out.push({ ...row, credentials: JSON.parse(decrypt(row.credentials)) });
      } catch (err) {
        console.error(`channel ${row.id}: cannot decrypt credentials`, err);
      }
    }
    return out;
  });
}

export function invalidateChannels(): void {
  invalidate("channels");
}

export async function markChannelFailure(id: number, error: string, autoDisableAfter = 0): Promise<void> {
  const [row] = await getDb()
    .update(schema.channels)
    .set({ failCount: sql`${schema.channels.failCount} + 1`, lastError: error.slice(0, 1000), lastErrorAt: new Date() })
    .where(eq(schema.channels.id, id))
    .returning({ failCount: schema.channels.failCount });
  if (autoDisableAfter > 0 && row && row.failCount >= autoDisableAfter) {
    await getDb().update(schema.channels).set({ enabled: false, autoDisabledAt: new Date() }).where(eq(schema.channels.id, id));
    invalidateChannels();
    console.warn(`channel ${id} auto-disabled after ${row.failCount} consecutive failures`);
  }
}

export async function markChannelHealthy(id: number): Promise<void> {
  await getDb().update(schema.channels).set({ failCount: 0 }).where(eq(schema.channels.id, id));
}

/** Any channel by id, enabled or not (batches must be polled on the channel that runs them). */
export async function loadChannel(id: number): Promise<LoadedChannel | null> {
  const [row] = await getDb().select().from(schema.channels).where(eq(schema.channels.id, id));
  return row ? { ...row, credentials: JSON.parse(decrypt(row.credentials)) } : null;
}

/**
 * Models customers can actually call: served by an enabled channel whose source routing allows
 * for that model. `batch` is the subset served by a channel that can run batches.
 */
export async function servedModels(): Promise<{ live: Set<string>; batch: Set<string> }> {
  const [channels, routing] = await Promise.all([getActiveChannels(), getRoutingSettings()]);
  const live = new Set<string>();
  const batch = new Set<string>();
  for (const ch of channels) {
    if (!routing.enabledSources.includes(ch.source)) continue;
    const runsBatches = batchCapable(ch, "openai") || batchCapable(ch, "anthropic");
    for (const m of ch.models) {
      if (!(routing.modelSources[m] ?? routing.enabledSources).includes(ch.source)) continue;
      live.add(m);
      if (runsBatches) batch.add(m);
    }
  }
  return { live, batch };
}
