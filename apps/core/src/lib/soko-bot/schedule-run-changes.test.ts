import { describe, expect, it } from "vitest";

import {
  effectiveRuns,
  isCronTime,
  nextEffectiveRun,
} from "./schedule-run-changes";

// Daily at 09:00 UTC.
const DAILY = { cronExpression: "0 9 * * *", timezone: "UTC" };
const at = (iso: string) => new Date(iso);
const START = at("2026-06-01T00:00:00.000Z");
const END = at("2026-06-06T00:00:00.000Z");
const times = (runs: { at: Date; originalAt: Date }[]) =>
  runs.map((run) => [run.at.toISOString(), run.originalAt.toISOString()]);

describe("effectiveRuns", () => {
  it("is the cron when nothing changed", () => {
    expect(
      effectiveRuns(DAILY, [], START, END, 10).map((run) =>
        run.at.toISOString(),
      ),
    ).toEqual([
      "2026-06-01T09:00:00.000Z",
      "2026-06-02T09:00:00.000Z",
      "2026-06-03T09:00:00.000Z",
      "2026-06-04T09:00:00.000Z",
      "2026-06-05T09:00:00.000Z",
    ]);
  });

  it("drops a skipped later run and fires a moved one once, at its new time", () => {
    const runs = effectiveRuns(
      DAILY,
      [
        { originalAt: at("2026-06-03T09:00:00.000Z"), scheduledAt: null },
        // Wednesday's run moved before Tuesday's: order follows the new time.
        {
          originalAt: at("2026-06-04T09:00:00.000Z"),
          scheduledAt: at("2026-06-02T07:30:00.000Z"),
        },
      ],
      START,
      END,
      10,
    );
    expect(times(runs)).toEqual([
      ["2026-06-01T09:00:00.000Z", "2026-06-01T09:00:00.000Z"],
      ["2026-06-02T07:30:00.000Z", "2026-06-04T09:00:00.000Z"],
      ["2026-06-02T09:00:00.000Z", "2026-06-02T09:00:00.000Z"],
      ["2026-06-05T09:00:00.000Z", "2026-06-05T09:00:00.000Z"],
    ]);
  });

  it("keeps a run moved past `after` even when its own time is behind it", () => {
    const runs = effectiveRuns(
      DAILY,
      [
        {
          originalAt: at("2026-06-01T09:00:00.000Z"),
          scheduledAt: at("2026-06-03T18:00:00.000Z"),
        },
      ],
      at("2026-06-02T12:00:00.000Z"),
      END,
      2,
    );
    expect(times(runs)).toEqual([
      ["2026-06-03T09:00:00.000Z", "2026-06-03T09:00:00.000Z"],
      ["2026-06-03T18:00:00.000Z", "2026-06-01T09:00:00.000Z"],
    ]);
  });

  it("drops a run moved behind `after`: it already fired", () => {
    expect(
      times(
        effectiveRuns(
          DAILY,
          [
            {
              originalAt: at("2026-06-04T09:00:00.000Z"),
              scheduledAt: at("2026-06-01T10:00:00.000Z"),
            },
          ],
          at("2026-06-01T12:00:00.000Z"),
          END,
          10,
        ),
      ),
    ).toEqual([
      ["2026-06-02T09:00:00.000Z", "2026-06-02T09:00:00.000Z"],
      ["2026-06-03T09:00:00.000Z", "2026-06-03T09:00:00.000Z"],
      ["2026-06-05T09:00:00.000Z", "2026-06-05T09:00:00.000Z"],
    ]);
  });
});

describe("nextEffectiveRun", () => {
  it("walks past skipped cron times to the next run that fires", () => {
    expect(
      nextEffectiveRun(
        DAILY,
        [
          { originalAt: at("2026-06-01T09:00:00.000Z"), scheduledAt: null },
          { originalAt: at("2026-06-02T09:00:00.000Z"), scheduledAt: null },
        ],
        START,
      ),
    ).toEqual(at("2026-06-03T09:00:00.000Z"));
  });
});

describe("isCronTime", () => {
  it("knows the schedule's own times", () => {
    expect(isCronTime(DAILY, at("2026-06-02T09:00:00.000Z"))).toBe(true);
    expect(isCronTime(DAILY, at("2026-06-02T09:30:00.000Z"))).toBe(false);
  });
});
