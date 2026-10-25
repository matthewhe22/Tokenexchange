import Link from "next/link";
import { batchDeals, maxBatchSaving, perMillion, publicPriceList, type Vendor } from "@/lib/catalog";
import { getDict } from "@/lib/i18n";

export const metadata = { title: "Pricing" };

export default async function PricingPage() {
  const [prices, t] = await Promise.all([publicPriceList(), getDict()]);
  const vendors = [...new Set(prices.map((p) => p.vendor))] as Vendor[];
  const pct = maxBatchSaving(batchDeals(prices));
  return (
    <div className="site-inner section">
      <h1 className="page-title">{t["pricing.title"]}</h1>
      <p className="lead">{t["pricing.lead"]}</p>
      {pct != null && (
        <div className="notice row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span><span className="badge ok">{t["batch.badge"]}</span> {t["batch.promoTitle"].replace("{pct}", String(pct))}</span>
          <Link href="/batch">{t["batch.promoCta"]} →</Link>
        </div>
      )}
      {vendors.map((v) => (
        <section key={v}>
          <h2>{v}</h2>
          <div className="card scroll">
            <table>
              <thead>
                <tr><th>{t["pricing.model"]}</th><th>{t["pricing.input"]}</th><th>{t["pricing.cached"]}</th><th>{t["pricing.cacheWrite"]}</th><th>{t["pricing.output"]}</th></tr>
              </thead>
              <tbody>
                {prices.filter((p) => p.vendor === v).map((p) => (
                  <tr key={p.model}>
                    <td className="mono">{p.model}</td>
                    <td>{perMillion(p.input)}</td>
                    <td>{perMillion(p.cacheRead)}</td>
                    <td>{perMillion(p.cacheWrite)}</td>
                    <td>
                      {perMillion(p.output)}
                      {p.perUnit != null && <div className="muted">+ ${p.perUnit.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")} per unit</div>}
                      {p.tier && (
                        <div className="muted">
                          Prompts over {p.tier.threshold.toLocaleString()} tokens: {perMillion(p.tier.input)} in / {perMillion(p.tier.output)} out
                        </div>
                      )}
                      {p.batch && <div className="muted">Batch API: {perMillion(p.batch.input)} in / {perMillion(p.batch.output)} out</div>}
                      {p.flex && <div className="muted">Flex: {perMillion(p.flex.input)} in / {perMillion(p.flex.output)} out</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!prices.length && <p className="muted">{t["pricing.soon"]}</p>}
      <h2>{t["pricing.how"]}</h2>
      <ul className="muted">
        {(["pricing.how1", "pricing.how2", "pricing.how3", "pricing.how4"] as const).map((k) => (
          <li key={k}>{t[k]}</li>
        ))}
      </ul>
      <p><Link href="/signup" className="btn">{t["nav.getKey"]}</Link></p>
    </div>
  );
}
