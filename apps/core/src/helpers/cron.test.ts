import { describe, expect, it } from "vitest";

import { computeNextRun, computeNextRunWithMinimumInterval } from "./cron";

describe("cron helpers", () => {
  const from = new Date("2026-08-17T12:00:00.000Z");

  it("computes next run in requested timezone", () => {
    expect(
      computeNextRun({
        cron: "0 9 * * *",
        timezone: "Europe/Zurich",
        from,
      })?.toISOString(),
    ).toBe("2026-08-18T07:00:00.000Z");
  });

  it("rejects schedules whose recurring interval is below policy", () => {
    expect(
      computeNextRunWithMinimumInterval(
        { cron: "*/10 * * * * *", timezone: "UTC", from },
        60_000,
      ),
    ).toBeNull();
  });

  it("accepts one-minute schedules independent of current wall-clock offset", () => {
    const offBoundary = new Date("2026-08-17T12:00:42.000Z");
    expect(
      computeNextRunWithMinimumInterval(
        { cron: "* * * * *", timezone: "UTC", from: offBoundary },
        60_000,
      )?.toISOString(),
    ).toBe("2026-08-17T12:01:00.000Z");
  });

  it("keeps Europe/Zurich wall-clock intent across DST boundaries", () => {
    expect(
      computeNextRun({
        cron: "30 2 * * *",
        timezone: "Europe/Zurich",
        from: new Date("2026-03-28T12:00:00.000Z"),
      })?.toISOString(),
    ).toBe("2026-03-29T01:30:00.000Z");
    expect(
      computeNextRun({
        cron: "30 2 * * *",
        timezone: "Europe/Zurich",
        from: new Date("2026-10-24T12:00:00.000Z"),
      })?.toISOString(),
    ).toBe("2026-10-25T00:30:00.000Z");
  });
});
