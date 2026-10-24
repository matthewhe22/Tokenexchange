import {
  authenticate,
  BatchInputError,
  createBatch,
  findFile,
  listBatches,
  OPENAI_BATCH_ENDPOINTS,
  openaiBatchObject,
  parseOpenAIInput,
} from "@/relay/batch";
import { relayError } from "@/relay/errors";
import type { Json } from "@/relay/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const p = await authenticate(req, "openai");
  if (p instanceof Response) return p;
  let body: Json;
  try {
    body = await req.json();
  } catch {
    return relayError("openai-chat", 400, "request body must be valid JSON");
  }
  const endpoint = body?.endpoint;
  const protocol = OPENAI_BATCH_ENDPOINTS[endpoint];
  if (!protocol) {
    return relayError("openai-chat", 400, `endpoint must be one of ${Object.keys(OPENAI_BATCH_ENDPOINTS).join(", ")}`, "invalid_request_error");
  }
  if ((body.completion_window ?? "24h") !== "24h") return relayError("openai-chat", 400, "completion_window must be 24h", "invalid_request_error");
  const file = typeof body.input_file_id === "string" ? await findFile(p.user.id, body.input_file_id) : null;
  if (!file || file.purpose !== "batch" || file.content == null) return relayError("openai-chat", 404, "input_file_id: no such batch input file");
  try {
    const items = parseOpenAIInput(file.content, endpoint);
    const row = await createBatch({ principal: p, api: "openai", endpoint, protocol, items, inputFileId: file.id, metadata: body.metadata });
    return row instanceof Response ? row : Response.json(await openaiBatchObject(row));
  } catch (err) {
    if (err instanceof BatchInputError) return relayError("openai-chat", err.status, err.message, "invalid_request_error");
    throw err;
  }
}

export async function GET(req: Request) {
  const p = await authenticate(req, "openai");
  if (p instanceof Response) return p;
  const q = new URL(req.url).searchParams;
  const limit = Math.min(100, Math.max(1, Number(q.get("limit")) || 20));
  const { rows, hasMore } = await listBatches(p.user.id, "openai", limit, q.get("after"));
  const data = await Promise.all(rows.map(openaiBatchObject));
  return Response.json({ object: "list", data, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null, has_more: hasMore });
}
