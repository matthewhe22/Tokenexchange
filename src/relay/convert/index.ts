import type { Json, Protocol } from "../types";
import { anthropicToChatResponse, anthropicToChatStream, chatToAnthropicRequest } from "./openai-anthropic";
import { chatToGeminiRequest, geminiToChatResponse, geminiToChatStream } from "./openai-gemini";

export { ConversionError } from "./common";

/** Translates a client request in one protocol for an upstream that speaks another, and back. */
export interface Converter {
  target: Protocol;
  request(body: Json): Json;
  response(upstream: Json, model: string): Json;
  stream(model: string, includeUsage: boolean): TransformStream<Uint8Array, Uint8Array>;
  /** Human-readable message from an upstream error body. */
  errorMessage(body: string): string;
}

function upstreamMessage(body: string): string {
  try {
    const j = JSON.parse(body);
    return j?.error?.message ?? j?.message ?? body.slice(0, 300);
  } catch {
    return body.slice(0, 300);
  }
}

const CONVERTERS: Partial<Record<Protocol, Partial<Record<Protocol, Converter>>>> = {
  "openai-chat": {
    "anthropic-messages": {
      target: "anthropic-messages",
      request: chatToAnthropicRequest,
      response: anthropicToChatResponse,
      stream: anthropicToChatStream,
      errorMessage: upstreamMessage,
    },
    gemini: {
      target: "gemini",
      request: chatToGeminiRequest,
      response: geminiToChatResponse,
      stream: geminiToChatStream,
      errorMessage: upstreamMessage,
    },
  },
};

export function converterFor(from: Protocol, to: Protocol): Converter | null {
  return CONVERTERS[from]?.[to] ?? null;
}

/** Protocols whose channels can serve a client speaking `from`, in preference order after native. */
export function conversionTargets(from: Protocol): Protocol[] {
  return Object.keys(CONVERTERS[from] ?? {}) as Protocol[];
}
