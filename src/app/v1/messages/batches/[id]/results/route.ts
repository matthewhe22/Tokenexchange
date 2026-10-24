import { authenticate, findBatch, refreshBatch, streamResults } from "@/relay/batch";
import { relayError } from "@/relay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await authenticate(req, "anthropic");
  if (p instanceof Response) return p;
  let row = await findBatch(p.user.id, (await params).id, "anthropic");
  if (!row) return relayError("anthropic-messages", 404, "no such message batch");
  row = await refreshBatch(row);
  if (row.status !== "ended" || !row.upstreamId) return relayError("anthropic-messages", 400, "results are available once the batch has ended");
  try {
    return await streamResults(row, row.upstreamId);
  } catch (err) {
    console.error("batch results download failed", err);
    return relayError("anthropic-messages", 502, "could not fetch results from the upstream, please retry");
  }
}
