import type { Metadata } from "next";
import { JsonLd, faqJsonLd } from "@/components/json-ld";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { SdkTabs } from "@/components/sdk-tabs";
import { batchDeals, maxBatchSaving, perMillion, publicPriceList, snippetModels } from "@/lib/catalog";
import { getDict } from "@/lib/i18n";
import { batchSnippets } from "@/lib/snippets";

export const metadata: Metadata = pageMetadata({
  path: "/batch",
  title: "Batch API",
  description:
    "Run GPT, Claude and open-model requests as asynchronous batches with the OpenAI or Anthropic SDK, at discounted batch rates. Up to 50,000 requests per job, results within 24 hours.",
});

export default async function BatchPage() {
  const [prices, t, examples] = await Promise.all([publicPriceList(), getDict(), snippetModels()]);
  const deals = batchDeals(prices);
  const pct = maxBatchSaving(deals);
  const withPct = (s: string) => s.replace("{pct}", String(pct));
  const features = ([1, 2, 3, 4, 5, 6] as const).map((i) => ({ title: t[`batch.f${i}.title`], body: t[`batch.f${i}.body`] }));

  return (
    <>
      <section className="hero site-inner">
        <p className="eyebrow">{t["batch.badge"]}</p>
        <h1 className="hero-title">{t["batch.title"]}</h1>
        {pct != null && <p className="saving-headline">−{pct}%</p>}
        <p className="hero-sub">{pct != null ? withPct(t["batch.lead"]) : t["batch.leadNoPct"]}</p>
        <div className="row hero-cta">
          <Link href="/signup" className="btn btn-lg">{t["batch.ctaStart"]}</Link>
          <a href="#quick-start" className="btn btn-lg btn-ghost">{t["batch.ctaDocs"]}</a>
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
        <h2 className="section-title">{t["batch.prices"]}</h2>
        {deals.length ? (
          <div className="card scroll">
            <table>
              <thead>
                <tr><th>{t["pricing.model"]}</th><th>{t["batch.realtime"]}</th><th>{t["batch.batch"]}</th><th>{t["batch.save"]}</th></tr>
              </thead>
              <tbody>
                {deals.map((d) => (
                  <tr key={d.model}>
                    <td className="mono">{d.model}</td>
                    <td className="muted">{perMillion(d.realtime.input)} / {perMillion(d.realtime.output)}</td>
                    <td><strong>{perMillion(d.batch.input)} / {perMillion(d.batch.output)}</strong></td>
                    <td><span className="badge ok">−{Math.floor(d.saving * 100)}%</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">{t["batch.noPrices"]}</p>
        )}
        <p className="muted" style={{ fontSize: 13 }}>USD per 1M tokens.</p>
      </section>

      <section className="site-inner section">
        <h2 className="section-title">{t["batch.how"]}</h2>
        <ol className="steps">
          {([1, 2, 3, 4] as const).map((i) => (
            <li key={i} className="card">{t[`batch.step${i}`]}</li>
          ))}
        </ol>
      </section>

      <section id="quick-start" className="site-inner section">
        <h2 className="section-title">{t["batch.ctaDocs"]}</h2>
        <SdkTabs tabs={batchSnippets(examples.batch.openai, examples.batch.anthropic)} />
      </section>

      <section className="site-inner section">
        <h2 className="section-title">{t["batch.useCases"]}</h2>
        <div className="row tool-list">
          {t["batch.uc"].split("|").map((u) => (
            <span key={u} className="chip">{u}</span>
          ))}
        </div>
        <h2 className="section-title" style={{ marginTop: 32 }}>{t["batch.limits"]}</h2>
        <p className="muted">{t["batch.limitsBody"]}</p>
      </section>

      <section className="site-inner section">
        <h2 className="section-title">{t["home.faq"]}</h2>
        <div className="faq">
          {([1, 2, 3] as const).map((i) => (
            <details key={i} className="card">
              <summary>{t[`batch.faq${i}q`]}</summary>
              <p>{t[`batch.faq${i}a`]}</p>
            </details>
          ))}
        </div>
      </section>

      <JsonLd data={faqJsonLd(([1, 2, 3] as const).map((i) => ({ q: t[`batch.faq${i}q`], a: t[`batch.faq${i}a`] })))} />
      <section className="site-inner section cta-band card">
        <h2 className="section-title" style={{ margin: 0 }}>{pct != null ? withPct(t["batch.promoTitle"]) : t["batch.promoTitleNoPct"]}</h2>
        <Link href="/signup" className="btn btn-lg">{t["home.ctaButton"]}</Link>
      </section>
    </>
  );
}
