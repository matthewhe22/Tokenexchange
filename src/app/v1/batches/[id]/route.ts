import { authenticate, findBatch, openaiBatchObject, refreshBatch } from "@/relay/batch";
import { relayError } from "@/relay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const p = await authenticate(req, "openai");
  if (p instanceof Response) return p;
  const row = await findBatch(p.user.id, (await params).id, "openai");
  if (!row) return relayError("openai-chat", 404, "no such batch");
  return Response.json(await openaiBatchObject(await refreshBatch(row)));
}
