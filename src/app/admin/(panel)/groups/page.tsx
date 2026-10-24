import { asc, count, eq } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { deleteGroup, saveGroup } from "../../actions";

export default async function GroupsPage() {
  const db = getDb();
  const groups = await db
    .select({ g: schema.pricingGroups, members: count(schema.users.id) })
    .from(schema.pricingGroups)
    .leftJoin(schema.users, eq(schema.users.groupId, schema.pricingGroups.id))
    .groupBy(schema.pricingGroups.id)
    .orderBy(asc(schema.pricingGroups.name));
  return (
    <>
      <h1>Pricing groups</h1>
      <p className="muted">
        Members of a group pay every model&apos;s price × the group multiplier (e.g. 0.85 for a 15% wholesale discount).
        Users without a group pay the standard price. Assign groups on each user&apos;s page.
      </p>
      <div className="card scroll">
        <table>
          <thead><tr><th>Name</th><th>Multiplier</th><th>Description</th><th>Members</th><th></th></tr></thead>
          <tbody>
            {groups.map(({ g, members }) => (
              <tr key={g.id}>
                <td colSpan={5} style={{ padding: 0 }}>
                  <form action={saveGroup} className="row" style={{ padding: 6, flexWrap: "nowrap" }}>
                    <input type="hidden" name="id" value={g.id} />
                    <input name="name" defaultValue={g.name} required />
                    <input name="multiplier" type="number" step="any" min={0} defaultValue={g.multiplier} />
                    <input name="description" defaultValue={g.description ?? ""} />
                    <span style={{ minWidth: 60 }}>{members}</span>
                    <button className="secondary">Save</button>
                    <button className="danger" formAction={deleteGroup}>Delete</button>
                  </form>
                </td>
              </tr>
            ))}
            {!groups.length && <tr><td colSpan={5} className="muted">No groups yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>New group</h2>
      <form action={saveGroup} className="card form-grid">
        <div><label>Name</label><input name="name" required placeholder="wholesale" /></div>
        <div><label>Price multiplier</label><input name="multiplier" type="number" step="any" min={0} defaultValue={1} /></div>
        <div><label>Description</label><input name="description" /></div>
        <div><button>Create group</button></div>
      </form>
    </>
  );
}
