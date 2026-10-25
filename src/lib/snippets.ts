import { appUrl } from "./url";

export function sdkSnippets() {
  const base = appUrl();
  return [
    {
      label: "OpenAI SDK",
      code: `from openai import OpenAI

client = OpenAI(base_url="${base}/v1", api_key="sk-tx-...")
reply = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello!"}],
)
print(reply.choices[0].message.content)`,
    },
    {
      label: "Anthropic SDK",
      code: `import anthropic

client = anthropic.Anthropic(base_url="${base}", api_key="sk-tx-...")
msg = client.messages.create(
    model="claude-sonnet-4-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)
print(msg.content[0].text)`,
    },
    {
      label: "Gemini SDK",
      code: `from google import genai

client = genai.Client(api_key="sk-tx-...", http_options={"base_url": "${base}"})
resp = client.models.generate_content(model="gemini-2.5-flash", contents="Hello!")
print(resp.text)`,
    },
    {
      label: "curl",
      code: `curl ${base}/v1/chat/completions \\
  -H "Authorization: Bearer sk-tx-..." \\
  -H "Content-Type: application/json" \\
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello!"}]}'`,
    },
  ];
}

/** Batch quick-start code for the OpenAI and Anthropic SDKs. */
export function batchSnippets(model = "gpt-4.1-mini", claudeModel = "claude-haiku-4-5") {
  const base = appUrl();
  return [
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
}
