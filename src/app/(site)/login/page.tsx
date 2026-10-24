import { LoginForm } from "@/components/auth-forms";

export const metadata = { title: "Sign in · TokenExchange" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="auth-card card">
      <h1>Sign in</h1>
      <LoginForm next={sp.next} notice={sp.reset ? "Password updated. Sign in with your new password." : undefined} />
    </div>
  );
}
