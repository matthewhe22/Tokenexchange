import { desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { RedeemGenerateForm } from "@/components/redeem-generate-form";
import { formatUsd } from "@/lib/money";

export default async function CodesPage() {
  const c = schema.redeemCodes;
  const batches = await getDb()
    .select({
      batch: c.batch,
      amount: c.amount,
      codes: sql<number>`count(*)::int`,
      used: sql<number>`sum(${c.usedCount})::int`,
      capacity: sql<number>`sum(${c.maxUses})::int`,
      created: sql<Date>`max(${c.createdAt})`,
    })
    .from(c)
    .groupBy(c.batch, c.amount)
    .orderBy(desc(sql`max(${c.createdAt})`));
  return (
    <>
      <h1>Redeem codes</h1>
      <p className="muted">Prepaid credit codes for offline sales, partners and promotions. Customers redeem them on their Billing page.</p>
      <RedeemGenerateForm />
      <h2>Batches</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Batch</th><th>Credit</th><th>Codes</th><th>Redeemed</th><th>Created</th></tr></thead>
          <tbody>
            {batches.map((b, i) => (
              <tr key={i}>
                <td>{b.batch ?? <span className="muted">(none)</span>}</td>
                <td>{formatUsd(Number(b.amount))}</td>
                <td>{b.codes}</td>
                <td>{b.used} / {b.capacity}</td>
                <td>{new Date(b.created).toISOString().slice(0, 10)}</td>
              </tr>
            ))}
            {!batches.length && <tr><td colSpan={5} className="muted">No codes yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
