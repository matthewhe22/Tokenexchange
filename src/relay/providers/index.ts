import { AwsClient } from "aws4fetch";
import type { ChannelRuntime, Json, Protocol, RelayRequest, UpstreamCall } from "../types";
import { getAccessToken, parseServiceAccount } from "./google-auth";
import { supports } from "./info";

export { PROVIDER_INFO, supports } from "./info";

const trim = (url: string) => url.replace(/\/+$/, "");

function jsonRequest(url: string, headers: Record<string, string>, body: Json): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function need(value: string | undefined | null, what: string): string {
  if (!value) throw new Error(`channel is missing ${what}`);
  return value;
}

const OPENAI_PATHS: Partial<Record<Protocol, string>> = {
  "openai-chat": "/chat/completions",
  "openai-responses": "/responses",
  "openai-embeddings": "/embeddings",
};

function buildOpenAI(req: RelayRequest, ch: ChannelRuntime): UpstreamCall {
  const body = { ...req.body, model: ch.upstreamModel };
  if (req.protocol === "openai-chat" && req.stream) {
    // Ask for the trailing usage chunk so streamed requests can be billed.
    body.stream_options = { ...(body.stream_options ?? {}), include_usage: true };
  }
  let base: string;
  const headers: Record<string, string> = {};
  if (ch.provider === "azure_openai") {
    base = ch.baseUrl ?? `https://${need(ch.config.resource, "config.resource or base URL")}.openai.azure.com/openai/v1`;
    headers["api-key"] = need(ch.credentials.apiKey, "apiKey");
  } else {
    base = ch.provider === "openai" ? (ch.baseUrl ?? "https://api.openai.com/v1") : need(ch.baseUrl, "base URL");
    headers.authorization = `Bearer ${need(ch.credentials.apiKey, "apiKey")}`;
  }
  let url = trim(base) + OPENAI_PATHS[req.protocol]!;
  if (ch.provider === "azure_openai" && ch.config.apiVersion) url += `?api-version=${encodeURIComponent(ch.config.apiVersion)}`;
  return { request: jsonRequest(url, headers, body), streamFormat: "sse" };
}

function anthropicHeaders(req: RelayRequest): Record<string, string> {
  const h: Record<string, string> = { "anthropic-version": req.headers.get("anthropic-version") ?? "2023-06-01" };
  const beta = req.headers.get("anthropic-beta");
  if (beta) h["anthropic-beta"] = beta;
  return h;
}

function buildAnthropic(req: RelayRequest, ch: ChannelRuntime): UpstreamCall {
  const root =
    ch.provider === "anthropic" ? (ch.baseUrl ?? "https://api.anthropic.com") : need(ch.baseUrl, "base URL");
  const key = need(ch.credentials.apiKey, "apiKey");
  const headers: Record<string, string> = { ...anthropicHeaders(req), "x-api-key": key };
  // Many relays only accept bearer auth.
  if (ch.provider === "anthropic_compatible") headers.authorization = `Bearer ${key}`;
  const url = trim(root).replace(/\/v1$/, "") + "/v1/messages";
  return { request: jsonRequest(url, headers, { ...req.body, model: ch.upstreamModel }), streamFormat: "sse" };
}

async function buildBedrock(req: RelayRequest, ch: ChannelRuntime): Promise<UpstreamCall> {
  const region = ch.config.region || "us-east-1";
  const base = trim(ch.baseUrl ?? `https://bedrock-runtime.${region}.amazonaws.com`);
  const action = req.stream ? "invoke-with-response-stream" : "invoke";
  const url = `${base}/model/${encodeURIComponent(ch.upstreamModel)}/${action}`;

  // Bedrock takes the Messages body without model/stream, with the version (and betas) in the body.
  const { model: _m, stream: _s, ...rest } = req.body;
  const body: Json = { ...rest, anthropic_version: "bedrock-2023-05-31" };
  const beta = req.headers.get("anthropic-beta");
  if (beta) body.anthropic_beta = beta.split(",").map((b) => b.trim()).filter(Boolean);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: req.stream ? "application/vnd.amazon.eventstream" : "application/json",
  };
  const init: RequestInit = { method: "POST", headers, body: JSON.stringify(body) };

  if (ch.credentials.apiKey) {
    headers.authorization = `Bearer ${ch.credentials.apiKey}`;
    return { request: new Request(url, init), streamFormat: req.stream ? "aws-eventstream" : "sse" };
  }
  const aws = new AwsClient({
    accessKeyId: need(ch.credentials.accessKeyId, "accessKeyId"),
    secretAccessKey: need(ch.credentials.secretAccessKey, "secretAccessKey"),
    sessionToken: ch.credentials.sessionToken || undefined,
    service: "bedrock",
    region,
  });
  return { request: await aws.sign(url, init), streamFormat: req.stream ? "aws-eventstream" : "sse" };
}

async function buildVertex(req: RelayRequest, ch: ChannelRuntime): Promise<UpstreamCall> {
  const sa = parseServiceAccount(need(ch.credentials.serviceAccount, "serviceAccount"));
  const project = need(ch.config.projectId || sa.project_id, "config.projectId");
  const location = ch.config.location || "global";
  const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const base = trim(ch.baseUrl ?? `https://${host}`);
  const token = await getAccessToken(sa);
  const prefix = `${base}/v1/projects/${project}/locations/${location}/publishers`;

  if (req.protocol === "anthropic-messages") {
    const { model: _m, ...rest } = req.body;
    const url = `${prefix}/anthropic/models/${ch.upstreamModel}:${req.stream ? "streamRawPredict" : "rawPredict"}`;
    const headers: Record<string, string> = { authorization: `Bearer ${token}` };
    const beta = req.headers.get("anthropic-beta");
    if (beta) headers["anthropic-beta"] = beta;
    return { request: jsonRequest(url, headers, { ...rest, anthropic_version: "vertex-2023-10-16" }), streamFormat: "sse" };
  }
  const url = `${prefix}/google/models/${ch.upstreamModel}:${req.stream ? "streamGenerateContent?alt=sse" : "generateContent"}`;
  return { request: jsonRequest(url, { authorization: `Bearer ${token}` }, req.body), streamFormat: "sse" };
}

function buildGemini(req: RelayRequest, ch: ChannelRuntime): UpstreamCall {
  const base = trim(ch.baseUrl ?? "https://generativelanguage.googleapis.com");
  const action = req.stream ? "streamGenerateContent?alt=sse" : "generateContent";
  const url = `${base}/v1beta/models/${ch.upstreamModel}:${action}`;
  return {
    request: jsonRequest(url, { "x-goog-api-key": need(ch.credentials.apiKey, "apiKey") }, req.body),
    streamFormat: "sse",
  };
}

export async function buildUpstreamCall(req: RelayRequest, ch: ChannelRuntime): Promise<UpstreamCall> {
  if (!supports(ch.provider, req.protocol)) throw new Error(`${ch.provider} does not serve ${req.protocol}`);
  switch (ch.provider) {
    case "openai":
    case "azure_openai":
    case "openai_compatible":
      return buildOpenAI(req, ch);
    case "anthropic":
    case "anthropic_compatible":
      return buildAnthropic(req, ch);
    case "bedrock":
      return buildBedrock(req, ch);
    case "vertex":
      return buildVertex(req, ch);
    case "gemini":
      return buildGemini(req, ch);
  }
}
