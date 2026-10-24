import { SOURCES } from "@/db/enums";
import { getLimitSettings, getRoutingSettings } from "@/lib/settings";
import { saveLimits, saveRouting } from "../../actions";

const SOURCE_HELP: Record<string, string> = {
  official: "Direct accounts with OpenAI, Anthropic, Google",
  cloud: "Azure OpenAI, AWS Bedrock, Google Vertex AI",
  reseller: "Third-party OpenAI/Anthropic-compatible relays",
};

export default async function SettingsPage() {
  const [routing, limits] = await Promise.all([getRoutingSettings(), getLimitSettings()]);
  return (
    <>
      <h1>Routing</h1>
      <form action={saveRouting} className="card" style={{ display: "grid", gap: 16 }}>
        <div>
          <label>Procurement sources allowed to serve traffic</label>
          {SOURCES.map((s) => (
            <div key={s} className="row">
              <input id={`src-${s}`} type="checkbox" name={`source.${s}`} defaultChecked={routing.enabledSources.includes(s)} />
              <label htmlFor={`src-${s}`} style={{ margin: 0, color: "inherit" }}>
                <strong>{s}</strong> <span className="muted">— {SOURCE_HELP[s]}</span>
              </label>
            </div>
          ))}
        </div>
        <div>
          <label>Per-model source restriction (one per line: model: source, source). Models not listed use the global setting.</label>
          <textarea
            name="modelSources"
            defaultValue={Object.entries(routing.modelSources).map(([m, s]) => `${m}: ${s.join(", ")}`).join("\n")}
            placeholder="claude-opus-4-1: official, cloud"
          />
        </div>
        <div style={{ maxWidth: 240 }}>
          <label>Max channels to try per request</label>
          <input name="maxAttempts" type="number" min={1} max={10} defaultValue={routing.maxAttempts} />
        </div>
        <div className="row">
          <input id="affinity" type="checkbox" name="affinity" defaultChecked={routing.affinity} />
          <label htmlFor="affinity" style={{ margin: 0, color: "inherit" }}>
            <strong>Channel affinity</strong> <span className="muted">— keep each API key + model on the same channel (better prompt-cache hit rates)</span>
          </label>
        </div>
        <div className="row">
          <input id="allowConversion" type="checkbox" name="allowConversion" defaultChecked={routing.allowConversion} />
          <label htmlFor="allowConversion" style={{ margin: 0, color: "inherit" }}>
            <strong>Protocol conversion</strong> <span className="muted">— serve /v1/chat/completions for Claude and Gemini models through Anthropic / Gemini channels</span>
          </label>
        </div>
        <div style={{ maxWidth: 360 }}>
          <label>Auto-disable a channel after this many consecutive failures (0 = never)</label>
          <input name="autoDisableAfter" type="number" min={0} defaultValue={routing.autoDisableAfter} />
        </div>
        <div><button>Save routing</button></div>
      </form>
      <h1 style={{ marginTop: 32 }}>Rate limits</h1>
      <form action={saveLimits} className="card form-grid">
        <div>
          <label>Requests / minute per API key (0 = unlimited). A key&apos;s own limit overrides this.</label>
          <input name="defaultKeyRpm" type="number" min={0} defaultValue={limits.defaultKeyRpm} />
        </div>
        <div>
          <label>Requests / minute per user across all keys (0 = unlimited)</label>
          <input name="userRpm" type="number" min={0} defaultValue={limits.userRpm} />
        </div>
        <div><button>Save limits</button></div>
      </form>
      <p className="muted">
        Changes reach every serverless instance within about 10 seconds. Counters use Upstash Redis when
        UPSTASH_REDIS_REST_URL is set, otherwise the database.
      </p>
    </>
  );
}
