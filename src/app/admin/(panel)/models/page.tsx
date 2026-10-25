import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { deletePrice, savePrice } from "../../actions";
import { compareWithBenchmark, type PriceComparison } from "@/lib/benchmark";
import { perMillion } from "@/lib/catalog";

const pct = (d: number | null) => (d == null ? "—" : `${d > 0 ? "+" : ""}${(d * 100).toFixed(0)}%`);
const pair = (p: { input: number; output: number } | null) => (p ? `${perMillion(p.input)} / ${perMillion(p.output)}` : "—");

function DiffBadge({ d }: { d: number | null }) {
  if (d == null) return <span className="muted">—</span>;
  // Within ±2% counts as level with the market.
  return <span className={d > 0.02 ? "badge off" : "badge ok"}>{pct(d)}</span>;
}

function BenchmarkTable({ rows }: { rows: PriceComparison[] }) {
  return (
    <div className="card scroll">
      <table>
        <thead>
          <tr><th>Model</th><th>Our price in / out</th><th>OpenRouter in / out</th><th>vs OpenRouter</th><th>Our batch</th><th>Batch vs OpenRouter</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.model}>
              <td className="mono">{r.model}</td>
              <td>{pair(r.ours)}</td>
              <td>{r.bench ? <><span>{pair(r.bench)}</span><div className="muted mono" style={{ fontSize: 11 }}>{r.bench.id}</div></> : <span className="muted">no match — set the OpenRouter id below</span>}</td>
              <td><DiffBadge d={r.diff} /></td>
              <td>{pair(r.batch)}</td>
              <td><DiffBadge d={r.batchDiff} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type Price = typeof schema.modelPrices.$inferSelect;

function PriceFields({ p }: { p?: Price }) {
  const v = (x: number | null | undefined) => (x ?? "") as number | string;
  return (
    <>
      <div><label>Input $/1M</label><input name="inputPrice" type="number" step="any" required defaultValue={v(p?.inputPrice)} /></div>
      <div><label>Output $/1M</label><input name="outputPrice" type="number" step="any" required defaultValue={v(p?.outputPrice)} /></div>
      <div><label>Cache read $/1M</label><input name="cacheReadPrice" type="number" step="any" defaultValue={v(p?.cacheReadPrice)} /></div>
      <div><label>Cache write $/1M</label><input name="cacheWritePrice" type="number" step="any" defaultValue={v(p?.cacheWritePrice)} /></div>
      <div><label>Markup</label><input name="markup" type="number" step="any" defaultValue={p?.markup ?? 1} /></div>
      <div><label>Max output tokens</label><input name="maxOutputTokens" type="number" min={1} placeholder="32768" defaultValue={v(p?.maxOutputTokens)} /></div>
      <div><label>Long-context threshold (prompt tokens)</label><input name="tierThreshold" type="number" min={1} placeholder="e.g. 200000" defaultValue={v(p?.tierThreshold)} /></div>
      <div><label>Above threshold: input $/1M</label><input name="tierInputPrice" type="number" step="any" defaultValue={v(p?.tierInputPrice)} /></div>
      <div><label>Above threshold: output $/1M</label><input name="tierOutputPrice" type="number" step="any" defaultValue={v(p?.tierOutputPrice)} /></div>
      <div><label>Per unit $ (image / search / minute)</label><input name="perRequestPrice" type="number" step="any" defaultValue={v(p?.perRequestPrice)} /></div>
      <div><label>Batch markup (× list; upstream pays 0.5×)</label><input name="batchMarkup" type="number" step="any" placeholder="e.g. 0.8 — blank = no batch" defaultValue={v(p?.batchMarkup)} /></div>
      <div><label>Flex markup (× list; OpenAI only, upstream 0.5×)</label><input name="flexMarkup" type="number" step="any" placeholder="e.g. 0.8 — blank = no flex" defaultValue={v(p?.flexMarkup)} /></div>
      <div><label>OpenRouter id to compare with (blank = match by name)</label><input name="benchmarkId" placeholder="e.g. meta-llama/llama-4-scout" defaultValue={p?.benchmarkId ?? ""} /></div>
      <div><label>Priority price (× list, OpenAI&apos;s ratio)</label><input name="priorityMultiplier" type="number" step="any" placeholder="e.g. 1.8 — blank = no priority" defaultValue={v(p?.priorityMultiplier)} /></div>
    </>
  );
}

export default async function ModelsPage() {
  const prices = await getDb().select().from(schema.modelPrices).orderBy(asc(schema.modelPrices.model));
  const benchmark = await compareWithBenchmark(prices);
  const above = benchmark.rows.filter((r) => r.diff != null && r.diff > 0.02).length;
  return (
    <>
      <h1>Models &amp; prices</h1>
      <p className="muted">
        Enter the vendor&apos;s official list prices. Customers pay list × markup (× their pricing group). A model must be listed
        and enabled here before it can be called. Cache prices default to the input price. Max output caps requests that set
        no limit, and requests are held against the balance at that worst case. Above the long-context threshold the whole
        request uses the tier prices. Per-unit prices apply to image generation (per image), rerank (per search) and
        duration-billed transcription (per started minute).
      </p>
      <p className="muted">
        Discounted tiers: OpenAI, Anthropic and Azure charge half of list for batches (and OpenAI for <span className="mono">service_tier: &quot;flex&quot;</span>).
        Set what customers pay as a multiple of list — 0.8 sells at list − 20% for a 37.5% margin. Priority is billed at the
        priority multiple × markup. A <span className="mono">service_tier</span> the model is not offered on is removed from the
        request, so customers can never trigger a higher upstream price than they are billed.
      </p>
      <details className="card" open={above > 0}>
        <summary style={{ cursor: "pointer" }}>
          <strong>Compared with OpenRouter</strong>{" "}
          {benchmark.error ? (
            <span className="badge off">unavailable</span>
          ) : above > 0 ? (
            <span className="badge off">{above} model(s) priced above OpenRouter</span>
          ) : (
            <span className="badge ok">no model priced above OpenRouter</span>
          )}
        </summary>
        <p className="muted" style={{ marginTop: 8 }}>
          OpenRouter&apos;s public list prices (refreshed hourly), compared at 3 input tokens per output token. OpenRouter also
          charges a fee on card top-ups, which this ignores. Batch prices are compared with OpenRouter&apos;s real-time price.
          Models are matched by name; set the OpenRouter id on a model when the match is missing or wrong.
        </p>
        {benchmark.error ? <div className="notice error">{benchmark.error}</div> : <BenchmarkTable rows={benchmark.rows} />}
      </details>
      {prices.map((p) => (
        <details key={p.model} className="card">
          <summary className="row" style={{ cursor: "pointer", justifyContent: "space-between" }}>
            <span className="mono">{p.model}</span>
            <span className="muted">
              ${p.inputPrice} / ${p.outputPrice} per 1M · ×{p.markup}
              {p.tierThreshold ? ` · tier >${p.tierThreshold.toLocaleString()}` : ""}
              {p.perRequestPrice ? ` · $${p.perRequestPrice}/unit` : ""}
              {p.batchMarkup != null ? ` · batch ×${p.batchMarkup}` : ""}
              {p.flexMarkup != null ? ` · flex ×${p.flexMarkup}` : ""}
              {p.priorityMultiplier != null ? ` · priority ×${p.priorityMultiplier}` : ""}
              {p.enabled ? "" : " · disabled"}
            </span>
          </summary>
          <form action={savePrice} className="form-grid" style={{ marginTop: 12 }}>
            <input type="hidden" name="model" value={p.model} />
            <PriceFields p={p} />
            <div className="row"><input id={`en-${p.model}`} name="enabled" type="checkbox" defaultChecked={p.enabled} /><label htmlFor={`en-${p.model}`} style={{ margin: 0 }}>Enabled</label></div>
            <div className="row">
              <button className="secondary">Save</button>
              <button className="danger" formAction={deletePrice}>Delete</button>
            </div>
          </form>
        </details>
      ))}
      <h2>Add model</h2>
      <form action={savePrice} className="card form-grid">
        <div><label>Model (public name)</label><input name="model" required placeholder="gpt-4o" /></div>
        <PriceFields />
        <div className="row"><input id="new-enabled" name="enabled" type="checkbox" defaultChecked /><label htmlFor="new-enabled" style={{ margin: 0 }}>Enabled</label></div>
        <div><button>Add model</button></div>
      </form>
    </>
  );
}
