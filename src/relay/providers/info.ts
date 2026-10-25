// Client-safe provider metadata (no Node-only imports), shared by the router and the admin UI.
import type { Provider, Source } from "@/db/enums";
import type { Protocol } from "../types";

const OPENAI_PROTOCOLS: Protocol[] = [
  "openai-chat",
  "openai-responses",
  "openai-embeddings",
  "openai-images",
  "openai-audio-speech",
  "openai-audio-transcriptions",
];

export const PROVIDER_INFO: Record<
  Provider,
  { label: string; defaultSource: Source; protocols: Protocol[]; credentialFields: string[]; configFields: string[]; baseUrlHint: string }
> = {
  openai: {
    label: "OpenAI (official)",
    defaultSource: "official",
    protocols: OPENAI_PROTOCOLS,
    credentialFields: ["apiKey"],
    configFields: ["batchCostFactor"],
    baseUrlHint: "https://api.openai.com/v1",
  },
  anthropic: {
    label: "Anthropic (official)",
    defaultSource: "official",
    protocols: ["anthropic-messages"],
    credentialFields: ["apiKey"],
    configFields: ["batchCostFactor"],
    baseUrlHint: "https://api.anthropic.com",
  },
  gemini: {
    label: "Google Gemini API (official)",
    defaultSource: "official",
    protocols: ["gemini"],
    credentialFields: ["apiKey"],
    configFields: [],
    baseUrlHint: "https://generativelanguage.googleapis.com",
  },
  azure_openai: {
    label: "Azure OpenAI (cloud)",
    defaultSource: "cloud",
    protocols: OPENAI_PROTOCOLS,
    credentialFields: ["apiKey"],
    configFields: ["resource", "apiVersion", "batchCostFactor"],
    baseUrlHint: "https://<resource>.openai.azure.com/openai/v1",
  },
  bedrock: {
    label: "AWS Bedrock – Claude (cloud)",
    defaultSource: "cloud",
    protocols: ["anthropic-messages"],
    // either apiKey (Bedrock API key) or accessKeyId + secretAccessKey (+ sessionToken)
    credentialFields: ["apiKey", "accessKeyId", "secretAccessKey", "sessionToken"],
    configFields: ["region"],
    baseUrlHint: "https://bedrock-runtime.<region>.amazonaws.com",
  },
  vertex: {
    label: "Google Vertex AI – Claude & Gemini (cloud)",
    defaultSource: "cloud",
    protocols: ["anthropic-messages", "gemini"],
    credentialFields: ["serviceAccount"],
    configFields: ["projectId", "location"],
    baseUrlHint: "https://aiplatform.googleapis.com",
  },
  openai_compatible: {
    label: "OpenAI-compatible relay (reseller)",
    defaultSource: "reseller",
    // Rerank follows the Cohere/Jina shape most relays expose at /v1/rerank.
    protocols: [...OPENAI_PROTOCOLS, "rerank"],
    credentialFields: ["apiKey"],
    configFields: ["catalog", "extraHeaders", "batch", "batchCostFactor"],
    baseUrlHint: "https://relay.example.com/v1",
  },
  anthropic_compatible: {
    label: "Anthropic-compatible relay (reseller)",
    defaultSource: "reseller",
    protocols: ["anthropic-messages"],
    credentialFields: ["apiKey"],
    configFields: ["extraHeaders", "batch", "batchCostFactor"],
    baseUrlHint: "https://relay.example.com",
  },
};

/**
 * Extra request headers from a channel's `extraHeaders` config ("Name: value" per line), e.g.
 * GMI Cloud's X-Organization-ID. Lines that are not valid headers are ignored.
 */
export function parseExtraHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of (raw ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) && value && !/[\r\n]/.test(value)) out[name] = value;
  }
  return out;
}

/** Ready-made settings for per-token upstreams, offered as "Add DeepInfra channel" etc. */
export const CHANNEL_PRESETS: Record<
  string,
  { name: string; provider: Provider; source: Source; baseUrl: string; config: Record<string, string>; note: string }
> = {
  deepinfra: {
    name: "DeepInfra",
    provider: "openai_compatible",
    source: "reseller",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    config: { catalog: "deepinfra", batch: "on", batchCostFactor: "0.8" },
    note: "Batches are billed at 80% of DeepInfra's price. DeepInfra's terms forbid reselling without a written agreement.",
  },
  novita: {
    name: "Novita AI",
    provider: "openai_compatible",
    source: "reseller",
    baseUrl: "https://api.novita.ai/openai/v1",
    config: { catalog: "novita", batch: "on", batchCostFactor: "0.5" },
    note: "Batches are billed at 50% of Novita's price (introductory). Confirm resale terms with Novita.",
  },
  gmi: {
    name: "GMI Cloud",
    provider: "openai_compatible",
    source: "reseller",
    baseUrl: "https://api.gmi-serving.com/v1",
    config: {},
    note: "Add your X-Organization-ID header if your account needs it. Enter per-model costs by hand. Confirm resale terms with GMI.",
  },
};

export function supports(provider: Provider, protocol: Protocol): boolean {
  return PROVIDER_INFO[provider].protocols.includes(protocol);
}

/**
 * Whether a channel can serve `upstreamModel` over `protocol`. Vertex hosts Claude (Anthropic
 * protocol) and Gemini (Gemini protocol) side by side, so for it the model decides the protocol.
 */
export function supportsModel(provider: Provider, protocol: Protocol, upstreamModel: string): boolean {
  if (!supports(provider, protocol)) return false;
  if (provider === "vertex") return (protocol === "anthropic-messages") === /claude/i.test(upstreamModel);
  return true;
}
