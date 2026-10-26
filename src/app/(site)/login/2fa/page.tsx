import { pageMetadata } from "@/lib/seo";
import { getDict } from "@/lib/i18n";
import Link from "next/link";
import { TwoFactorForm } from "@/components/auth-forms";
import { readPendingTwoFactor } from "@/lib/session";

export const metadata = pageMetadata({ path: "/login/2fa", title: "Two-factor authentication", description: "Enter your two-factor authentication code.", index: false });

export default async function TwoFactorPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const pending = await readPendingTwoFactor();
  const t = await getDict();
  return (
    <div className="auth-card card">
      <h1>{t["auth.2fa"]}</h1>
      {pending ? <TwoFactorForm next={next} t={t} /> : <p>Your sign-in expired. <Link href="/login">Sign in again</Link>.</p>}
    </div>
  );
}
