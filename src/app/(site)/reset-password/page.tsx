import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-forms";

export const metadata = { title: "Choose a new password · TokenExchange" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <div className="auth-card card">
      <h1>Choose a new password</h1>
      {token ? <ResetPasswordForm token={token} /> : <p>This link is incomplete. <Link href="/forgot-password">Request a new one</Link>.</p>}
    </div>
  );
}
