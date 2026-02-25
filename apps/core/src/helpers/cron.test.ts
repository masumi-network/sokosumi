import { describe, expect, it } from "vitest";

import { computeNextRun } from "./cron";

describe("computeNextRun", () => {
  const from = new Date("2025-10-06T13:30:00.000Z");

  it("returns next run for UTC cron expression", () => {
    const next = computeNextRun({
      cron: "0 14 */1 * *",
      timezone: "UTC",
      from,
    });

    expect(next?.toISOString()).toBe("2025-10-06T14:00:00.000Z");
  });

  it("returns next weekday run for UTC cron expression", () => {
    const next = computeNextRun({
      cron: "28 16 * * MON,WED",
      timezone: "UTC",
      from,
    });

    expect(next?.toISOString()).toBe("2025-10-06T16:28:00.000Z");
  });

  it("respects timezone when computing next run", () => {
    const next = computeNextRun({
      cron: "0 10 * * *",
      timezone: "America/New_York",
      from,
    });

    expect(next?.toISOString()).toBe("2025-10-06T14:00:00.000Z");
  });

  it("handles DST spring-forward gap", () => {
    const next = computeNextRun({
      cron: "0 1 * * *",
      timezone: "Europe/London",
      from: new Date("2025-03-30T00:30:00.000Z"),
    });

    expect(next?.toISOString()).toBe("2025-03-30T01:00:00.000Z");
  });

  it("returns null for invalid cron expression", () => {
    const next = computeNextRun({
      cron: "invalid cron",
      timezone: "UTC",
      from,
    });

    expect(next).toBeNull();
  });

  it("returns null for invalid timezone", () => {
    const next = computeNextRun({
      cron: "0 10 * * *",
      timezone: "Invalid/Timezone",
      from,
    });

    expect(next).toBeNull();
  });
});
