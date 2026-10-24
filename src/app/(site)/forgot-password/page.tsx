import { getDict } from "@/lib/i18n";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { turnstileSiteKey } from "@/lib/turnstile";

export const metadata = { title: "Reset password · TokenExchange" };

export default async function ForgotPasswordPage() {
  const t = await getDict();
  return (
    <div className="auth-card card">
      <h1>{t["auth.reset"]}</h1>
      <ForgotPasswordForm siteKey={turnstileSiteKey} t={t} />
    </div>
  );
}
