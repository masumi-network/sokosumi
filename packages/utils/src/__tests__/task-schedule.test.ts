import { describe, expect, it } from "vitest";

import { hasActiveTaskSchedule } from "../task-schedule.js";

const onceMetadata = JSON.stringify({
  version: 1,
  mode: "once",
  scheduledAt: "2026-08-01T10:00:00.000Z",
  runAt: "2026-08-01T10:00:00.000Z",
});

const recurringMetadata = JSON.stringify({
  version: 1,
  mode: "recurring",
  scheduledAt: "2026-08-01T10:00:00.000Z",
  expr: "0 9 * * *",
  timezone: "UTC",
  endsMode: "never",
});

describe("hasActiveTaskSchedule", () => {
  it("returns true for valid once metadata without nextRunAt", () => {
    expect(hasActiveTaskSchedule(onceMetadata, null)).toBe(true);
  });

  it("returns true for valid recurring metadata without nextRunAt", () => {
    expect(hasActiveTaskSchedule(recurringMetadata, null)).toBe(true);
  });

  it("returns true when only nextRunAt is set (Date)", () => {
    expect(
      hasActiveTaskSchedule(null, new Date("2026-08-01T10:00:00.000Z")),
    ).toBe(true);
  });

  it("returns true when only nextRunAt is set (ISO string)", () => {
    expect(hasActiveTaskSchedule(null, "2026-08-01T10:00:00.000Z")).toBe(true);
  });

  it("returns false when both are empty", () => {
    expect(hasActiveTaskSchedule(null, null)).toBe(false);
    expect(hasActiveTaskSchedule(undefined, undefined)).toBe(false);
    expect(hasActiveTaskSchedule("", null)).toBe(false);
  });

  it("returns false for invalid JSON metadata without nextRunAt", () => {
    expect(hasActiveTaskSchedule("{not-json", null)).toBe(false);
  });

  it("returns false for unsupported version/mode without nextRunAt", () => {
    expect(
      hasActiveTaskSchedule(JSON.stringify({ version: 2, mode: "once" }), null),
    ).toBe(false);
    expect(
      hasActiveTaskSchedule(
        JSON.stringify({ version: 1, mode: "other" }),
        null,
      ),
    ).toBe(false);
  });

  it("returns true when nextRunAt is present even if metadata is invalid", () => {
    expect(
      hasActiveTaskSchedule("{not-json", new Date("2026-08-01T10:00:00.000Z")),
    ).toBe(true);
  });
});
