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

async function incrUpstash(cfg: { url: string; token: string }, key: string, windowSec: number): Promise<number> {
  const res = await fetch(`${cfg.url}/pipeline`, {
    method: "POST",
    headers: { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" },
    // The key is per-window, so a plain EXPIRE (re-set on every hit) is enough.
    body: JSON.stringify([
      ["INCR", key],
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

async function incrPostgres(key: string, windowStart: number): Promise<number> {
  const rows = await getDb().execute<{ count: number }>(sql`
    insert into rate_limits (bucket, window_start, count) values (${key}, ${windowStart}, 1)
    on conflict (bucket) do update set
      -- Instances with skewed clocks must never move the window backwards or reset a newer one.
      count = case
        when excluded.window_start > rate_limits.window_start then 1
        else rate_limits.count + 1 end,
      window_start = greatest(rate_limits.window_start, excluded.window_start)
    returning count`);
  return Number(rows[0].count);
}

/**
 * Fixed-window counter: allows `limit` hits per `windowSec` for `bucket`. Uses Upstash Redis when
 * configured (shared across all instances, no database writes), otherwise a Postgres table.
 * Fails open if the store is unreachable, so an outage of the limiter never blocks paying traffic.
 */
export async function hit(bucket: string, limit: number, windowSec = 60): Promise<LimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - (now % windowSec);
  const retryAfter = windowStart + windowSec - now;
  if (limit <= 0) return { ok: true, count: 0, retryAfter };
  try {
    const cfg = upstash();
    const count = cfg ? await incrUpstash(cfg, `rl:${bucket}:${windowStart}`, windowSec) : await incrPostgres(bucket, windowStart);
    return { ok: count <= limit, count, retryAfter };
  } catch (err) {
    console.error("rate limiter unavailable, allowing request", err);
    return { ok: true, count: 0, retryAfter };
  }
}
