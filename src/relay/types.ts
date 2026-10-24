import type { Provider, Source } from "@/db/schema";

export type Protocol = "openai-chat" | "openai-responses" | "openai-embeddings" | "anthropic-messages" | "gemini";

// Request bodies are relayed mostly untouched, so they are kept as loose JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

/** Normalised token usage. `input` excludes cached tokens on every protocol. */
export interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface RelayRequest {
  protocol: Protocol;
  /** Model name as the customer sent it (the public name). */
  model: string;
  stream: boolean;
  body: Json;
  headers: Headers;
}

export interface ChannelRuntime {
  id: number;
  name: string;
  provider: Provider;
  source: Source;
  baseUrl: string | null;
  config: Record<string, string>;
  credentials: Record<string, string>;
  upstreamModel: string;
}

export interface UpstreamCall {
  request: Request;
  /** Bedrock streams use AWS event-stream framing that must be converted to SSE. */
  streamFormat: "sse" | "aws-eventstream";
}
