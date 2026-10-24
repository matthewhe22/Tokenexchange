import Link from "next/link";
import { logout } from "@/app/(site)/auth-actions";
import { requireUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <div className="shell">
      <nav className="nav">
        <Link href="/" className="brand">TokenExchange</Link>
        <Link href="/dashboard">Overview</Link>
        <Link href="/dashboard/keys">API keys</Link>
        <Link href="/dashboard/usage">Usage</Link>
        <Link href="/dashboard/billing">Billing</Link>
        <Link href="/dashboard/account">Account</Link>
        <Link href="/docs">Docs</Link>
        {user.role === "admin" && <Link href="/admin">Admin console</Link>}
        <form action={logout} style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6, wordBreak: "break-all" }}>{user.email}</div>
          <button className="secondary">Sign out</button>
        </form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
