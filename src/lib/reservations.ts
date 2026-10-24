import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Json, Protocol } from "@/relay/types";
import type { ModelPrice } from "./billing";

/** Output tokens assumed when the request sets no limit, and the ceiling for any request. */
export const DEFAULT_OUTPUT_ESTIMATE = 4096;
export const MAX_OUTPUT_ESTIMATE = 65_536;
/** Reservations older than this belong to functions that died (Vercel's longest timeout is 800s). */
export const STALE_AFTER_MS = 20 * 60 * 1000;

function requestedOutputTokens(protocol: Protocol, body: Json): number | null {
  const v =
    protocol === "gemini"
      ? body?.generationConfig?.maxOutputTokens
      : (body?.max_completion_tokens ?? body?.max_output_tokens ?? body?.max_tokens);
  return typeof v === "number" && v > 0 ? v : null;
}

/**
 * Upper-bound cost of a request in micro-USD, used to hold funds while it runs.
 * Input is approximated from the body size (~4 bytes/token); output from the request's own limit.
 */
export function estimateCost(protocol: Protocol, body: Json, rawBytes: number, price: ModelPrice): number {
  const input = Math.ceil(rawBytes / 4);
  const output =
    protocol === "openai-embeddings"
      ? 0
      : Math.min(MAX_OUTPUT_ESTIMATE, requestedOutputTokens(protocol, body) ?? DEFAULT_OUTPUT_ESTIMATE);
  return Math.max(1, Math.ceil((input * price.inputPrice + output * price.outputPrice) * price.markup));
}

export type ReserveResult =
  | { ok: true; id: number; amount: number }
  | { ok: false; reason: "balance" | "key_quota" };

/**
 * Holds up to `estimate` from the user's balance and the key's spending limit. If less than the
 * estimate is available, whatever remains is held instead, so a small balance can still make a
 * request, but concurrent requests cannot both spend the same money.
 */
export async function reserve(userId: number, apiKeyId: number, estimate: number): Promise<ReserveResult> {
  return getDb().transaction(async (tx) => {
    // Lock order (user, then key) is the same everywhere to avoid deadlocks.
    const [user] = await tx
      .select({ balance: schema.users.balance })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .for("update");
    const [key] = await tx
      .select({ used: schema.apiKeys.used, quotaLimit: schema.apiKeys.quotaLimit })
      .from(schema.apiKeys)
      .where(eq(schema.apiKeys.id, apiKeyId))
      .for("update");
    if (!user || user.balance <= 0) return { ok: false, reason: "balance" } as const;
    const keyRemaining = key?.quotaLimit != null ? key.quotaLimit - key.used : Infinity;
    if (keyRemaining <= 0) return { ok: false, reason: "key_quota" } as const;

    const amount = Math.min(estimate, user.balance, keyRemaining);
    await tx.update(schema.users).set({ balance: sql`${schema.users.balance} - ${amount}` }).where(eq(schema.users.id, userId));
    await tx.update(schema.apiKeys).set({ used: sql`${schema.apiKeys.used} + ${amount}` }).where(eq(schema.apiKeys.id, apiKeyId));
    const [row] = await tx.insert(schema.reservations).values({ userId, apiKeyId, amount }).returning({ id: schema.reservations.id });
    return { ok: true, id: row.id, amount } as const;
  });
}

/** Returns funds held by reservations whose request never settled. Returns how many were released. */
export async function releaseStaleReservations(olderThanMs = STALE_AFTER_MS): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  return getDb().transaction(async (tx) => {
    const rows = await tx
      .delete(schema.reservations)
      .where(lt(schema.reservations.createdAt, cutoff))
      .returning();
    for (const r of rows) {
      await tx.update(schema.users).set({ balance: sql`${schema.users.balance} + ${r.amount}` }).where(eq(schema.users.id, r.userId));
      if (r.apiKeyId != null) {
        await tx
          .update(schema.apiKeys)
          .set({ used: sql`greatest(0, ${schema.apiKeys.used} - ${r.amount})` })
          .where(and(eq(schema.apiKeys.id, r.apiKeyId)));
      }
    }
    return rows.length;
  });
}
