"use client";

import { useActionState } from "react";
import { redeem } from "@/app/dashboard/actions";

export function RedeemForm() {
  const [state, action, pending] = useActionState(redeem, null);
  return (
    <form action={action} className="card row" style={{ alignItems: "end" }}>
      <div style={{ maxWidth: 300, flex: 1 }}>
        <label htmlFor="code">Have a credit code?</label>
        <input id="code" name="code" placeholder="TX-XXXX-XXXX-XXXX-XXXX" autoComplete="off" required />
      </div>
      <button className="secondary" disabled={pending}>Redeem</button>
      {state?.error && <span className="error">{state.error}</span>}
      {state?.message && <span>{state.message}</span>}
    </form>
  );
}
