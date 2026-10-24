import Link from "next/link";
import { perMillion, publicPriceList, type Vendor } from "@/lib/catalog";
import { TOPUP_MIN_USD } from "@/lib/stripe";

export const metadata = { title: "Pricing · TokenExchange" };

export default async function PricingPage() {
  const prices = await publicPriceList();
  const vendors = [...new Set(prices.map((p) => p.vendor))] as Vendor[];
  return (
    <div className="site-inner section">
      <h1 className="page-title">Pricing</h1>
      <p className="lead">
        Pay as you go in USD per 1 million tokens. No subscription, no minimum commitment; top up from ${TOPUP_MIN_USD}.
      </p>
      {vendors.map((v) => (
        <section key={v}>
          <h2>{v}</h2>
          <div className="card scroll">
            <table>
              <thead>
                <tr><th>Model</th><th>Input</th><th>Cached input</th><th>Cache write</th><th>Output</th></tr>
              </thead>
              <tbody>
                {prices.filter((p) => p.vendor === v).map((p) => (
                  <tr key={p.model}>
                    <td className="mono">{p.model}</td>
                    <td>{perMillion(p.input)}</td>
                    <td>{perMillion(p.cacheRead)}</td>
                    <td>{perMillion(p.cacheWrite)}</td>
                    <td>{perMillion(p.output)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!prices.length && <p className="muted">Model pricing will be published soon.</p>}
      <h2>How billing works</h2>
      <ul className="muted">
        <li>Token counts come from the model provider&apos;s own usage report for each request.</li>
        <li>Reasoning (&quot;thinking&quot;) tokens are billed as output tokens.</li>
        <li>Requests that fail upstream are not charged.</li>
        <li>Each request is charged in fractions of a cent and deducted from your prepaid balance.</li>
      </ul>
      <p><Link href="/signup" className="btn">Get an API key</Link></p>
    </div>
  );
}
