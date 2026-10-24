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

/** An error in the shape the caller's SDK expects for the protocol it is speaking. */
export function relayError(protocol: Protocol, status: number, message: string, code?: string): Response {
  let body: unknown;
  if (protocol === "anthropic-messages") {
    body = { type: "error", error: { type: ANTHROPIC_TYPES[status] ?? "api_error", message } };
  } else if (protocol === "gemini") {
    body = { error: { code: status, message, status: GEMINI_STATUS[status] ?? "INTERNAL" } };
  } else {
    body = { error: { message, type: code ?? "tokenexchange_error", code: code ?? null } };
  }
  return Response.json(body, { status });
}
