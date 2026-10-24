// Display time zone for the whole app. Timestamps are stored in UTC (timestamptz); this only
// controls how they are shown and where "today" and daily totals begin. Handles AEST/AEDT.
export const APP_TIMEZONE = process.env.APP_TIMEZONE || "Australia/Melbourne";

function parts(d: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(d)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "2026-10-25" in the app time zone. */
export function formatDate(d: Date): string {
  const p = parts(d);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** "2026-10-25 08:12" (or with seconds) in the app time zone. */
export function formatDateTime(d: Date, opts: { seconds?: boolean } = {}): string {
  const p = parts(d);
  return `${formatDate(d)} ${pad(p.hour)}:${pad(p.minute)}${opts.seconds ? `:${pad(p.second)}` : ""}`;
}

/** Short zone name for column headers, e.g. "AEDT" in summer and "AEST" in winter. */
export function tzLabel(d: Date = new Date()): string {
  return (
    new Intl.DateTimeFormat("en-AU", { timeZone: APP_TIMEZONE, timeZoneName: "short" }).formatToParts(d).find((p) => p.type === "timeZoneName")
      ?.value ?? APP_TIMEZONE
  );
}

/** Milliseconds the app time zone is ahead of UTC at instant `d`. */
function offsetMs(d: Date): number {
  const p = parts(d);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000;
}

/** The instant local midnight starts on calendar day y-m-d in the app time zone (DST-safe). */
export function zonedMidnight(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - offsetMs(new Date(guess));
  // The offset can differ at the corrected instant on a DST change day; one more pass settles it.
  t = guess - offsetMs(new Date(t));
  return new Date(t);
}

/** Local calendar days ending today, oldest first, plus the instant the first one starts. */
export function lastNDays(n: number, now: Date = new Date()): { days: string[]; since: Date } {
  const p = parts(now);
  const days = Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day - (n - 1 - i)));
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  });
  const [y, m, d] = days[0].split("-").map(Number);
  return { days, since: zonedMidnight(y, m, d) };
}

/** Start of today in the app time zone. */
export function startOfToday(now: Date = new Date()): Date {
  return lastNDays(1, now).since;
}
