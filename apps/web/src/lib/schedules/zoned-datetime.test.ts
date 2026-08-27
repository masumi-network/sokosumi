import { describe, expect, it } from "vitest";

import {
  endOfLocalDateInTimezone,
  gregorianDayOfWeek,
  parseDateTimeLocalParts,
  utcToDateTimeLocalInTimezone,
  zonedDateTimeLocalToUtc,
} from "@/lib/schedules/zoned-datetime";

describe("zonedDateTimeLocalToUtc", () => {
  it("converts wall-clock time in America/New_York to UTC", () => {
    const result = zonedDateTimeLocalToUtc(
      "2026-06-24T15:30",
      "America/New_York",
    );

    expect(result?.toISOString()).toBe("2026-06-24T19:30:00.000Z");
  });

  it("converts wall-clock time in Asia/Tokyo to UTC", () => {
    const result = zonedDateTimeLocalToUtc("2026-06-24T15:30", "Asia/Tokyo");

    expect(result?.toISOString()).toBe("2026-06-24T06:30:00.000Z");
  });
});

describe("endOfLocalDateInTimezone", () => {
  it("returns end of day in the selected timezone", () => {
    const result = endOfLocalDateInTimezone("2026-06-24", "America/New_York");

    expect(result?.toISOString()).toBe("2026-06-25T03:59:59.999Z");
  });
});

describe("utcToDateTimeLocalInTimezone", () => {
  it("formats UTC instants in the selected timezone", () => {
    const formatted = utcToDateTimeLocalInTimezone(
      new Date("2026-06-24T19:30:00.000Z"),
      "America/New_York",
    );

    expect(formatted).toBe("2026-06-24T15:30");
  });
});

describe("parseDateTimeLocalParts", () => {
  it("reads wall-clock fields without applying a runtime timezone", () => {
    expect(parseDateTimeLocalParts("2026-06-24T15:30")).toEqual({
      year: 2026,
      month: 6,
      day: 24,
      hour: 15,
      minute: 30,
    });
  });
});

describe("gregorianDayOfWeek", () => {
  it("returns the weekday for a calendar date", () => {
    expect(gregorianDayOfWeek(2026, 6, 24)).toBe(3);
  });
});
