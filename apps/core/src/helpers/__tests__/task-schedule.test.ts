import { describe, expect, it } from "vitest";

import {
  computeIntervalNextRun,
  computeScheduleNextRun,
  inferLegacyIntervalDaysFromCron,
  isDueRunPastScheduleEnd,
} from "@/helpers/task-schedule";

describe("task-schedule helpers", () => {
  it("infers legacy every-N-days cron patterns", () => {
    expect(inferLegacyIntervalDaysFromCron("30 9 */2 * *")).toBe(2);
    expect(inferLegacyIntervalDaysFromCron("30 9 */1 * *")).toBeNull();
    expect(inferLegacyIntervalDaysFromCron("30 9 * * *")).toBeNull();
  });

  it("computes interval next run from anchor", () => {
    const anchorAt = new Date("2026-06-01T09:00:00.000Z");
    const from = new Date("2026-06-05T10:00:00.000Z");

    expect(computeIntervalNextRun(anchorAt, 2, from)).toEqual(
      new Date("2026-06-07T09:00:00.000Z"),
    );
  });

  it("uses interval metadata when computing schedule next run", () => {
    const nextRun = computeScheduleNextRun(
      {
        version: 1,
        mode: "recurring",
        scheduledAt: "2026-06-01T09:00:00.000Z",
        expr: "0 9 * * *",
        timezone: "UTC",
        endsMode: "never",
        intervalDays: 2,
        anchorAt: "2026-06-01T09:00:00.000Z",
      },
      new Date("2026-06-04T10:00:00.000Z"),
    );

    expect(nextRun).toEqual(new Date("2026-06-05T09:00:00.000Z"));
  });

  it("allows a due run on the end date", () => {
    const metadata = {
      version: 1 as const,
      mode: "recurring" as const,
      scheduledAt: "2026-06-01T09:00:00.000Z",
      expr: "0 9 * * *",
      timezone: "UTC",
      endsMode: "on" as const,
      endsOn: "2026-06-10T23:59:59.999Z",
    };

    expect(
      isDueRunPastScheduleEnd(metadata, new Date("2026-06-10T09:00:00.000Z")),
    ).toBe(false);
    expect(
      isDueRunPastScheduleEnd(metadata, new Date("2026-06-11T09:00:00.000Z")),
    ).toBe(true);
  });
});
