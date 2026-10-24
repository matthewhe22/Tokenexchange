import { asc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { deletePrice, savePrice } from "../../actions";

export default async function ModelsPage() {
  const prices = await getDb().select().from(schema.modelPrices).orderBy(asc(schema.modelPrices.model));
  return (
    <>
      <h1>Models &amp; prices</h1>
      <p className="muted">
        Enter the vendor&apos;s official list price in USD per 1M tokens. Customers pay list × markup; a model must be listed and
        enabled here before it can be called. Cache prices default to the input price when blank.
      </p>
      <div className="card scroll">
        <table>
          <thead>
            <tr><th>Model</th><th>Input</th><th>Output</th><th>Cache read</th><th>Cache write</th><th>Markup</th><th>Enabled</th><th></th></tr>
          </thead>
          <tbody>
            {prices.map((p) => (
              <tr key={p.model}>
                <td colSpan={8} style={{ padding: 0 }}>
                  <form action={savePrice} className="row" style={{ padding: "6px", flexWrap: "nowrap" }}>
                    <input name="model" defaultValue={p.model} readOnly className="mono" style={{ minWidth: 200 }} />
                    <input name="inputPrice" type="number" step="any" defaultValue={p.inputPrice} />
                    <input name="outputPrice" type="number" step="any" defaultValue={p.outputPrice} />
                    <input name="cacheReadPrice" type="number" step="any" defaultValue={p.cacheReadPrice ?? ""} />
                    <input name="cacheWritePrice" type="number" step="any" defaultValue={p.cacheWritePrice ?? ""} />
                    <input name="markup" type="number" step="any" defaultValue={p.markup} />
                    <input name="enabled" type="checkbox" defaultChecked={p.enabled} />
                    <button className="secondary">Save</button>
                    <button className="danger" formAction={deletePrice}>Delete</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Add model</h2>
      <form action={savePrice} className="card form-grid">
        <div><label>Model (public name)</label><input name="model" required placeholder="gpt-4o" /></div>
        <div><label>Input $/1M</label><input name="inputPrice" type="number" step="any" required /></div>
        <div><label>Output $/1M</label><input name="outputPrice" type="number" step="any" required /></div>
        <div><label>Cache read $/1M</label><input name="cacheReadPrice" type="number" step="any" /></div>
        <div><label>Cache write $/1M</label><input name="cacheWritePrice" type="number" step="any" /></div>
        <div><label>Markup</label><input name="markup" type="number" step="any" defaultValue={1} /></div>
        <div className="row"><input id="new-enabled" name="enabled" type="checkbox" defaultChecked /><label htmlFor="new-enabled" style={{ margin: 0 }}>Enabled</label></div>
        <div><button>Add model</button></div>
      </form>
    </>
  );
}
