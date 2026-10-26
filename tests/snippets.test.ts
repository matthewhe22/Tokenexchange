import { describe, expect, it } from "vitest";
import { batchSnippets, sdkSnippets } from "@/lib/snippets";

describe("SDK examples", () => {
  it("only offers SDKs that some channel serves, with a served model", () => {
    const tabs = sdkSnippets({ openai: "llama-3.3-70b-instruct" });
    expect(tabs.map((t) => t.label)).toEqual(["OpenAI SDK", "curl"]);
    expect(tabs[0].code).toContain('model="llama-3.3-70b-instruct"');
  });
  it("falls back to generic examples before anything is served", () => {
    expect(sdkSnippets({}).map((t) => t.label)).toEqual(["OpenAI SDK", "Anthropic SDK", "Gemini SDK", "curl"]);
  });
  it("shows only the batch API that can run the model", () => {
    expect(batchSnippets(undefined, "claude-opus-5-5").map((t) => t.label)).toEqual(["Anthropic SDK"]);
    expect(batchSnippets().length).toBe(2);
  });
});
