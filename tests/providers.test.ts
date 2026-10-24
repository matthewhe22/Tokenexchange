import { describe, expect, it } from "vitest";
import { buildUpstreamCall } from "@/relay/providers";
import type { ChannelRuntime, RelayRequest } from "@/relay/types";

const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
  protocol: "anthropic-messages",
  model: "claude-test",
  stream: true,
  body: { model: "claude-test", stream: true, max_tokens: 5, messages: [] },
  headers: new Headers({ "anthropic-beta": "a, b" }),
  ...over,
});

const ch = (over: Partial<ChannelRuntime>): ChannelRuntime => ({
  id: 1, name: "c", provider: "bedrock", source: "cloud", baseUrl: null, config: {}, credentials: {}, upstreamModel: "x", ...over,
});

describe("buildUpstreamCall", () => {
  it("signs Bedrock requests with SigV4 and moves version/betas into the body", async () => {
    const call = await buildUpstreamCall(
      req(),
      ch({ config: { region: "us-west-2" }, credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" }, upstreamModel: "us.anthropic.claude-x-v1:0" }),
    );
    expect(call.streamFormat).toBe("aws-eventstream");
    expect(call.request.url).toBe("https://bedrock-runtime.us-west-2.amazonaws.com/model/us.anthropic.claude-x-v1%3A0/invoke-with-response-stream");
    expect(call.request.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-west-2\/bedrock\/aws4_request/);
    const body = await call.request.json();
    expect(body).toMatchObject({ anthropic_version: "bedrock-2023-05-31", anthropic_beta: ["a", "b"], max_tokens: 5 });
    expect(body.model).toBeUndefined();
    expect(body.stream).toBeUndefined();
  });

  it("builds Azure v1 URLs from the resource name", async () => {
    const call = await buildUpstreamCall(
      req({ protocol: "openai-chat", stream: false, body: { model: "gpt", messages: [] } }),
      ch({ provider: "azure_openai", config: { resource: "myres" }, credentials: { apiKey: "k" }, upstreamModel: "my-deployment" }),
    );
    expect(call.request.url).toBe("https://myres.openai.azure.com/openai/v1/chat/completions");
    expect(call.request.headers.get("api-key")).toBe("k");
    expect((await call.request.json()).model).toBe("my-deployment");
  });

  it("refuses protocols a provider cannot serve", async () => {
    await expect(buildUpstreamCall(req({ protocol: "gemini" }), ch({ provider: "anthropic" }))).rejects.toThrow(/does not serve/);
  });
});
