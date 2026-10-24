"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, requestPasswordReset, resetPassword, signup, verifyTwoFactor } from "@/app/(site)/auth-actions";
import { Turnstile } from "./turnstile";

function Status({ state }: { state?: { error?: string; message?: string } }) {
  if (state?.error) return <div className="error">{state.error}</div>;
  if (state?.message) return <div className="notice">{state.message}</div>;
  return null;
}

export function LoginForm({ next, notice }: { next?: string; notice?: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="auth-form">
      {notice && <div className="notice">{notice}</div>}
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="username" defaultValue={state?.email} />
      </div>
      <div>
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      <Status state={state} />
      <button disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link href="/forgot-password">Forgot password?</Link>
        <Link href="/signup">Create an account</Link>
      </div>
    </form>
  );
}

export function SignupForm({ siteKey }: { siteKey: string }) {
  const [state, action, pending] = useActionState(signup, undefined);
  return (
    <form action={action} className="auth-form">
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required autoComplete="email" defaultValue={state?.email} />
      </div>
      <div>
        <label htmlFor="password">Password (8+ characters)</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <Turnstile siteKey={siteKey} />
      <Status state={state} />
      <button disabled={pending}>{pending ? "Creating account…" : "Create account"}</button>
      <p className="muted" style={{ margin: 0 }}>
        Already have an account? <Link href="/login">Sign in</Link>. By signing up you agree to the <Link href="/terms">Terms</Link>.
      </p>
    </form>
  );
}

export function ForgotPasswordForm({ siteKey }: { siteKey: string }) {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className="auth-form">
      <div>
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required defaultValue={state?.email} />
      </div>
      <Turnstile siteKey={siteKey} />
      <Status state={state} />
      <button disabled={pending}>Send reset link</button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="password">New password (8+ characters)</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <Status state={state} />
      <button disabled={pending}>Set new password</button>
    </form>
  );
}

export function OAuthButtons({ providers, next }: { providers: { id: string; label: string }[]; next?: string }) {
  if (!providers.length) return null;
  return (
    <div className="auth-form" style={{ marginBottom: 16 }}>
      {providers.map((p) => (
        <a key={p.id} className="btn btn-ghost" style={{ textAlign: "center" }} href={`/api/auth/${p.id}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
          Continue with {p.label}
        </a>
      ))}
      <div className="muted" style={{ textAlign: "center", fontSize: 12 }}>or use your email</div>
    </div>
  );
}

export function TwoFactorForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(verifyTwoFactor, undefined);
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="code">6-digit code from your authenticator app</label>
        <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus />
      </div>
      <Status state={state} />
      <button disabled={pending}>Verify</button>
    </form>
  );
}
