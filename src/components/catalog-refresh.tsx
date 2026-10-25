"use client";

import { useActionState } from "react";
import { refreshCatalogCosts } from "@/app/admin/actions";

const fmt = (c: { input: number; output: number; cacheRead?: number } | null) =>
  c ? `$${c.input} / $${c.output}${c.cacheRead != null ? ` (cached $${c.cacheRead})` : ""}` : "—";

export function CatalogRefresh({ id }: { id: number }) {
  const [result, action, pending] = useActionState(refreshCatalogCosts, null);
  return (
    <form action={action}>
      <input type="hidden" name="id" value={id} />
      <button className="secondary" disabled={pending}>{pending ? "Refreshing…" : "Refresh costs from catalog"}</button>
      {result && (
        <div className="notice">
          <span className={result.ok ? "badge ok" : "badge off"}>{result.ok ? "OK" : "FAILED"}</span> {result.message}
          {result.changes.map((c) => (
            <div key={c.model} className="mono">{c.model}: {fmt(c.before)} → {fmt(c.after)}</div>
          ))}
          {result.missing.length > 0 && <div>No longer in the catalog: <span className="mono">{result.missing.join(", ")}</span></div>}
        </div>
      )}
    </form>
  );
}
