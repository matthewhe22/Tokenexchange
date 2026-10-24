import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { deletePrice, savePrice } from "../../actions";

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
    </>
  );
}

export default async function ModelsPage() {
  const prices = await getDb().select().from(schema.modelPrices).orderBy(asc(schema.modelPrices.model));
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
      {prices.map((p) => (
        <details key={p.model} className="card">
          <summary className="row" style={{ cursor: "pointer", justifyContent: "space-between" }}>
            <span className="mono">{p.model}</span>
            <span className="muted">
              ${p.inputPrice} / ${p.outputPrice} per 1M · ×{p.markup}
              {p.tierThreshold ? ` · tier >${p.tierThreshold.toLocaleString()}` : ""}
              {p.perRequestPrice ? ` · $${p.perRequestPrice}/unit` : ""}
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
