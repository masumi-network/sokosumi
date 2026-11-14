import { describe, expect, it } from "vitest";

import { MAX_RUNS_PER_SCHEDULE, runTimes } from "./read-soko-bot";

const FROM = new Date("2026-06-01T00:00:00.000Z");
const TO = new Date("2026-06-08T00:00:00.000Z");

describe("runTimes", () => {
  it("starts at the range when the next run is before it", () => {
    const times = runTimes(
      {
        cronExpression: "0 12 * * *",
        timezone: "UTC",
        runOnce: false,
        nextRunAt: new Date("2026-05-20T12:00:00.000Z"),
      },
      FROM,
      TO,
    );
    expect(times.map((t) => t.toISOString())).toEqual([
      "2026-06-01T12:00:00.000Z",
      "2026-06-02T12:00:00.000Z",
      "2026-06-03T12:00:00.000Z",
      "2026-06-04T12:00:00.000Z",
      "2026-06-05T12:00:00.000Z",
      "2026-06-06T12:00:00.000Z",
      "2026-06-07T12:00:00.000Z",
    ]);
  });

  it("caps a schedule that runs every minute", () => {
    const times = runTimes(
      {
        cronExpression: "* * * * *",
        timezone: "UTC",
        runOnce: false,
        nextRunAt: FROM,
      },
      FROM,
      TO,
    );
    expect(times).toHaveLength(MAX_RUNS_PER_SCHEDULE);
    expect(times[0]).toEqual(FROM);
  });

  it("shows a one-time run only inside the range", () => {
    const once = (at: string) => ({
      cronExpression: "0 9 1 6 *",
      timezone: "UTC",
      runOnce: true,
      nextRunAt: new Date(at),
    });
    expect(runTimes(once("2026-06-01T09:00:00.000Z"), FROM, TO)).toHaveLength(
      1,
    );
    expect(runTimes(once("2026-06-08T00:00:00.000Z"), FROM, TO)).toEqual([]);
  });

  it("shows nothing for a cron it cannot read", () => {
    expect(
      runTimes(
        {
          cronExpression: "nope",
          timezone: "UTC",
          runOnce: false,
          nextRunAt: FROM,
        },
        FROM,
        TO,
      ),
    ).toEqual([]);
  });
});
