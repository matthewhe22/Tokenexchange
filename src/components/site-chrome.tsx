import Link from "next/link";
import { getDict, getLocale } from "@/lib/i18n";
import { currentUser } from "@/lib/session";
import { COMPANY_NAME } from "@/lib/company";
import { LangSwitch } from "./lang-switch";
import { TenonLogo } from "./logo";

export async function SiteHeader() {
  const [user, t, locale] = await Promise.all([currentUser(), getDict(), getLocale()]);
  return (
    <header className="site-header">
      <div className="site-inner row" style={{ justifyContent: "space-between" }}>
        <Link href="/" className="logo">
          <TenonLogo size={30} />
        </Link>
        <nav className="row site-nav">
          <Link href="/batch">{t["nav.batch"]}</Link>
          <Link href="/pricing">{t["nav.pricing"]}</Link>
          <Link href="/docs">{t["nav.docs"]}</Link>
          <LangSwitch current={locale} label={t["lang.label"]} />
          {user ? (
            <Link href={user.role === "admin" ? "/admin" : "/dashboard"} className="btn">{t["nav.console"]}</Link>
          ) : (
            <>
              <Link href="/login">{t["nav.signin"]}</Link>
              <Link href="/signup" className="btn">{t["nav.getKey"]}</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export async function SiteFooter() {
  const t = await getDict();
  return (
    <footer className="site-footer">
      <div className="site-inner row" style={{ justifyContent: "space-between" }}>
        <span className="row" style={{ gap: 12 }}>
          <TenonLogo size={22} />
          <span className="muted">
            © {new Date().getFullYear()} Tenon · {t["footer.owned"].replace("{company}", COMPANY_NAME)}
          </span>
        </span>
        <nav className="row">
          <Link href="/batch">{t["nav.batch"]}</Link>
          <Link href="/pricing">{t["nav.pricing"]}</Link>
          <Link href="/docs">{t["nav.docs"]}</Link>
          <Link href="/guides">{t["nav.guides"]}</Link>
          <Link href="/about">{t["footer.about"]}</Link>
          <Link href="/terms">{t["footer.terms"]}</Link>
          <Link href="/privacy">{t["footer.privacy"]}</Link>
        </nav>
      </div>
    </footer>
  );
}
