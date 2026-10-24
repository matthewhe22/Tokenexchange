// Upstream batch APIs: OpenAI and Azure OpenAI (files + /batches) and Anthropic (message batches).
import type { LoadedChannel } from "@/lib/channels";
import { anthropicEndpoint, openaiEndpoint } from "../providers";
import type { Json } from "../types";

export class UpstreamError extends Error {
  constructor(
    public status: number,
    public body: string,
  ) {
    super(`HTTP ${status}: ${body.slice(0, 500)}`);
  }
}

/** How long to wait for response headers, and for each chunk of a body after that. */
const TIMEOUT_MS = 120_000;

/**
 * Fetch with a timeout on the response headers only, so large result files can stream for as long
 * as data keeps arriving (body reads use an idle timeout, see jsonLines).
 */
async function call(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`upstream did not respond in ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new UpstreamError(res.status, await res.text().catch(() => ""));
  return res;
}

function readWithIdleTimeout<T>(reader: ReadableStreamDefaultReader<T>): Promise<ReadableStreamReadResult<T>> {
  let timer: ReturnType<typeof setTimeout>;
  const idle = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`upstream sent nothing for ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
  });
  return Promise.race([reader.read(), idle]).finally(() => clearTimeout(timer));
}

const json = (headers: Record<string, string>, body: Json): RequestInit => ({
  method: "POST",
  headers: { ...headers, "content-type": "application/json" },
  body: JSON.stringify(body),
});

/** Providers whose batch API this gateway can drive. Bedrock and Vertex batches need S3 / GCS buckets. */
export function batchCapable(ch: Pick<LoadedChannel, "provider">, api: "openai" | "anthropic"): boolean {
  return api === "openai" ? ch.provider === "openai" || ch.provider === "azure_openai" : ch.provider === "anthropic";
}

/** One request of a batch, already rewritten for the upstream (model = upstream id). */
export interface BatchLine {
  custom_id: string;
  body: Json;
}

/** Path for a batch line: Azure takes "/chat/completions", OpenAI "/v1/chat/completions". */
function openaiLineUrl(ch: LoadedChannel, endpoint: string): string {
  return ch.provider === "azure_openai" ? endpoint.replace(/^\/v1/, "") : endpoint;
}

export async function submitBatch(ch: LoadedChannel, api: "openai" | "anthropic", endpoint: string, lines: BatchLine[]): Promise<Json> {
  if (api === "anthropic") {
    const { root, headers } = anthropicEndpoint(ch);
    const requests = lines.map((l) => ({ custom_id: l.custom_id, params: l.body }));
    return (await call(`${root}/v1/messages/batches`, json(headers, { requests }))).json();
  }
  const { base, headers, query } = openaiEndpoint(ch);
  const url = openaiLineUrl(ch, endpoint);
  const jsonl = lines.map((l) => JSON.stringify({ custom_id: l.custom_id, method: "POST", url, body: l.body })).join("\n") + "\n";
  const form = new FormData();
  form.set("purpose", "batch");
  form.set("file", new Blob([jsonl], { type: "application/jsonl" }), "batch.jsonl");
  const file = await (await call(`${base}/files${query}`, { method: "POST", headers, body: form })).json();
  return (await call(`${base}/batches${query}`, json(headers, { input_file_id: file.id, endpoint: url, completion_window: "24h" }))).json();
}

export async function getUpstreamBatch(ch: LoadedChannel, api: "openai" | "anthropic", id: string): Promise<Json> {
  if (api === "anthropic") {
    const { root, headers } = anthropicEndpoint(ch);
    return (await call(`${root}/v1/messages/batches/${encodeURIComponent(id)}`, { headers })).json();
  }
  const { base, headers, query } = openaiEndpoint(ch);
  return (await call(`${base}/batches/${encodeURIComponent(id)}${query}`, { headers })).json();
}

export async function cancelUpstreamBatch(ch: LoadedChannel, api: "openai" | "anthropic", id: string): Promise<Json> {
  if (api === "anthropic") {
    const { root, headers } = anthropicEndpoint(ch);
    return (await call(`${root}/v1/messages/batches/${encodeURIComponent(id)}/cancel`, { method: "POST", headers })).json();
  }
  const { base, headers, query } = openaiEndpoint(ch);
  return (await call(`${base}/batches/${encodeURIComponent(id)}/cancel${query}`, { method: "POST", headers })).json();
}

export async function deleteUpstreamBatch(ch: LoadedChannel, id: string): Promise<void> {
  const { root, headers } = anthropicEndpoint(ch);
  await call(`${root}/v1/messages/batches/${encodeURIComponent(id)}`, { method: "DELETE", headers });
}

/** JSONL results: an OpenAI output / error file, or Anthropic batch results. */
export async function upstreamResults(ch: LoadedChannel, api: "openai" | "anthropic", id: string): Promise<Response> {
  if (api === "anthropic") {
    const { root, headers } = anthropicEndpoint(ch);
    return call(`${root}/v1/messages/batches/${encodeURIComponent(id)}/results`, { headers });
  }
  const { base, headers, query } = openaiEndpoint(ch);
  return call(`${base}/files/${encodeURIComponent(id)}/content${query}`, { headers });
}

/** Splits a JSONL body into parsed lines, without holding the whole file in memory. */
export async function* jsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<Json> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await readWithIdleTimeout(reader);
    } catch (err) {
      await reader.cancel(err).catch(() => null);
      throw err;
    }
    const { value, done } = chunk;
    buf += dec.decode(value, { stream: !done });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
    if (done) break;
  }
  if (buf.trim()) yield JSON.parse(buf);
}

/** Rewrites each JSONL line on the way to the client (e.g. upstream model ids to public names). */
export function mapJsonLines(body: ReadableStream<Uint8Array>, fn: (line: Json) => Json): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const it = jsonLines(body);
  return new ReadableStream({
    async pull(controller) {
      const { value, done } = await it.next();
      if (done) controller.close();
      else controller.enqueue(enc.encode(JSON.stringify(fn(value)) + "\n"));
    },
    async cancel() {
      await it.return(undefined);
    },
  });
}
