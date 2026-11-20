import { describe, expect, it } from "vitest";
import {
  fillScheduleTaskName,
  SCHEDULE_TASK_NAME_MAX_LENGTH,
  scheduleTaskNameLength,
} from "./task-schedule-name.js";

describe("fillScheduleTaskName", () => {
  it("puts the run's date in the schedule's time zone", () => {
    // 23:30 UTC on Nov 22 is already Nov 23 in Zurich.
    const runAt = new Date("2026-11-22T23:30:00Z");
    expect(
      fillScheduleTaskName("Weekly report {date}", runAt, "Europe/Zurich"),
    ).toBe("Weekly report 2026-11-23");
    expect(
      fillScheduleTaskName("Weekly report {date}", runAt, "America/New_York"),
    ).toBe("Weekly report 2026-11-22");
  });

  it("fills every {date} and leaves names without it alone", () => {
    const runAt = new Date("2026-01-05T09:00:00Z");
    expect(fillScheduleTaskName("{date}: plan for {date}", runAt, "UTC")).toBe(
      "2026-01-05: plan for 2026-01-05",
    );
    expect(fillScheduleTaskName("Weekly report", runAt, "UTC")).toBe(
      "Weekly report",
    );
  });

  it("writes a zero-padded YYYY-MM-DD in any locale", () => {
    const runAt = new Date("0987-02-03T12:00:00Z");
    expect(fillScheduleTaskName("{date}", runAt, "UTC")).toBe("0987-02-03");
  });

  it("cuts an older over-limit name at the Task name limit without splitting a character", () => {
    const name = `${"a".repeat(9989)}{date}😀`;
    const filled = fillScheduleTaskName(
      name,
      new Date("2026-01-05T09:00:00Z"),
      "UTC",
    );

    expect(filled.length).toBeLessThanOrEqual(SCHEDULE_TASK_NAME_MAX_LENGTH);
    expect(filled).toBe(`${"a".repeat(9989)}2026-01-05`);
  });

  it("measures the name a Run's Task gets", () => {
    expect(scheduleTaskNameLength("Report")).toBe(6);
    expect(scheduleTaskNameLength("Report {date} {date}")).toBe(28);
  });

  it("falls back to UTC for an unknown time zone", () => {
    const runAt = new Date("2026-03-01T01:00:00Z");
    expect(fillScheduleTaskName("Report {date}", runAt, "Not/AZone")).toBe(
      "Report 2026-03-01",
    );
  });
});
