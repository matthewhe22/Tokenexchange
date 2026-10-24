import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { getDb, schema } from "@/db";
import { CreateKeyForm } from "@/components/create-key-form";
import { formatUsd } from "@/lib/money";
import { adjustBalance, deleteKey, toggleKey, toggleUser } from "../../../actions";

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = getDb();
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, Number(id)));
  if (!user) notFound();
  const keys = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, user.id)).orderBy(desc(schema.apiKeys.id));
  const txs = await db
    .select()
    .from(schema.balanceTransactions)
    .where(eq(schema.balanceTransactions.userId, user.id))
    .orderBy(desc(schema.balanceTransactions.id))
    .limit(20);

  return (
    <>
      <h1>{user.email}</h1>
      <div className="grid">
        <div className="card stat"><div className="label">Balance</div><div className="value">{formatUsd(user.balance)}</div></div>
        <div className="card stat"><div className="label">Role</div><div className="value">{user.role}</div></div>
        <div className="card stat">
          <div className="label">Status</div>
          <form action={toggleUser} className="row">
            <input type="hidden" name="userId" value={user.id} />
            <span className="value">{user.disabled ? "disabled" : "active"}</span>
            <button className="secondary">{user.disabled ? "Enable" : "Disable"}</button>
          </form>
        </div>
      </div>

      <h2>Adjust balance</h2>
      <form action={adjustBalance} className="card form-grid">
        <input type="hidden" name="userId" value={user.id} />
        <div><label>Amount (USD, negative to deduct)</label><input name="amount" type="number" step="any" required /></div>
        <div><label>Note</label><input name="note" /></div>
        <div><button>Apply</button></div>
      </form>

      <h2>API keys</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Name</th><th>Key</th><th>Used / limit</th><th>Models</th><th>Last used</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono">{k.keyPrefix}…</td>
                <td>{formatUsd(k.used)} / {k.quotaLimit != null ? formatUsd(k.quotaLimit) : "∞"}</td>
                <td className="mono">{k.allowedModels?.join(", ") ?? "all"}</td>
                <td>{k.lastUsedAt?.toISOString().replace("T", " ").slice(0, 16) ?? "—"}</td>
                <td>{k.enabled ? <span className="badge ok">enabled</span> : <span className="badge off">disabled</span>}</td>
                <td className="row">
                  <form action={toggleKey}><input type="hidden" name="id" value={k.id} /><button className="secondary">{k.enabled ? "Disable" : "Enable"}</button></form>
                  <form action={deleteKey}><input type="hidden" name="id" value={k.id} /><button className="danger">Delete</button></form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CreateKeyForm userId={user.id} />

      <h2>Balance history</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Time</th><th>Type</th><th>Amount</th><th>Note</th></tr></thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td>{t.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>{t.type}</td>
                <td>{formatUsd(t.amount)}</td>
                <td>{t.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
