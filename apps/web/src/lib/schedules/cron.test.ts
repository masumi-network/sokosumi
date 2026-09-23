import { describe, expect, it } from "vitest";

import { computeScheduleTitleInfo } from "@/components/schedules/format";
import { formatTime, formatWeekday } from "@/lib/schedules/cron";
import { zonedDateTimeLocalToUtc } from "@/lib/schedules/zoned-datetime";
import { createTestFormatter } from "@/test/intl-formatter";

const formatter = createTestFormatter({ locale: "en-US" });

describe("formatTime", () => {
  it("formats wall-clock hour and minute in the schedule timezone", () => {
    const instant = zonedDateTimeLocalToUtc(
      "2026-06-24T09:00",
      "America/New_York",
    );
    const expected = formatter.dateTime(instant!, "time", {
      timeZone: "America/New_York",
    });

    expect(formatTime(9, 0, formatter, "America/New_York")).toBe(expected);
    expect(formatTime(9, 0, formatter, "America/New_York")).toMatch(/9:00/);
  });

  it("uses the formatter locale instead of the runtime default", () => {
    const de = createTestFormatter({ locale: "de", hourCycle: "h23" });
    expect(formatTime(9, 0, de, "UTC")).toMatch(/09:00|9:00/);
  });
});

describe("formatWeekday", () => {
  it("maps cron weekday tokens to localized weekday labels", () => {
    expect(formatWeekday("MON", formatter, "UTC").toLowerCase()).toContain(
      "monday",
    );
    expect(formatWeekday("MON", formatter, "UTC").toLowerCase()).not.toContain(
      "wednesday",
    );
  });

  it("uses the formatter locale for weekday names", () => {
    const de = createTestFormatter({ locale: "de" });
    expect(formatWeekday("MON", de, "UTC").toLowerCase()).toContain("montag");
  });
});

describe("computeScheduleTitleInfo", () => {
  it("derives weekly labels from the cron weekday", () => {
    const info = computeScheduleTitleInfo(
      {
        scheduleType: "CRON",
        cron: "0 9 * * 1",
        timezone: "UTC",
      },
      formatter,
    );

    expect(info).toEqual({
      key: "weeklyWithWeekdayTime",
      values: {
        weekday: expect.stringMatching(/monday/i),
        time: expect.any(String),
      },
    });
  });

  it("names the day step of an every-N-days rule, which the cron does not carry", () => {
    const info = computeScheduleTitleInfo(
      {
        scheduleType: "CRON",
        cron: "0 9 * * *",
        timezone: "UTC",
        intervalDays: 3,
      },
      formatter,
    );

    expect(info).toEqual({
      key: "dailyEveryNWithTime",
      values: { n: 3, time: expect.any(String) },
    });
  });
});
