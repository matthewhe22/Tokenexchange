import Link from "next/link";
import { capacityReport } from "@/lib/capacity";
import { formatUsd } from "@/lib/money";
import { formatDate } from "@/lib/time";

const WINDOWS = { "24h": 24, "7d": 24 * 7, "30d": 24 * 30 } as const;
const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export default async function CapacityPage({ searchParams }: { searchParams: Promise<{ window?: string }> }) {
  const { window: w } = await searchParams;
  const key = (w && w in WINDOWS ? w : "7d") as keyof typeof WINDOWS;
  const rows = await capacityReport(WINDOWS[key]);

  return (
    <>
      <h1>Committed capacity</h1>
      <p className="muted">
        Take-or-pay channels (PTU, provisioned throughput, reserved instances). The commitment is paid whether or not it is
        used, so the margin depends on utilization: below break-even the commitment loses money against pay-as-you-go.
        Set the hourly cost, tokens-per-minute capacity and end date on each channel.
      </p>
      <div className="row" style={{ marginBottom: 16 }}>
        {Object.keys(WINDOWS).map((k) => (
          <Link key={k} href={`/admin/capacity?window=${k}`} className={k === key ? "badge ok" : "badge"}>
            Last {k}
          </Link>
        ))}
      </div>
      {!rows.length && <div className="card muted">No channel has a fixed cost or capacity yet.</div>}
      {rows.map((r) => {
        const margin = r.revenue - r.fixedCost;
        const losing = r.breakEven != null && r.utilization != null && r.utilization < r.breakEven;
        return (
          <div key={r.channel.id} className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                <Link href={`/admin/channels/${r.channel.id}`}>{r.channel.name}</Link>
              </h2>
              <span>
                {!r.channel.enabled && <span className="badge off">disabled</span>}{" "}
                {losing && <span className="badge off">below break-even</span>}{" "}
                {r.daysLeft != null &&
                  (r.daysLeft <= 0 ? (
                    <span className="badge off">commitment ended {formatDate(r.channel.commitmentEndsAt!)}</span>
                  ) : (
                    <span className={r.daysLeft <= 30 ? "badge off" : "badge"}>
                      ends {formatDate(r.channel.commitmentEndsAt!)} ({r.daysLeft} days)
                    </span>
                  ))}
              </span>
            </div>
            <p className="muted" style={{ marginTop: 4 }}>
              {r.channel.fixedCostHourly != null ? `$${r.channel.fixedCostHourly}/hour` : "no fixed cost"} ·{" "}
              {r.channel.capacityTpm ? `${r.channel.capacityTpm.toLocaleString()} tokens/min` : "capacity not set"} · models{" "}
              <span className="mono">{r.channel.models.join(", ")}</span>
            </p>
            <div className="grid">
              <Stat label="Utilization" value={pct(r.utilization)} />
              <Stat label="Break-even utilization" value={pct(r.breakEven)} />
              <Stat label="Peak minute" value={pct(r.peakUtilization)} />
              <Stat label="Tokens served" value={r.tokens.toLocaleString()} />
              <Stat label="Revenue" value={formatUsd(r.revenue)} />
              <Stat label="Fixed cost" value={formatUsd(r.fixedCost)} />
              <Stat
                label="Margin"
                value={`${formatUsd(margin)}${r.revenue ? ` (${((margin / r.revenue) * 100).toFixed(1)}%)` : ""}`}
              />
              <Stat label="Requests" value={r.requests.toLocaleString()} />
            </div>
            {r.channel.capacityTpm != null && (
              <>
                <div className="muted" style={{ fontSize: 12, margin: "12px 0 4px" }}>Utilization by hour, last 24 hours</div>
                <div className="bars" style={{ height: 70 }}>
                  {r.hourly.map((u, i) => (
                    <div key={i} className="bar-col" title={`${23 - i}h ago: ${pct(u)}`}>
                      <div className="bar" style={{ height: `${Math.min(100, (u ?? 0) * 100)}%`, minHeight: u ? 2 : 0 }} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
