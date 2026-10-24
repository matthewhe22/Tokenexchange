"use client";

import { useActionState } from "react";
import { confirmTotp, disableTotp } from "@/app/dashboard/actions";

function CodeForm({ action, label, danger }: { action: (p: unknown, f: FormData) => Promise<{ error?: string; message?: string }>; label: string; danger?: boolean }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="row" style={{ marginTop: 12, alignItems: "end" }}>
      <div style={{ maxWidth: 200 }}>
        <label htmlFor={`code-${label}`}>6-digit code</label>
        <input id={`code-${label}`} name="code" inputMode="numeric" autoComplete="one-time-code" required />
      </div>
      <button className={danger ? "danger" : undefined} disabled={pending}>{label}</button>
      {state?.error && <span className="error">{state.error}</span>}
      {state?.message && <span>{state.message}</span>}
    </form>
  );
}

export function ConfirmTotpForm() {
  return <CodeForm action={confirmTotp} label="Turn on" />;
}

export function DisableTotpForm() {
  return <CodeForm action={disableTotp} label="Turn off" danger />;
}
