import { and, eq, isNotNull } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { testChannel } from "./channel-test";
import { invalidateChannels } from "./channels";
import { decrypt } from "./crypto";
import { releaseStaleReservations } from "./reservations";

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

let lastRun = 0;

/** Housekeeping: release stale holds and probe disabled channels. Throttled per instance. */
export async function runMaintenance(minIntervalMs = 0) {
  if (Date.now() - lastRun < minIntervalMs) return null;
  lastRun = Date.now();
  const released = await releaseStaleReservations();
  const channels = await probeDisabledChannels();
  return { released, ...channels };
}
