import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, lastNDays, startOfToday, tzLabel } from "@/lib/time";

describe("Melbourne display time", () => {
  it("formats in AEDT during daylight saving (UTC+11)", () => {
    const d = new Date("2026-10-24T21:13:27Z");
    expect(formatDateTime(d)).toBe("2026-10-25 08:13");
    expect(formatDateTime(d, { seconds: true })).toBe("2026-10-25 08:13:27");
    expect(formatDate(d)).toBe("2026-10-25");
    expect(tzLabel(d)).toBe("AEDT");
  });

  it("formats in AEST in winter (UTC+10)", () => {
    const d = new Date("2026-07-01T00:30:00Z");
    expect(formatDateTime(d)).toBe("2026-07-01 10:30");
    expect(tzLabel(d)).toBe("AEST");
  });

  it("starts 'today' at Melbourne midnight", () => {
    expect(startOfToday(new Date("2026-10-24T21:13:27Z")).toISOString()).toBe("2026-10-24T13:00:00.000Z");
    expect(startOfToday(new Date("2026-07-01T00:30:00Z")).toISOString()).toBe("2026-06-30T14:00:00.000Z");
  });

  it("lists local days across the DST change (4 Oct 2026)", () => {
    const { days, since } = lastNDays(3, new Date("2026-10-05T03:00:00Z"));
    expect(days).toEqual(["2026-10-03", "2026-10-04", "2026-10-05"]);
    // 3 Oct is still AEST, so local midnight is 14:00 UTC the day before
    expect(since.toISOString()).toBe("2026-10-02T14:00:00.000Z");
  });
});
