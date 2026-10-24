import { sql } from "drizzle-orm";
import { getDb } from "@/db";

export interface LimitResult {
  ok: boolean;
  count: number;
  /** Seconds until the current window resets. */
  retryAfter: number;
}

function upstash(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/+$/, ""), token } : null;
}

async function incrUpstash(cfg: { url: string; token: string }, key: string, windowSec: number, amount: number): Promise<number> {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    // The key is per-window, so a plain EXPIRE (re-set on every hit) is enough.
    body: JSON.stringify([
      ["INCRBY", key, String(amount)],
      ["EXPIRE", key, String(windowSec + 1)],
    ]),
    signal: AbortSignal.timeout(500),
  });
  if (!res.ok) throw new Error(`upstash ${res.status}`);
  // Per-command failures come back as HTTP 200 with { error } entries.
  const [incr] = (await res.json()) as { result?: unknown; error?: string }[];
  if (typeof incr?.result !== "number") throw new Error(`upstash: ${incr?.error ?? "unexpected response"}`);
  return incr.result;
}

async function incrPostgres(key: string, windowStart: number, amount: number): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(sql`
    insert into rate_limits (bucket, window_start, count) values (${key}, ${windowStart}, ${amount})
    on conflict (bucket) do update set
      -- Instances with skewed clocks must never move the window backwards or reset a newer one.
      count = case
        when excluded.window_start > rate_limits.window_start then excluded.count
        else rate_limits.count + excluded.count end,
      window_start = greatest(rate_limits.window_start, excluded.window_start)
    returning count`);
  return Number(rows[0].count);
}

/**
 * Fixed-window counter: allows `limit` hits per `windowSec` for `bucket`. Uses Upstash Redis when
 * configured (shared across all instances, no database writes), otherwise a Postgres table.
 * Fails open if the store is unreachable, so an outage of the limiter never blocks paying traffic.
 * `amount` counts more than one unit at once (e.g. tokens served by a capacity channel).
 */
export async function hit(bucket: string, limit: number, windowSec = 60, amount = 1): Promise<LimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  const retryAfter = windowStart + windowSec - now;
  if (limit <= 0) return { ok: true, count: 0, retryAfter };
  try {
    const cfg = upstash();
    const count = cfg
      ? await incrUpstash(cfg, `rl:${bucket}:${windowStart}`, windowSec, amount)
      : await incrPostgres(bucket, windowStart, amount);
    return { ok: count <= limit, count, retryAfter };
  } catch (err) {
    console.error("rate limiter unavailable, allowing request", err);
    return { ok: true, count: 0, retryAfter };
  }
}

/** Current count in `bucket`'s window without incrementing it. Fails open (returns 0). */
export async function peek(bucket: string, windowSec = 60): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  try {
    const cfg = upstash();
    if (cfg) {
      const res = await fetch(`${cfg.url}/get/${encodeURIComponent(`rl:${bucket}:${windowStart}`)}`, {
        headers: { authorization: `Bearer ${cfg.token}` },
        signal: AbortSignal.timeout(500),
      });
      const { result } = (await res.json()) as { result: string | null };
      return Number(result ?? 0);
    }
    const rows = await getDb().execute<{ count: number }>(
      sql`select count from rate_limits where bucket = ${bucket} and window_start = ${windowStart}`,
    );
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

/** Deletes Postgres counters from windows that ended more than a day ago. */
export async function pruneRateLimits(): Promise<number> {
  const cutoff = Math.floor(Date.now() / 1000) - 86_400;
  const rows = await getDb().execute(sql`delete from rate_limits where window_start < ${cutoff} returning bucket`);
  return rows.length;
}

/** Adds `amount` to the current window of `bucket` (no limit), e.g. tokens per minute. */
export async function addToWindow(bucket: string, amount: number, windowSec = 60): Promise<void> {
  if (amount > 0) await hit(bucket, Number.MAX_SAFE_INTEGER, windowSec, amount);
}
