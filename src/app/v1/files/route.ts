import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { authenticate, fileObject, newId } from "@/relay/batch";
import { relayError } from "@/relay/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Upload a batch input file (JSONL). Only purpose=batch is supported. */
export async function POST(req: Request) {
  const p = await authenticate(req, "openai");
  if (p instanceof Response) return p;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return relayError("openai-chat", 400, "request body must be multipart/form-data");
  }
  const file = form.get("file");
  if (form.get("purpose") !== "batch") return relayError("openai-chat", 400, "only purpose=batch is supported", "invalid_request_error");
  if (!file || typeof file === "string") return relayError("openai-chat", 400, "file is required", "invalid_request_error");
  const content = await file.text();
  const [row] = await getDb()
    .insert(schema.files)
    .values({ id: newId("file-tx"), userId: p.user.id, purpose: "batch", filename: file.name || "batch.jsonl", bytes: file.size, content })
    .returning();
  return Response.json(fileObject(row));
}

export async function GET(req: Request) {
  const p = await authenticate(req, "openai");
  if (p instanceof Response) return p;
  const purpose = new URL(req.url).searchParams.get("purpose");
  const f = schema.files;
  const rows = await getDb()
    .select()
    .from(f)
    .where(purpose ? and(eq(f.userId, p.user.id), eq(f.purpose, purpose)) : eq(f.userId, p.user.id))
    .orderBy(desc(f.createdAt))
    .limit(1000);
  return Response.json({ object: "list", data: rows.map(fileObject), has_more: false });
}
