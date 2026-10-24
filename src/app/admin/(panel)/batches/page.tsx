import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatUsd } from "@/lib/money";
import { formatDateTime } from "@/lib/time";

export default async function BatchesPage() {
  const b = schema.batches;
  const rows = await getDb()
    .select({ batch: b, email: schema.users.email, channel: schema.channels.name })
    .from(b)
    .innerJoin(schema.users, eq(schema.users.id, b.userId))
    .leftJoin(schema.channels, eq(schema.channels.id, b.channelId))
    .orderBy(desc(b.createdAt))
    .limit(200);

  return (
    <>
      <h1>Batches</h1>
      <p className="muted">
        Asynchronous batches (<span className="mono">/v1/batches</span>, <span className="mono">/v1/messages/batches</span>) run on the
        upstream&apos;s batch API at half of list and are billed at each model&apos;s batch markup. The worst case is held when the batch
        is created; it is billed from the upstream&apos;s results when the batch ends. Batches are refreshed whenever the customer polls
        them, and by the maintenance job.
      </p>
      <div className="card scroll">
        <table>
          <thead>
            <tr><th>Created</th><th>Batch</th><th>Customer</th><th>Models</th><th>Requests</th><th>Channel</th><th>Status</th><th>Billed</th><th>Upstream</th></tr>
          </thead>
          <tbody>
            {rows.map(({ batch: r, email, channel }) => (
              <tr key={r.id}>
                <td>{formatDateTime(r.createdAt)}</td>
                <td className="mono">{r.id}</td>
                <td>{email}</td>
                <td className="mono">{r.models.join(", ")}</td>
                <td>{r.requestCount}</td>
                <td>{channel ?? "—"}</td>
                <td>
                  {r.status}
                  {r.settledAt ? <span className="badge ok" style={{ marginLeft: 4 }}>billed</span> : r.settlingAt ? <span className="badge" style={{ marginLeft: 4 }}>billing</span> : null}
                </td>
                <td>{r.settledAt ? formatUsd(r.cost) : "held"}</td>
                <td>{r.settledAt ? formatUsd(r.upstreamCost) : "—"}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={9} className="muted">No batches yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
