// OpenAI Chat Completions  <->  Gemini generateContent
import { SSEParser } from "../sse";
import type { Json } from "../types";
import {
  chunk,
  ConversionError,
  openAIUsage,
  parseImageUrl,
  parseToolArguments,
  sse,
  textOf,
  usageChunk,
  type OpenAIChunkState,
  rejectUntranslatable,
} from "./common";

// Gemini 3 returns a `thoughtSignature` on function calls that must be sent back on the next turn.
// OpenAI clients echo tool-call ids verbatim, so the signature rides along inside the id.
const SIG_SEP = "~sig~";

export function toolCallId(n: number, signature?: string): string {
  return signature ? `call_${n}${SIG_SEP}${signature}` : `call_${n}`;
}

function signatureOf(id: string | undefined): string | undefined {
  const i = id?.indexOf(SIG_SEP) ?? -1;
  return i >= 0 ? id!.slice(i + SIG_SEP.length) : undefined;
}

function parts(content: Json): Json[] {
  if (typeof content === "string") return content ? [{ text: content }] : [];
  if (!Array.isArray(content)) return [];
  return content.map((p: Json) => {
    if (p?.type === "text") return { text: p.text ?? "" };
    if (p?.type === "image_url") {
      const url = typeof p.image_url === "string" ? p.image_url : p.image_url?.url;
      const img = parseImageUrl(url ?? "");
      if (img.kind !== "base64") throw new ConversionError("Gemini models need images as base64 data URLs (data:image/...;base64,...)");
      return { inlineData: { mimeType: img.mediaType, data: img.data } };
    }
    throw new ConversionError(`content part type '${p?.type}' is not supported for this model`);
  });
}

export function chatToGeminiRequest(body: Json): Json {
  rejectUntranslatable(body);
  const system: string[] = [];
  const contents: { role: "user" | "model"; parts: Json[] }[] = [];
  const toolNames = new Map<string, string>();
  const push = (role: "user" | "model", p: Json[]) => {
    if (!p.length) return;
    const last = contents.at(-1);
    if (last && last.role === role) last.parts.push(...p);
    else contents.push({ role, parts: p });
  };

  for (const m of body.messages ?? []) {
    switch (m?.role) {
      case "system":
      case "developer":
        system.push(textOf(m.content));
        break;
      case "user":
        push("user", parts(m.content));
        break;
      case "assistant": {
        const p = parts(m.content);
        for (const tc of m.tool_calls ?? []) {
          toolNames.set(tc.id, tc.function?.name);
          const sig = signatureOf(tc.id);
          p.push({ functionCall: { name: tc.function?.name, args: parseToolArguments(tc.function?.arguments) }, ...(sig ? { thoughtSignature: sig } : {}) });
        }
        push("model", p);
        break;
      }
      case "tool": {
        const name = toolNames.get(m.tool_call_id);
        if (!name) throw new ConversionError(`tool message references unknown tool_call_id '${m.tool_call_id}'`);
        push("user", [{ functionResponse: { name, response: { content: textOf(m.content) } } }]);
        break;
      }
      default:
        throw new ConversionError(`message role '${m?.role}' is not supported`);
    }
  }
  if (!contents.length) throw new ConversionError("messages must contain at least one user message");

  const generationConfig: Json = {};
  if (body.temperature != null) generationConfig.temperature = body.temperature;
  if (body.top_p != null) generationConfig.topP = body.top_p;
  const maxTokens = body.max_completion_tokens ?? body.max_tokens;
  if (maxTokens != null) generationConfig.maxOutputTokens = maxTokens;
  if (body.stop != null) generationConfig.stopSequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (body.response_format?.type === "json_object" || body.response_format?.type === "json_schema") {
    generationConfig.responseMimeType = "application/json";
    const schema = body.response_format.json_schema?.schema;
    if (schema) generationConfig.responseJsonSchema = schema;
  }

  const out: Json = { contents };
  if (system.length) out.systemInstruction = { parts: [{ text: system.join("\n\n") }] };
  if (Object.keys(generationConfig).length) out.generationConfig = generationConfig;
  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = [
      {
        // parametersJsonSchema takes full JSON Schema, including what OpenAI strict mode adds
        // (additionalProperties: false), which the older `parameters` field rejects.
        functionDeclarations: body.tools.map((t: Json) => ({
          name: t.function?.name,
          description: t.function?.description,
          ...(t.function?.parameters ? { parametersJsonSchema: t.function.parameters } : {}),
        })),
      },
    ];
    const tc = body.tool_choice;
    const mode = tc === "none" ? "NONE" : tc === "required" || tc?.type === "function" ? "ANY" : "AUTO";
    out.toolConfig = {
      functionCallingConfig: { mode, ...(tc?.type === "function" ? { allowedFunctionNames: [tc.function?.name] } : {}) },
    };
  }
  return out;
}

const FINISH: Record<string, string> = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  BLOCKLIST: "content_filter",
  PROHIBITED_CONTENT: "content_filter",
  SPII: "content_filter",
};

function usageFrom(u: Json): Json {
  return openAIUsage(u?.promptTokenCount ?? 0, (u?.candidatesTokenCount ?? 0) + (u?.thoughtsTokenCount ?? 0), u?.cachedContentTokenCount ?? 0);
}

function splitParts(candidate: Json, nextToolId: (signature?: string) => string) {
  let text = "";
  const toolCalls: Json[] = [];
  for (const p of candidate?.content?.parts ?? []) {
    if (p.thought) continue;
    if (typeof p.text === "string") text += p.text;
    if (p.functionCall) {
      toolCalls.push({
        id: nextToolId(p.thoughtSignature),
        type: "function",
        function: { name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
      });
    }
  }
  return { text, toolCalls };
}

export function geminiToChatResponse(resp: Json, model: string): Json {
  const candidate = resp.candidates?.[0];
  let n = 0;
  const { text, toolCalls } = splitParts(candidate, (sig) => toolCallId(++n, sig));
  const message: Json = { role: "assistant", content: text || (toolCalls.length ? null : "") };
  if (toolCalls.length) message.tool_calls = toolCalls;
  const finish = toolCalls.length ? "tool_calls" : (FINISH[candidate?.finishReason] ?? "stop");
  return {
    id: `chatcmpl-${resp.responseId ?? Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: finish }],
    usage: usageFrom(resp.usageMetadata),
  };
}

/** Rewrites a Gemini streamGenerateContent (alt=sse) stream as OpenAI chat.completion.chunk events. */
export function geminiToChatStream(model: string, includeUsage: boolean): TransformStream<Uint8Array, Uint8Array> {
  const state: OpenAIChunkState = { id: `chatcmpl-${Date.now()}`, model, created: Math.floor(Date.now() / 1000), includeUsage };
  let usage: Json = null;
  let finish: string | null = null;
  let toolCount = 0;
  let started = false;
  let out: TransformStreamDefaultController<Uint8Array>;

  const parser = new SSEParser((_event, data) => {
    let ev: Json;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    if (ev.error) {
      out.enqueue(sse({ error: { message: ev.error.message ?? "upstream error", type: "api_error" } }));
      return;
    }
    if (!started) {
      started = true;
      if (ev.responseId) state.id = `chatcmpl-${ev.responseId}`;
      out.enqueue(sse(chunk(state, { role: "assistant", content: "" })));
    }
    if (ev.usageMetadata) usage = ev.usageMetadata;
    const candidate = ev.candidates?.[0];
    let idSeq = toolCount;
    const { text, toolCalls } = splitParts(candidate, (sig) => toolCallId(++idSeq, sig));
    if (text) out.enqueue(sse(chunk(state, { content: text })));
    for (const tc of toolCalls) {
      out.enqueue(sse(chunk(state, { tool_calls: [{ index: toolCount++, ...tc }] })));
    }
    if (candidate?.finishReason) finish = toolCount ? "tool_calls" : (FINISH[candidate.finishReason] ?? "stop");
  });

  return new TransformStream({
    start(controller) {
      out = controller;
    },
    transform(bytes) {
      parser.push(bytes);
    },
    flush() {
      parser.end();
      if (!started) return;
      if (!finish) {
        // The upstream stream ended without a finish reason: it was cut off, so do not pretend it completed.
        out.enqueue(sse({ error: { message: "upstream stream ended unexpectedly", type: "api_error" } }));
        return;
      }
      out.enqueue(sse(chunk(state, {}, finish)));
      if (state.includeUsage && usage) out.enqueue(sse(usageChunk(state, usageFrom(usage))));
      out.enqueue(sse("[DONE]"));
    },
  });
}
