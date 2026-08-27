import { describe, expect, it } from "vitest";

import { computeScheduleTitleInfo } from "@/components/schedules/format";
import { formatTime, formatWeekday } from "@/lib/schedules/cron";
import { zonedDateTimeLocalToUtc } from "@/lib/schedules/zoned-datetime";

describe("formatTime", () => {
  it("formats wall-clock hour and minute in the schedule timezone", () => {
    const instant = zonedDateTimeLocalToUtc(
      "2026-06-24T09:00",
      "America/New_York",
    );
    const expected = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(instant!);

    expect(formatTime(9, 0, "America/New_York")).toBe(expected);
    expect(formatTime(9, 0, "America/New_York")).toMatch(/9:00/);
  });
});

describe("formatWeekday", () => {
  it("maps cron weekday tokens to localized weekday labels", () => {
    expect(formatWeekday("MON", "UTC").toLowerCase()).toContain("monday");
    expect(formatWeekday("MON", "UTC").toLowerCase()).not.toContain(
      "wednesday",
    );
  });
});

describe("computeScheduleTitleInfo", () => {
  it("derives weekly labels from the cron weekday", () => {
    const info = computeScheduleTitleInfo({
      scheduleType: "CRON",
      cron: "0 9 * * 1",
      timezone: "UTC",
    });

    expect(info).toEqual({
      key: "weeklyWithWeekdayTime",
      values: {
        weekday: expect.stringMatching(/monday/i),
        time: expect.any(String),
      },
    });
  });
});
