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
