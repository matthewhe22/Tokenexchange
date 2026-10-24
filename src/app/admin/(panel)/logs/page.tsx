import { and, desc, eq, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatUsd } from "@/lib/money";

export default async function LogsPage({ searchParams }: { searchParams: Promise<{ user?: string; model?: string; errors?: string }> }) {
  const sp = await searchParams;
  const l = schema.usageLogs;
  const where: SQL[] = [];
  if (sp.user) where.push(eq(l.userId, Number(sp.user)));
  if (sp.model) where.push(eq(l.model, sp.model));
  const rows = await getDb()
    .select({ log: l, channel: schema.channels.name, email: schema.users.email })
    .from(l)
    .leftJoin(schema.channels, eq(schema.channels.id, l.channelId))
    .leftJoin(schema.users, eq(schema.users.id, l.userId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(l.id))
    .limit(200);
  const shown = sp.errors ? rows.filter((r) => r.log.status >= 400 || r.log.error) : rows;

  return (
    <>
      <h1>Usage logs</h1>
      <form className="row card" method="get">
        <input name="user" placeholder="user id" defaultValue={sp.user} style={{ maxWidth: 120 }} />
        <input name="model" placeholder="model" defaultValue={sp.model} style={{ maxWidth: 220 }} />
        <label className="row" style={{ margin: 0 }}><input type="checkbox" name="errors" defaultChecked={!!sp.errors} /> errors only</label>
        <button className="secondary">Filter</button>
      </form>
      <div className="card scroll">
        <table>
          <thead>
            <tr><th>Time</th><th>User</th><th>Endpoint</th><th>Model</th><th>Channel</th><th>Status</th><th>In / out / cache</th><th>Cost</th><th>Upstream</th><th>Latency</th></tr>
          </thead>
          <tbody>
            {shown.map(({ log, channel, email }) => (
              <tr key={log.id}>
                <td>{log.createdAt.toISOString().replace("T", " ").slice(5, 19)}</td>
                <td>{email ?? log.userId}</td>
                <td className="mono">{log.endpoint}{log.stream ? " (stream)" : ""}</td>
                <td className="mono">{log.model}</td>
                <td>{channel ?? "—"}</td>
                <td>
                  <span className={log.status < 400 && !log.error ? "badge ok" : "badge off"}>{log.status}</span>
                  {log.error && <div className="mono muted" style={{ maxWidth: 320 }}>{log.error.slice(0, 200)}</div>}
                </td>
                <td>{log.inputTokens} / {log.outputTokens} / {log.cacheReadTokens + log.cacheWriteTokens}</td>
                <td>{formatUsd(log.cost)}</td>
                <td>{formatUsd(log.upstreamCost)}</td>
                <td>{log.latencyMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
