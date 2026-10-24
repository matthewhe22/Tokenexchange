import { getPrices } from "@/lib/billing";
import { getActiveChannels } from "@/lib/channels";
import { estimateInputTokens } from "@/lib/reservations";
import { getRoutingSettings } from "@/lib/settings";
import { authenticateApiKey, extractApiKey } from "@/relay/auth";
import { relayError } from "@/relay/errors";
import { orderChannels } from "@/relay/router";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Anthropic token counting (free). Forwarded to a channel that implements it (Anthropic or a
 * compatible relay); otherwise answered with a conservative local estimate so clients such as
 * Claude Code keep working on Bedrock- or Vertex-only setups.
 */
export async function POST(req: Request) {
  const key = extractApiKey(req);
  if (!key) return relayError("anthropic-messages", 401, "missing API key");
  const auth = await authenticateApiKey(key);
  if (!auth.ok) return relayError("anthropic-messages", auth.status, auth.message);

  const raw = await req.text();
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return relayError("anthropic-messages", 400, "request body must be valid JSON");
  }
  const model = body?.model;
  if (typeof model !== "string" || !(await getPrices()).get(model)?.enabled) {
    return relayError("anthropic-messages", 404, `model '${model}' is not available`);
  }

  const [channels, routing] = await Promise.all([getActiveChannels(), getRoutingSettings()]);
  const native = orderChannels(channels, model, "anthropic-messages", routing).filter(
    (c) => c.provider === "anthropic" || c.provider === "anthropic_compatible",
  );
  for (const ch of native.slice(0, 2)) {
    const root = (ch.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "").replace(/\/v1$/, "");
    try {
      const res = await fetch(`${root}/v1/messages/count_tokens`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": ch.credentials.apiKey,
          ...(ch.provider === "anthropic_compatible" ? { authorization: `Bearer ${ch.credentials.apiKey}` } : {}),
          "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01",
          ...(req.headers.get("anthropic-beta") ? { "anthropic-beta": req.headers.get("anthropic-beta")! } : {}),
        },
        body: JSON.stringify({ ...body, model: ch.modelMapping[model] ?? model }),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return Response.json(await res.json());
    } catch {
      // fall through to the next channel / the estimate
    }
  }
  return Response.json({ input_tokens: estimateInputTokens(raw) });
}
