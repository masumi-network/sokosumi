import { format } from "date-fns";
import { describe, expect, it } from "vitest";

import {
  getCalendarRange,
  getLatestCalendarDate,
  resolveCalendarDate,
} from "./calendar-range";

const NOW = new Date(2026, 0, 10, 12);

describe("getLatestCalendarDate", () => {
  it("keeps the last complete calendar grid within the default 90-day horizon", () => {
    const latest = getLatestCalendarDate(NOW);

    expect(format(latest, "yyyy-MM-dd")).toBe("2026-03-01");
    expect(
      getCalendarRange(format(latest, "yyyy-MM-dd")).to.getTime(),
    ).toBeLessThanOrEqual(NOW.getTime() + 90 * 24 * 60 * 60 * 1000);
  });

  it.each([
    [new Date(2026, 1, 20), "2026-03-01"],
    [new Date(2026, 2, 31), "2026-03-01"],
    [new Date(2026, 3, 1), "2026-04-01"],
    [new Date(2026, 6, 31, 23, 59), "2026-07-01"],
    [new Date(2027, 0, 15), "2027-01-01"],
  ])(
    "includes the month of a scheduled post at %s",
    (scheduledAt, expected) => {
      const latest = getLatestCalendarDate(NOW, scheduledAt);

      expect(format(latest, "yyyy-MM-dd")).toBe(expected);
    },
  );

  it("loads the full month containing a post on its last day", () => {
    const scheduledAt = new Date(2026, 6, 31, 23, 59);
    const range = getCalendarRange(
      format(getLatestCalendarDate(NOW, scheduledAt), "yyyy-MM-dd"),
    );
    expect(range.from.getTime()).toBeLessThan(scheduledAt.getTime());
    expect(range.to.getTime()).toBeGreaterThan(scheduledAt.getTime());
  });

  it("keeps the default when no scheduled post exists", () => {
    expect(getLatestCalendarDate(NOW, null)).toEqual(
      getLatestCalendarDate(NOW),
    );
  });
});

describe("resolveCalendarDate", () => {
  const scheduledAt = new Date(2026, 6, 31, 23, 59);

  it("accepts a URL date beyond 90 days in the latest scheduled month", () => {
    expect(resolveCalendarDate("2026-07-31", NOW, scheduledAt)).toBe(
      "2026-07-31",
    );
  });

  it("clamps a URL beyond the latest scheduled month", () => {
    expect(resolveCalendarDate("2027-01-01", NOW, scheduledAt)).toBe(
      "2026-07-01",
    );
  });

  it("clamps a URL beyond the default horizon when no post exists", () => {
    expect(resolveCalendarDate("2026-07-31", NOW)).toBe("2026-03-01");
  });

  it.each([undefined, "invalid"])("falls back to today for %s", (dateParam) => {
    expect(resolveCalendarDate(dateParam, NOW, scheduledAt)).toBe("2026-01-10");
  });
});
