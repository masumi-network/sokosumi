import { describe, expect, it } from "vitest";

import { createTestFormatter } from "@/test/intl-formatter";

import { formatRunTimeLabel } from "./run-time-label";

const formatter = createTestFormatter({ timeZone: "UTC" });

function label(at: Date, now: Date) {
  return formatRunTimeLabel(
    at,
    formatter,
    (key, values) => `${key}${values ? JSON.stringify(values) : ""}`,
    now,
  );
}

describe("formatRunTimeLabel", () => {
  const now = new Date(2030, 0, 2, 9, 0);

  it("reports a passed time as overdue", () => {
    expect(label(new Date(2030, 0, 2, 8, 59), now)).toBe("overdue");
  });

  it("counts minutes within the hour, rounding up", () => {
    expect(label(new Date(2030, 0, 2, 9, 30, 10), now)).toBe(
      'inMinutes{"minutes":31}',
    );
  });

  it("counts hours within the day", () => {
    expect(label(new Date(2030, 0, 2, 13, 0), now)).toBe('inHours{"hours":4}');
  });

  it("names tomorrow with its time", () => {
    const at = new Date(2030, 0, 3, 10, 0);
    expect(label(at, now)).toBe(
      `tomorrowAt${JSON.stringify({ time: formatter.dateTime(at, "time") })}`,
    );
  });

  it("falls back to a date and time", () => {
    const at = new Date(2030, 0, 5, 10, 0);
    expect(label(at, now)).toBe(
      `at${JSON.stringify({ datetime: formatter.dateTime(at, "dateTime") })}`,
    );
  });
});
