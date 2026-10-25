import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, schema } from "@/db";
import { ChannelForm } from "@/components/channel-form";
import { ChannelTest } from "@/components/channel-test";
import { decrypt } from "@/lib/crypto";
import { deleteChannel, saveChannel } from "../../../actions";
import { formatDate, formatDateTime } from "@/lib/time";
import { cached } from "@/lib/cache";
import { getPrices } from "@/lib/billing";
import { catalogKind, fetchCatalog, suggestPublicName, type CatalogModel } from "@/lib/upstream-catalog";
import { CatalogRefresh } from "@/components/catalog-refresh";
import { importCatalogModels } from "../../../actions";

type Channel = typeof schema.channels.$inferSelect;

/** Cost per 1M tokens at 3 input : 1 output, a typical chat mix. */
const blended = (input: number, output: number) => (3 * input + output) / 4;

async function CatalogSection({ channel }: { channel: Channel }) {
  let catalog: CatalogModel[] = [];
  let error: string | null = null;
  try {
    const ch = { ...channel, credentials: JSON.parse(decrypt(channel.credentials)) as Record<string, string> };
    catalog = await cached(`catalog:${channel.id}`, () => fetchCatalog(ch), 10 * 60_000);
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const prices = await getPrices();
  const served = new Map(channel.models.map((m) => [channel.modelMapping[m] ?? m, m]));
  return (
    <>
      <h2>Upstream catalog</h2>
      <p className="muted">
        Live models and prices from {channel.name}. Importing a model adds it to this channel with its upstream cost, and
        creates a price at the upstream&apos;s price × markup if the public name has none. Use the same public name on
        several channels to route one model across providers (give the cheapest the highest priority). Margin assumes
        3 input tokens per output token.
      </p>
      <CatalogRefresh id={channel.id} />
      {error ? (
        <div className="notice error">Could not load the catalog: {error}</div>
      ) : (
        <details className="card" style={{ marginTop: 12 }}>
          <summary style={{ cursor: "pointer" }}>{catalog.length} text models — choose models to import</summary>
          <form action={importCatalogModels} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={channel.id} />
            <div className="row" style={{ flexWrap: "wrap", marginBottom: 12 }}>
              <label style={{ margin: 0 }}>Markup for new prices</label>
              <input name="markup" type="number" step="any" defaultValue={1.2} style={{ width: 90 }} />
              <label style={{ margin: 0 }}>Batch markup (blank = no batch)</label>
              <input name="batchMarkup" type="number" step="any" placeholder="e.g. 0.9" style={{ width: 90 }} />
              <button>Import selected</button>
            </div>
            <div className="scroll">
              <table>
                <thead>
                  <tr><th></th><th>Upstream model</th><th>Public name</th><th>In / out / cached $ per 1M</th><th>Context</th><th>Our price</th><th>Margin</th></tr>
                </thead>
                <tbody>
                  {catalog.map((m) => {
                    const pub = served.get(m.id);
                    const p = pub ? prices.get(pub) : undefined;
                    const sell = p ? blended(p.inputPrice * p.markup, p.outputPrice * p.markup) : null;
                    const cost = blended(m.cost.input, m.cost.output);
                    return (
                      <tr key={m.id}>
                        <td><input type="checkbox" name="pick" value={m.id} disabled={!!pub} /></td>
                        <td className="mono">{m.id}</td>
                        <td>{pub ? <span className="mono">{pub}</span> : <input name={`name:${m.id}`} defaultValue={suggestPublicName(m.id)} style={{ minWidth: 200 }} />}</td>
                        <td>${m.cost.input} / ${m.cost.output}{m.cost.cacheRead != null ? ` / $${m.cost.cacheRead}` : ""}</td>
                        <td>{m.contextSize ? m.contextSize.toLocaleString() : "—"}</td>
                        <td>{sell != null ? `$${sell.toFixed(4)}` : "—"}</td>
                        <td>{sell ? `${(((sell - cost) / sell) * 100).toFixed(1)}%` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </form>
        </details>
      )}
    </>
  );
}

export default async function ChannelPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ imported?: string }>;
}) {
  const { id } = await params;
  const { imported } = await searchParams;
  const [c] = await getDb().select().from(schema.channels).where(eq(schema.channels.id, Number(id)));
  if (!c) notFound();

  let stored: string[] = [];
  try {
    stored = Object.keys(JSON.parse(decrypt(c.credentials)));
  } catch {
    // undecryptable (ENCRYPTION_KEY changed): admin must re-enter credentials
  }

  return (
    <>
      <h1>{c.name}</h1>
      {c.lastError && (
        <div className="notice mono">
          Last error {c.lastErrorAt ? formatDateTime(c.lastErrorAt, { seconds: true }) : ""}: {c.lastError}
        </div>
      )}
      {imported && <div className="notice">Imported {imported} model(s). Check their prices in Models &amp; prices.</div>}
      {catalogKind(c) && <CatalogSection channel={c} />}
      <h2>Test</h2>
      <ChannelTest id={c.id} models={c.models} />
      <h2>Edit</h2>
      <ChannelForm
        action={saveChannel}
        value={{
          id: c.id,
          name: c.name,
          provider: c.provider,
          source: c.source,
          baseUrl: c.baseUrl ?? "",
          config: c.config,
          models: c.models,
          modelMapping: c.modelMapping,
          priority: c.priority,
          weight: c.weight,
          costMultiplier: c.costMultiplier,
          modelCosts: c.modelCosts,
          fixedCostHourly: c.fixedCostHourly,
          capacityTpm: c.capacityTpm,
          commitmentEndsAt: c.commitmentEndsAt ? formatDate(c.commitmentEndsAt) : "",
          enabled: c.enabled,
          storedCredentials: stored,
        }}
      />
      <form action={deleteChannel}>
        <input type="hidden" name="id" value={c.id} />
        <button className="danger">Delete channel</button>
      </form>
    </>
  );
}
