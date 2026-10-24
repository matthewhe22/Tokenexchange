import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatUsd } from "@/lib/money";
import { requireUser } from "@/lib/session";

export default async function UsagePage() {
  const user = await requireUser();
  const l = schema.usageLogs;
  const db = getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const byModel = await db
    .select({
      model: l.model,
      requests: sql<number>`count(*)::int`,
      input: sql<number>`sum(${l.inputTokens} + ${l.cacheReadTokens} + ${l.cacheWriteTokens})::bigint`,
      output: sql<number>`sum(${l.outputTokens})::bigint`,
      spend: sql<number>`sum(${l.cost})::bigint`,
    })
    .from(l)
    .where(and(eq(l.userId, user.id), gte(l.createdAt, since)))
    .groupBy(l.model)
    .orderBy(sql`5 desc`);
  const recent = await db
    .select({ log: l, key: schema.apiKeys.name })
    .from(l)
    .leftJoin(schema.apiKeys, eq(schema.apiKeys.id, l.apiKeyId))
    .where(eq(l.userId, user.id))
    .orderBy(desc(l.id))
    .limit(100);

  return (
    <>
      <h1>Usage</h1>
      <h2>Last 30 days by model</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Model</th><th>Requests</th><th>Input tokens</th><th>Output tokens</th><th>Spend</th></tr></thead>
          <tbody>
            {byModel.map((m) => (
              <tr key={m.model}>
                <td className="mono">{m.model}</td>
                <td>{m.requests.toLocaleString()}</td>
                <td>{Number(m.input).toLocaleString()}</td>
                <td>{Number(m.output).toLocaleString()}</td>
                <td>{formatUsd(Number(m.spend))}</td>
              </tr>
            ))}
            {!byModel.length && <tr><td colSpan={5} className="muted">No usage yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Recent requests</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Time (UTC)</th><th>Key</th><th>Model</th><th>Status</th><th>Input / cached / output</th><th>Cost</th><th>Latency</th></tr></thead>
          <tbody>
            {recent.map(({ log, key }) => (
              <tr key={log.id}>
                <td>{log.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{key ?? "deleted"}</td>
                <td className="mono">{log.model}{log.stream ? " · stream" : ""}</td>
                <td><span className={log.status < 400 ? "badge ok" : "badge off"}>{log.status}</span></td>
                <td>{log.inputTokens} / {log.cacheReadTokens + log.cacheWriteTokens} / {log.outputTokens}</td>
                <td>{formatUsd(log.cost)}</td>
                <td>{log.latencyMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
