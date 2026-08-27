import { describe, expect, it } from "vitest";

import {
  computeIntervalNextRun,
  computeScheduleNextRun,
  inferLegacyIntervalDaysFromCron,
  isDueRunPastScheduleEnd,
  isRecurringScheduleEnded,
  projectTaskScheduleOccurrences,
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

  it("advances interval next run after a due anchor occurrence", () => {
    const anchorAt = new Date("2026-06-01T09:00:00.000Z");

    expect(computeIntervalNextRun(anchorAt, 2, anchorAt)).toEqual(
      new Date("2026-06-03T09:00:00.000Z"),
    );
  });

  it("keeps local wall-clock time across DST boundaries", () => {
    const anchorAt = new Date("2026-03-07T14:00:00.000Z");
    const from = new Date("2026-03-07T15:00:00.000Z");

    expect(
      computeIntervalNextRun(anchorAt, 1, from, "America/New_York"),
    ).toEqual(new Date("2026-03-08T13:00:00.000Z"));
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

  it("uses effective version 2 one-time and recurring schedule fields", () => {
    expect(
      computeScheduleNextRun({
        version: 2,
        epochId: "123e4567-e89b-42d3-a456-426614174000",
        mode: "once",
        createdAt: "2026-06-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
        timezone: "UTC",
        sourceRunAt: "2026-06-01T09:00:00.000Z",
        effectiveRunAt: "2026-06-01T10:00:00.000Z",
      }),
    ).toEqual(new Date("2026-06-01T10:00:00.000Z"));

    expect(
      computeScheduleNextRun(
        {
          version: 2,
          epochId: "123e4567-e89b-42d3-a456-426614174001",
          mode: "recurring",
          createdAt: "2026-06-01T08:00:00.000Z",
          ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "never",
          epochReleaseCount: 0,
          intervalDays: 2,
          anchorAt: "2026-06-01T09:00:00.000Z",
        },
        new Date("2026-06-04T10:00:00.000Z"),
      ),
    ).toEqual(new Date("2026-06-05T09:00:00.000Z"));
  });

  it("ends an after-count version 2 epoch at its release target", () => {
    const metadata = {
      version: 2 as const,
      epochId: "123e4567-e89b-42d3-a456-426614174001",
      mode: "recurring" as const,
      createdAt: "2026-06-01T08:00:00.000Z",
      ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
      timezone: "UTC",
      expr: "0 9 * * *",
      endsMode: "after" as const,
      targetReleaseCount: 5,
      epochReleaseCount: 5,
      anchorAt: "2026-06-01T09:00:00.000Z",
    };

    expect(isRecurringScheduleEnded(metadata, new Date())).toBe(true);
    expect(
      isDueRunPastScheduleEnd(metadata, new Date("2026-06-06T09:00:00.000Z")),
    ).toBe(true);
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

  it("projects a one-time version 1 schedule with a deterministic display key", () => {
    expect(
      projectTaskScheduleOccurrences(
        "task-1",
        {
          version: 1,
          mode: "once",
          scheduledAt: "2026-06-01T08:00:00.000Z",
          runAt: "2026-06-02T09:00:00.000Z",
        },
        new Date("2026-06-02T09:00:00.000Z"),
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-03T00:00:00.000Z"),
      ),
    ).toEqual([
      {
        id: "v1:task-1:2026-06-01T08:00:00.000Z:2026-06-02T09:00:00.000Z",
        scheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
      },
    ]);
  });

  it("projects ordered recurring version 1 occurrences", () => {
    expect(
      projectTaskScheduleOccurrences(
        "task-1",
        {
          version: 1,
          mode: "recurring",
          scheduledAt: "2026-06-01T09:00:00.000Z",
          expr: "0 9 * * *",
          timezone: "UTC",
          endsMode: "never",
        },
        new Date("2026-06-02T09:00:00.000Z"),
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-05T00:00:00.000Z"),
      ),
    ).toEqual([
      {
        id: "v1:task-1:2026-06-01T09:00:00.000Z:2026-06-02T09:00:00.000Z",
        scheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
      },
      {
        id: "v1:task-1:2026-06-01T09:00:00.000Z:2026-06-03T09:00:00.000Z",
        scheduledAt: new Date("2026-06-03T09:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
      },
      {
        id: "v1:task-1:2026-06-01T09:00:00.000Z:2026-06-04T09:00:00.000Z",
        scheduledAt: new Date("2026-06-04T09:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-04T09:00:00.000Z"),
      },
    ]);
  });

  it("projects recurring version 2 occurrences with the persisted epoch identity", () => {
    expect(
      projectTaskScheduleOccurrences(
        "task-1",
        {
          version: 2,
          epochId: "123e4567-e89b-42d3-a456-426614174001",
          mode: "recurring",
          createdAt: "2026-06-01T08:00:00.000Z",
          ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "never",
          epochReleaseCount: 0,
          anchorAt: "2026-06-01T09:00:00.000Z",
        },
        new Date("2026-06-02T09:00:00.000Z"),
        new Date("2026-06-01T00:00:00.000Z"),
        new Date("2026-06-04T00:00:00.000Z"),
      ),
    ).toEqual([
      {
        id: "v2:123e4567-e89b-42d3-a456-426614174001:2026-06-02T09:00:00.000Z",
        scheduledAt: new Date("2026-06-02T09:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-02T09:00:00.000Z"),
      },
      {
        id: "v2:123e4567-e89b-42d3-a456-426614174001:2026-06-03T09:00:00.000Z",
        scheduledAt: new Date("2026-06-03T09:00:00.000Z"),
        originalScheduledAt: new Date("2026-06-03T09:00:00.000Z"),
      },
    ]);
  });

  it("stops after the remaining version 1 and version 2 release limits", () => {
    const from = new Date("2026-06-01T00:00:00.000Z");
    const to = new Date("2026-06-06T00:00:00.000Z");

    expect(
      projectTaskScheduleOccurrences(
        "task-1",
        {
          version: 1,
          mode: "recurring",
          scheduledAt: "2026-06-01T09:00:00.000Z",
          expr: "0 9 * * *",
          timezone: "UTC",
          endsMode: "after",
          occurrences: 2,
        },
        new Date("2026-06-02T09:00:00.000Z"),
        from,
        to,
      ).map((occurrence) => occurrence.scheduledAt),
    ).toEqual([
      new Date("2026-06-02T09:00:00.000Z"),
      new Date("2026-06-03T09:00:00.000Z"),
    ]);

    expect(
      projectTaskScheduleOccurrences(
        "task-1",
        {
          version: 2,
          epochId: "123e4567-e89b-42d3-a456-426614174002",
          mode: "recurring",
          createdAt: "2026-06-01T08:00:00.000Z",
          ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "after",
          targetReleaseCount: 4,
          epochReleaseCount: 2,
          anchorAt: "2026-06-01T09:00:00.000Z",
        },
        new Date("2026-06-02T09:00:00.000Z"),
        from,
        to,
      ).map((occurrence) => occurrence.scheduledAt),
    ).toEqual([
      new Date("2026-06-02T09:00:00.000Z"),
      new Date("2026-06-03T09:00:00.000Z"),
    ]);
  });

  it("projects interval schedules and excludes occurrences outside the half-open range", () => {
    expect(
      projectTaskScheduleOccurrences(
        "task-1",
        {
          version: 2,
          epochId: "123e4567-e89b-42d3-a456-426614174003",
          mode: "recurring",
          createdAt: "2026-06-01T08:00:00.000Z",
          ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
          timezone: "UTC",
          expr: "0 9 * * *",
          endsMode: "never",
          epochReleaseCount: 0,
          intervalDays: 2,
          anchorAt: "2026-06-01T09:00:00.000Z",
        },
        new Date("2026-06-03T09:00:00.000Z"),
        new Date("2026-06-04T00:00:00.000Z"),
        new Date("2026-06-08T00:00:00.000Z"),
      ).map((occurrence) => occurrence.scheduledAt),
    ).toEqual([
      new Date("2026-06-05T09:00:00.000Z"),
      new Date("2026-06-07T09:00:00.000Z"),
    ]);
  });
});
