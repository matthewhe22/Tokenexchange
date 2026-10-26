import Link from "next/link";
import { CodeBlock } from "@/components/code-block";
import { GuidePage, guideMetadata } from "@/components/guide-page";
import { batchDeals, perMillion, publicPriceList, snippetModels } from "@/lib/catalog";
import { appUrl } from "@/lib/url";

export const metadata = guideMetadata("openai-batch-api");

// Worked example size: 10,000 documents, ~1,000 tokens in and ~200 out each.
const DOCS = 10_000;
const IN_TOKENS = 1_000;
const OUT_TOKENS = 200;

const usd = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function BatchGuide() {
  const base = appUrl();
  const [prices, examples] = await Promise.all([publicPriceList(), snippetModels()]);
  const deals = batchDeals(prices);
  const model = examples.batch.openai ?? deals[0]?.model ?? "gpt-4.1-mini";
  const deal = deals.find((d) => d.model === model) ?? deals[0];
  const cost = (p: { input: number; output: number }) => (DOCS * (IN_TOKENS * p.input + OUT_TOKENS * p.output)) / 1e6;

  return (
    <GuidePage slug="openai-batch-api">
      <p>
        Many LLM jobs don&apos;t need an answer in seconds: classifying a backlog of tickets, summarising documents, generating
        embeddings, translating a catalogue, running evals. The Batch API takes a file of requests, runs them within 24 hours,
        and bills them at a lower batch rate. On Tenon it works with the official OpenAI SDK; you only change the base URL.
      </p>

      <h2>When to use a batch</h2>
      <ul>
        <li><strong>Use it</strong> for offline work: backfills, nightly jobs, dataset labelling, evals, bulk embeddings.</li>
        <li><strong>Don&apos;t</strong> use it for anything a user is waiting on. Most batches finish well inside the 24-hour window, but there is no latency guarantee.</li>
        <li>Each batch holds up to 50,000 requests, all to one endpoint (<code>/v1/chat/completions</code>, <code>/v1/responses</code> or <code>/v1/embeddings</code>) and one model.</li>
        <li>You pay only for requests that complete. Failed, expired and cancelled requests cost nothing.</li>
      </ul>

      <h2>What it costs</h2>
      {deal ? (
        <>
          <p>
            Batch prices for a few models today (USD per 1M tokens, input / output). The full list is on the{" "}
            <Link href="/batch">Batch API page</Link>.
          </p>
          <div className="card scroll">
            <table>
              <thead><tr><th>Model</th><th>Real-time</th><th>Batch</th><th>Saving</th></tr></thead>
              <tbody>
                {deals.slice(0, 6).map((d) => (
                  <tr key={d.model}>
                    <td className="mono">{d.model}</td>
                    <td className="muted">{perMillion(d.realtime.input)} / {perMillion(d.realtime.output)}</td>
                    <td><strong>{perMillion(d.batch.input)} / {perMillion(d.batch.output)}</strong></td>
                    <td>−{Math.floor(d.saving * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p>
            Example: summarising {DOCS.toLocaleString("en-US")} documents of about {IN_TOKENS.toLocaleString("en-US")} tokens each,
            with {OUT_TOKENS}-token summaries, on <code>{deal.model}</code> costs about <strong>{usd(cost(deal.batch))}</strong> as a
            batch, against {usd(cost(deal.realtime))} in real time.
          </p>
        </>
      ) : (
        <p>Batch prices are listed on the <Link href="/batch">Batch API page</Link>.</p>
      )}

      <h2>1. Set up the client</h2>
      <p>
        Install the SDK with <code>pip install openai</code> and create a key on the{" "}
        <Link href="/dashboard/keys">API keys</Link> page. The only change from OpenAI&apos;s own setup is the base URL.
      </p>
      <CodeBlock label="python" code={`from openai import OpenAI

client = OpenAI(base_url="${base}/v1", api_key="sk-tx-...")`} />

      <h2>2. Write the requests as JSONL</h2>
      <p>
        One JSON object per line. <code>custom_id</code> is your own identifier, used to match results back to inputs, since
        results don&apos;t come back in input order. Every line&apos;s <code>url</code> must be the batch&apos;s endpoint, and
        <code> body</code> is exactly what you&apos;d send to that endpoint in real time.
      </p>
      <CodeBlock label="python" code={`import json

documents = {"ticket-1001": "My invoice is wrong...", "ticket-1002": "How do I reset..."}

with open("requests.jsonl", "w") as f:
    for doc_id, text in documents.items():
        f.write(json.dumps({
            "custom_id": doc_id,
            "method": "POST",
            "url": "/v1/chat/completions",
            "body": {
                "model": "${model}",
                "max_tokens": 200,
                "messages": [
                    {"role": "system", "content": "Classify the ticket as billing, account or other. Reply with one word."},
                    {"role": "user", "content": text},
                ],
            },
        }) + "\\n")`} />
      <p className="muted">
        Upload files are limited to 4.5 MB. For a larger job, split the requests across several files and create one batch per file.
      </p>

      <h2>3. Upload the file and create the batch</h2>
      <CodeBlock label="python" code={`batch_file = client.files.create(file=open("requests.jsonl", "rb"), purpose="batch")

batch = client.batches.create(
    input_file_id=batch_file.id,
    endpoint="/v1/chat/completions",
    completion_window="24h",
)
print(batch.id, batch.status)`} />
      <p>
        Every line is checked when you create the batch: invalid JSON, a missing or duplicate <code>custom_id</code>, or a line
        for another endpoint is rejected with a 400 that names the line, before anything runs.
      </p>
      <p>
        Your balance must cover the batch&apos;s worst case, every request using its full <code>max_tokens</code>. That amount is
        held while the batch runs; when it finishes you are charged for the tokens actually used and the rest is released.
      </p>

      <h2>4. Wait for it to finish</h2>
      <p>
        A batch moves through <code>validating</code> and <code>in_progress</code> to one of <code>completed</code>,{" "}
        <code>failed</code>, <code>expired</code> or <code>cancelled</code>. Poll every few minutes; there is nothing to gain from
        polling faster.
      </p>
      <CodeBlock label="python" code={`import time

while True:
    batch = client.batches.retrieve(batch.id)
    print(batch.status, batch.request_counts)
    if batch.status in ("completed", "failed", "expired", "cancelled"):
        break
    time.sleep(300)`} />
      <p>To stop a batch, call <code>client.batches.cancel(batch.id)</code>; requests that already finished are still returned and billed.</p>

      <h2>5. Read the results</h2>
      <p>
        Successful requests are in <code>output_file_id</code>, failed ones in <code>error_file_id</code>. Both are JSONL with
        the same <code>custom_id</code>s you sent.
      </p>
      <CodeBlock label="python" code={`labels = {}
if batch.output_file_id:
    for line in client.files.content(batch.output_file_id).text.splitlines():
        row = json.loads(line)
        if row["response"]["status_code"] == 200:
            labels[row["custom_id"]] = row["response"]["body"]["choices"][0]["message"]["content"]

failed = []
if batch.error_file_id:
    failed = [json.loads(l)["custom_id"] for l in client.files.content(batch.error_file_id).text.splitlines()]

print(len(labels), "done,", len(failed), "to retry")`} />
      <p>Collect the failed <code>custom_id</code>s and submit them again as a new, smaller batch.</p>

      <h2>Tips</h2>
      <ul>
        <li>Make <code>custom_id</code> the key you store results under (a row id, a file path), so a retry can&apos;t create duplicates.</li>
        <li>Set <code>max_tokens</code> to what you really need. Output tokens cost more than input, and a tight cap keeps both the bill and the amount held from your balance small.</li>
        <li>Keep a long, shared system prompt identical across lines. Where the model supports prompt caching, repeated prefixes are cheaper.</li>
        <li>Try ten lines in real time first. A prompt bug found after 50,000 requests is expensive even at batch prices.</li>
        <li>Prefer the Anthropic SDK? Message Batches work too; see the <Link href="/docs#batch">docs</Link>.</li>
      </ul>
    </GuidePage>
  );
}
