import { eq } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import { consumeAuthToken } from "@/lib/auth-tokens";

export const metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const userId = token ? await consumeAuthToken(token, "verify_email") : null;
  if (userId) await getDb().update(schema.users).set({ emailVerifiedAt: new Date() }).where(eq(schema.users.id, userId));
  return (
    <div className="auth-card card">
      <h1>{userId ? "Email verified" : "Link invalid or expired"}</h1>
      <p>
        {userId ? (
          <>You can now create API keys. <Link href="/dashboard/keys">Go to your keys</Link>.</>
        ) : (
          <>Sign in and request a new verification email from your <Link href="/dashboard">dashboard</Link>.</>
        )}
      </p>
    </div>
  );
}
