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

export function startMockUpstream(port: number): Promise<{ received: Received[]; close: () => void }> {
  const received: Received[] = [];
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
    if (path === "/v1/checkout/sessions") {
      return json(200, { id: "cs_mock", object: "checkout.session", url: `http://localhost:${port}/checkout/cs_mock` });
    }
    if (path.startsWith("/checkout/")) {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<h1>Mock Stripe Checkout</h1>");
    }

    if (path === "/broken/v1/chat/completions") return json(500, { error: { message: "boom" } });

    if (path.startsWith("/openai/v1/")) {
      if (req.headers.authorization !== "Bearer up-openai") return json(401, { error: { message: "bad key" } });
      if (path.endsWith("/chat/completions")) {
        if (!body.stream) return json(200, { id: "c1", choices: [{ message: { role: "assistant", content: "pong" } }], usage: { prompt_tokens: 20, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 4 } } });
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
    }

    if (path === "/azure/openai/v1/chat/completions") {
      if (req.headers["api-key"] !== "up-azure") return json(401, { error: { message: "bad key" } });
      return json(200, { choices: [{ message: { content: "pong" } }], usage: { prompt_tokens: 10, completion_tokens: 2 } });
    }

    if (path === "/anthropic/v1/messages") {
      if (req.headers["x-api-key"] !== "up-anthropic") return json(401, { type: "error", error: { type: "authentication_error", message: "bad key" } });
      if (body.max_tokens == null) return json(400, { type: "error", error: { type: "invalid_request_error", message: "max_tokens: field required" } });
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
  return new Promise((resolve) => server.listen(port, () => resolve({ received, close: () => server.close() })));
}
