"use client";

import { useActionState } from "react";
import { createRedeemCodes } from "@/app/admin/actions";

export function RedeemGenerateForm() {
  const [state, action, pending] = useActionState(createRedeemCodes, null);
  const csv = state?.codes ? "code\n" + state.codes.join("\n") : "";
  return (
    <form action={action} className="card">
      <div className="form-grid">
        <div><label>Number of codes (max 500)</label><input name="count" type="number" min={1} max={500} defaultValue={10} required /></div>
        <div><label>Credit per code (USD)</label><input name="amount" type="number" step="any" min={0} required /></div>
        <div><label>Uses per code (different users)</label><input name="maxUses" type="number" min={1} defaultValue={1} /></div>
        <div><label>Expires at (optional)</label><input name="expiresAt" type="datetime-local" /></div>
        <div><label>Batch name</label><input name="batch" placeholder="e.g. reseller-acme-2026-10" /></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button disabled={pending}>Generate codes</button>
        {state?.error && <span className="error">{state.error}</span>}
      </div>
      {state?.codes && (
        <div style={{ marginTop: 12 }}>
          <div className="notice">Copy or download these codes now — only their hashes are stored.</div>
          <textarea readOnly value={state.codes.join("\n")} style={{ minHeight: 160 }} />
          <a className="btn" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="redeem-codes.csv">Download CSV</a>
        </div>
      )}
    </form>
  );
}
