import { EventStreamDecoder } from "./eventstream";
import { encodeSSE } from "./sse";

/**
 * Converts a Bedrock InvokeModelWithResponseStream body (AWS event-stream frames whose
 * `chunk` payloads wrap base64 Anthropic events) into a standard Anthropic SSE stream.
 */
export function bedrockToSSE(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new EventStreamDecoder();
  const enc = new TextEncoder();
  const text = new TextDecoder();
  return new TransformStream({
    transform(chunk, controller) {
      for (const msg of decoder.push(chunk)) {
        const messageType = msg.headers[":message-type"];
        const payload = JSON.parse(text.decode(msg.payload) || "{}");
        if (messageType === "event" && msg.headers[":event-type"] === "chunk" && typeof payload.bytes === "string") {
          const event = JSON.parse(Buffer.from(payload.bytes, "base64").toString("utf8"));
          controller.enqueue(enc.encode(encodeSSE(event.type, event)));
        } else if (messageType === "exception" || messageType === "error") {
          const kind = String(msg.headers[":exception-type"] ?? msg.headers[":error-code"] ?? "api_error");
          const message = payload.message ?? payload.Message ?? String(msg.headers[":error-message"] ?? kind);
          controller.enqueue(
            enc.encode(encodeSSE("error", { type: "error", error: { type: kind === "throttlingException" ? "rate_limit_error" : "api_error", message } })),
          );
        }
      }
    },
  });
}
