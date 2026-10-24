import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { RedeemForm } from "@/components/redeem-form";
import { formatUsd } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { stripeEnabled, TOPUP_MAX_USD, TOPUP_MIN_USD, TOPUP_PRESETS_USD } from "@/lib/stripe";
import { startTopup } from "../actions";
import { formatDateTime, tzLabel } from "@/lib/time";

const STATUS: Record<string, string> = {
  success: "Payment received. Credit appears within a few seconds once Stripe confirms it — refresh if it is not there yet.",
  cancelled: "Checkout cancelled. You have not been charged.",
  error: "We could not start checkout. Please try again or contact support.",
  unavailable: "Online payments are not enabled yet.",
};

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser();
  const { status } = await searchParams;
  const txs = await getDb()
    .select()
    .from(schema.balanceTransactions)
    .where(eq(schema.balanceTransactions.userId, user.id))
    .orderBy(desc(schema.balanceTransactions.id))
    .limit(50);

  return (
    <>
      <h1>Billing</h1>
      {status && STATUS[status] && <div className={status === "success" ? "notice" : "notice error"}>{STATUS[status]}</div>}
      <div className="grid">
        <div className="card stat"><div className="label">Current balance</div><div className="value">{formatUsd(user.balance)}</div></div>
      </div>

      <h2>Add credit</h2>
      {stripeEnabled() ? (
        <form action={startTopup} className="card">
          <div className="row" role="radiogroup" aria-label="Amount">
            {TOPUP_PRESETS_USD.map((a, i) => (
              <label key={a} className="chip">
                <input type="radio" name="amount" value={a} defaultChecked={i === 1} /> ${a}
              </label>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <div style={{ maxWidth: 220 }}>
              <label htmlFor="custom">Or a custom amount (${TOPUP_MIN_USD}–${TOPUP_MAX_USD})</label>
              <input id="custom" name="custom" type="number" min={TOPUP_MIN_USD} max={TOPUP_MAX_USD} step="0.01" />
            </div>
            <button style={{ alignSelf: "end" }}>Continue to payment</button>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>Secure checkout by Stripe. Credit never expires and is spent per token at the rates on the pricing page.</p>
        </form>
      ) : (
        <div className="card muted">Online payments are not enabled yet. Contact support to add credit.</div>
      )}

      <RedeemForm />

      <h2>History</h2>
      <div className="card scroll">
        <table>
          <thead><tr><th>Date ({tzLabel()})</th><th>Type</th><th>Amount</th><th>Details</th></tr></thead>
          <tbody>
            {txs.map((t) => (
              <tr key={t.id}>
                <td>{formatDateTime(t.createdAt)}</td>
                <td>{t.type}</td>
                <td>{formatUsd(t.amount)}</td>
                <td>{t.note}</td>
              </tr>
            ))}
            {!txs.length && <tr><td colSpan={4} className="muted">No payments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
