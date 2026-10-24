"use client";

import { useActionState } from "react";
import { createKey } from "@/app/admin/actions";

export function CreateKeyForm({ userId }: { userId: number }) {
  const [state, action, pending] = useActionState(createKey, null);
  return (
    <form action={action} className="card">
      <input type="hidden" name="userId" value={userId} />
      <div className="form-grid">
        <div><label>Name</label><input name="name" placeholder="default" /></div>
        <div><label>Spending limit (USD, blank = none)</label><input name="quota" type="number" step="any" /></div>
        <div><label>Expires at (optional)</label><input name="expiresAt" type="datetime-local" /></div>
        <div className="wide"><label>Allowed models (comma separated, blank = all)</label><input name="allowedModels" /></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button disabled={pending}>Create API key</button>
      </div>
      {state?.key && (
        <div className="notice">
          Copy this key now — it will not be shown again:
          <div className="mono" style={{ marginTop: 6, fontSize: 14 }}>{state.key}</div>
        </div>
      )}
    </form>
  );
}
