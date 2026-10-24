import { authenticate, findBatch, findFile, streamResults } from "@/relay/batch";
import { relayError } from "@/relay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await authenticate(req, "openai");
  if (p instanceof Response) return p;
  const f = await findFile(p.user.id, (await params).id);
  if (!f) return relayError("openai-chat", 404, "no such file");
  if (f.content != null) return new Response(f.content, { headers: { "content-type": "application/octet-stream" } });
  // Batch output: streamed from the upstream that ran the batch.
  const batch = f.batchId ? await findBatch(p.user.id, f.batchId, "openai") : null;
  if (!batch || !f.upstreamFileId) return relayError("openai-chat", 404, "file content is no longer available");
  try {
    return await streamResults(batch, f.upstreamFileId);
  } catch (err) {
    console.error("batch output download failed", err);
    return relayError("openai-chat", 502, "could not fetch the file from the upstream, please retry");
  }
}
