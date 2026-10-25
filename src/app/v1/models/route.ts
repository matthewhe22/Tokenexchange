import { getPrices } from "@/lib/billing";
import { servedModels } from "@/lib/channels";
import { authenticateApiKey, extractApiKey } from "@/relay/auth";
import { relayError } from "@/relay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One list that satisfies both the OpenAI (`object`, `owned_by`) and Anthropic (`type`, `display_name`) SDKs.
export async function GET(req: Request) {
  const key = extractApiKey(req);
  if (!key) return relayError("openai-chat", 401, "missing API key");
  const auth = await authenticateApiKey(key);
  if (!auth.ok) return relayError("openai-chat", auth.status, auth.message);

  const allowed = auth.apiKey.allowedModels;
  const [prices, served] = await Promise.all([getPrices(), servedModels()]);
  // Only models some enabled channel can serve right now.
  const data = [...prices.values()]
    .filter((p) => p.enabled && served.live.has(p.model) && (!allowed || allowed.includes(p.model)))
    .map((p) => ({
      id: p.model,
      object: "model",
      type: "model",
      display_name: p.model,
      created: Math.floor(p.updatedAt.getTime() / 1000),
      created_at: p.updatedAt.toISOString(),
      owned_by: "tokenexchange",
    }));
  return Response.json({ object: "list", data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null });
}
