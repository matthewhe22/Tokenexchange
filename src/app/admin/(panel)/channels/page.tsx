import { asc, desc } from "drizzle-orm";
import { getDb, schema } from "@/db";
import { ChannelForm } from "@/components/channel-form";
import { CHANNEL_PRESETS, PROVIDER_INFO } from "@/relay/providers/info";
import { saveChannel, toggleChannel } from "../../actions";

export default async function ChannelsPage({ searchParams }: { searchParams: Promise<{ preset?: string }> }) {
  const { preset: presetKey } = await searchParams;
  const preset = presetKey ? CHANNEL_PRESETS[presetKey] : undefined;
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
                <td>{c.fixedCostHourly != null ? `$${c.fixedCostHourly}/h fixed` : c.costMultiplier}</td>
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

      <h2 id="add">Add channel</h2>
      <div className="row" style={{ marginBottom: 12, flexWrap: "wrap" }}>
        <span className="muted">Start from:</span>
        <a className={!preset ? "badge ok" : "badge"} href="/admin/channels#add">Blank</a>
        {Object.entries(CHANNEL_PRESETS).map(([k, p]) => (
          <a key={k} className={presetKey === k ? "badge ok" : "badge"} href={`/admin/channels?preset=${k}#add`}>{p.name}</a>
        ))}
      </div>
      {preset && <div className="notice">{preset.note} After saving, open the channel to import models and prices from its catalog.</div>}
      <ChannelForm
        key={presetKey ?? "blank"}
        action={saveChannel}
        value={{
          name: preset?.name ?? "",
          provider: preset?.provider ?? "openai",
          source: preset?.source ?? "",
          baseUrl: preset?.baseUrl ?? "",
          config: preset?.config ?? {},
          models: [],
          modelMapping: {},
          priority: 0,
          weight: 1,
          costMultiplier: 1,
          modelCosts: {},
          fixedCostHourly: null,
          capacityTpm: null,
          commitmentEndsAt: "",
          enabled: true,
          storedCredentials: [],
        }}
      />
    </>
  );
}
