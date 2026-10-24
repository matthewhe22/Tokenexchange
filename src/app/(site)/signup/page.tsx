import { getDict } from "@/lib/i18n";
import { OAuthButtons, SignupForm } from "@/components/auth-forms";
import { enabledOAuthProviders } from "@/lib/oauth";
import { turnstileSiteKey } from "@/lib/turnstile";

export const metadata = { title: "Create account · TokenExchange" };

export default async function SignupPage() {
  const t = await getDict();
  return (
    <div className="auth-card card">
      <h1>{t["auth.signup"]}</h1>
      <p className="muted">{t["auth.signupLead"]}</p>
      <OAuthButtons providers={enabledOAuthProviders()} t={t} />
      <SignupForm siteKey={turnstileSiteKey} t={t} />
    </div>
  );
}
