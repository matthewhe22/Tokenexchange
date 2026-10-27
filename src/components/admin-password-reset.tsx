"use client";

import { useActionState } from "react";
import { adminPasswordReset } from "@/app/admin/actions";

export function AdminPasswordReset({ userId, email }: { userId: number; email: string }) {
  const [state, action, pending] = useActionState(adminPasswordReset, null);
  return (
    <form action={action} className="card">
      <input type="hidden" name="userId" value={userId} />
      <p className="muted" style={{ marginTop: 0 }}>
        The user chooses the new password themselves, so you never see it. Resetting signs them out everywhere. Two-factor
        authentication stays on.
      </p>
      <div className="row">
        <button name="mode" value="email" disabled={pending}>Email reset link to {email}</button>
        <button name="mode" value="link" className="secondary" disabled={pending}>Create link to send myself</button>
      </div>
      {state?.error && <div className="notice error" style={{ marginTop: 12 }}>{state.error}</div>}
      {state?.ok && <div className="notice" style={{ marginTop: 12 }}>{state.ok}</div>}
      {state?.link && (
        <div className="notice" style={{ marginTop: 12 }}>
          Send this link to the user over a channel you trust. It is shown only once:
          <div className="mono" style={{ marginTop: 6, fontSize: 13, wordBreak: "break-all" }}>{state.link}</div>
        </div>
      )}
    </form>
  );
}
