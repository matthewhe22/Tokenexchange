import Link from "next/link";
import { TwoFactorForm } from "@/components/auth-forms";
import { readPendingTwoFactor } from "@/lib/session";

export const metadata = { title: "Two-factor authentication · TokenExchange" };

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const pending = await readPendingTwoFactor();
  return (
    <div className="auth-card card">
      <h1>Two-factor authentication</h1>
      {pending ? <TwoFactorForm next={next} /> : <p>Your sign-in expired. <Link href="/login">Sign in again</Link>.</p>}
    </div>
  );
}
