import { eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { authenticate, fileObject, findFile } from "@/relay/batch";
import { relayError } from "@/relay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const p = await authenticate(req, "openai");
  if (p instanceof Response) return p;
  const f = await findFile(p.user.id, (await params).id);
  return f ? Response.json(fileObject(f)) : relayError("openai-chat", 404, "no such file");
}

export async function DELETE(req: Request, { params }: Ctx) {
  const p = await authenticate(req, "openai");
  if (p instanceof Response) return p;
  const f = await findFile(p.user.id, (await params).id);
  if (!f) return relayError("openai-chat", 404, "no such file");
  await getDb().delete(schema.files).where(eq(schema.files.id, f.id));
  return Response.json({ id: f.id, object: "file", deleted: true });
}
