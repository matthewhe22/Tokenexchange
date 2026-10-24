"use client";

import { useActionState } from "react";
import { runChannelTest } from "@/app/admin/actions";

export function ChannelTest({ id, models }: { id: number; models: string[] }) {
  const [result, action, pending] = useActionState(runChannelTest, null);
  return (
    <form action={action} className="card">
      <input type="hidden" name="id" value={id} />
      <div className="row">
        <select name="model" style={{ maxWidth: 320 }}>
          {models.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </select>
        <button className="secondary" disabled={pending || !models.length}>{pending ? "Testing…" : "Send test request"}</button>
      </div>
      {result && (
        <div className="notice mono">
          <span className={result.ok ? "badge ok" : "badge off"}>{result.ok ? "OK" : "FAILED"}</span> HTTP {result.status} · {result.latencyMs} ms
          <div style={{ marginTop: 6 }}>{result.message}</div>
        </div>
      )}
    </form>
  );
}
