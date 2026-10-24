import { anthropicBatchObject, authenticate, BatchInputError, createBatch, listBatches, parseAnthropicInput } from "@/relay/batch";
import { relayError } from "@/relay/errors";
import type { Json } from "@/relay/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const p = await authenticate(req, "anthropic");
  if (p instanceof Response) return p;
  let body: Json;
  try {
    body = await req.json();
  } catch {
    return relayError("anthropic-messages", 400, "request body must be valid JSON");
  }
  try {
    const items = parseAnthropicInput(body?.requests);
    const row = await createBatch({ principal: p, api: "anthropic", endpoint: "/v1/messages", protocol: "anthropic-messages", items });
    return row instanceof Response ? row : Response.json(anthropicBatchObject(row));
  } catch (err) {
    if (err instanceof BatchInputError) return relayError("anthropic-messages", err.status, err.message);
    throw err;
  }
}

export async function GET(req: Request) {
  const p = await authenticate(req, "anthropic");
  if (p instanceof Response) return p;
  const q = new URL(req.url).searchParams;
  const limit = Math.min(1000, Math.max(1, Number(q.get("limit")) || 20));
  const { rows, hasMore } = await listBatches(p.user.id, "anthropic", limit, q.get("after_id"));
  const data = rows.map(anthropicBatchObject);
  return Response.json({ data, has_more: hasMore, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null });
}
