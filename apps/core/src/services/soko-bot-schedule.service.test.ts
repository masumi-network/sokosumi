import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({ default: {} }));

import {
  resolveScheduleTiming,
  SokoBotScheduleValidationError,
} from "./soko-bot-schedule.service";

const now = new Date("2026-09-30T12:00:00.000Z");

describe("resolveScheduleTiming", () => {
  it("runs a one-time schedule exactly at runAt, mirroring it as wall-clock cron", () => {
    const timing = resolveScheduleTiming(
      { runAt: "2026-10-01T09:00:00+02:00", timezone: "Europe/Berlin" },
      now,
    );
    expect(timing).toEqual({
      cronExpression: "0 9 1 10 *",
      nextRunAt: new Date("2026-10-01T07:00:00.000Z"),
      runOnce: true,
    });
  });

  it("rejects a one-time schedule in the past or beyond a year", () => {
    expect(() =>
      resolveScheduleTiming(
        { runAt: "2026-09-30T11:00:00Z", timezone: "UTC" },
        now,
      ),
    ).toThrow(SokoBotScheduleValidationError);
    expect(() =>
      resolveScheduleTiming(
        { runAt: "2028-01-01T09:00:00Z", timezone: "UTC" },
        now,
      ),
    ).toThrow(SokoBotScheduleValidationError);
  });

  it("finds the first Monday of each month with the # weekday form", () => {
    const first = resolveScheduleTiming(
      { cronExpression: "0 10 * * 1#1", timezone: "Europe/Berlin" },
      now,
    );
    expect(first.runOnce).toBe(false);
    // 5 Oct 2026 is the first Monday of October; 10:00 Berlin is 08:00 UTC.
    expect(first.nextRunAt).toEqual(new Date("2026-10-05T08:00:00.000Z"));
    const second = resolveScheduleTiming(
      { cronExpression: "0 10 * * 1#1", timezone: "Europe/Berlin" },
      new Date(first.nextRunAt.getTime() + 60_000),
    );
    // 2 Nov 2026, after the switch to winter time.
    expect(second.nextRunAt).toEqual(new Date("2026-11-02T09:00:00.000Z"));
  });

  it("rejects day-of-month combined with a weekday, which cron reads as either", () => {
    expect(() =>
      resolveScheduleTiming(
        { cronExpression: "0 10 1-7 * 1", timezone: "UTC" },
        now,
      ),
    ).toThrow(/either one/);
  });

  it("needs a cron or a runAt", () => {
    expect(() => resolveScheduleTiming({ timezone: "UTC" }, now)).toThrow(
      SokoBotScheduleValidationError,
    );
  });
});
