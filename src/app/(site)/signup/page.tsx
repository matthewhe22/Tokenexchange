import { SignupForm } from "@/components/auth-forms";
import { turnstileSiteKey } from "@/lib/turnstile";

export const metadata = { title: "Create account · TokenExchange" };

export default function SignupPage() {
  return (
    <div className="auth-card card">
      <h1>Create your account</h1>
      <p className="muted">Pay as you go. One key for OpenAI, Anthropic and Gemini models.</p>
      <SignupForm siteKey={turnstileSiteKey} />
    </div>
  );
}
