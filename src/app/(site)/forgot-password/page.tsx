import { ForgotPasswordForm } from "@/components/auth-forms";
import { turnstileSiteKey } from "@/lib/turnstile";

export const metadata = { title: "Reset password · TokenExchange" };

export default function ForgotPasswordPage() {
  return (
    <div className="auth-card card">
      <h1>Reset your password</h1>
      <ForgotPasswordForm siteKey={turnstileSiteKey} />
    </div>
  );
}
