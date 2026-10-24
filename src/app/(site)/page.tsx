import Link from "next/link";
import { SdkTabs } from "@/components/sdk-tabs";
import { perMillion, publicPriceList } from "@/lib/catalog";
import { sdkSnippets } from "@/lib/snippets";

const FEATURES = [
  {
    title: "Native APIs, not a lowest common denominator",
    body: "Call OpenAI Chat & Responses, Anthropic Messages and Gemini through their own SDKs. Streaming, tools, prompt caching and thinking work as documented.",
  },
  {
    title: "Redundant capacity",
    body: "Every model is served from several upstream accounts across vendors and cloud platforms. If one is rate-limited or down, your request moves to the next.",
  },
  {
    title: "Pay only for tokens",
    body: "No subscription and no minimum spend. Top up from $5 with a card, and see what every request cost — down to cached tokens.",
  },
  {
    title: "Keys you control",
    body: "Separate keys per project or teammate, each with an optional spending cap and model allow-list. Disable a key instantly.",
  },
];

const TOOLS = ["Claude Code", "Codex CLI", "Cursor", "Cline", "LangChain", "LlamaIndex", "Vercel AI SDK", "LiteLLM"];

export default async function Home() {
  const prices = await publicPriceList();
  const featured = prices.filter((p) => p.vendor !== "Other").slice(0, 6);
  return (
    <>
      <section className="hero site-inner">
        <p className="eyebrow">OpenAI · Anthropic · Google</p>
        <h1 className="hero-title">One API key for every frontier model</h1>
        <p className="hero-sub">
          Use GPT, Claude and Gemini from the SDKs you already have. Change the base URL, keep your code, and pay per token
          from a single balance.
        </p>
        <div className="row hero-cta">
          <Link href="/signup" className="btn btn-lg">Get an API key</Link>
          <Link href="/docs" className="btn btn-lg btn-ghost">Read the docs</Link>
        </div>
        <div className="hero-code">
          <SdkTabs tabs={sdkSnippets()} />
        </div>
      </section>

      <section className="site-inner section">
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="card feature">
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="site-inner section">
        <h2 className="section-title">Works with the tools you use</h2>
        <div className="row tool-list">
          {TOOLS.map((t) => (
            <span key={t} className="chip">{t}</span>
          ))}
        </div>
      </section>

      {featured.length > 0 && (
        <section className="site-inner section">
          <h2 className="section-title">Simple per-token pricing</h2>
          <div className="card scroll">
            <table>
              <thead><tr><th>Model</th><th>Input / 1M</th><th>Output / 1M</th></tr></thead>
              <tbody>
                {featured.map((p) => (
                  <tr key={p.model}>
                    <td className="mono">{p.model}</td>
                    <td>{perMillion(p.input)}</td>
                    <td>{perMillion(p.output)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p><Link href="/pricing">See all models and cache pricing →</Link></p>
        </section>
      )}

      <section className="site-inner section">
        <h2 className="section-title">Questions</h2>
        <div className="faq">
          <details className="card">
            <summary>Do I need to change my code?</summary>
            <p>Only the base URL and the API key. Requests and responses use each vendor&apos;s own format.</p>
          </details>
          <details className="card">
            <summary>How is usage billed?</summary>
            <p>Per token, using the token counts the model provider reports — including cached and reasoning tokens — at the rates on the pricing page. Failed requests are free.</p>
          </details>
          <details className="card">
            <summary>Does my credit expire?</summary>
            <p>No. Unused credit stays on your account.</p>
          </details>
          <details className="card">
            <summary>Do you store my prompts?</summary>
            <p>No. We log metadata needed for billing — model, token counts, cost, latency — but not request or response content. See the <Link href="/privacy">privacy policy</Link>.</p>
          </details>
        </div>
      </section>

      <section className="site-inner section cta-band card">
        <h2 className="section-title" style={{ margin: 0 }}>Start building in two minutes</h2>
        <Link href="/signup" className="btn btn-lg">Create a free account</Link>
      </section>
    </>
  );
}
