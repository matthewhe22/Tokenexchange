// Batch API: customers submit asynchronous batches in OpenAI or Anthropic format; they are forwarded
// to the upstream's own batch API (half of list price) and billed at the model's batch markup.
//
// Lifecycle: the worst case of every request is held up front (for up to two days). Batches are
// refreshed from the upstream whenever the customer polls them, and by the maintenance job; once a
// batch ends, its results are read once to bill the real usage and release the hold.
import { randomBytes } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { chargeFor, getPrices, recordUsages, type ModelPrice, type UsageEntry } from "@/lib/billing";
import { getActiveChannels, loadChannel, type LoadedChannel } from "@/lib/channels";
import { sha256 } from "@/lib/crypto";
import { priceForGroup } from "@/lib/groups";
import { hit } from "@/lib/ratelimit";
import { applyOutputCap, planCost, reserve } from "@/lib/reservations";
import { getLimitSettings, getRoutingSettings } from "@/lib/settings";
import { tierFactors } from "@/lib/tiers";
import { appUrl } from "@/lib/url";
import { authenticateApiKey, extractApiKey, type ApiKeyRow, type UserRow } from "../auth";
import { relayError } from "../errors";
import { orderChannels } from "../router";
import type { Json, Protocol, Usage } from "../types";
import { fromAnthropic, usageFromBody } from "../usage";
import {
  batchCapable,
  cancelUpstreamBatch,
  getUpstreamBatch,
  jsonLines,
  mapJsonLines,
  submitBatch,
  upstreamResults,
  UpstreamError,
  type BatchLine,
} from "./upstream";

export type BatchRow = typeof schema.batches.$inferSelect;
export type FileRow = typeof schema.files.$inferSelect;
export type Api = "openai" | "anthropic";

/** Request endpoints an OpenAI-format batch may target. */
export const OPENAI_BATCH_ENDPOINTS: Record<string, Protocol> = {
  "/v1/chat/completions": "openai-chat",
  "/v1/responses": "openai-responses",
  "/v1/embeddings": "openai-embeddings",
};
export const MAX_BATCH_REQUESTS = 50_000;
/** Upstreams finish within 24 hours; the hold outlives that with a margin. */
const HOLD_MS = 48 * 3_600_000;
/** Do not ask the upstream for a batch's status more often than this. */
const POLL_EVERY_MS = 10_000;
/** A settlement that has not finished in this long is assumed dead and may be retried. */
const SETTLE_LEASE_MS = 10 * 60_000;
/** Uploaded input files are deleted after this long. */
export const FILE_RETENTION_MS = 30 * 24 * 3_600_000;

const errorProtocol = (api: Api): Protocol => (api === "openai" ? "openai-chat" : "anthropic-messages");

export function newId(prefix: string): string {
  return prefix + randomBytes(12).toString("base64url");
}

export interface Principal {
  user: UserRow;
  apiKey: ApiKeyRow;
}

/** API-key auth for batch and file endpoints; returns an error response in the API's format. */
export async function authenticate(req: Request, api: Api): Promise<Principal | Response> {
  const key = extractApiKey(req);
  if (!key) return relayError(errorProtocol(api), 401, "missing API key");
  const auth = await authenticateApiKey(key);
  if (!auth.ok) return relayError(errorProtocol(api), auth.status, auth.message);
  return auth;
}

export function isTerminal(row: Pick<BatchRow, "api" | "status">): boolean {
  return row.api === "anthropic" ? row.status === "ended" : ["completed", "failed", "expired", "cancelled"].includes(row.status);
}

// ---------- creating ----------

export interface BatchItem {
  customId: string;
  model: string;
  body: Json;
}

/** Thrown for a request the customer must fix (400 unless stated). */
export class BatchInputError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}

/** Parses an OpenAI batch input file (JSONL) into items; every line must target `endpoint`. */
export function parseOpenAIInput(content: string, endpoint: string): BatchItem[] {
  const items: BatchItem[] = [];
  const seen = new Set<string>();
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    if (!text) continue;
    let line: Json;
    try {
      line = JSON.parse(text);
    } catch {
      throw new BatchInputError(`line ${i + 1}: not valid JSON`);
    }
    if (typeof line?.custom_id !== "string" || !line.custom_id) throw new BatchInputError(`line ${i + 1}: custom_id is required`);
    if (seen.has(line.custom_id)) throw new BatchInputError(`line ${i + 1}: duplicate custom_id '${line.custom_id}'`);
    seen.add(line.custom_id);
    if ((line.method ?? "POST") !== "POST") throw new BatchInputError(`line ${i + 1}: method must be POST`);
    if (line.url !== endpoint) throw new BatchInputError(`line ${i + 1}: url must be ${endpoint}, the batch's endpoint`);
    if (!line.body || typeof line.body !== "object" || typeof line.body.model !== "string") {
      throw new BatchInputError(`line ${i + 1}: body.model is required`);
    }
    items.push({ customId: line.custom_id, model: line.body.model, body: line.body });
  }
  if (!items.length) throw new BatchInputError("the input file has no requests");
  if (items.length > MAX_BATCH_REQUESTS) throw new BatchInputError(`a batch may hold at most ${MAX_BATCH_REQUESTS} requests`);
  // OpenAI requires a single model per batch.
  if (new Set(items.map((i) => i.model)).size > 1) throw new BatchInputError("all requests in a batch must use the same model");
  return items;
}

/** Parses the `requests` of an Anthropic message batch. */
export function parseAnthropicInput(requests: unknown): BatchItem[] {
  if (!Array.isArray(requests) || !requests.length) throw new BatchInputError("requests must be a non-empty array");
  if (requests.length > MAX_BATCH_REQUESTS) throw new BatchInputError(`a batch may hold at most ${MAX_BATCH_REQUESTS} requests`);
  const seen = new Set<string>();
  return requests.map((r: Json, i) => {
    if (typeof r?.custom_id !== "string" || !r.custom_id) throw new BatchInputError(`requests.${i}.custom_id is required`);
    if (seen.has(r.custom_id)) throw new BatchInputError(`requests.${i}: duplicate custom_id '${r.custom_id}'`);
    seen.add(r.custom_id);
    if (!r.params || typeof r.params !== "object" || typeof r.params.model !== "string") {
      throw new BatchInputError(`requests.${i}.params.model is required`);
    }
    return { customId: r.custom_id, model: r.params.model, body: r.params };
  });
}

export interface CreateBatch {
  principal: Principal;
  api: Api;
  /** Per-request endpoint, e.g. /v1/chat/completions or /v1/messages */
  endpoint: string;
  protocol: Protocol;
  items: BatchItem[];
  inputFileId?: string | null;
  metadata?: Json;
}

/** Validates, holds funds for and submits a batch. Returns the stored row, or an error response. */
export async function createBatch(c: CreateBatch): Promise<BatchRow | Response> {
  const { user, apiKey } = c.principal;
  const ep = errorProtocol(c.api);
  const models = [...new Set(c.items.map((i) => i.model))];

  const prices = new Map<string, ModelPrice>();
  for (const model of models) {
    const listed = (await getPrices()).get(model);
    if (!listed || !listed.enabled) return relayError(ep, 404, `model '${model}' is not available`, "model_not_found");
    if (apiKey.allowedModels && !apiKey.allowedModels.includes(model)) return relayError(ep, 403, `this API key may not use model '${model}'`);
    const price = await priceForGroup(listed, user.groupId);
    if (!tierFactors(price, "batch")) return relayError(ep, 400, `batch processing is not offered for model '${model}'`, "invalid_request_error");
    prices.set(model, price);
  }
  if (user.balance <= 0) return relayError(ep, 402, "insufficient balance, please top up", "insufficient_quota");

  // Worst case of every request, with its output capped to what is held (as for live requests).
  let total = 0;
  for (const item of c.items) {
    const price = prices.get(item.model)!;
    delete item.body.stream;
    delete item.body.service_tier;
    if (item.body.stream_options) delete item.body.stream_options;
    const plan = planCost(c.protocol, item.body, JSON.stringify(item.body), price, undefined, tierFactors(price, "batch")!.sell);
    if (plan.outputCap > 0) applyOutputCap(c.protocol, item.body, plan.outputCap);
    total += plan.cost(plan.outputCap);
  }

  const limits = await getLimitSettings();
  const l = await hit(`key:${apiKey.id}`, apiKey.rpmLimit ?? limits.defaultKeyRpm);
  if (!l.ok) return relayError(ep, 429, "rate limit exceeded, please slow down", "rate_limit_exceeded", { "retry-after": String(l.retryAfter) });

  // One upstream batch runs on one channel, so the channel must serve every model in it.
  const [channels, routing] = await Promise.all([getActiveChannels(), getRoutingSettings()]);
  const candidates = orderChannels(
    channels.filter((ch) => batchCapable(ch, c.api)),
    models[0],
    c.protocol,
    routing,
  ).filter((ch) => models.every((m) => orderChannels([ch], m, c.protocol, routing).length));
  if (!candidates.length) return relayError(ep, 503, `no upstream channel can run batches for ${models.join(", ")}`);

  const held = await reserve(user.id, apiKey.id, { inputTokens: 0, outputCap: 0, choices: 1, cost: () => total }, new Date(Date.now() + HOLD_MS));
  if (!held.ok) {
    return held.reason === "key_quota"
      ? relayError(ep, 402, "this API key has reached its spending limit", "insufficient_quota")
      : relayError(ep, 402, `insufficient balance: this batch needs up to $${(total / 1e6).toFixed(2)} held until it completes`, "insufficient_quota");
  }

  const db = getDb();
  const [row] = await db
    .insert(schema.batches)
    .values({
      id: newId(c.api === "openai" ? "batch_tx" : "msgbatch_tx"),
      userId: user.id,
      apiKeyId: apiKey.id,
      api: c.api,
      endpoint: c.endpoint,
      models,
      inputFileId: c.inputFileId ?? null,
      requestCount: c.items.length,
      status: c.api === "openai" ? "validating" : "in_progress",
      metadata: c.metadata ?? null,
      reservationId: held.id,
    })
    .returning();

  let lastError: { status: number; message: string } = { status: 502, message: "upstream batch submission failed" };
  for (const ch of candidates) {
    const lines: BatchLine[] = c.items.map((i) => ({ custom_id: i.customId, body: { ...i.body, model: ch.modelMapping[i.model] ?? i.model } }));
    try {
      const up = await submitBatch(ch, c.api, c.endpoint, lines);
      const [updated] = await db
        .update(schema.batches)
        .set({ channelId: ch.id, upstreamId: String(up.id), upstream: up, status: statusOf(c.api, up) })
        .where(eq(schema.batches.id, row.id))
        .returning();
      return updated;
    } catch (err) {
      if (err instanceof UpstreamError) {
        lastError = { status: err.status, message: err.message };
        // The upstream rejected the batch itself: another channel would too.
        if (err.status === 400 || err.status === 422) break;
      } else {
        lastError = { status: 502, message: err instanceof Error ? err.message : String(err) };
      }
    }
  }

  // Nothing was submitted: release the hold and record the failure.
  await recordUsages([entryFor(row, null, models[0], null, 0, 0, lastError.status, `batch submission failed: ${lastError.message}`)], {
    reservationId: held.id,
    also: async (tx) => {
      await tx.update(schema.batches).set({ status: "failed", settledAt: new Date() }).where(eq(schema.batches.id, row.id));
    },
  });
  if (lastError.status === 400 || lastError.status === 422) return relayError(ep, 400, `upstream rejected the batch: ${upstreamMessage(lastError.message)}`, "invalid_request_error");
  return relayError(ep, 502, "could not submit the batch upstream, please retry");
}

function upstreamMessage(detail: string): string {
  const body = detail.replace(/^HTTP \d+: /, "");
  try {
    const j = JSON.parse(body);
    return String(j?.error?.message ?? body).slice(0, 500);
  } catch {
    return body.slice(0, 500);
  }
}

function statusOf(api: Api, up: Json): string {
  return String((api === "anthropic" ? up?.processing_status : up?.status) ?? "in_progress");
}

function entryFor(row: BatchRow, ch: LoadedChannel | null, model: string, usage: Usage | null, cost: number, upstreamCost: number, status: number, error?: string): UsageEntry {
  return {
    userId: row.userId,
    apiKeyId: row.apiKeyId,
    channelId: ch?.id ?? null,
    endpoint: row.api === "openai" ? `/v1/batches ${row.endpoint}` : "/v1/messages/batches",
    model,
    upstreamModel: ch ? (ch.modelMapping[model] ?? model) : null,
    stream: false,
    status,
    usage,
    cost,
    upstreamCost,
    latencyMs: Math.min(2_000_000_000, Date.now() - row.createdAt.getTime()),
    error,
    serviceTier: "batch",
  };
}

// ---------- polling and settlement ----------

/** Upstream model id -> public name, for this batch on this channel. */
function publicNames(row: BatchRow, ch: LoadedChannel): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of row.models) out.set(ch.modelMapping[m] ?? m, m);
  return out;
}

/** Brings a batch up to date with the upstream and bills it once it has ended. */
export async function refreshBatch(row: BatchRow, force = false): Promise<BatchRow> {
  if (row.settledAt || !row.upstreamId || row.channelId == null) return row;
  const ch = await loadChannel(row.channelId);
  if (!ch) return row;
  const db = getDb();
  if (force || !isTerminal(row) || !row.lastPolledAt) {
    if (force || !row.lastPolledAt || Date.now() - row.lastPolledAt.getTime() >= POLL_EVERY_MS) {
      try {
        const up = await getUpstreamBatch(ch, row.api, row.upstreamId);
        [row] = await db
          .update(schema.batches)
          .set({ upstream: up, status: statusOf(row.api, up), lastPolledAt: new Date() })
          .where(eq(schema.batches.id, row.id))
          .returning();
      } catch (err) {
        console.error(`batch ${row.id}: refresh failed`, err);
        return row;
      }
    }
  }
  if (isTerminal(row)) await settleBatch(row, ch).catch((err) => console.error(`batch ${row.id}: settlement failed`, err));
  const [fresh] = await db.select().from(schema.batches).where(eq(schema.batches.id, row.id));
  return fresh ?? row;
}

/** Reads the results of an ended batch and bills what the upstream actually ran. Runs once. */
async function settleBatch(row: BatchRow, ch: LoadedChannel): Promise<void> {
  const db = getDb();
  const claimed = await db
    .update(schema.batches)
    .set({ settlingAt: new Date() })
    .where(
      and(
        eq(schema.batches.id, row.id),
        isNull(schema.batches.settledAt),
        or(isNull(schema.batches.settlingAt), lt(schema.batches.settlingAt, new Date(Date.now() - SETTLE_LEASE_MS))),
      ),
    )
    .returning({ id: schema.batches.id });
  if (!claimed.length) return;

  const protocol: Protocol = row.api === "anthropic" ? "anthropic-messages" : OPENAI_BATCH_ENDPOINTS[row.endpoint];
  const names = publicNames(row, ch);
  const byModel = new Map<string, Usage>();
  const add = (model: string, u: Usage | null) => {
    if (!u) return;
    const t = byModel.get(model) ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    byModel.set(model, { input: t.input + u.input, output: t.output + u.output, cacheRead: t.cacheRead + u.cacheRead, cacheWrite: t.cacheWrite + u.cacheWrite });
  };

  const up = (row.upstream ?? {}) as Json;
  const resultsId = row.api === "anthropic" ? row.upstreamId! : up.output_file_id;
  if (resultsId) {
    const res = await upstreamResults(ch, row.api, String(resultsId));
    for await (const line of jsonLines(res.body!)) {
      if (row.api === "anthropic") {
        if (line?.result?.type !== "succeeded") continue;
        const m = line.result.message;
        add(names.get(m?.model) ?? row.models[0], fromAnthropic(m?.usage));
      } else if (line?.response?.status_code === 200) {
        add(row.models[0], usageFromBody(protocol, line.response.body));
      }
    }
  }

  const [user] = await db.select({ groupId: schema.users.groupId }).from(schema.users).where(eq(schema.users.id, row.userId));
  const entries: UsageEntry[] = [];
  for (const [model, usage] of byModel) {
    const listed = (await getPrices()).get(model);
    if (!listed) throw new Error(`no price for ${model}; add it back to settle this batch`);
    const price = await priceForGroup(listed, user?.groupId ?? null);
    const { cost, upstreamCost } = chargeFor(usage, price, ch, "batch");
    entries.push(entryFor(row, ch, model, usage, cost, upstreamCost, 200));
  }
  if (!entries.length) entries.push(entryFor(row, ch, row.models[0], null, 0, 0, 200, `batch ${row.status} with no successful requests`));
  const cost = entries.reduce((s, e) => s + e.cost, 0);
  const upstreamCost = entries.reduce((s, e) => s + e.upstreamCost, 0);
  await recordUsages(entries, {
    reservationId: row.reservationId,
    also: async (tx) => {
      await tx.update(schema.batches).set({ settledAt: new Date(), cost, upstreamCost }).where(eq(schema.batches.id, row.id));
    },
  });
}

/** For the maintenance job: refresh batches nobody is polling, so they still get billed. */
export async function refreshPendingBatches(limit = 20): Promise<number> {
  const rows = await getDb()
    .select()
    .from(schema.batches)
    .where(and(isNull(schema.batches.settledAt), isNotNull(schema.batches.upstreamId)))
    .orderBy(schema.batches.lastPolledAt)
    .limit(limit);
  for (const row of rows) await refreshBatch(row);
  return rows.length;
}

/** Deletes uploaded input files past the retention period. */
export async function pruneFiles(): Promise<number> {
  const rows = await getDb()
    .delete(schema.files)
    .where(and(isNotNull(schema.files.content), lt(schema.files.createdAt, new Date(Date.now() - FILE_RETENTION_MS))))
    .returning({ id: schema.files.id });
  return rows.length;
}

export async function cancelBatch(row: BatchRow): Promise<BatchRow> {
  if (isTerminal(row) || !row.upstreamId || row.channelId == null) return row;
  const ch = await loadChannel(row.channelId);
  if (!ch) return row;
  const up = await cancelUpstreamBatch(ch, row.api, row.upstreamId);
  const [updated] = await getDb()
    .update(schema.batches)
    .set({ upstream: up, status: statusOf(row.api, up), lastPolledAt: new Date() })
    .where(eq(schema.batches.id, row.id))
    .returning();
  return updated;
}

export async function findBatch(userId: number, id: string, api: Api): Promise<BatchRow | null> {
  const [row] = await getDb()
    .select()
    .from(schema.batches)
    .where(and(eq(schema.batches.id, id), eq(schema.batches.userId, userId), eq(schema.batches.api, api)));
  return row ?? null;
}

/** A page of the user's batches, newest first, starting after the batch `after` (a cursor id). */
export async function listBatches(userId: number, api: Api, limit: number, after?: string | null): Promise<{ rows: BatchRow[]; hasMore: boolean }> {
  const b = schema.batches;
  const where = [eq(b.userId, userId), eq(b.api, api)];
  if (after) where.push(sql`${b.createdAt} < (select created_at from batches where id = ${after} and user_id = ${userId})`);
  const rows = await getDb()
    .select()
    .from(b)
    .where(and(...where))
    .orderBy(desc(b.createdAt))
    .limit(limit + 1);
  return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
}

// ---------- output files and results ----------

/** Our id for a batch's upstream output / error file (stable, so repeated polls reuse it). */
async function outputFile(row: BatchRow, kind: "output" | "error", upstreamFileId: unknown): Promise<string | null> {
  if (typeof upstreamFileId !== "string" || !upstreamFileId) return null;
  const id = `file-tx${sha256(`${row.id}:${kind}`).slice(0, 24)}`;
  await getDb()
    .insert(schema.files)
    .values({
      id,
      userId: row.userId,
      purpose: kind === "output" ? "batch_output" : "batch_error",
      filename: `${row.id}_${kind}.jsonl`,
      bytes: 0,
      batchId: row.id,
      channelId: row.channelId,
      upstreamFileId,
    })
    .onConflictDoNothing();
  return id;
}

const unix = (v: unknown, fallback: number | null = null) => (typeof v === "number" ? v : fallback);

/** The batch as OpenAI's API describes it, with our ids in place of the upstream's. */
export async function openaiBatchObject(row: BatchRow): Promise<Json> {
  const up = (row.upstream ?? {}) as Json;
  return {
    id: row.id,
    object: "batch",
    endpoint: row.endpoint,
    errors: up.errors ?? null,
    input_file_id: row.inputFileId,
    completion_window: "24h",
    status: row.status,
    output_file_id: await outputFile(row, "output", up.output_file_id),
    error_file_id: await outputFile(row, "error", up.error_file_id),
    created_at: Math.floor(row.createdAt.getTime() / 1000),
    in_progress_at: unix(up.in_progress_at),
    expires_at: unix(up.expires_at, Math.floor(row.createdAt.getTime() / 1000) + 86_400),
    finalizing_at: unix(up.finalizing_at),
    completed_at: unix(up.completed_at),
    failed_at: unix(up.failed_at),
    expired_at: unix(up.expired_at),
    cancelling_at: unix(up.cancelling_at),
    cancelled_at: unix(up.cancelled_at),
    request_counts: up.request_counts ?? { total: row.requestCount, completed: 0, failed: 0 },
    metadata: row.metadata ?? null,
  };
}

/** The batch as Anthropic's API describes it; results are downloaded through this gateway. */
export function anthropicBatchObject(row: BatchRow): Json {
  const up = (row.upstream ?? {}) as Json;
  const ended = row.status === "ended";
  return {
    id: row.id,
    type: "message_batch",
    processing_status: row.status,
    request_counts: up.request_counts ?? { processing: row.requestCount, succeeded: 0, errored: 0, canceled: 0, expired: 0 },
    ended_at: up.ended_at ?? null,
    created_at: up.created_at ?? row.createdAt.toISOString(),
    expires_at: up.expires_at ?? new Date(row.createdAt.getTime() + 86_400_000).toISOString(),
    archived_at: up.archived_at ?? null,
    cancel_initiated_at: up.cancel_initiated_at ?? null,
    results_url: ended && row.upstreamId ? `${appUrl()}/v1/messages/batches/${row.id}/results` : null,
  };
}

/** Streams a batch's results from the upstream, with upstream model ids replaced by public names. */
export async function streamResults(row: BatchRow, upstreamId: string): Promise<Response> {
  const ch = row.channelId != null ? await loadChannel(row.channelId) : null;
  if (!ch) return relayError(errorProtocol(row.api), 404, "the channel that ran this batch no longer exists");
  const res = await upstreamResults(ch, row.api, upstreamId);
  const names = publicNames(row, ch);
  const rename = (m: unknown) => (typeof m === "string" ? (names.get(m) ?? m) : m);
  const body = mapJsonLines(res.body!, (line) => {
    if (row.api === "anthropic") {
      if (line?.result?.message?.model) line.result.message.model = rename(line.result.message.model);
    } else if (line?.response?.body?.model) {
      line.response.body.model = rename(line.response.body.model);
    }
    return line;
  });
  // Streamed, so results larger than Vercel's 4.5 MB response limit still download.
  return new Response(body, { headers: { "content-type": row.api === "anthropic" ? "application/x-jsonl" : "application/octet-stream" } });
}

// ---------- files ----------

export function fileObject(f: FileRow): Json {
  return {
    id: f.id,
    object: "file",
    bytes: f.bytes,
    created_at: Math.floor(f.createdAt.getTime() / 1000),
    filename: f.filename,
    purpose: f.purpose,
    status: "processed",
    status_details: null,
  };
}

export async function findFile(userId: number, id: string): Promise<FileRow | null> {
  const [f] = await getDb().select().from(schema.files).where(and(eq(schema.files.id, id), eq(schema.files.userId, userId)));
  return f ?? null;
}
