import { buildUpstreamCall } from "@/relay/providers";
import { PROVIDER_INFO } from "@/relay/providers/info";
import type { Protocol, RelayRequest } from "@/relay/types";
import type { LoadedChannel } from "./channels";

/** Sends a tiny real request through a channel. Costs a few tokens. */
export async function testChannel(ch: LoadedChannel, model: string): Promise<{ ok: boolean; status: number; latencyMs: number; message: string }> {
  const protocols = PROVIDER_INFO[ch.provider].protocols;
  let protocol: Protocol = protocols[0];
  if (ch.provider === "vertex") protocol = model.startsWith("claude") ? "anthropic-messages" : "gemini";
  if (protocols.includes("openai-embeddings") && /embed/i.test(model)) protocol = "openai-embeddings";

  const body =
    protocol === "anthropic-messages"
      ? { model, max_tokens: 8, messages: [{ role: "user", content: "ping" }] }
      : protocol === "gemini"
        ? { contents: [{ role: "user", parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 8 } }
        : protocol === "openai-embeddings"
          ? { model, input: "ping" }
          : { model, messages: [{ role: "user", content: "ping" }] };

  const req: RelayRequest = { protocol, model, stream: false, body, headers: new Headers() };
  const started = Date.now();
  try {
    const call = await buildUpstreamCall(req, { ...ch, upstreamModel: ch.modelMapping[model] ?? model });
    const res = await fetch(call.request, { signal: AbortSignal.timeout(30_000) });
    const text = await res.text();
    return { ok: res.ok, status: res.status, latencyMs: Date.now() - started, message: text.slice(0, 500) };
  } catch (err) {
    return { ok: false, status: 0, latencyMs: Date.now() - started, message: err instanceof Error ? err.message : String(err) };
  }
}
