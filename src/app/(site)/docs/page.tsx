import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { SdkTabs } from "@/components/sdk-tabs";
import { batchSnippets, sdkSnippets } from "@/lib/snippets";
import { snippetModels } from "@/lib/catalog";
import { appUrl } from "@/lib/url";

export const metadata = pageMetadata({ path: "/docs", title: "Docs", description: "Connect to Tenon with the OpenAI, Anthropic or Gemini SDK, Claude Code, Codex CLI or curl: endpoints, authentication, the Batch API, errors and limits." });

export default async function DocsPage() {
  const base = appUrl();
  const examples = await snippetModels();
  return (
    <div className="site-inner section docs">
      <aside className="docs-toc">
        <a href="#start">Getting started</a>
        <a href="#endpoints">Endpoints</a>
        <a href="#sdks">SDK examples</a>
        <a href="#batch">Batch API</a>
        <a href="#tools">Coding tools</a>
        <a href="#errors">Errors</a>
        <a href="#limits">Limits</a>
      </aside>
      <article>
        <h1 className="page-title">Documentation</h1>

        <h2 id="start">Getting started</h2>
        <ol>
          <li><Link href="/signup">Create an account</Link> and verify your email.</li>
          <li>Add credit on the <Link href="/dashboard/billing">Billing</Link> page.</li>
          <li>Create a key on the <Link href="/dashboard/keys">API keys</Link> page. Keys start with <code>sk-tx-</code>.</li>
          <li>Point your SDK at <code>{base}</code> and use the key in place of the vendor&apos;s key.</li>
        </ol>

        <h2 id="endpoints">Endpoints</h2>
        <div className="card scroll">
          <table>
            <thead><tr><th>API</th><th>Path</th><th>Auth header</th></tr></thead>
            <tbody>
              <tr><td>OpenAI Chat Completions</td><td className="mono">POST /v1/chat/completions</td><td className="mono">Authorization: Bearer</td></tr>
              <tr><td>OpenAI Responses</td><td className="mono">POST /v1/responses</td><td className="mono">Authorization: Bearer</td></tr>
              <tr><td>OpenAI Embeddings</td><td className="mono">POST /v1/embeddings</td><td className="mono">Authorization: Bearer</td></tr>
              <tr><td>Anthropic Messages</td><td className="mono">POST /v1/messages</td><td className="mono">x-api-key or Bearer</td></tr>
              <tr><td>Gemini</td><td className="mono">POST /v1beta/models/&#123;model&#125;:generateContent<br />POST /v1beta/models/&#123;model&#125;:streamGenerateContent</td><td className="mono">x-goog-api-key or ?key=</td></tr>
              <tr><td>List models</td><td className="mono">GET /v1/models</td><td className="mono">any</td></tr>
              <tr><td>OpenAI Batch</td><td className="mono">POST /v1/files<br />POST /v1/batches · GET /v1/batches/&#123;id&#125;<br />GET /v1/files/&#123;id&#125;/content</td><td className="mono">Authorization: Bearer</td></tr>
              <tr><td>Anthropic Message Batches</td><td className="mono">POST /v1/messages/batches<br />GET /v1/messages/batches/&#123;id&#125;/results</td><td className="mono">x-api-key or Bearer</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted">
          Each endpoint speaks its vendor&apos;s protocol: send Claude models to <code>/v1/messages</code>, Gemini models to
          <code> /v1beta</code>, and OpenAI models to <code>/v1/chat/completions</code> or <code>/v1/responses</code>. The full model
          list and prices are on the <Link href="/pricing">pricing page</Link>.
        </p>

        <h2 id="sdks">SDK examples</h2>
        <SdkTabs tabs={sdkSnippets(examples.live)} />

        <h2 id="batch">Batch API</h2>
        <p>
          Asynchronous jobs at discounted batch rates, through the OpenAI Files + Batches API (<code>/v1/files</code>,
          <code> /v1/batches</code>) and Anthropic Message Batches (<code>/v1/messages/batches</code>). Up to 50,000 requests per
          batch; results within 24 hours; you pay only for requests that complete. Prices and a quick start are on the{" "}
          <Link href="/batch">Batch API page</Link>.
        </p>
        <SdkTabs tabs={batchSnippets(examples.batch.openai, examples.batch.anthropic)} />

        <h2 id="tools">Coding tools</h2>
        <h3>Claude Code</h3>
        <CodeBlock code={`export ANTHROPIC_BASE_URL=${base}\nexport ANTHROPIC_AUTH_TOKEN=sk-tx-...\nclaude`} />
        <h3>Codex CLI</h3>
        <p className="muted">Add a provider to <code>~/.codex/config.toml</code>, then export <code>TENON_API_KEY</code>:</p>
        <CodeBlock
          code={`model_provider = "tenon"
model = "gpt-4.1"

[model_providers.tenon]
name = "Tenon"
base_url = "${base}/v1"
env_key = "TENON_API_KEY"
wire_api = "responses"`}
        />
        <h3>Anything OpenAI-compatible</h3>
        <p className="muted">Set the base URL to <code>{base}/v1</code> and the API key to your <code>sk-tx-</code> key.</p>

        <h2 id="errors">Errors</h2>
        <div className="card scroll">
          <table>
            <thead><tr><th>Status</th><th>Meaning</th></tr></thead>
            <tbody>
              <tr><td>400</td><td>The request was rejected by the model provider; the message explains why.</td></tr>
              <tr><td>401</td><td>Missing, invalid, disabled or expired API key.</td></tr>
              <tr><td>402</td><td>Balance is used up, or the key reached its spending limit. Top up or raise the limit.</td></tr>
              <tr><td>403</td><td>The key is not allowed to use this model.</td></tr>
              <tr><td>404</td><td>Unknown model. Check the pricing page for exact names.</td></tr>
              <tr><td>429</td><td>Upstream capacity is temporarily exhausted. Retry with backoff.</td></tr>
              <tr><td>503</td><td>No upstream could serve the request right now. Retry shortly.</td></tr>
            </tbody>
          </table>
        </div>

        <h2 id="limits">Limits</h2>
        <ul className="muted">
          <li>Request bodies are limited to 4.5 MB. Send large images by URL rather than base64 where the API allows it.</li>
          <li>A single request can run for up to 5 minutes.</li>
          <li>Realtime (WebSocket) APIs are not available.</li>
        </ul>
      </article>
    </div>
  );
}
