// OpenAI Chat Completions  <->  Anthropic Messages
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
  jsonInstruction,
  rejectUntranslatable,
} from "./common";

const DEFAULT_MAX_TOKENS = 4096;

function contentBlocks(content: Json): Json[] {
  if (typeof content === "string") return content ? [{ type: "text", text: content }] : [];
  if (!Array.isArray(content)) return [];
  const blocks: Json[] = [];
  for (const part of content) {
    if (part?.type === "text") blocks.push({ type: "text", text: part.text ?? "" });
    else if (part?.type === "image_url") {
      const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
      if (!url) continue;
      const img = parseImageUrl(url);
      blocks.push(
        img.kind === "base64"
          ? { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } }
          : { type: "image", source: { type: "url", url: img.data } },
      );
    } else {
      throw new ConversionError(`content part type '${part?.type}' is not supported for this model`);
    }
  }
  return blocks;
}

export function chatToAnthropicRequest(body: Json): Json {
  rejectUntranslatable(body);
  const system: string[] = [];
  const messages: { role: "user" | "assistant"; content: Json[] }[] = [];
  const push = (role: "user" | "assistant", blocks: Json[]) => {
    if (!blocks.length) return;
    const last = messages.at(-1);
    // Anthropic expects alternating turns; merge consecutive messages of the same role.
    if (last && last.role === role) last.content.push(...blocks);
    else messages.push({ role, content: blocks });
  };

  for (const m of body.messages ?? []) {
    switch (m?.role) {
      case "system":
      case "developer":
        system.push(textOf(m.content));
        break;
      case "user":
        push("user", contentBlocks(m.content));
        break;
      case "assistant": {
        const blocks = contentBlocks(m.content);
        for (const tc of m.tool_calls ?? []) {
          blocks.push({ type: "tool_use", id: tc.id, name: tc.function?.name, input: parseToolArguments(tc.function?.arguments) });
        }
        push("assistant", blocks);
        break;
      }
      case "tool":
        push("user", [{ type: "tool_result", tool_use_id: m.tool_call_id, content: textOf(m.content) }]);
        break;
      default:
        throw new ConversionError(`message role '${m?.role}' is not supported`);
    }
  }
  if (!messages.length) throw new ConversionError("messages must contain at least one user message");

  const out: Json = {
    model: body.model,
    max_tokens: body.max_completion_tokens ?? body.max_tokens ?? DEFAULT_MAX_TOKENS,
    messages,
  };
  const json = jsonInstruction(body.response_format);
  if (json) system.push(json);
  if (system.length) out.system = system.join("\n\n");
  if (body.stream) out.stream = true;
  if (body.temperature != null) out.temperature = Math.min(1, body.temperature);
  // Newer Claude models accept temperature or top_p, not both; temperature wins.
  if (body.top_p != null && out.temperature == null) out.top_p = body.top_p;
  if (body.stop != null) out.stop_sequences = Array.isArray(body.stop) ? body.stop : [body.stop];
  if (typeof body.user === "string") out.metadata = { user_id: body.user };
  if (Array.isArray(body.tools) && body.tools.length) {
    out.tools = body.tools.map((t: Json) => ({
      name: t.function?.name,
      description: t.function?.description,
      input_schema: t.function?.parameters ?? { type: "object", properties: {} },
    }));
  }
  const tc = body.tool_choice;
  let choice: Json | undefined;
  if (tc === "auto") choice = { type: "auto" };
  else if (tc === "none") choice = { type: "none" };
  else if (tc === "required") choice = { type: "any" };
  else if (tc?.type === "function") choice = { type: "tool", name: tc.function?.name };
  if (body.parallel_tool_calls === false && out.tools) choice = { ...(choice ?? { type: "auto" }), disable_parallel_tool_use: true };
  if (choice) out.tool_choice = choice;
  return out;
}

const FINISH: Record<string, string> = {
  end_turn: "stop",
  stop_sequence: "stop",
  pause_turn: "stop",
  max_tokens: "length",
  tool_use: "tool_calls",
  refusal: "content_filter",
};

function usageFrom(u: Json): Json {
  const cacheRead = u?.cache_read_input_tokens ?? 0;
  const prompt = (u?.input_tokens ?? 0) + cacheRead + (u?.cache_creation_input_tokens ?? 0);
  return openAIUsage(prompt, u?.output_tokens ?? 0, cacheRead);
}

export function anthropicToChatResponse(msg: Json, model: string): Json {
  const text = (msg.content ?? [])
    .filter((b: Json) => b.type === "text")
    .map((b: Json) => b.text)
    .join("");
  const toolCalls = (msg.content ?? [])
    .filter((b: Json) => b.type === "tool_use")
    .map((b: Json) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
  const message: Json = { role: "assistant", content: text || (toolCalls.length ? null : "") };
  if (toolCalls.length) message.tool_calls = toolCalls;
  return {
    id: `chatcmpl-${msg.id ?? Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: FINISH[msg.stop_reason] ?? "stop" }],
    usage: usageFrom(msg.usage),
  };
}

/** Rewrites an Anthropic Messages SSE stream as OpenAI chat.completion.chunk events. */
export function anthropicToChatStream(model: string, includeUsage: boolean): TransformStream<Uint8Array, Uint8Array> {
  const state: OpenAIChunkState = { id: `chatcmpl-${Date.now()}`, model, created: Math.floor(Date.now() / 1000), includeUsage };
  let usage: Json = {};
  let finish: string | null = null;
  let toolIndex = -1;
  const blockToTool = new Map<number, number>();
  let out: TransformStreamDefaultController<Uint8Array>;

  const parser = new SSEParser((_event, data) => {
    let ev: Json;
    try {
      ev = JSON.parse(data);
    } catch {
      return;
    }
    switch (ev.type) {
      case "message_start":
        state.id = `chatcmpl-${ev.message?.id ?? state.id}`;
        usage = { ...ev.message?.usage };
        out.enqueue(sse(chunk(state, { role: "assistant", content: "" })));
        break;
      case "content_block_start":
        if (ev.content_block?.type === "tool_use") {
          blockToTool.set(ev.index, ++toolIndex);
          out.enqueue(
            sse(
              chunk(state, {
                tool_calls: [{ index: toolIndex, id: ev.content_block.id, type: "function", function: { name: ev.content_block.name, arguments: "" } }],
              }),
            ),
          );
        }
        break;
      case "content_block_delta":
        if (ev.delta?.type === "text_delta") out.enqueue(sse(chunk(state, { content: ev.delta.text })));
        else if (ev.delta?.type === "input_json_delta" && blockToTool.has(ev.index)) {
          out.enqueue(sse(chunk(state, { tool_calls: [{ index: blockToTool.get(ev.index), function: { arguments: ev.delta.partial_json } }] })));
        }
        break;
      case "message_delta":
        if (ev.usage) usage = { ...usage, ...Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v != null)) };
        if (ev.delta?.stop_reason) finish = FINISH[ev.delta.stop_reason] ?? "stop";
        break;
      case "message_stop":
        out.enqueue(sse(chunk(state, {}, finish ?? "stop")));
        if (state.includeUsage) out.enqueue(sse(usageChunk(state, usageFrom(usage))));
        out.enqueue(sse("[DONE]"));
        break;
      case "error":
        out.enqueue(sse({ error: { message: ev.error?.message ?? "upstream error", type: ev.error?.type ?? "api_error" } }));
        break;
    }
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
    },
  });
}
