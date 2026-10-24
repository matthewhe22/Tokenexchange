import { buildUpstreamCall } from "@/relay/providers";
import { PROVIDER_INFO, supportsModel } from "@/relay/providers/info";
import type { Protocol, RelayRequest } from "@/relay/types";
import type { LoadedChannel } from "./channels";

/** Sends a tiny real request through a channel. Costs a few tokens. */
export async function testChannel(ch: LoadedChannel, model: string): Promise<{ ok: boolean; status: number; latencyMs: number; message: string }> {
  const upstreamModel = ch.modelMapping[model] ?? model;
  const chatLike: Protocol[] = ["openai-chat", "anthropic-messages", "gemini"];
  // Same protocol choice as routing (Vertex picks by model family, on the mapped model name).
  let protocol: Protocol = PROVIDER_INFO[ch.provider].protocols.find((p) => chatLike.includes(p) && supportsModel(ch.provider, p, upstreamModel)) ?? "openai-chat";
  if (supportsModel(ch.provider, "openai-embeddings", upstreamModel) && /embed/i.test(model)) protocol = "openai-embeddings";

  const body =
    protocol === "anthropic-messages"
      ? { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] }
      : protocol === "gemini"
        ? { contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 8 } }
        : protocol === "openai-embeddings"
          ? { model, input: "ping" }
          : // Keep probes cheap; reasoning models need max_completion_tokens and a little headroom.
            ch.provider === "openai_compatible"
            ? { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] }
            : { model, max_completion_tokens: 32, messages: [{ role: "user", content: "ping" }] };

  const req: RelayRequest = { protocol, model, stream: false, body, headers: new Headers() };
  const started = Date.now();
  try {
    const call = await buildUpstreamCall(req, { ...ch, upstreamModel });
    const res = await fetch(call.request, { signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - started, message: text.slice(0, 500) };
  } catch (err) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : String(err) };
  }
}
