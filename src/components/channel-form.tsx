"use client";

import { useState } from "react";
import { PROVIDERS, SOURCES, type Provider } from "@/db/enums";
import { PROVIDER_INFO } from "@/relay/providers/info";

export interface ChannelFormValue {
  id?: number;
  name: string;
  provider: Provider;
  source: string;
  baseUrl: string;
  config: Record<string, string>;
  models: string[];
  modelMapping: Record<string, string>;
  priority: number;
  weight: number;
  costMultiplier: number;
  enabled: boolean;
  /** Which credential fields already hold a value (values themselves are never sent to the browser). */
  storedCredentials: string[];
}

const CRED_LABELS: Record<string, string> = {
  apiKey: "API key",
  accessKeyId: "AWS access key ID",
  secretAccessKey: "AWS secret access key",
  sessionToken: "AWS session token (optional)",
  serviceAccount: "Service account JSON",
};

const CONFIG_LABELS: Record<string, string> = {
  resource: "Azure resource name",
  apiVersion: "API version (optional)",
  region: "AWS region",
  projectId: "GCP project ID (defaults to the service account's)",
  location: "Location (default: global)",
};

export function ChannelForm({ value, action }: { value: ChannelFormValue; action: (form: FormData) => Promise<void> }) {
  const [provider, setProvider] = useState<Provider>(value.provider);
  const info = PROVIDER_INFO[provider];

  return (
    <form action={action} className="card">
      {value.id && <input type="hidden" name="id" value={value.id} />}
      <div className="form-grid">
        <div>
          <label>Provider</label>
          <select name="provider" value={provider} onChange={(e) => setProvider(e.target.value as Provider)}>
            {PROVIDERS.map((p) => (
              <option key={p} value={p}>{PROVIDER_INFO[p].label}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Procurement source</label>
          <select name="source" defaultValue={value.source || ""} key={provider}>
            <option value="">Default for provider ({info.defaultSource})</option>
            {SOURCES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Name</label>
          <input name="name" defaultValue={value.name} placeholder={info.label} />
        </div>
        <div>
          <label>Base URL {provider.endsWith("_compatible") ? "(required)" : "(optional override)"}</label>
          <input name="baseUrl" defaultValue={value.baseUrl} placeholder={info.baseUrlHint} required={provider.endsWith("_compatible")} />
        </div>

        {info.configFields.map((k) => (
          <div key={k}>
            <label>{CONFIG_LABELS[k] ?? k}</label>
            <input name={`config.${k}`} defaultValue={value.config[k] ?? ""} />
          </div>
        ))}

        {info.credentialFields.map((k) => (
          <div key={k} className={k === "serviceAccount" ? "wide" : undefined}>
            <label>
              {CRED_LABELS[k] ?? k}
              {value.storedCredentials.includes(k) && " — stored, leave blank to keep"}
            </label>
            {k === "serviceAccount" ? (
              <textarea name={`cred.${k}`} placeholder='{"type":"service_account", ...}' />
            ) : (
              <input name={`cred.${k}`} type="password" autoComplete="off" />
            )}
          </div>
        ))}
        {provider === "bedrock" && (
          <div className="wide muted">Use either a Bedrock API key, or an access key ID + secret access key.</div>
        )}

        <div className="wide">
          <label>Models served (public names, comma or newline separated)</label>
          <textarea name="models" defaultValue={value.models.join("\n")} placeholder={"gpt-4o\nclaude-sonnet-4-5"} />
        </div>
        <div className="wide">
          <label>Model mapping (one per line: public-name=upstream-id). Needed for Azure deployments, Bedrock model IDs, etc.</label>
          <textarea
            name="modelMapping"
            defaultValue={Object.entries(value.modelMapping).map(([a, b]) => `${a}=${b}`).join("\n")}
            placeholder="claude-sonnet-4-5=us.anthropic.claude-sonnet-4-5-20250929-v1:0"
          />
        </div>
        <div>
          <label>Priority (higher is tried first)</label>
          <input name="priority" type="number" defaultValue={value.priority} />
        </div>
        <div>
          <label>Weight (within same priority)</label>
          <input name="weight" type="number" min={1} defaultValue={value.weight} />
        </div>
        <div>
          <label>Cost multiplier (our cost ÷ list price)</label>
          <input name="costMultiplier" type="number" step="0.001" min={0} defaultValue={value.costMultiplier} />
        </div>
        <div className="row" style={{ alignSelf: "end" }}>
          <input id="enabled" name="enabled" type="checkbox" defaultChecked={value.enabled} />
          <label htmlFor="enabled" style={{ margin: 0 }}>Enabled</label>
        </div>
      </div>
      <div className="row" style={{ marginTop: 16 }}>
        <button>{value.id ? "Save channel" : "Create channel"}</button>
      </div>
    </form>
  );
}
