import { and, eq, lt, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import type { Json, Protocol } from "@/relay/types";
import { ratesFor, type ModelPrice } from "./billing";

/**
 * Output cap for models without `max_output_tokens` when the request sets no limit. Conservative
 * because some models reject larger values; set each model's real maximum in Models & prices.
 */
export const DEFAULT_MAX_OUTPUT = 8_192;
/** When the balance cannot cover the full request, serve a shorter answer down to this many tokens. */
export const MIN_OUTPUT_TOKENS = 256;
/** Holds older than this belong to functions that died (Vercel allows at most 800s per request). */
export const STALE_AFTER_MS = 15 * 60 * 1000;

/**
 * Conservative input-token estimate. Text is counted at 3 bytes/token (CJK text is ~3 bytes per
 * token or worse). Long base64 blobs (images, PDFs) are counted per blob instead of per byte.
 */
export function estimateInputTokens(raw: string): number {
  let blobTokens = 0;
  const text = raw.replace(/[A-Za-z0-9+/=_-]{2000,}/g, (m) => {
    blobTokens += Math.max(2000, Math.ceil(m.length / 25));
    return "";
  });
  return Math.ceil(Buffer.byteLength(text) / 3) + blobTokens;
}

function requestedOutputTokens(protocol: Protocol, body: Json): number | null {
  const v =
    protocol === "gemini"
      ? body?.generationConfig?.maxOutputTokens
      : (body?.max_completion_tokens ?? body?.max_output_tokens ?? body?.max_tokens);
  return typeof v === "number" && v > 0 ? Math.floor(v) : null;
}

export interface CostPlan {
  inputTokens: number;
  /** Output tokens the request may produce if fully funded. */
  outputCap: number;
  /** Parallel completions (OpenAI `n`); each may produce `outputCap` tokens. */
  choices: number;
  cost: (outputTokens: number) => number;
}

/** Worst-case pricing for a request, as a function of the output cap it is allowed. */
export function planCost(protocol: Protocol, body: Json, raw: string, price: ModelPrice, inputTokensOverride?: number): CostPlan {
  const inputTokens = inputTokensOverride ?? estimateInputTokens(raw);
  const modelMax = price.maxOutputTokens ?? DEFAULT_MAX_OUTPUT;
  const noOutputCap = protocol === "openai-embeddings" || protocol === "rerank" || protocol === "openai-audio-speech";
  const outputCap = noOutputCap ? 0 : Math.min(modelMax, requestedOutputTokens(protocol, body) ?? modelMax);
  const choices = (protocol === "openai-chat" || protocol === "openai-images") && Number.isInteger(body?.n) && body.n > 1 ? body.n : 1;
  const rates = ratesFor(price, inputTokens);
  // Input could all be written to the prompt cache, which costs more than plain input.
  const inputPrice = Math.max(rates.input, rates.cacheWrite);
  const perUnit = (price.perRequestPrice ?? 0) * 1_000_000 * choices;
  return {
    inputTokens,
    outputCap,
    choices,
    cost: (out) => Math.max(1, Math.ceil((inputTokens * inputPrice + out * choices * rates.output + perUnit) * price.markup)),
  };
}

/** Largest output cap whose worst-case cost fits in `available`, or -1 if not even the input fits. */
export function affordableOutput(plan: CostPlan, available: number): number {
  if (plan.cost(plan.outputCap) <= available) return plan.outputCap;
  let lo = 0;
  let hi = plan.outputCap;
  if (plan.cost(0) > available) return -1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (plan.cost(mid) <= available) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Writes the output cap into the request so the upstream can never generate more than was held. */
export function applyOutputCap(protocol: Protocol, body: Json, cap: number): void {
  switch (protocol) {
    case "openai-chat":
      if (body.max_tokens != null && body.max_completion_tokens == null) body.max_tokens = cap;
      else body.max_completion_tokens = cap;
      break;
    case "openai-responses":
      body.max_output_tokens = cap;
      break;
    case "anthropic-messages":
      body.max_tokens = cap;
      break;
    case "gemini":
      body.generationConfig = { ...(body.generationConfig ?? {}), maxOutputTokens: cap };
      break;
    case "openai-embeddings":
      break;
  }
}

export type ReserveResult =
  | { ok: true; id: number; amount: number; outputCap: number }
  | { ok: false; reason: "balance" | "key_quota" };

/**
 * Holds the worst-case cost of the request against the user's balance and the key's spending
 * limit. If the full amount is not available, the output cap is shrunk to what is (down to
 * MIN_OUTPUT_TOKENS); otherwise the request is refused. The caller must apply `outputCap`.
 */
export async function reserve(userId: number, apiKeyId: number, plan: CostPlan): Promise<ReserveResult> {
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
    const balance = user?.balance ?? 0;
    const keyRemaining = key?.quotaLimit != null ? key.quotaLimit - key.used : Infinity;
    const binding = keyRemaining < balance ? "key_quota" : "balance";
    const available = Math.min(balance, keyRemaining);

    const cap = affordableOutput(plan, available);
    if (cap < 0 || (plan.outputCap > 0 && cap < Math.min(MIN_OUTPUT_TOKENS, plan.outputCap))) {
      return { ok: false, reason: binding } as const;
    }
    const amount = plan.cost(cap);
    await tx.update(schema.users).set({ balance: sql`${schema.users.balance} - ${amount}` }).where(eq(schema.users.id, userId));
    await tx.update(schema.apiKeys).set({ used: sql`${schema.apiKeys.used} + ${amount}` }).where(eq(schema.apiKeys.id, apiKeyId));
    const [row] = await tx.insert(schema.reservations).values({ userId, apiKeyId, amount }).returning({ id: schema.reservations.id });
    return { ok: true, id: row.id, amount, outputCap: cap } as const;
  });
}

/**
 * Returns funds held by reservations whose request never settled, optionally for one user only.
 * Each release is logged as a zero-cost usage row so unbilled requests can be reconciled.
 */
export async function releaseStaleReservations(olderThanMs = STALE_AFTER_MS, userId?: number): Promise<number> {
  const where: SQL[] = [lt(schema.reservations.createdAt, new Date(Date.now() - olderThanMs))];
  if (userId != null) where.push(eq(schema.reservations.userId, userId));
  return getDb().transaction(async (tx) => {
    const rows = await tx.delete(schema.reservations).where(and(...where)).returning();
    for (const r of rows) {
      await tx.update(schema.users).set({ balance: sql`${schema.users.balance} + ${r.amount}` }).where(eq(schema.users.id, r.userId));
      if (r.apiKeyId != null) {
        await tx.update(schema.apiKeys).set({ used: sql`${schema.apiKeys.used} - ${r.amount}` }).where(eq(schema.apiKeys.id, r.apiKeyId));
      }
      await tx.insert(schema.usageLogs).values({
        userId: r.userId,
        apiKeyId: r.apiKeyId ?? 0,
        endpoint: "reservation-sweep",
        model: "-",
        status: 0,
        error: `released unsettled hold of ${r.amount} micro-USD from ${r.createdAt.toISOString()}; the request was not billed`,
      });
    }
    return rows.length;
  });
}
