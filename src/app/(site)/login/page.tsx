import { LoginForm, OAuthButtons } from "@/components/auth-forms";
import { enabledOAuthProviders } from "@/lib/oauth";

export const metadata = { title: "Sign in · TokenExchange" };

const ERRORS: Record<string, string> = {
  oauth: "Sign-in was cancelled or expired. Please try again.",
  oauth_email: "We could not get a verified email address from that account.",
  disabled: "This account is disabled. Contact support.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; error?: string }> }) {
  const sp = await searchParams;
  const notice = sp.reset ? "Password updated. Sign in with your new password." : sp.error ? ERRORS[sp.error] : undefined;
  return (
    <div className="auth-card card">
      <h1>Sign in</h1>
      <OAuthButtons providers={enabledOAuthProviders()} next={sp.next} />
      <LoginForm next={sp.next} notice={notice} />
    </div>
  );
}
