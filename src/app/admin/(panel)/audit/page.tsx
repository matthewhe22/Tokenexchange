import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";

export default async function AuditPage() {
  const rows = await getDb().select().from(schema.auditLogs).orderBy(desc(schema.auditLogs.id)).limit(300);
  return (
    <>
      <h1>Audit log</h1>
      <p className="muted">Every change made in the admin console. Upstream credentials are never recorded, only which fields changed.</p>
      <div className="card scroll">
        <table>
          <thead><tr><th>Time (UTC)</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th><th>IP</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{r.actorEmail}</td>
                <td className="mono">{r.action}</td>
                <td className="mono">{r.target ?? "—"}</td>
                <td className="mono" style={{ maxWidth: 420, wordBreak: "break-word" }}>{r.details ? JSON.stringify(r.details).slice(0, 400) : ""}</td>
                <td className="mono">{r.ip ?? ""}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="muted">Nothing recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
