"use client";

import Link from "next/link";
import { useActionState } from "react";
import { login, requestPasswordReset, resetPassword, signup, verifyTwoFactor } from "@/app/(site)/auth-actions";
import type { Dict } from "@/lib/i18n";
import { Turnstile } from "./turnstile";

function Status({ state }: { state?: { error?: string; message?: string } }) {
  if (state?.error) return <div className="error">{state.error}</div>;
  if (state?.message) return <div className="notice">{state.message}</div>;
  return null;
}

export function LoginForm({ next, notice, t }: { next?: string; notice?: string; t: Dict }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="auth-form">
      {notice && <div className="notice">{notice}</div>}
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="email">{t["auth.email"]}</label>
        <input id="email" name="email" type="email" required autoComplete="username" defaultValue={state?.email} />
      </div>
      <div>
        <label htmlFor="password">{t["auth.password"]}</label>
        <input id="password" name="password" type="password" required autoComplete="current-password" />
      </div>
      <Status state={state} />
      <button disabled={pending}>{pending ? "…" : t["auth.signin"]}</button>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <Link href="/forgot-password">{t["auth.forgot"]}</Link>
        <Link href="/signup">{t["auth.create"]}</Link>
      </div>
    </form>
  );
}

export function SignupForm({ siteKey, t }: { siteKey: string; t: Dict }) {
  const [state, action, pending] = useActionState(signup, undefined);
  return (
    <form action={action} className="auth-form">
      <div>
        <label htmlFor="email">{t["auth.email"]}</label>
        <input id="email" name="email" type="email" required autoComplete="email" defaultValue={state?.email} />
      </div>
      <div>
        <label htmlFor="password">{t["auth.passwordNew"]}</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <Turnstile siteKey={siteKey} />
      <Status state={state} />
      <button disabled={pending}>{pending ? "…" : t["auth.createButton"]}</button>
      <p className="muted" style={{ margin: 0 }}>
        {t["auth.have"]} <Link href="/login">{t["auth.signin"]}</Link>. {t["auth.agree"]} <Link href="/terms">{t["footer.terms"]}</Link>.
      </p>
    </form>
  );
}

export function ForgotPasswordForm({ siteKey, t }: { siteKey: string; t: Dict }) {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);
  return (
    <form action={action} className="auth-form">
      <div>
        <label htmlFor="email">{t["auth.email"]}</label>
        <input id="email" name="email" type="email" required defaultValue={state?.email} />
      </div>
      <Turnstile siteKey={siteKey} />
      <Status state={state} />
      <button disabled={pending}>{t["auth.sendReset"]}</button>
    </form>
  );
}

export function ResetPasswordForm({ token, t }: { token: string; t: Dict }) {
  const [state, action, pending] = useActionState(resetPassword, undefined);
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="token" value={token} />
      <div>
        <label htmlFor="password">{t["auth.passwordNew"]}</label>
        <input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
      </div>
      <Status state={state} />
      <button disabled={pending}>{t["auth.setPassword"]}</button>
    </form>
  );
}

export function OAuthButtons({ providers, next, t }: { providers: { id: string; label: string }[]; next?: string; t: Dict }) {
  if (!providers.length) return null;
  return (
    <div className="auth-form" style={{ marginBottom: 16 }}>
      {providers.map((p) => (
        <a key={p.id} className="btn btn-ghost" style={{ textAlign: "center" }} href={`/api/auth/${p.id}/start${next ? `?next=${encodeURIComponent(next)}` : ""}`}>
          {t["auth.continueWith"]} {p.label}
        </a>
      ))}
      <div className="muted" style={{ textAlign: "center", fontSize: 12 }}>{t["auth.orEmail"]}</div>
    </div>
  );
}

export function TwoFactorForm({ next, t }: { next?: string; t: Dict }) {
  const [state, action, pending] = useActionState(verifyTwoFactor, undefined);
  return (
    <form action={action} className="auth-form">
      <input type="hidden" name="next" value={next ?? ""} />
      <div>
        <label htmlFor="code">{t["auth.2faCode"]}</label>
        <input id="code" name="code" autoComplete="one-time-code" required autoFocus />
        <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>Lost your phone? Enter one of your recovery codes instead.</div>
      </div>
      <Status state={state} />
      <button disabled={pending}>{t["auth.verify"]}</button>
    </form>
  );
}
