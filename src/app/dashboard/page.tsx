import { and, eq, gte, sql } from "drizzle-orm";
import Link from "next/link";
import { getDb, schema } from "@/db";
import { CodeBlock } from "@/components/code-block";
import { VerifyBanner } from "@/components/verify-banner";
import { formatUsd } from "@/lib/money";
import { requireUser } from "@/lib/session";
import { appUrl } from "@/lib/url";
import { APP_TIMEZONE, lastNDays } from "@/lib/time";

export default async function Overview() {
  const user = await requireUser();
  const l = schema.usageLogs;
  // Days are Melbourne calendar days (see APP_TIMEZONE).
  const { days, since } = lastNDays(14);
  const daily = await getDb()
    .select({
      day: sql<string>`to_char(${l.createdAt} at time zone ${APP_TIMEZONE}, 'YYYY-MM-DD')`,
      requests: sql<number>`count(*)::int`,
      spend: sql<number>`coalesce(sum(${l.cost}), 0)::bigint`,
    })
    .from(l)
    .where(and(eq(l.userId, user.id), gte(l.createdAt, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`);

  const byDay = new Map(daily.map((d) => [d.day, { requests: d.requests, spend: Number(d.spend) }]));
  const max = Math.max(1, ...daily.map((d) => Number(d.spend)));
  const total = daily.reduce((s, d) => s + Number(d.spend), 0);
  const requests = daily.reduce((s, d) => s + d.requests, 0);

  return (
    <>
      {!user.emailVerifiedAt && <VerifyBanner email={user.email} />}
      <h1>Overview</h1>
      <div className="grid">
        <div className="card stat">
          <div className="label">Balance</div>
          <div className="value">{formatUsd(user.balance)}</div>
          <Link href="/dashboard/billing">Add credit →</Link>
        </div>
        <div className="card stat"><div className="label">Spend, last 14 days</div><div className="value">{formatUsd(total)}</div></div>
        <div className="card stat"><div className="label">Requests, last 14 days</div><div className="value">{requests.toLocaleString()}</div></div>
      </div>

      <h2>Daily spend</h2>
      <div className="card">
        <div className="bars" role="img" aria-label="Daily spend for the last 14 days">
          {days.map((d) => {
            const v = byDay.get(d)?.spend ?? 0;
            return (
              <div key={d} className="bar-col" title={`${d}: ${formatUsd(v)}, ${byDay.get(d)?.requests ?? 0} requests`}>
                <div className="bar" style={{ height: `${Math.max(2, (v / max) * 100)}%` }} />
                <span className="bar-label">{d.slice(8)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <h2>Quick start</h2>
      <p className="muted">
        Create a key on the <Link href="/dashboard/keys">API keys</Link> page, then point any OpenAI, Anthropic or Gemini SDK at this base URL.
      </p>
      <CodeBlock
        code={`curl ${appUrl()}/v1/chat/completions \\
  -H "Authorization: Bearer $TOKENEXCHANGE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model": "gpt-4o-mini", "messages": [{"role": "user", "content": "Hello"}]}'`}
      />
      <p><Link href="/docs">Full integration guide →</Link></p>
    </>
  );
}
