import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { cached, invalidate } from "./cache";
import { decrypt } from "./crypto";

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

export async function markChannelFailure(id: number, error: string): Promise<void> {
  await getDb()
    .update(schema.channels)
    .set({ failCount: sql`${schema.channels.failCount} + 1`, lastError: error.slice(0, 1000), lastErrorAt: new Date() })
    .where(eq(schema.channels.id, id));
}

export async function markChannelHealthy(id: number): Promise<void> {
  await getDb().update(schema.channels).set({ failCount: 0 }).where(eq(schema.channels.id, id));
}
