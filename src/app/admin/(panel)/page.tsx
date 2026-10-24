import { desc, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatUsd } from "@/lib/money";

export default async function Dashboard() {
  const db = getDb();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const l = schema.usageLogs;

  const [today] = await db
    .select({
      requests: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${l.status} >= 400)::int`,
      revenue: sql<number>`coalesce(sum(${l.cost}), 0)::bigint`,
      upstream: sql<number>`coalesce(sum(${l.upstreamCost}), 0)::bigint`,
      tokens: sql<number>`coalesce(sum(${l.inputTokens} + ${l.outputTokens} + ${l.cacheReadTokens} + ${l.cacheWriteTokens}), 0)::bigint`,
    })
    .from(l)
    .where(gte(l.createdAt, since));

  const bySource = await db
    .select({
      source: schema.channels.source,
      requests: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${l.cost}), 0)::bigint`,
      upstream: sql<number>`coalesce(sum(${l.upstreamCost}), 0)::bigint`,
    })
    .from(l)
    .innerJoin(schema.channels, sql`${schema.channels.id} = ${l.channelId}`)
    .where(gte(l.createdAt, since))
    .groupBy(schema.channels.source);

  const channels = await db.select().from(schema.channels).orderBy(desc(schema.channels.failCount));
  const revenue = Number(today.revenue);
  const upstream = Number(today.upstream);

  return (
    <>
      <h1>Today (UTC)</h1>
      <div className="grid">
        <Stat label="Requests" value={String(today.requests)} />
        <Stat label="Errors" value={String(today.errors)} />
        <Stat label="Tokens" value={Number(today.tokens).toLocaleString()} />
        <Stat label="Revenue" value={formatUsd(revenue)} />
        <Stat label="Upstream cost (est.)" value={formatUsd(upstream)} />
        <Stat label="Gross margin" value={`${formatUsd(revenue - upstream)}${revenue ? ` (${(((revenue - upstream) / revenue) * 100).toFixed(1)}%)` : ""}`} />
      </div>

      <h2>By procurement source</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Source</th><th>Requests</th><th>Revenue</th><th>Upstream</th><th>Margin</th></tr></thead>
          <tbody>
            {bySource.map((r) => (
              <tr key={r.source}>
                <td>{r.source}</td>
                <td>{r.requests}</td>
                <td>{formatUsd(Number(r.revenue))}</td>
                <td>{formatUsd(Number(r.upstream))}</td>
                <td>{formatUsd(Number(r.revenue) - Number(r.upstream))}</td>
              </tr>
            ))}
            {!bySource.length && <tr><td colSpan={5} className="muted">No traffic yet today.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Channel health</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Channel</th><th>Source</th><th>Status</th><th>Consecutive failures</th><th>Last error</th></tr></thead>
          <tbody>
            {channels.map((c) => (
              <tr key={c.id}>
                <td><a href={`/admin/channels/${c.id}`}>{c.name}</a></td>
                <td>{c.source}</td>
                <td>{c.enabled ? <span className="badge ok">enabled</span> : <span className="badge off">disabled</span>}</td>
                <td>{c.failCount}</td>
                <td className="mono">{c.lastError ? `${c.lastErrorAt?.toISOString()} ${c.lastError.slice(0, 160)}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
