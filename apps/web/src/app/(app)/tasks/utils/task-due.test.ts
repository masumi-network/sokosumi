import { describe, expect, it } from "vitest";

import { dayInTimeZone, dueDayDate, isTaskOverdue } from "./task-due";

describe("dayInTimeZone", () => {
  it("reads the calendar day in the given zone", () => {
    const instant = new Date("2026-11-10T03:00:00.000Z");
    expect(dayInTimeZone(instant, "UTC")).toBe("2026-11-10");
    expect(dayInTimeZone(instant, "America/Los_Angeles")).toBe("2026-11-09");
  });
});

describe("isTaskOverdue", () => {
  it("is overdue after the due day while the work is unfinished", () => {
    expect(isTaskOverdue("2026-11-09", "RUNNING", "2026-11-10")).toBe(true);
    expect(isTaskOverdue("2026-11-09", "FAILED", "2026-11-10")).toBe(true);
  });

  it("is not overdue on the due day itself", () => {
    expect(isTaskOverdue("2026-11-10", "DRAFT", "2026-11-10")).toBe(false);
  });

  it("is never overdue once completed or canceled", () => {
    expect(isTaskOverdue("2026-11-01", "COMPLETED", "2026-11-10")).toBe(false);
    expect(isTaskOverdue("2026-11-01", "CANCELED", "2026-11-10")).toBe(false);
  });
});

describe("dueDayDate", () => {
  it("lands on the due day in UTC", () => {
    expect(dueDayDate("2026-11-20").toISOString().slice(0, 10)).toBe(
      "2026-11-20",
    );
  });
});
