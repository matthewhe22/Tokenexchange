import Link from "next/link";
import { currentUser } from "@/lib/session";

export async function SiteHeader() {
  const user = await currentUser();
  return (
    <header className="site-header">
      <div className="site-inner row" style={{ justifyContent: "space-between" }}>
        <Link href="/" className="logo">
          <span className="logo-mark">⇄</span> TokenExchange
        </Link>
        <nav className="row site-nav">
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs">Docs</Link>
          {user ? (
            <Link href={user.role === "admin" ? "/admin" : "/dashboard"} className="btn">Console</Link>
          ) : (
            <>
              <Link href="/login">Sign in</Link>
              <Link href="/signup" className="btn">Get API key</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-inner row" style={{ justifyContent: "space-between" }}>
        <span className="muted">© {new Date().getFullYear()} TokenExchange</span>
        <nav className="row">
          <Link href="/pricing">Pricing</Link>
          <Link href="/docs">Docs</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </div>
    </footer>
  );
}
