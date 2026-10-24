// Client-safe provider metadata (no Node-only imports), shared by the router and the admin UI.
import type { Provider, Source } from "@/db/enums";
import type { Protocol } from "../types";

const OPENAI_PROTOCOLS: Protocol[] = ["openai-chat", "openai-responses", "openai-embeddings"];

export const PROVIDER_INFO: Record<
  Provider,
  { label: string; defaultSource: Source; protocols: Protocol[]; credentialFields: string[]; configFields: string[]; baseUrlHint: string }
> = {
  openai: {
    label: "OpenAI (official)",
    defaultSource: "official",
    protocols: OPENAI_PROTOCOLS,
    credentialFields: ["apiKey"],
    configFields: [],
    baseUrlHint: "https://api.openai.com/v1",
  },
  anthropic: {
    label: "Anthropic (official)",
    defaultSource: "official",
    protocols: ["anthropic-messages"],
    credentialFields: ["apiKey"],
    configFields: [],
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
    configFields: ["resource", "apiVersion"],
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
    protocols: OPENAI_PROTOCOLS,
    credentialFields: ["apiKey"],
    configFields: [],
    baseUrlHint: "https://relay.example.com/v1",
  },
  anthropic_compatible: {
    label: "Anthropic-compatible relay (reseller)",
    defaultSource: "reseller",
    protocols: ["anthropic-messages"],
    credentialFields: ["apiKey"],
    configFields: [],
    baseUrlHint: "https://relay.example.com",
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
