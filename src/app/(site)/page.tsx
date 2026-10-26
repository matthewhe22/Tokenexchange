import Link from "next/link";
import { JsonLd, faqJsonLd } from "@/components/json-ld";
import { pageMetadata, SITE_NAME } from "@/lib/seo";
import { appUrl } from "@/lib/url";
import { SdkTabs } from "@/components/sdk-tabs";
import { batchDeals, maxBatchSaving, perMillion, publicPriceList, snippetModels } from "@/lib/catalog";
import { getDict } from "@/lib/i18n";
import { sdkSnippets } from "@/lib/snippets";

export const metadata = pageMetadata({
  path: "/",
  description:
    "One API key for GPT, Claude, Gemini, DeepSeek, Llama and Qwen. OpenAI- and Anthropic-compatible, pay per token with no subscription, plus a discounted Batch API.",
});

const TOOLS = ["Claude Code", "Codex CLI", "Cursor", "Cline", "LangChain", "LlamaIndex", "Vercel AI SDK", "LiteLLM"];

export default async function Home() {
  const [prices, t, examples] = await Promise.all([publicPriceList(), getDict(), snippetModels()]);
  const features = ([1, 2, 3, 4] as const).map((i) => ({ title: t[`home.f${i}.title`], body: t[`home.f${i}.body`] }));
  const featured = prices.filter((p) => p.vendor !== "Other").slice(0, 6);
  const deals = batchDeals(prices);
  const pct = maxBatchSaving(deals);
  return (
    <>
      <section className="hero site-inner">
        <p className="eyebrow">{t["home.eyebrow"]}</p>
        <h1 className="hero-title">{t["home.title"]}</h1>
        <p className="hero-sub">{t["home.sub"]}</p>
        <div className="row hero-cta">
          <Link href="/signup" className="btn btn-lg">{t["home.ctaKey"]}</Link>
          <Link href="/docs" className="btn btn-lg btn-ghost">{t["home.ctaDocs"]}</Link>
        </div>
        <div className="hero-code">
          <SdkTabs tabs={sdkSnippets(examples.live)} />
        </div>
      </section>

      <section className="site-inner section">
        <div className="card batch-promo">
          <div className="batch-promo-text">
            <span className="badge ok">{t["batch.badge"]}</span>
            <h2>{pct != null ? t["batch.promoTitle"].replace("{pct}", String(pct)) : t["batch.promoTitleNoPct"]}</h2>
            <p className="muted">{t["batch.promoBody"]}</p>
            <Link href="/batch" className="btn">{t["batch.promoCta"]}</Link>
          </div>
          {deals.length > 0 && (
            <table className="batch-promo-table">
              <thead>
                <tr><th>{t["pricing.model"]}</th><th colSpan={2}>{t["pricing.input"]} / 1M</th><th></th></tr>
              </thead>
              <tbody>
                {deals.slice(0, 4).map((d) => (
                  <tr key={d.model}>
                    <td className="mono">{d.model}</td>
                    <td className="muted"><s>{perMillion(d.realtime.input)}</s></td>
                    <td><strong>{perMillion(d.batch.input)}</strong></td>
                    <td><span className="badge ok">−{Math.floor(d.saving * 100)}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section className="site-inner section">
        <div className="feature-grid">
          {features.map((f) => (
            <div key={f.title} className="card feature">
              <h3>{f.title}</h3>
              <p className="muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="site-inner section">
        <h2 className="section-title">{t["home.tools"]}</h2>
        <div className="row tool-list">
          {TOOLS.map((t) => (
            <span key={t} className="chip">{t}</span>
          ))}
        </div>
      </section>

      {featured.length > 0 && (
        <section className="site-inner section">
          <h2 className="section-title">{t["home.pricing"]}</h2>
          <div className="card scroll">
            <table>
              <thead><tr><th>{t["pricing.model"]}</th><th>{t["pricing.input"]} / 1M</th><th>{t["pricing.output"]} / 1M</th></tr></thead>
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
          <p><Link href="/pricing">{t["home.pricingAll"]}</Link></p>
        </section>
      )}

      <section className="site-inner section">
        <h2 className="section-title">{t["home.faq"]}</h2>
        <div className="faq">
          {([1, 2, 3, 4] as const).map((i) => (
            <details key={i} className="card">
              <summary>{t[`home.q${i}`]}</summary>
              <p>
                {t[`home.a${i}`]}
                {i === 4 && <> <Link href="/privacy">{t["footer.privacy"]}</Link></>}
              </p>
            </details>
          ))}
        </div>
      </section>

      <JsonLd
        data={[
          { "@context": "https://schema.org", "@type": "Organization", name: SITE_NAME, url: appUrl(), logo: `${appUrl()}/apple-icon.png` },
          { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, url: appUrl() },
          faqJsonLd(([1, 2, 3, 4] as const).map((i) => ({ q: t[`home.q${i}`], a: t[`home.a${i}`] }))),
        ]}
      />
      <section className="site-inner section cta-band card">
        <h2 className="section-title" style={{ margin: 0 }}>{t["home.cta"]}</h2>
        <Link href="/signup" className="btn btn-lg">{t["home.ctaButton"]}</Link>
      </section>
    </>
  );
}
