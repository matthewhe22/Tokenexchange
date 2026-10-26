import { pageMetadata } from "@/lib/seo";
import { getDict } from "@/lib/i18n";
import { ForgotPasswordForm } from "@/components/auth-forms";
import { turnstileSiteKey } from "@/lib/turnstile";

export const metadata = pageMetadata({ path: "/forgot-password", title: "Reset password", description: "Reset the password of your Tenon account.", index: false });

export default async function ForgotPasswordPage() {
  const t = await getDict();
  return (
    <div className="auth-card card">
      <h1>{t["auth.reset"]}</h1>
      <ForgotPasswordForm siteKey={turnstileSiteKey} t={t} />
    </div>
  );
}
