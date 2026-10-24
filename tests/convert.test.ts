import { describe, expect, it } from "vitest";
import { ConversionError } from "@/relay/convert";
import { anthropicToChatResponse, anthropicToChatStream, chatToAnthropicRequest } from "@/relay/convert/openai-anthropic";
import { chatToGeminiRequest, geminiToChatResponse, geminiToChatStream } from "@/relay/convert/openai-gemini";

async function runStream(ts: TransformStream<Uint8Array, Uint8Array>, raw: string) {
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      const b = new TextEncoder().encode(raw);
      for (let i = 0; i < b.length; i += 7) c.enqueue(b.subarray(i, i + 7));
      c.close();
    },
  });
  const text = await new Response(src.pipeThrough(ts)).text();
  return text
    .split("\n\n")
    .filter(Boolean)
    .map((l) => l.replace(/^data: /, ""))
    .map((d) => (d === "[DONE]" ? d : JSON.parse(d)));
}

const toolConversation = {
  model: "claude-x",
  max_completion_tokens: 300,
  temperature: 1.5,
  stop: "END",
  messages: [
    { role: "system", content: "be brief" },
    { role: "user", content: [{ type: "text", text: "weather?" }, { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] },
    { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }] },
    { role: "tool", tool_call_id: "call_1", content: "sunny" },
  ],
  tools: [{ type: "function", function: { name: "get_weather", description: "d", parameters: { type: "object", properties: { city: { type: "string" } } } } }],
  tool_choice: "required",
  parallel_tool_calls: false,
};

describe("OpenAI chat -> Anthropic", () => {
  it("maps system, images, tool calls, tool results and options", () => {
    const out = chatToAnthropicRequest(toolConversation);
    expect(out.system).toBe("be brief");
    expect(out.max_tokens).toBe(300);
    expect(out.temperature).toBe(1);
    expect(out.stop_sequences).toEqual(["END"]);
    expect(out.messages).toEqual([
      { role: "user", content: [{ type: "text", text: "weather?" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "AAAA" } }] },
      { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "get_weather", input: { city: "Paris" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "sunny" }] },
    ]);
    expect(out.tools[0]).toEqual({ name: "get_weather", description: "d", input_schema: toolConversation.tools[0].function.parameters });
    expect(out.tool_choice).toEqual({ type: "any", disable_parallel_tool_use: true });
  });

  it("rejects unsupported content and bad tool arguments", () => {
    expect(() => chatToAnthropicRequest({ messages: [{ role: "user", content: [{ type: "input_audio" }] }] })).toThrow(ConversionError);
    expect(() =>
      chatToAnthropicRequest({ messages: [{ role: "assistant", tool_calls: [{ id: "x", function: { name: "f", arguments: "{oops" } }] }] }),
    ).toThrow(ConversionError);
  });

  it("maps a tool-use response back", () => {
    const r = anthropicToChatResponse(
      {
        id: "msg_1",
        content: [{ type: "text", text: "checking" }, { type: "tool_use", id: "tu_1", name: "get_weather", input: { city: "Paris" } }],
        stop_reason: "tool_use",
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 },
      },
      "claude-x",
    );
    expect(r.choices[0].finish_reason).toBe("tool_calls");
    expect(r.choices[0].message).toEqual({
      role: "assistant",
      content: "checking",
      tool_calls: [{ id: "tu_1", type: "function", function: { name: "get_weather", arguments: '{"city":"Paris"}' } }],
    });
    expect(r.usage).toEqual({ prompt_tokens: 16, completion_tokens: 5, total_tokens: 21, prompt_tokens_details: { cached_tokens: 4 } });
  });

  it("translates a streamed answer with a tool call", async () => {
    const ev = (type: string, data: object) => `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
    const raw =
      ev("message_start", { message: { id: "m1", usage: { input_tokens: 9, output_tokens: 1 } } }) +
      ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } }) +
      ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: "Hi" } }) +
      ev("content_block_start", { index: 1, content_block: { type: "tool_use", id: "tu_1", name: "f" } }) +
      ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: '{"a":' } }) +
      ev("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json: "1}" } }) +
      ev("message_delta", { delta: { stop_reason: "tool_use" }, usage: { output_tokens: 12 } }) +
      ev("message_stop", {});
    const chunks = await runStream(anthropicToChatStream("claude-x", true), raw);
    expect(chunks[0].choices[0].delta).toEqual({ role: "assistant", content: "" });
    expect(chunks[1].choices[0].delta).toEqual({ content: "Hi" });
    expect(chunks[2].choices[0].delta.tool_calls[0]).toMatchObject({ index: 0, id: "tu_1", function: { name: "f", arguments: "" } });
    expect(chunks[3].choices[0].delta.tool_calls[0]).toEqual({ index: 0, function: { arguments: '{"a":' } });
    expect(chunks[5].choices[0].finish_reason).toBe("tool_calls");
    expect(chunks[6].usage).toMatchObject({ prompt_tokens: 9, completion_tokens: 12 });
    expect(chunks.at(-1)).toBe("[DONE]");
    expect(new Set(chunks.slice(0, -1).map((c) => c.id)).size).toBe(1);
  });
});

describe("OpenAI chat -> Gemini", () => {
  it("maps contents, tools and generation config", () => {
    const out = chatToGeminiRequest({ ...toolConversation, response_format: { type: "json_object" } });
    expect(out.systemInstruction).toEqual({ parts: [{ text: "be brief" }] });
    expect(out.contents).toEqual([
      { role: "user", parts: [{ text: "weather?" }, { inlineData: { mimeType: "image/png", data: "AAAA" } }] },
      { role: "model", parts: [{ functionCall: { name: "get_weather", args: { city: "Paris" } } }] },
      { role: "user", parts: [{ functionResponse: { name: "get_weather", response: { content: "sunny" } } }] },
    ]);
    expect(out.generationConfig).toEqual({ temperature: 1.5, maxOutputTokens: 300, stopSequences: ["END"], responseMimeType: "application/json" });
    expect(out.toolConfig).toEqual({ functionCallingConfig: { mode: "ANY" } });
  });

  it("requires inline images", () => {
    expect(() => chatToGeminiRequest({ messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://x/y.png" } }] }] })).toThrow(
      /base64/,
    );
  });

  it("maps responses, skipping thoughts and counting thinking tokens as output", () => {
    const r = geminiToChatResponse(
      {
        candidates: [{ content: { parts: [{ text: "plan", thought: true }, { text: "Answer" }, { functionCall: { name: "f", args: { a: 1 } } }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 3, thoughtsTokenCount: 7, cachedContentTokenCount: 2 },
      },
      "gemini-x",
    );
    expect(r.choices[0].message.content).toBe("Answer");
    expect(r.choices[0].message.tool_calls[0].function).toEqual({ name: "f", arguments: '{"a":1}' });
    expect(r.choices[0].finish_reason).toBe("tool_calls");
    expect(r.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 2 } });
  });

  it("translates a stream", async () => {
    const raw =
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hel" }] } }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 1 } })}\n\n` +
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "lo" }] }, finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 2 } })}\n\n`;
    const chunks = await runStream(geminiToChatStream("gemini-x", true), raw);
    expect(chunks.map((c) => (c === "[DONE]" ? c : (c.choices[0]?.delta.content ?? c.choices[0]?.finish_reason ?? "usage")))).toEqual([
      "",
      "Hel",
      "lo",
      "length",
      "usage",
      "[DONE]",
    ]);
  });
});

describe("conversion review fixes", async () => {
  const { toolCallId } = await import("@/relay/convert/openai-gemini");
  it("gives parallel Gemini tool calls distinct ids in a stream", async () => {
    const raw = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ functionCall: { name: "a", args: {} } }, { functionCall: { name: "b", args: {} } }] }, finishReason: "STOP" }] })}\n\n`;
    const chunks = await runStream(geminiToChatStream("g", false), raw);
    const ids = chunks.filter((c) => c !== "[DONE]" && c.choices[0]?.delta?.tool_calls).map((c) => c.choices[0].delta.tool_calls[0].id);
    expect(ids).toEqual(["call_1", "call_2"]);
  });

  it("reports a Gemini stream cut off before a finish reason as an error", async () => {
    const raw = `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "partial" }] } }] })}\n\n`;
    const chunks = await runStream(geminiToChatStream("g", true), raw);
    expect(chunks.at(-1).error.message).toMatch(/ended unexpectedly/);
    expect(chunks).not.toContain("[DONE]");
  });

  it("round-trips Gemini thought signatures through tool-call ids", () => {
    const resp = geminiToChatResponse({ candidates: [{ content: { parts: [{ functionCall: { name: "f", args: {} }, thoughtSignature: "c2ln+/=" }] } }] }, "g");
    const id = resp.choices[0].message.tool_calls[0].id;
    expect(id).toBe(toolCallId(1, "c2ln+/="));
    const req = chatToGeminiRequest({
      messages: [
        { role: "user", content: "x" },
        { role: "assistant", tool_calls: [{ id, function: { name: "f", arguments: "{}" } }] },
        { role: "tool", tool_call_id: id, content: "ok" },
      ],
    });
    expect(req.contents[1].parts[0]).toEqual({ functionCall: { name: "f", args: {} }, thoughtSignature: "c2ln+/=" });
  });

  it("rejects features that cannot be translated and maps JSON output", () => {
    expect(() => chatToAnthropicRequest({ n: 2, messages: [{ role: "user", content: "x" }] })).toThrow(/n > 1/);
    expect(() => chatToGeminiRequest({ logprobs: true, messages: [{ role: "user", content: "x" }] })).toThrow(/logprobs/);
    const a = chatToAnthropicRequest({ response_format: { type: "json_object" }, temperature: 0.5, top_p: 0.9, messages: [{ role: "user", content: "x" }] });
    expect(a.system).toMatch(/JSON object/);
    expect(a.top_p).toBeUndefined();
    const g = chatToGeminiRequest({ response_format: { type: "json_schema", json_schema: { schema: { type: "object" } } }, tools: [{ type: "function", function: { name: "f", parameters: { type: "object", additionalProperties: false } } }], messages: [{ role: "user", content: "x" }] });
    expect(g.generationConfig.responseJsonSchema).toEqual({ type: "object" });
    expect(g.tools[0].functionDeclarations[0].parametersJsonSchema).toEqual({ type: "object", additionalProperties: false });
  });
});
