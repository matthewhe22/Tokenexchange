import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { GuidePage, guideMetadata } from "@/components/guide-page";
import { snippetModels } from "@/lib/catalog";
import { appUrl } from "@/lib/url";

export const metadata = guideMetadata("openai-compatible");

export default async function OpenAICompatibleGuide() {
  const base = appUrl();
  const model = (await snippetModels()).live.openai ?? "gpt-4.1-mini";

  return (
    <GuidePage slug="openai-compatible">
      <p>
        Tenon speaks the OpenAI API, so anything built on the OpenAI SDK, or offering an &quot;OpenAI-compatible&quot; provider
        setting, can use it with two changes: the base URL becomes <code>{base}/v1</code> and the API key becomes your Tenon key
        (it starts with <code>sk-tx-</code>). Your code, prompts and response handling stay the same.
      </p>

      <h2>The quickest way: environment variables</h2>
      <p>The official OpenAI SDKs read both settings from the environment, so many apps switch without a code change:</p>
      <CodeBlock label="bash" code={`export OPENAI_BASE_URL=${base}/v1
export OPENAI_API_KEY=sk-tx-...`} />

      <h2>Python</h2>
      <CodeBlock label="python" code={`from openai import OpenAI

client = OpenAI(base_url="${base}/v1", api_key="sk-tx-...")

reply = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Write a haiku about tenon joints."}],
)
print(reply.choices[0].message.content)`} />

      <h2>Node.js / TypeScript</h2>
      <CodeBlock label="typescript" code={`import OpenAI from "openai";

const client = new OpenAI({ baseURL: "${base}/v1", apiKey: process.env.TENON_API_KEY });

const reply = await client.chat.completions.create({
  model: "${model}",
  messages: [{ role: "user", content: "Write a haiku about tenon joints." }],
});
console.log(reply.choices[0].message.content);`} />

      <h2>Streaming</h2>
      <p>Streaming works as it does with OpenAI. Add <code>stream_options</code> to get token usage in the last chunk:</p>
      <CodeBlock label="python" code={`stream = client.chat.completions.create(
    model="${model}",
    messages=[{"role": "user", "content": "Count to five."}],
    stream=True,
    stream_options={"include_usage": True},
)
for chunk in stream:
    if chunk.choices and chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="", flush=True)`} />

      <h2>LangChain</h2>
      <CodeBlock label="python" code={`from langchain_openai import ChatOpenAI

llm = ChatOpenAI(model="${model}", base_url="${base}/v1", api_key="sk-tx-...")
print(llm.invoke("Hello!").content)`} />

      <h2>Vercel AI SDK</h2>
      <CodeBlock label="typescript" code={`import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const tenon = createOpenAI({ baseURL: "${base}/v1", apiKey: process.env.TENON_API_KEY });

const { text } = await generateText({ model: tenon.chat("${model}"), prompt: "Hello!" });`} />

      <h2>Apps with an OpenAI-compatible setting</h2>
      <p>
        Chat front ends, IDE extensions and agent frameworks usually ask for three things. Use these values, and pick the
        model from the <Link href="/pricing">pricing page</Link>:
      </p>
      <div className="card scroll">
        <table>
          <tbody>
            <tr><td>Base URL / API host</td><td className="mono">{base}/v1</td></tr>
            <tr><td>API key</td><td className="mono">sk-tx-...</td></tr>
            <tr><td>Model</td><td className="mono">{model}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="muted">If an app asks for the host without <code>/v1</code> and appends it itself, enter <code>{base}</code>.</p>

      <h2>List the available models</h2>
      <p>Tools that offer a model picker call <code>GET /v1/models</code>, which returns every model Tenon currently serves:</p>
      <CodeBlock label="bash" code={`curl ${base}/v1/models -H "Authorization: Bearer sk-tx-..."`} />

      <h2>Errors and retries</h2>
      <p>
        Errors use OpenAI&apos;s format and status codes, so existing retry logic keeps working. The SDKs already retry 429 and
        5xx responses with backoff. A 402 means the balance or the key&apos;s spending limit is used up; retrying won&apos;t help,
        so top up on the <Link href="/dashboard/billing">Billing</Link> page. The full table is in the{" "}
        <Link href="/docs#errors">docs</Link>.
      </p>

      <h2>Claude and Gemini models</h2>
      <p>
        Prefer the vendors&apos; own SDKs? Tenon also serves the Anthropic Messages API at <code>{base}</code> and the Gemini API
        at <code>{base}/v1beta</code> for the models it carries; see the <Link href="/docs#sdks">SDK examples</Link>. For bulk
        jobs at batch prices, see the <Link href="/guides/openai-batch-api">Batch API guide</Link>.
      </p>
    </GuidePage>
  );
}
