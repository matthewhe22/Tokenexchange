import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { MyKeyForm } from "@/components/my-key-form";
import { VerifyBanner } from "@/components/verify-banner";
import { formatUsd } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { deleteMyKey, toggleMyKey } from "../actions";

export default async function KeysPage() {
  const user = await requireUser();
  const keys = await getDb().select().from(schema.apiKeys).where(eq(schema.apiKeys.userId, user.id)).orderBy(desc(schema.apiKeys.id));
  return (
    <>
      {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
      <h1>API keys</h1>
      <div className="card scroll">
        <table>
          <thead><tr><th>Name</th><th>Key</th><th>Spent / limit</th><th>Models</th><th>Last used</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td>{k.name}</td>
                <td className="mono">{k.keyPrefix}…</td>
                <td>{formatUsd(k.used)} / {k.quotaLimit != null ? formatUsd(k.quotaLimit) : "no limit"}</td>
                <td className="mono">{k.allowedModels?.join(", ") ?? "all"}</td>
                <td>{k.lastUsedAt?.toISOString().replace("T", " ").slice(0, 16) ?? "never"}</td>
                <td>{k.enabled ? <span className="badge ok">active</span> : <span className="badge off">disabled</span>}</td>
                <td className="row">
                  <form action={toggleMyKey}><input type="hidden" name="id" value={k.id} /><button className="secondary">{k.enabled ? "Disable" : "Enable"}</button></form>
                  <form action={deleteMyKey}><input type="hidden" name="id" value={k.id} /><button className="danger">Delete</button></form>
                </td>
              </tr>
            ))}
            {!keys.length && <tr><td colSpan={7} className="muted">No keys yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>New key</h2>
      <MyKeyForm disabled={!user.emailVerifiedAt} />
    </>
  );
}
