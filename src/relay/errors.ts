import type { Protocol } from "./types";

const ANTHROPIC_TYPES: Record<number, string> = {
  400: "invalid_request_error",
  401: "authentication_error",
  402: "billing_error",
  403: "permission_error",
  404: "not_found_error",
  429: "rate_limit_error",
  503: "overloaded_error",
};

const GEMINI_STATUS: Record<number, string> = {
  400: "INVALID_ARGUMENT",
  401: "UNAUTHENTICATED",
  402: "FAILED_PRECONDITION",
  403: "PERMISSION_DENIED",
  404: "NOT_FOUND",
  429: "RESOURCE_EXHAUSTED",
  503: "UNAVAILABLE",
};

/** Sent with flex / priority / batch rates. */
export const METERING_UNAVAILABLE = "metering_unavailable";

/** What the caller sees when a successful call could not be metered (the hold is still charged). */
export const METERING_UNAVAILABLE_MESSAGE =
  "the model provider did not report token usage for this request, so it could not be metered; the reserved amount was charged instead";

/**
 * Trailing SSE events that tell a streaming caller its response could not be metered. Sent right
 * before the stream is errored, so SDKs that stop at their own `[DONE]` sentinel still see a failed
 * request rather than a silently free one.
 */
export function unmeteredTail(protocol: Protocol, message: string): string {
  const code = METERING_UNAVAILABLE;
  switch (protocol) {
    case "anthropic-messages":
      return `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message, code } })}\n\n`;
    case "gemini":
      return `data: ${JSON.stringify({ error: { code: 502, message, status: "INTERNAL" } })}\n\n`;
    case "openai-responses":
      return `event: error\ndata: ${JSON.stringify({ type: "error", error: { message, code } })}\n\n`;
    default:
      return `data: ${JSON.stringify({ error: { message, type: "tokenexchange_error", code } })}\n\n`;
  }
}

/** An error in the shape the caller's SDK expects for the protocol it is speaking. */
export function relayError(protocol: Protocol, status: number, message: string, code?: string, headers?: HeadersInit): Response {
  let body: unknown;
  if (protocol === "anthropic-messages") {
    body = { type: "error", error: { type: ANTHROPIC_TYPES[status] ?? "api_error", message } };
  } else if (protocol === "gemini") {
    body = { error: { code: status, message, status: GEMINI_STATUS[status] ?? "INTERNAL" } };
  } else {
    body = { error: { message, type: code ?? "tokenexchange_error", code: code ?? null } };
  }
  return Response.json(body, { status, headers });
}
