import { pageMetadata } from "@/lib/seo";
import { getDict } from "@/lib/i18n";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-forms";

export const metadata = pageMetadata({ path: "/reset-password", title: "Choose a new password", description: "Choose a new password for your Tenon account.", index: false });

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const t = await getDict();
  return (
    <div className="auth-card card">
      <h1>{t["auth.newPassword"]}</h1>
      {token ? <ResetPasswordForm token={token} t={t} /> : <p>This link is incomplete. <Link href="/forgot-password">Request a new one</Link>.</p>}
    </div>
  );
}
