import Link from "next/link";
import { COMPANY_NAME } from "@/lib/company";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  path: "/about",
  title: "About",
  description: `Tenon is owned and operated by ${COMPANY_NAME}. One API key for OpenAI-, Anthropic- and Gemini-compatible models, prepaid and billed per token.`,
});

export default function AboutPage() {
  return (
    <article className="site-inner section prose">
      <h1 className="page-title">About Tenon</h1>
      <p className="lead">
        Tenon is a gateway to AI models. One API key and one prepaid balance work with the OpenAI, Anthropic and Gemini SDKs,
        Claude Code and any OpenAI-compatible tool, billed per token, with discounted batch processing for jobs that can wait.
      </p>

      <h2>Who runs it</h2>
      <p>
        This website and the Tenon service are owned and operated by <strong>{COMPANY_NAME}</strong>.
      </p>

      <h2>Independent service</h2>
      <p>
        Tenon is an independent service. It is not affiliated with, endorsed by or sponsored by OpenAI, Anthropic, Google or any
        other model provider. Product and model names are trademarks of their respective owners and are used only to describe
        compatibility.
      </p>

      <h2>Payments</h2>
      <p>
        Credit is prepaid and spent per token at the rates on the <Link href="/pricing">pricing page</Link>. Card payments are
        processed by Stripe; card details are entered on Stripe&apos;s pages and are never seen or stored by Tenon. See the{" "}
        <Link href="/terms">Terms of Service</Link> for refunds and the <Link href="/privacy">Privacy Policy</Link> for how data is
        handled.
      </p>

      <h2>Get started</h2>
      <p>
        <Link href="/signup">Create an account</Link>, or read the <Link href="/docs">documentation</Link> and{" "}
        <Link href="/guides">guides</Link>.
      </p>
    </article>
  );
}
