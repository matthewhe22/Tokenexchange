import { anthropicBatchObject, authenticate, cancelBatch, findBatch } from "@/relay/batch";
import { relayError } from "@/relay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await authenticate(req, "anthropic");
  if (p instanceof Response) return p;
  const row = await findBatch(p.user.id, (await params).id, "anthropic");
  if (!row) return relayError("anthropic-messages", 404, "no such message batch");
  try {
    return Response.json(anthropicBatchObject(await cancelBatch(row)));
  } catch (err) {
    console.error("batch cancel failed", err);
    return relayError("anthropic-messages", 502, "could not cancel the batch upstream, please retry");
  }
}
