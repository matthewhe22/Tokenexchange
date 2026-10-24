"use client";

import { useActionState } from "react";
import { resendVerification } from "@/app/(site)/auth-actions";

export function VerifyBanner({ email }: { email: string }) {
  const [state, action, pending] = useActionState(resendVerification, null);
  return (
    <form action={action} className="notice row" style={{ justifyContent: "space-between" }}>
      <span>{state?.message ?? `Confirm ${email} to start creating API keys. Check your inbox for the link.`}</span>
      <button className="secondary" disabled={pending}>Resend email</button>
    </form>
  );
}
