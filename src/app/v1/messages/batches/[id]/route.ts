import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { loadChannel } from "@/lib/channels";
import { anthropicBatchObject, authenticate, findBatch, refreshBatch } from "@/relay/batch";
import { deleteUpstreamBatch } from "@/relay/batch/upstream";
import { relayError } from "@/relay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const p = await authenticate(req, "anthropic");
  if (p instanceof Response) return p;
  const row = await findBatch(p.user.id, (await params).id, "anthropic");
  if (!row) return relayError("anthropic-messages", 404, "no such message batch");
  return Response.json(anthropicBatchObject(await refreshBatch(row)));
}

/** Deletes an ended (and billed) batch, here and upstream. */
export async function DELETE(req: Request, { params }: Ctx) {
  const p = await authenticate(req, "anthropic");
  if (p instanceof Response) return p;
  let row = await findBatch(p.user.id, (await params).id, "anthropic");
  if (!row) return relayError("anthropic-messages", 404, "no such message batch");
  row = await refreshBatch(row);
  if (row.status !== "ended" || !row.settledAt) {
    return relayError("anthropic-messages", 400, "a batch can only be deleted once it has ended; cancel it first");
  }
  const ch = row.upstreamId && row.channelId != null ? await loadChannel(row.channelId) : null;
  if (ch) await deleteUpstreamBatch(ch, row.upstreamId!).catch((err) => console.error("upstream batch delete failed", err));
  await getDb().delete(schema.batches).where(eq(schema.batches.id, row.id));
  return Response.json({ id: row.id, type: "message_batch_deleted" });
}
