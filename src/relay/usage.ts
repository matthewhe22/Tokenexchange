import type { Json, Protocol, Usage } from "./types";

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function fromOpenAIChat(u: Json): Usage | null {
  if (!u) return null;
  const cached = n(u.prompt_tokens_details?.cached_tokens);
  return { input: Math.max(0, n(u.prompt_tokens) - cached), output: n(u.completion_tokens), cacheRead: cached, cacheWrite: 0 };
}

export function fromOpenAIResponses(u: Json): Usage | null {
  if (!u) return null;
  const cached = n(u.input_tokens_details?.cached_tokens);
  return { input: Math.max(0, n(u.input_tokens) - cached), output: n(u.output_tokens), cacheRead: cached, cacheWrite: 0 };
}

export function fromAnthropic(u: Json): Usage | null {
  if (!u) return null;
  return {
    input: n(u.input_tokens),
    output: n(u.output_tokens),
    cacheRead: n(u.cache_read_input_tokens),
    cacheWrite: n(u.cache_creation_input_tokens),
  };
}

export function fromGemini(u: Json): Usage | null {
  if (!u) return null;
  const cached = n(u.cachedContentTokenCount);
  return {
    input: Math.max(0, n(u.promptTokenCount) - cached),
    // thinking tokens are billed as output
    output: n(u.candidatesTokenCount) + n(u.thoughtsTokenCount),
    cacheRead: cached,
    cacheWrite: 0,
  };
}

/** Usage from a complete (non-streaming) JSON response body. */
export function usageFromBody(protocol: Protocol, body: Json): Usage | null {
  switch (protocol) {
    case "openai-chat":
    case "openai-embeddings":
      return fromOpenAIChat(body?.usage);
    case "openai-responses":
      return fromOpenAIResponses(body?.usage);
    case "anthropic-messages":
      return fromAnthropic(body?.usage);
    case "gemini":
      return fromGemini(body?.usageMetadata);
  }
}

/** Accumulates usage across the events of a streamed response. */
export class StreamUsageTracker {
  private usage: Usage | null = null;

  constructor(private protocol: Protocol) {}

  onEvent(_event: string | undefined, data: string): void {
    if (data === "[DONE]") return;
    let json: Json;
    try {
      json = JSON.parse(data);
    } catch {
      return;
    }
    switch (this.protocol) {
      case "openai-chat":
        if (json.usage) this.usage = fromOpenAIChat(json.usage);
        break;
      case "openai-responses":
        if (json.response?.usage) this.usage = fromOpenAIResponses(json.response.usage);
        break;
      case "anthropic-messages":
        if (json.type === "message_start") {
          this.usage = fromAnthropic(json.message?.usage);
        } else if (json.type === "message_delta" && json.usage) {
          // message_delta carries cumulative counts; input fields only appear on newer API versions
          const d = fromAnthropic(json.usage)!;
          const prev = this.usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
          this.usage = {
            input: json.usage.input_tokens != null ? d.input : prev.input,
            output: d.output,
            cacheRead: json.usage.cache_read_input_tokens != null ? d.cacheRead : prev.cacheRead,
            cacheWrite: json.usage.cache_creation_input_tokens != null ? d.cacheWrite : prev.cacheWrite,
          };
        }
        break;
      case "gemini":
        if (json.usageMetadata) this.usage = fromGemini(json.usageMetadata);
        break;
      case "openai-embeddings":
        break;
    }
  }

  result(): Usage | null {
    return this.usage;
  }
}
