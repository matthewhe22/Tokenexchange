"use client";

import { useActionState } from "react";
import { changePassword } from "@/app/dashboard/actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, null);
  return (
    <form action={action} className="card auth-form" style={{ maxWidth: 420 }}>
      <div><label htmlFor="current">Current password</label><input id="current" name="current" type="password" required autoComplete="current-password" /></div>
      <div><label htmlFor="password">New password</label><input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" /></div>
      {state?.error && <div className="error">{state.error}</div>}
      {state?.message && <div className="notice">{state.message}</div>}
      <button disabled={pending}>Update password</button>
    </form>
  );
}
