import { waitUntil } from "@vercel/functions";
import { chargeFor, getPrices, recordUsage, type ModelPrice } from "@/lib/billing";
import { getActiveChannels, markChannelFailure, markChannelHealthy, type LoadedChannel } from "@/lib/channels";
import { hit } from "@/lib/ratelimit";
import { applyOutputCap, planCost, releaseStaleReservations, reserve } from "@/lib/reservations";
import { getLimitSettings, getRoutingSettings } from "@/lib/settings";
import { authenticateApiKey, extractApiKey, type ApiKeyRow, type UserRow } from "./auth";
import { bedrockToSSE } from "./bedrock-stream";
import { conversionTargets, ConversionError, converterFor } from "./convert";
import { relayError } from "./errors";
import { buildUpstreamCall } from "./providers";
import { orderChannels } from "./router";
import { SSEParser } from "./sse";
import { tapStream } from "./stream";
import { StreamUsageTracker, usageFromBody } from "./usage";
import type { Json, Protocol, RelayRequest, Usage } from "./types";

// Failures that are specific to one channel (bad key, quota, outage, missing deployment): try the next one.
const RETRYABLE = new Set([401, 403, 404, 408, 409, 429, 500, 502, 503, 504, 529]);
// Client errors whose upstream message is safe and useful to pass through verbatim.
const PASSTHROUGH = new Set([400, 413, 415, 422]);

const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
};

export interface RelayOptions {
  /** For protocols that carry the model in the URL (Gemini). */
  model?: string;
  stream?: boolean;
  /** Endpoint label stored in usage logs. */
  endpoint: string;
}

interface Ctx {
  user: UserRow;
  apiKey: ApiKeyRow;
  price: ModelPrice;
  req: RelayRequest;
  endpoint: string;
  started: number;
  reservationId: number | null;
  settled: boolean;
  /** Set when the request was translated for an upstream speaking another protocol. */
  via?: Protocol;
}

interface Candidate {
  ch: LoadedChannel;
  /** Protocol spoken to this channel; differs from the client's when converting. */
  target: Protocol;
}

async function settleOnce(ctx: Ctx, ch: LoadedChannel | null, status: number, usage: Usage | null, error?: string) {
  const { cost, upstreamCost } =
    usage && ch ? chargeFor(usage, ctx.price, ch.costMultiplier) : { cost: 0, upstreamCost: 0 };
  await recordUsage({
    userId: ctx.user.id,
    apiKeyId: ctx.apiKey.id,
    channelId: ch?.id ?? null,
    endpoint: ctx.via ? `${ctx.endpoint} → ${ctx.via}` : ctx.endpoint,
    model: ctx.req.model,
    upstreamModel: ch ? (ch.modelMapping[ctx.req.model] ?? ctx.req.model) : null,
    stream: ctx.req.stream,
    status,
    usage,
    cost,
    upstreamCost,
    latencyMs: Date.now() - ctx.started,
    error,
    reservationId: ctx.reservationId,
  });
}

/**
 * Settles a request exactly once (later calls are ignored), retrying transient database errors.
 * If every attempt fails the hold stays in place and the stale-reservation sweep releases it.
 */
async function settle(ctx: Ctx, ch: LoadedChannel | null, status: number, usage: Usage | null, error?: string) {
  if (ctx.settled) return;
  ctx.settled = true;
  for (let attempt = 0; ; attempt++) {
    try {
      return await settleOnce(ctx, ch, status, usage, error);
    } catch (err) {
      if (attempt >= 2) {
        console.error("settle failed; usage not recorded", { userId: ctx.user.id, model: ctx.req.model, usage, err });
        return;
      }
      await new Promise((r) => setTimeout(r, 200 * 3 ** attempt));
    }
  }
}

export async function relay(req: Request, protocol: Protocol, opts: RelayOptions): Promise<Response> {
  const started = Date.now();
  const key = extractApiKey(req);
  if (!key) return relayError(protocol, 401, "missing API key");
  const auth = await authenticateApiKey(key);
  if (!auth.ok) return relayError(protocol, auth.status, auth.message);
  const { user, apiKey } = auth;

  let body: Json;
  let rawText: string;
  try {
    rawText = await req.text();
    body = JSON.parse(rawText);
  } catch {
    return relayError(protocol, 400, "request body must be valid JSON");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return relayError(protocol, 400, "request body must be a JSON object");

  const model = opts.model ?? body.model;
  if (typeof model !== "string" || !model) return relayError(protocol, 400, "model is required");
  const stream = opts.stream ?? body.stream === true;

  const price = (await getPrices()).get(model);
  if (!price || !price.enabled) return relayError(protocol, 404, `model '${model}' is not available`, "model_not_found");
  if (apiKey.allowedModels && !apiKey.allowedModels.includes(model)) {
    return relayError(protocol, 403, `this API key may not use model '${model}'`);
  }
  if (user.balance <= 0) return relayError(protocol, 402, "insufficient balance, please top up", "insufficient_quota");
  if (apiKey.quotaLimit != null && apiKey.used >= apiKey.quotaLimit) {
    return relayError(protocol, 402, "this API key has reached its spending limit", "insufficient_quota");
  }

  const limits = await getLimitSettings();
  for (const [bucket, limit] of [
    [`key:${apiKey.id}`, apiKey.rpmLimit ?? limits.defaultKeyRpm],
    [`user:${user.id}`, limits.userRpm],
  ] as const) {
    const l = await hit(bucket, limit);
    if (!l.ok) {
      return relayError(protocol, 429, "rate limit exceeded, please slow down", "rate_limit_exceeded", { "retry-after": String(l.retryAfter) });
    }
  }

  const [channels, routing] = await Promise.all([getActiveChannels(), getRoutingSettings()]);
  const affinityKey = routing.affinity ? `${apiKey.id}:${model}` : undefined;
  const candidates: Candidate[] = orderChannels(channels, model, protocol, routing, Math.random, affinityKey).map((ch) => ({ ch, target: protocol }));
  if (routing.allowConversion) {
    // Channels that speak another protocol come after native ones (e.g. Claude via /v1/chat/completions).
    for (const target of conversionTargets(protocol)) {
      for (const ch of orderChannels(channels, model, target, routing, Math.random, affinityKey)) {
        if (!candidates.some((c) => c.ch.id === ch.id)) candidates.push({ ch, target });
      }
    }
  }
  candidates.splice(Math.max(1, routing.maxAttempts));
  if (!candidates.length) return relayError(protocol, 503, `no upstream channel is available for '${model}'`);

  // Hold funds for the worst case before calling upstream, and cap the output so the upstream can
  // never produce more than was held. settle() returns the difference.
  const plan = planCost(protocol, body, rawText, price);
  let held = await reserve(user.id, apiKey.id, plan);
  // Funds may be stuck in holds from killed functions; release this user's stale ones and retry.
  if (!held.ok && (await releaseStaleReservations(undefined, user.id).catch(() => 0)) > 0) {
    held = await reserve(user.id, apiKey.id, plan);
  }
  if (!held.ok) {
    return held.reason === "key_quota"
      ? relayError(protocol, 402, "this API key has reached its spending limit", "insufficient_quota")
      : relayError(protocol, 402, "insufficient balance, please top up", "insufficient_quota");
  }
  if (plan.outputCap > 0) applyOutputCap(protocol, body, held.outputCap);
  // Cheap sweep for funds held by functions that were killed mid-request; cron does the same daily.
  if (Math.random() < 0.01) waitUntil(releaseStaleReservations().catch(() => 0));

  const rreq: RelayRequest = { protocol, model, stream, body, headers: req.headers };
  const ctx: Ctx = { user, apiKey, price, req: rreq, endpoint: opts.endpoint, started, reservationId: held.id, settled: false };
  try {
    return await forward(ctx, candidates, routing.autoDisableAfter);
  } catch (err) {
    // Anything unexpected after the hold (body read failure, bug): release it and answer cleanly.
    console.error("relay failed", err);
    await settle(ctx, null, 502, null, `gateway error: ${err instanceof Error ? err.message : String(err)}`);
    return relayError(protocol, 502, "gateway error, please retry");
  }
}

async function forward(ctx: Ctx, candidates: Candidate[], autoDisableAfter: number): Promise<Response> {
  const { protocol, model, stream } = ctx.req;
  let lastError = { status: 502, message: "upstream request failed" };
  let lastChannel: LoadedChannel | null = null;

  for (const { ch, target } of candidates) {
    lastChannel = ch;
    const conv = target === protocol ? null : converterFor(protocol, target);
    let rreq = ctx.req;
    if (conv) {
      try {
        rreq = { ...ctx.req, protocol: target, body: conv.request(ctx.req.body) };
      } catch (err) {
        if (!(err instanceof ConversionError)) throw err;
        ctx.via = target;
        await settle(ctx, ch, 400, null, err.message);
        return relayError(protocol, 400, err.message, "invalid_request_error");
      }
    }
    const runtime = { ...ch, upstreamModel: ch.modelMapping[model] ?? model };
    let res: Response;
    let streamFormat: "sse" | "aws-eventstream";
    try {
      const call = await buildUpstreamCall(rreq, runtime);
      streamFormat = call.streamFormat;
      res = await fetch(call.request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      waitUntil(markChannelFailure(ch.id, message, autoDisableAfter));
      lastError = { status: 502, message };
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = `HTTP ${res.status}: ${text.slice(0, 500)}`;
      if (RETRYABLE.has(res.status)) {
        waitUntil(markChannelFailure(ch.id, detail, autoDisableAfter));
        lastError = { status: res.status, message: detail };
        continue;
      }
      ctx.via = conv ? target : undefined;
      waitUntil(settle(ctx, ch, res.status, null, detail));
      if (PASSTHROUGH.has(res.status)) {
        // A translated request gets the upstream's message in the client's own error format.
        if (conv) return relayError(protocol, res.status, conv.errorMessage(text), "invalid_request_error");
        return new Response(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
      }
      return relayError(protocol, res.status, "upstream rejected the request");
    }

    if (ch.failCount > 0) waitUntil(markChannelHealthy(ch.id));
    ctx.via = conv ? target : undefined;

    if (!stream || !res.body) {
      const text = await res.text();
      let json: Json = null;
      try {
        json = JSON.parse(text);
      } catch {
        // non-JSON success body: relay it, but there is nothing to bill
      }
      const usage = json ? usageFromBody(target, json) : null;
      // Never fail a successful upstream call because bookkeeping failed; settle() logs and retries.
      await settle(ctx, ch, res.status, usage, usage ? undefined : "no usage in upstream response");
      if (conv) {
        if (!json) throw new Error("upstream returned a non-JSON body for a translated request");
        return Response.json(conv.response(json, model), { status: res.status });
      }
      return new Response(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
    }

    const sse = streamFormat === "aws-eventstream" ? res.body.pipeThrough(bedrockToSSE()) : res.body;
    // Usage is read from the upstream's own events, before any translation.
    const tracker = new StreamUsageTracker(target);
    const parser = new SSEParser((event, data) => tracker.onEvent(event, data));
    const tapped = tapStream(
      sse,
      (chunk) => parser.push(chunk),
      async (error) => {
        parser.end();
        const usage = tracker.result();
        const message = error ? String(error instanceof Error ? error.message : error) : usage ? undefined : "no usage in stream";
        await settle(ctx, ch, 200, usage, message);
      },
    );
    const out = conv ? tapped.pipeThrough(conv.stream(model, ctx.req.body?.stream_options?.include_usage === true)) : tapped;
    return new Response(out, { status: 200, headers: SSE_HEADERS });
  }

  waitUntil(settle(ctx, lastChannel, lastError.status, null, `all channels failed; last: ${lastError.message}`));
  const status = lastError.status === 429 ? 429 : 503;
  return relayError(protocol, status, status === 429 ? "upstream rate limited, please retry" : "all upstream channels failed, please retry");
}
