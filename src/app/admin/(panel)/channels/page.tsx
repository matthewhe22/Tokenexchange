import { asc, desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ChannelForm } from "@/components/channel-form";
import { PROVIDER_INFO } from "@/relay/providers/info";
import { saveChannel, toggleChannel } from "../../actions";

export default async function ChannelsPage() {
  const rows = await getDb()
    .select()
    .from(schema.channels)
    .orderBy(asc(schema.channels.source), desc(schema.channels.priority), asc(schema.channels.id));

  return (
    <>
      <h1>Channels</h1>
      <p className="muted">
        Each channel is one upstream account. Requests go to the highest-priority enabled channel that serves the model,
        weighted-random within a priority, and fall over to the next one on 401/403/404/429/5xx.
      </p>
      <div className="card scroll">
        <table>
          <thead>
            <tr><th>Name</th><th>Provider</th><th>Source</th><th>Models</th><th>Priority / weight</th><th>Cost ×</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td><a href={`/admin/channels/${c.id}`}>{c.name}</a></td>
                <td>{PROVIDER_INFO[c.provider].label}</td>
                <td>{c.source}</td>
                <td className="mono">{c.models.join(", ")}</td>
                <td>{c.priority} / {c.weight}</td>
                <td>{c.costMultiplier}</td>
                <td>
                  {c.enabled ? <span className="badge ok">enabled</span> : <span className="badge off">disabled</span>}
                  {c.failCount > 0 && <span className="badge off" style={{ marginLeft: 4 }}>{c.failCount} fails</span>}
                </td>
                <td>
                  <form action={toggleChannel}>
                    <input type="hidden" name="id" value={c.id} />
                    <button className="secondary">{c.enabled ? "Disable" : "Enable"}</button>
                  </form>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="muted">No channels yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Add channel</h2>
      <ChannelForm
        action={saveChannel}
        value={{ name: "", provider: "openai", source: "", baseUrl: "", config: {}, models: [], modelMapping: {}, priority: 0, weight: 1, costMultiplier: 1, enabled: true, storedCredentials: [] }}
      />
    </>
  );
}
