import { appUrl } from "./url";

/** Model shown in each SDK example; an SDK without a model is left out (nothing serves it). */
export interface SnippetModels {
  openai?: string;
  anthropic?: string;
  gemini?: string;
}

const DEFAULT_MODELS: SnippetModels = { openai: "gpt-4o-mini", anthropic: "claude-sonnet-4-5", gemini: "gemini-2.5-flash" };

export function sdkSnippets(served: SnippetModels = DEFAULT_MODELS) {
  const base = appUrl();
  // Before any channel serves anything (a fresh install), show the generic examples.
  const models = served.openai || served.anthropic || served.gemini ? served : DEFAULT_MODELS;
  const tabs = [
    {
      api: "openai" as const,
      label: "OpenAI SDK",
      code: `from openai import OpenAI

client = OpenAI(base_url="${base}/v1", api_key="sk-tx-...")
reply = client.chat.completions.create(
    model="${models.openai}",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(reply.choices[0].message.content)`,
    },
    {
      api: "anthropic" as const,
      label: "Anthropic SDK",
      code: `import anthropic

client = anthropic.Anthropic(base_url="${base}", api_key="sk-tx-...")
msg = client.messages.create(
    model="${models.anthropic}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(msg.content[0].text)`,
    },
    {
      api: "gemini" as const,
      label: "Gemini SDK",
      code: `from google import genai

client = genai.Client(api_key="sk-tx-...", http_options={"base_url": "${base}"})
resp = client.models.generate_content(model="${models.gemini}", contents="Hello!")
print(resp.text)`,
    },
    {
      api: "openai" as const,
      label: "curl",
      code: `curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer sk-tx-..." \\
  -H "Content-Type: application/json" \\
  -d '{"model": "${models.openai}", "messages": [{"role": "user", "content": "Hello!"}]}'`,
    },
  ];
  return tabs.filter((t) => models[t.api]).map(({ label, code }) => ({ label, code }));
}

/** Batch quick-start code for the OpenAI and Anthropic SDKs. */
export function batchSnippets(openaiModel?: string, anthropicModel?: string) {
  const base = appUrl();
  const none = !openaiModel && !anthropicModel;
  const model = none ? "gpt-4.1-mini" : openaiModel;
  const claudeModel = none ? "claude-haiku-4-5" : anthropicModel;
  const tabs = [
    {
      label: "OpenAI SDK",
      code: `from openai import OpenAI
import json

client = OpenAI(base_url="${base}/v1", api_key="sk-tx-...")

# requests.jsonl: one request per line
with open("requests.jsonl", "w") as f:
    for i, text in enumerate(["first document", "second document"]):
        f.write(json.dumps({
            "custom_id": f"doc-{i}",
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {"model": "${model}",
                     "messages": [{"role": "user", "content": f"Summarise: {text}"}]},
        }) + "\\n")

file = client.files.create(file=open("requests.jsonl", "rb"), purpose="batch")
batch = client.batches.create(input_file_id=file.id,
                              endpoint="/v1/chat/completions",
                              completion_window="24h")

# later
batch = client.batches.retrieve(batch.id)
if batch.status == "completed":
    print(client.files.content(batch.output_file_id).text)`,
    },
    {
      label: "Anthropic SDK",
      code: `import anthropic

client = anthropic.Anthropic(base_url="${base}", api_key="sk-tx-...")

batch = client.messages.batches.create(requests=[
    {"custom_id": f"doc-{i}",
     "params": {"model": "${claudeModel}", "max_tokens": 512,
                "messages": [{"role": "user", "content": f"Summarise: {text}"}]}}
    for i, text in enumerate(["first document", "second document"])
])

# later
batch = client.messages.batches.retrieve(batch.id)
if batch.processing_status == "ended":
    for result in client.messages.batches.results(batch.id):
        print(result.custom_id, result.result.type)`,
    },
  ];
  // Leave out an API with no model to show (nothing serves batches through it).
  return tabs.filter((t) => (t.label === "OpenAI SDK" ? model : claudeModel));
}
