import type { Json } from "../types";

/** A client request in one protocol served by an upstream that speaks another. */
export class ConversionError extends Error {}

export interface OpenAIChunkState {
  id: string;
  model: string;
  created: number;
  includeUsage: boolean;
}

export function chunk(state: OpenAIChunkState, delta: Json, finishReason: string | null = null): Json {
  return {
    id: state.id,
    object: "chat.completion.chunk",
    created: state.created,
    model: state.model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  };
}

export function usageChunk(state: OpenAIChunkState, usage: Json): Json {
  return { id: state.id, object: "chat.completion.chunk", created: state.created, model: state.model, choices: [], usage };
}

export function openAIUsage(prompt: number, completion: number, cached: number): Json {
  return {
    prompt_tokens: prompt,
    completion_tokens: completion,
    total_tokens: prompt + completion,
    prompt_tokens_details: { cached_tokens: cached },
  };
}

/** Text of an OpenAI message `content`, which may be a string or an array of parts. */
export function textOf(content: Json): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

export interface ParsedImage {
  kind: "base64" | "url";
  mediaType: string;
  data: string;
}

export function parseImageUrl(url: string): ParsedImage {
  const m = /^data:([^;,]+);base64,(.*)$/s.exec(url);
  if (m) return { kind: "base64", mediaType: m[1], data: m[2] };
  return { kind: "url", mediaType: "", data: url };
}

export function parseToolArguments(args: Json): Json {
  if (args && typeof args === "object") return args;
  if (typeof args !== "string" || !args.trim()) return {};
  try {
    return JSON.parse(args);
  } catch {
    throw new ConversionError("tool call arguments must be valid JSON");
  }
}

export const enc = new TextEncoder();

export function sse(data: Json | string): Uint8Array {
  return enc.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

/** OpenAI-only request features that cannot be reproduced on another vendor's API. */
export function rejectUntranslatable(body: Json): void {
  if (Number.isInteger(body.n) && body.n > 1) throw new ConversionError("n > 1 is only supported for OpenAI models");
  if (body.logprobs || body.top_logprobs != null) throw new ConversionError("logprobs are only supported for OpenAI models");
  if (body.audio || (Array.isArray(body.modalities) && body.modalities.includes("audio"))) {
    throw new ConversionError("audio output is only supported for OpenAI models");
  }
  if (body.prediction) throw new ConversionError("predicted outputs are only supported for OpenAI models");
}

/** Instruction that asks for JSON when the target API has no equivalent of `response_format`. */
export function jsonInstruction(format: Json): string | null {
  if (format?.type === "json_object") return "Respond only with a single valid JSON object and nothing else.";
  if (format?.type === "json_schema") {
    return `Respond only with a single JSON value that validates against this JSON Schema, and nothing else:\n${JSON.stringify(format.json_schema?.schema ?? {})}`;
  }
  return null;
}
