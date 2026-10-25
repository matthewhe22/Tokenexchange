// A fake of every upstream API the gateway talks to, for local end-to-end testing.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { encodeEventStreamMessage } from "../src/relay/eventstream";

export interface Received {
  path: string;
  headers: IncomingMessage["headers"];
  body: any;
}

const sse = (res: ServerResponse, events: [string | undefined, unknown][]) => {
  res.writeHead(200, { "content-type": "text/event-stream" });
  for (const [event, data] of events) {
    res.write((event ? `event: ${event}\n` : "") + `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
  }
  res.end();
};

const anthropicEvents = (text: string): [string, unknown][] => [
  ["message_start", { type: "message_start", message: { id: "msg_1", role: "assistant", content: [], usage: { input_tokens: 11, output_tokens: 1, cache_read_input_tokens: 5 } } }],
  ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
  ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
  ["content_block_stop", { type: "content_block_stop", index: 0 }],
  ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 7 } }],
  ["message_stop", { type: "message_stop" }],
];

const anthropicJson = { id: "msg_1", type: "message", role: "assistant", content: [{ type: "text", text: "pong" }], usage: { input_tokens: 11, output_tokens: 7 } };

// Batches the mock "runs": every request succeeds with fixed usage, except custom_ids containing "fail".
interface MockBatch {
  id: string;
  lines: { custom_id: string; body: any }[];
  polls: number;
  cancelled: boolean;
}

export function startMockUpstream(port: number): Promise<{ received: Received[]; close: () => void; heal: () => void }> {
  const received: Received[] = [];
  let flakyHealed = false;
  const files = new Map<string, string>();
  const batches = new Map<string, MockBatch>();
  let seq = 0;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url!, "http://x");
    const path = url.pathname;
    let body: any = {};
    try {
      body = raw && req.headers["content-type"]?.includes("json") ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw));
    } catch {}
    received.push({ path: path + url.search, headers: req.headers, body });
    const json = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };

    // Stripe API (the gateway's SDK is pointed here via STRIPE_API_BASE)
    if (path === "/v1/customers") return json(200, { id: "cus_mock", object: "customer" });
    const charge = path.match(/^\/v1\/charges\/([^/]+)$/);
    if (charge) return json(200, { id: charge[1], object: "charge", customer: charge[1] === "ch_orphan" ? null : "cus_e2e", amount: 2500 });
    if (path === "/v1/checkout/sessions") {
      // A customer created with the other mode's keys (live vs test), as real Stripe reports it.
      if (body.customer === "cus_stale") {
        return json(400, { error: { type: "invalid_request_error", code: "resource_missing", param: "customer", message: "No such customer: 'cus_stale'; a similar object exists in live mode, but a test mode key was used to make this request." } });
      }
      return json(200, { id: "cs_mock", object: "checkout.session", url: `http://localhost:${port}/checkout/cs_mock` });
    }
    if (path.startsWith("/checkout/")) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<h1>Mock Stripe Checkout</h1>");
    }

    if (path === "/reset/v1/chat/completions") {
      // headers sent, then the connection drops mid-body
      res.writeHead(200, { "content-type": "application/json", "content-length": "1000" });
      res.write('{"choices":');
      setTimeout(() => res.destroy(), 50);
      return;
    }

    if (path === "/flaky/v1/chat/completions") {
      if (!flakyHealed) return json(500, { error: { message: "flaky upstream down" } });
      return json(200, { choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 1, completion_tokens: 1 } });
    }

    if (path === "/slow/v1/chat/completions") {
      await new Promise((r) => setTimeout(r, 800));
      return json(200, { choices: [{ message: { content: "slow" } }], usage: { prompt_tokens: 20, completion_tokens: 5 } });
    }

    if (path === "/broken/v1/chat/completions") return json(500, { error: { message: "boom" } });

    // OpenRouter's public model list, for the price benchmark.
    if (path === "/openrouter/api/v1/models") {
      return json(200, {
        data: [
          { id: "acme/gpt-test", pricing: { prompt: "0.0000015", completion: "0.000006" } },
          { id: "acme/oss-model", pricing: { prompt: "0.000002", completion: "0.000004" } },
        ],
      });
    }

    // Upstream price catalogs: DeepInfra's public list (at the API root) and Novita's /models.
    if (path === "/models/list") {
      return json(200, [
        { model_name: "meta-llama/Llama-3.3-70B-Instruct-Turbo", type: "text-generation", max_tokens: 131072, pricing: { cents_per_input_token: 0.00001, cents_per_output_token: 0.000032 } },
        { model_name: "BAAI/bge-m3", type: "embeddings", pricing: { cents_per_input_token: 0.000001 } },
      ]);
    }
    if (path === "/novita/openai/v1/models") {
      if (req.headers.authorization !== "Bearer up-novita") return json(401, { error: { message: "bad key" } });
      return json(200, { data: [{ id: "meta-llama/llama-3.3-70b-instruct", input_token_price_per_m: 1350, output_token_price_per_m: 4000, context_size: 131072 }] });
    }

    if (path === "/ptu/v1/chat/completions") return json(429, { error: { message: "Requests to the deployment have exceeded its provisioned capacity" } });

    // Answers successfully but never reports usage: the gateway must charge the held worst case and
    // fail the request loudly, never serve it for free.
    if (path === "/nomusage/v1/chat/completions") {
      if (body.stream) {
        return sse(res, [
          [undefined, { id: "c1", choices: [{ delta: { content: "po" } }] }],
          [undefined, { id: "c1", choices: [{ delta: { content: "ng" } }] }],
          [undefined, "[DONE]"],
        ]);
      }
      return json(200, { id: "c1", choices: [{ message: { role: "assistant", content: "pong" } }] });
    }

    if (path.startsWith("/openai/v1/")) {
      if (req.headers.authorization !== "Bearer up-openai") return json(401, { error: { message: "bad key" } });
      // ---- batch API ----
      if (path === "/openai/v1/files" && req.method === "POST") {
        if (!raw.includes('name="purpose"') || !raw.includes("batch")) return json(400, { error: { message: "purpose required" } });
        const jsonl = raw.split(/\r?\n/).filter((l) => l.startsWith('{"custom_id"')).join("\n");
        const id = `file-up${++seq}`;
        files.set(id, jsonl);
        return json(200, { id, object: "file", purpose: "batch", bytes: jsonl.length });
      }
      if (path === "/openai/v1/batches" && req.method === "POST") {
        const content = files.get(body.input_file_id);
        if (!content) return json(404, { error: { message: "no such file" } });
        const lines = content.split("\n").map((l) => JSON.parse(l));
        if (lines.some((l) => l.url !== body.endpoint || l.body.model !== "gpt-4o-batch-up")) return json(400, { error: { message: "bad lines" } });
        const id = `batch_up${++seq}`;
        batches.set(id, { id, lines, polls: 0, cancelled: false });
        return json(200, { id, object: "batch", status: "validating", endpoint: body.endpoint, request_counts: { total: lines.length, completed: 0, failed: 0 } });
      }
      const ob = path.match(/^\/openai\/v1\/batches\/([^/]+)(\/cancel)?$/);
      if (ob) {
        const b = batches.get(ob[1]);
        if (!b) return json(404, { error: { message: "no such batch" } });
        if (ob[2]) b.cancelled = true;
        // Finished by the time anyone polls.
        const done = ++b.polls > 0;
        const failed = b.lines.filter((l) => l.custom_id.includes("fail")).length;
        return json(200, {
          id: b.id,
          object: "batch",
          status: b.cancelled ? "cancelled" : done ? "completed" : "in_progress",
          output_file_id: done ? `out-${b.id}` : null,
          error_file_id: done && failed ? `err-${b.id}` : null,
          in_progress_at: 1_700_000_000,
          completed_at: done ? 1_700_000_100 : null,
          request_counts: { total: b.lines.length, completed: done ? b.lines.length - failed : 0, failed: done ? failed : 0 },
        });
      }
      const oc = path.match(/^\/openai\/v1\/files\/(out|err)-([^/]+)\/content$/);
      if (oc) {
        const b = batches.get(oc[2])!;
        res.writeHead(200, { "content-type": "application/octet-stream" });
        for (const l of b.lines) {
          const fail = l.custom_id.includes("fail");
          if (fail !== (oc[1] === "err")) continue;
          res.write(
            JSON.stringify(
              fail
                ? { id: `r-${l.custom_id}`, custom_id: l.custom_id, response: { status_code: 400, body: { error: { message: "bad" } } } }
                : { id: `r-${l.custom_id}`, custom_id: l.custom_id, response: { status_code: 200, body: { id: "c", model: l.body.model, choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 100, completion_tokens: 10 } } } },
            ) + "\n",
          );
        }
        return res.end();
      }
      if (path.endsWith("/chat/completions")) {
        if (!body.stream) return json(200, { id: "c1", service_tier: body.service_tier ?? "default", choices: [{ message: { role: "assistant", content: "pong" } }], usage: { prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } });
        const ev: [undefined, unknown][] = [[undefined, { id: "c1", choices: [{ delta: { content: "po" } }] }], [undefined, { id: "c1", choices: [{ delta: { content: "ng" } }] }]];
        if (body.stream_options?.include_usage) ev.push([undefined, { id: "c1", choices: [], usage: { prompt_tokens: 20, completion_tokens: 5 } }]);
        ev.push([undefined, "[DONE]"]);
        return sse(res, ev);
      }
      if (path.endsWith("/responses")) {
        return sse(res, [
          ["response.created", { type: "response.created", response: { id: "r1" } }],
          ["response.output_text.delta", { type: "response.output_text.delta", delta: "pong" }],
          ["response.completed", { type: "response.completed", response: { id: "r1", usage: { input_tokens: 30, output_tokens: 6, input_tokens_details: { cached_tokens: 0 } } } }],
        ]);
      }
      if (path.endsWith("/embeddings")) return json(200, { data: [{ embedding: [0.1, 0.2] }], usage: { prompt_tokens: 8, total_tokens: 8 } });
      if (path.endsWith("/images/generations")) return json(200, { data: Array.from({ length: body.n ?? 1 }, () => ({ url: "https://img/x.png" })) });
      if (path.endsWith("/audio/speech")) {
        res.writeHead(200, { "content-type": "audio/mpeg" });
        return res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00, 0x01, 0x02]));
      }
      if (path.endsWith("/audio/transcriptions")) {
        if (!String(req.headers["content-type"]).startsWith("multipart/form-data") || !raw.includes("whisper-upstream")) {
          return json(400, { error: { message: "expected multipart with the mapped model" } });
        }
        return json(200, { text: "hello world", usage: { type: "duration", seconds: 61 } });
      }
      if (path.endsWith("/rerank")) return json(200, { results: [{ index: 0, relevance_score: 0.9 }], usage: { total_tokens: 100 } });
    }

    if (path === "/azure/openai/v1/chat/completions") {
      if (req.headers["api-key"] !== "up-azure") return json(401, { error: { message: "bad key" } });
      return json(200, { choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    }

    if (path === "/anthropic/v1/messages/count_tokens") return json(200, { input_tokens: 42 });

    if (path === "/anthropic/v1/messages/batches" && req.method === "POST") {
      if (req.headers["x-api-key"] !== "up-anthropic") return json(401, { type: "error", error: { type: "authentication_error", message: "bad key" } });
      if (!body.requests?.every((r: any) => r.params?.max_tokens && r.params.model.startsWith("claude-up") && !r.params.stream)) {
        return json(400, { type: "error", error: { type: "invalid_request_error", message: "bad requests" } });
      }
      const id = `msgbatch_up${++seq}`;
      batches.set(id, { id, lines: body.requests.map((r: any) => ({ custom_id: r.custom_id, body: r.params })), polls: 0, cancelled: false });
      return json(200, { id, type: "message_batch", processing_status: "in_progress", request_counts: { processing: body.requests.length, succeeded: 0, errored: 0, canceled: 0, expired: 0 }, created_at: "2026-01-01T00:00:00Z", results_url: null });
    }
    const ab = path.match(/^\/anthropic\/v1\/messages\/batches\/([^/]+)(\/cancel|\/results)?$/);
    if (ab) {
      const b = batches.get(ab[1]);
      if (!b) return json(404, { type: "error", error: { type: "not_found_error", message: "no such batch" } });
      if (ab[2] === "/results") {
        res.writeHead(200, { "content-type": "application/x-jsonl" });
        for (const l of b.lines) {
          res.write(JSON.stringify({ custom_id: l.custom_id, result: { type: "succeeded", message: { ...anthropicJson, model: `${l.body.model}-20260101`, usage: { input_tokens: 200, output_tokens: 20 } } } }) + "\n");
        }
        return res.end();
      }
      if (req.method === "DELETE") return json(200, { id: b.id, type: "message_batch_deleted" });
      if (ab[2]) b.cancelled = true;
      const done = ++b.polls > 0;
      return json(200, {
        id: b.id,
        type: "message_batch",
        processing_status: done ? "ended" : "in_progress",
        request_counts: { processing: done ? 0 : b.lines.length, succeeded: done ? b.lines.length : 0, errored: 0, canceled: 0, expired: 0 },
        created_at: "2026-01-01T00:00:00Z",
        ended_at: done ? "2026-01-01T01:00:00Z" : null,
        results_url: done ? `http://localhost:${port}/anthropic/v1/messages/batches/${b.id}/results` : null,
      });
    }

    if (path === "/creditless/v1/messages") {
      return json(400, { type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } });
    }

    if (path === "/anthropic/v1/messages") {
      if (req.headers["x-api-key"] !== "up-anthropic") return json(401, { type: "error", error: { type: "authentication_error", message: "bad key" } });
      if (body.max_tokens == null) return json(400, { type: "error", error: { type: "invalid_request_error", message: "max_tokens: field required" } });
      if (body.bogus_param) return json(400, { type: "error", error: { type: "invalid_request_error", message: "bogus_param: Extra inputs are not permitted" } });
      return body.stream ? sse(res, anthropicEvents("pong")) : json(200, anthropicJson);
    }

    const bedrock = path.match(/^\/bedrock\/model\/([^/]+)\/(invoke|invoke-with-response-stream)$/);
    if (bedrock) {
      if (req.headers.authorization !== "Bearer up-bedrock") return json(403, { message: "denied" });
      if (body.anthropic_version !== "bedrock-2023-05-31" || body.model || body.stream !== undefined) return json(400, { message: "bad body" });
      if (bedrock[2] === "invoke") return json(200, anthropicJson);
      res.writeHead(200, { "content-type": "application/vnd.amazon.eventstream" });
      for (const [, ev] of anthropicEvents("pong")) {
        const payload = new TextEncoder().encode(JSON.stringify({ bytes: Buffer.from(JSON.stringify(ev)).toString("base64") }));
        res.write(encodeEventStreamMessage({ ":message-type": "event", ":event-type": "chunk", ":content-type": "application/json" }, payload));
      }
      return res.end();
    }

    if (path === "/google/token") {
      if (body.grant_type !== "urn:ietf:params:oauth:grant-type:jwt-bearer" || !body.assertion) return json(400, { error: "invalid_grant" });
      return json(200, { access_token: "vertex-token", expires_in: 3600 });
    }

    const vertex = path.match(/^\/vertex\/v1\/projects\/proj-1\/locations\/global\/publishers\/(anthropic|google)\/models\/([^:]+):(\w+)$/);
    if (vertex) {
      if (req.headers.authorization !== "Bearer vertex-token") return json(401, { error: { message: "no token" } });
      if (vertex[1] === "anthropic") {
        if (body.anthropic_version !== "vertex-2023-10-16") return json(400, { error: { message: "bad version" } });
        return vertex[3] === "streamRawPredict" ? sse(res, anthropicEvents("pong")) : json(200, anthropicJson);
      }
      return json(200, { candidates: [{ content: { parts: [{ text: "pong" }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 } });
    }

    const gemini = path.match(/^\/gemini\/v1beta\/models\/([^:]+):(\w+)$/);
    if (gemini) {
      if (req.headers["x-goog-api-key"] !== "up-gemini") return json(403, { error: { code: 403, message: "bad key" } });
      if (gemini[2] === "streamGenerateContent") {
        return sse(res, [
          [undefined, { candidates: [{ content: { parts: [{ text: "po" }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 1 } }],
          [undefined, { candidates: [{ content: { parts: [{ text: "ng" }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3, thoughtsTokenCount: 10 } }],
        ]);
      }
      return json(200, { candidates: [{ content: { parts: [{ text: "pong" }] } }], usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 3 } });
    }

    json(404, { error: `mock: no route for ${path}` });
  });
  return new Promise((resolve) =>
    server.listen(port, () => resolve({ received, close: () => server.close(), heal: () => (flakyHealed = true) })),
  );
}
