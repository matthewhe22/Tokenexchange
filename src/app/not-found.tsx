import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";

export const metadata = { title: "Page not found", robots: { index: false, follow: true } };

export default function NotFound() {
  return (
    <div className="site">
      <SiteHeader />
      <main className="site-main">
        <section className="hero site-inner">
          <p className="eyebrow">404</p>
          <h1 className="hero-title">This page doesn&apos;t exist</h1>
          <p className="hero-sub">The link may be old, or the address mistyped.</p>
          <div className="row hero-cta">
            <Link href="/" className="btn btn-lg">Home</Link>
            <Link href="/pricing" className="btn btn-lg btn-ghost">Pricing</Link>
            <Link href="/docs" className="btn btn-lg btn-ghost">Docs</Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
