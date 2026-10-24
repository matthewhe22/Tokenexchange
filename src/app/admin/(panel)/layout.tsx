import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { logout } from "@/app/(site)/auth-actions";

export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="shell">
      <nav className="nav">
        <Link href="/admin" className="brand">TokenExchange</Link>
        <Link href="/admin">Dashboard</Link>
        <Link href="/admin/channels">Channels</Link>
        <Link href="/admin/models">Models &amp; prices</Link>
        <Link href="/admin/settings">Routing</Link>
        <Link href="/admin/users">Users</Link>
        <Link href="/admin/logs">Usage logs</Link>
        <form action={logout} style={{ marginTop: 16 }}>
          <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>{admin.email}</div>
          <button className="secondary">Sign out</button>
        </form>
      </nav>
      <main className="main">{children}</main>
    </div>
  );
}
