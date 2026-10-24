"use client";

import { useActionState } from "react";
import { createMyKey } from "@/app/dashboard/actions";
import { CodeBlock } from "./code-block";

export function MyKeyForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(createMyKey, null);
  return (
    <form action={action} className="card">
      <div className="form-grid">
        <div><label>Name</label><input name="name" placeholder="e.g. production" maxLength={60} /></div>
        <div><label>Spending limit in USD (optional)</label><input name="quota" type="number" step="any" min={0} /></div>
        <div className="wide"><label>Restrict to models (comma separated, optional)</label><input name="allowedModels" placeholder="gpt-4o-mini, claude-haiku-4-5" /></div>
      </div>
      <div className="row" style={{ marginTop: 12 }}>
        <button disabled={pending || disabled}>Create key</button>
      </div>
      {state?.error && <div className="error" style={{ marginTop: 8 }}>{state.error}</div>}
      {state?.key && (
        <div style={{ marginTop: 12 }}>
          <div className="notice">Copy your key now. For security it will not be shown again.</div>
          <CodeBlock code={state.key} />
        </div>
      )}
    </form>
  );
}
