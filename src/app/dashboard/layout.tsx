import { getDict } from "@/lib/i18n";
import Link from "next/link";
import { logout } from "@/app/(site)/auth-actions";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const t = await getDict();
  return (
    <div className="shell">
      <nav className="nav">
        <Link href="/" className="brand">TokenExchange</Link>
        <Link href="/dashboard">{t["dash.overview"]}</Link>
        <Link href="/dashboard/keys">{t["dash.keys"]}</Link>
        <Link href="/dashboard/playground">{t["dash.playground"]}</Link>
        <Link href="/dashboard/usage">{t["dash.usage"]}</Link>
        <Link href="/dashboard/billing">{t["dash.billing"]}</Link>
        <Link href="/dashboard/account">{t["dash.account"]}</Link>
        <Link href="/docs">{t["dash.docs"]}</Link>
        {user.role === "admin" && <Link href="/admin">{t["dash.admin"]}</Link>}
        <form action={logout} style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6, wordBreak: "break-all" }}>{user.email}</div>
          <button className="secondary">{t["dash.signout"]}</button>
        </form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
