import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { testChannel } from "./channel-test";
import { invalidateChannels } from "./channels";
import { decrypt } from "./crypto";
import { pruneRateLimits } from "./ratelimit";
import { releaseStaleReservations } from "./reservations";
import { pruneFiles, refreshPendingBatches } from "@/relay/batch";

/** Test request to every auto-disabled channel; healthy ones are put back into rotation. */
export async function probeDisabledChannels(): Promise<{ probed: number; recovered: number }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.channels)
    .where(and(eq(schema.channels.enabled, false), isNotNull(schema.channels.autoDisabledAt)));
  let recovered = 0;
  for (const row of rows) {
    if (!row.models.length) continue;
    let result;
    try {
      result = await testChannel({ ...row, credentials: JSON.parse(decrypt(row.credentials)) }, row.models[0]);
    } catch (err) {
      result = { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    if (result.ok) {
      await db
        .update(schema.channels)
        .set({ enabled: true, autoDisabledAt: null, failCount: 0, lastError: null })
        .where(and(eq(schema.channels.id, row.id), isNotNull(schema.channels.autoDisabledAt)));
      recovered++;
    } else {
      await db
        .update(schema.channels)
        .set({ lastError: `probe: ${result.message.slice(0, 900)}`, lastErrorAt: new Date() })
        .where(eq(schema.channels.id, row.id));
    }
  }
  if (recovered) invalidateChannels();
  return { probed: rows.length, recovered };
}

/**
 * Claims the maintenance slot across all instances: at most one run per `minIntervalMs`,
 * via an atomic compare-and-set on the settings table.
 */
async function claimSlot(minIntervalMs: number): Promise<boolean> {
  if (minIntervalMs <= 0) return true;
  const now = Date.now();
  const rows = await getDb().execute(sql`
    insert into settings (key, value) values ('maintenance', ${JSON.stringify({ at: now })}::jsonb)
    on conflict (key) do update set value = excluded.value
      where (settings.value->>'at')::bigint < ${now - minIntervalMs}
    returning key`);
  return rows.length > 0;
}

/**
 * Housekeeping: release stale holds, probe auto-disabled channels, prune rate-limit counters,
 * refresh (and bill) batches nobody is polling, delete expired batch input files.
 */
export async function runMaintenance(minIntervalMs = 0) {
  if (!(await claimSlot(minIntervalMs))) return null;
  const released = await releaseStaleReservations();
  const channels = await probeDisabledChannels();
  const prunedCounters = await pruneRateLimits();
  const batches = await refreshPendingBatches().catch((err) => (console.error("batch refresh failed", err), 0));
  const prunedFiles = await pruneFiles();
  return { released, ...channels, prunedCounters, batches, prunedFiles };
}
