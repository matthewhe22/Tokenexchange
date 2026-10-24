export const metadata = { title: "Privacy Policy · TokenExchange" };

// TEMPLATE: have qualified counsel review and adapt before launch (GDPR/CCPA specifics, contact details).
export default function PrivacyPage() {
  return (
    <article className="site-inner section prose">
      <h1 className="page-title">Privacy Policy</h1>
      <p className="muted">Last updated: draft</p>
      <h2>What we collect</h2>
      <ul>
        <li>Account data: email address and a hashed password.</li>
        <li>Billing data: payment records from Stripe. Card details are handled by Stripe and never reach our servers.</li>
        <li>Usage metadata: time, model, token counts, cost, latency and status of each API request.</li>
      </ul>
      <h2>What we do not store</h2>
      <p>We do not store the content of your prompts or of model responses. Requests are passed to the model provider that serves them and are subject to that provider&apos;s data policy.</p>
      <h2>How we use data</h2>
      <p>To operate and bill for the service, prevent abuse, and contact you about your account.</p>
      <h2>Sub-processors</h2>
      <p>Vercel (hosting), our database host, Stripe (payments), our email provider, and the AI model providers that serve your requests.</p>
      <h2>Your choices</h2>
      <p>You can request a copy or deletion of your account data by contacting the operator of this site.</p>
    </article>
  );
}
