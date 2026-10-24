import { waitUntil } from "@vercel/functions";
import { chargeFor, getPrices, recordUsage, type ModelPrice } from "@/lib/billing";
import { getActiveChannels, markChannelFailure, markChannelHealthy, type LoadedChannel } from "@/lib/channels";
import { getRoutingSettings } from "@/lib/settings";
import { authenticateApiKey, extractApiKey, type ApiKeyRow, type UserRow } from "./auth";
import { bedrockToSSE } from "./bedrock-stream";
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
}

async function settle(ctx: Ctx, ch: LoadedChannel | null, status: number, usage: Usage | null, error?: string) {
  const { cost, upstreamCost } =
    usage && ch ? chargeFor(usage, ctx.price, ch.costMultiplier) : { cost: 0, upstreamCost: 0 };
  await recordUsage({
    userId: ctx.user.id,
    apiKeyId: ctx.apiKey.id,
    channelId: ch?.id ?? null,
    endpoint: ctx.endpoint,
    model: ctx.req.model,
    upstreamModel: ch ? (ch.modelMapping[ctx.req.model] ?? ctx.req.model) : null,
    stream: ctx.req.stream,
    status,
    usage,
    cost,
    upstreamCost,
    latencyMs: Date.now() - ctx.started,
    error,
  });
}

export async function relay(req: Request, protocol: Protocol, opts: RelayOptions): Promise<Response> {
  const started = Date.now();
  const key = extractApiKey(req);
  if (!key) return relayError(protocol, 401, "missing API key");
  const auth = await authenticateApiKey(key);
  if (!auth.ok) return relayError(protocol, auth.status, auth.message);
  const { user, apiKey } = auth;

  let body: Json;
  try {
    body = await req.json();
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

  const [channels, routing] = await Promise.all([getActiveChannels(), getRoutingSettings()]);
  const candidates = orderChannels(channels, model, protocol, routing).slice(0, Math.max(1, routing.maxAttempts));
  if (!candidates.length) return relayError(protocol, 503, `no upstream channel is available for '${model}'`);

  const rreq: RelayRequest = { protocol, model, stream, body, headers: req.headers };
  const ctx: Ctx = { user, apiKey, price, req: rreq, endpoint: opts.endpoint, started };
  let lastError = { status: 502, message: "upstream request failed" };
  let lastChannel: LoadedChannel | null = null;

  for (const ch of candidates) {
    lastChannel = ch;
    const runtime = { ...ch, upstreamModel: ch.modelMapping[model] ?? model };
    let res: Response;
    let streamFormat: "sse" | "aws-eventstream";
    try {
      const call = await buildUpstreamCall(rreq, runtime);
      streamFormat = call.streamFormat;
      res = await fetch(call.request);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      waitUntil(markChannelFailure(ch.id, message, routing.autoDisableAfter));
      lastError = { status: 502, message };
      continue;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const detail = `HTTP ${res.status}: ${text.slice(0, 500)}`;
      if (RETRYABLE.has(res.status)) {
        waitUntil(markChannelFailure(ch.id, detail, routing.autoDisableAfter));
        lastError = { status: res.status, message: detail };
        continue;
      }
      waitUntil(settle(ctx, ch, res.status, null, detail));
      if (PASSTHROUGH.has(res.status)) {
        return new Response(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
      }
      return relayError(protocol, res.status, "upstream rejected the request");
    }

    if (ch.failCount > 0) waitUntil(markChannelHealthy(ch.id));

    if (!stream || !res.body) {
      const text = await res.text();
      let usage: Usage | null = null;
      try {
        usage = usageFromBody(protocol, JSON.parse(text));
      } catch {
        // non-JSON success body: relay it, but there is nothing to bill
      }
      await settle(ctx, ch, res.status, usage, usage ? undefined : "no usage in upstream response");
      return new Response(text, { status: res.status, headers: { "content-type": res.headers.get("content-type") ?? "application/json" } });
    }

    const sse = streamFormat === "aws-eventstream" ? res.body.pipeThrough(bedrockToSSE()) : res.body;
    const tracker = new StreamUsageTracker(protocol);
    const parser = new SSEParser((event, data) => tracker.onEvent(event, data));
    const out = tapStream(
      sse,
      (chunk) => parser.push(chunk),
      async (error) => {
        parser.end();
        const usage = tracker.result();
        const message = error ? String(error instanceof Error ? error.message : error) : usage ? undefined : "no usage in stream";
        await settle(ctx, ch, 200, usage, message);
      },
    );
    return new Response(out, { status: 200, headers: SSE_HEADERS });
  }

  waitUntil(settle(ctx, lastChannel, lastError.status, null, `all channels failed; last: ${lastError.message}`));
  const status = lastError.status === 429 ? 429 : 503;
  return relayError(protocol, status, status === 429 ? "upstream rate limited, please retry" : "all upstream channels failed, please retry");
}
