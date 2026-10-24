import { desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { formatUsd } from "@/lib/money";
import { createUser } from "../../actions";

export default async function UsersPage() {
  const users = await getDb().select().from(schema.users).orderBy(desc(schema.users.id)).limit(200);
  return (
    <>
      <h1>Users</h1>
      <div className="card scroll">
        <table>
          <thead><tr><th>ID</th><th>Email</th><th>Role</th><th>Balance</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td><a href={`/admin/users/${u.id}`}>{u.email}</a></td>
                <td>{u.role}</td>
                <td>{formatUsd(u.balance)}</td>
                <td>{u.disabled ? <span className="badge off">disabled</span> : <span className="badge ok">active</span>}</td>
                <td>{u.createdAt.toISOString().slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Create user</h2>
      <form action={createUser} className="card form-grid">
        <div><label>Email</label><input name="email" type="email" required /></div>
        <div><label>Password (needed only for admins until self-service sign-up ships)</label><input name="password" type="password" autoComplete="new-password" /></div>
        <div>
          <label>Role</label>
          <select name="role" defaultValue="user"><option value="user">user</option><option value="admin">admin</option></select>
        </div>
        <div><label>Initial balance (USD)</label><input name="balance" type="number" step="any" defaultValue={0} /></div>
        <div><button>Create user</button></div>
      </form>
    </>
  );
}
