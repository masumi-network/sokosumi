import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskScheduleEndsMode } from "@/lib/types/task-schedule";
import {
  hasTaskScheduleChanged,
  metadataToSelection,
  selectionToApiBody,
} from "@/lib/utils/task-schedule";

afterEach(() => {
  vi.useRealTimers();
});

describe("metadataToSelection", () => {
  it("uses the effective time and timezone from version 2 one-time metadata", () => {
    const selection = metadataToSelection(
      JSON.stringify({
        version: 2,
        epochId: "123e4567-e89b-42d3-a456-426614174000",
        mode: "once",
        createdAt: "2026-06-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
        timezone: "America/New_York",
        sourceRunAt: "2026-06-24T18:00:00.000Z",
        effectiveRunAt: "2026-06-24T19:30:00.000Z",
      }),
      "UTC",
    );

    expect(selection).toEqual({
      mode: "once",
      timezone: "America/New_York",
      oneTimeLocalIso: "2026-06-24T15:30",
    });
  });

  it("maps version 2 recurring metadata to its remaining release count", () => {
    const selection = metadataToSelection(
      JSON.stringify({
        version: 2,
        epochId: "123e4567-e89b-42d3-a456-426614174001",
        mode: "recurring",
        createdAt: "2026-06-01T08:00:00.000Z",
        ruleEffectiveFrom: "2026-06-01T08:00:00.000Z",
        timezone: "UTC",
        expr: "0 9 * * *",
        endsMode: "after",
        targetReleaseCount: 5,
        epochReleaseCount: 2,
        anchorAt: "2026-06-01T09:00:00.000Z",
      }),
      "Europe/Berlin",
    );

    expect(selection).toMatchObject({
      mode: "recurring",
      timezone: "UTC",
      cron: "0 9 * * *",
      endsMode: "after",
      endAfterOccurrences: 3,
    });
  });
});

describe("selectionToApiBody", () => {
  it("converts one-time schedules using the selected timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));

    const body = selectionToApiBody({
      mode: "once",
      timezone: "America/New_York",
      oneTimeLocalIso: "2026-06-24T15:30",
    });

    expect(body).toEqual({
      mode: "once",
      runAt: new Date("2026-06-24T19:30:00.000Z"),
    });
  });

  it("converts recurring end dates using the selected timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));

    const body = selectionToApiBody({
      mode: "recurring",
      timezone: "America/New_York",
      cron: "30 15 * * *",
      endsMode: TaskScheduleEndsMode.ON,
      endOnLocalDate: "2026-06-24",
    });

    expect(body).toEqual({
      mode: "recurring",
      expr: "30 15 * * *",
      timezone: "America/New_York",
      endsMode: TaskScheduleEndsMode.ON,
      endsOn: new Date("2026-06-25T03:59:59.999Z"),
    });
  });

  it("sends interval metadata for every-N-days schedules", () => {
    const body = selectionToApiBody({
      mode: "recurring",
      timezone: "America/New_York",
      oneTimeLocalIso: "2026-06-24T09:00",
      cron: "0 9 * * *",
      intervalDays: 2,
    });

    expect(body).toEqual({
      mode: "recurring",
      expr: "0 9 * * *",
      timezone: "America/New_York",
      endsMode: TaskScheduleEndsMode.NEVER,
      intervalDays: 2,
      anchorAt: new Date("2026-06-24T13:00:00.000Z"),
    });
  });

  it("rejects malformed recurring selections", () => {
    expect(
      selectionToApiBody({
        mode: "recurring",
        timezone: "UTC",
        cron: "not a cron expression",
        endsMode: TaskScheduleEndsMode.AFTER,
      }),
    ).toBeNull();
  });

  it("rejects a once-mode schedule with an invalid timezone instead of throwing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));

    expect(() =>
      selectionToApiBody({
        mode: "once",
        timezone: "Not/AZone",
        oneTimeLocalIso: "2026-06-24T15:30",
      }),
    ).not.toThrow();

    expect(
      selectionToApiBody({
        mode: "once",
        timezone: "Not/AZone",
        oneTimeLocalIso: "2026-06-24T15:30",
      }),
    ).toBeNull();
  });

  it("rejects one-time schedules in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));

    expect(
      selectionToApiBody({
        mode: "once",
        timezone: "UTC",
        oneTimeLocalIso: "2026-06-24T11:59",
      }),
    ).toBeNull();
  });

  it("rejects recurring end dates in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));

    expect(
      selectionToApiBody({
        mode: "recurring",
        timezone: "UTC",
        cron: "0 9 * * *",
        endsMode: TaskScheduleEndsMode.ON,
        endOnLocalDate: "2026-06-23",
      }),
    ).toBeNull();
  });

  it("rejects recurring end dates before the first upcoming occurrence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));

    expect(
      selectionToApiBody({
        mode: "recurring",
        timezone: "UTC",
        cron: "0 9 * * *",
        endsMode: TaskScheduleEndsMode.ON,
        endOnLocalDate: "2026-06-24",
      }),
    ).toBeNull();
  });

  it("rejects interval schedule end dates before the next anchored occurrence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));

    expect(
      selectionToApiBody({
        mode: "recurring",
        timezone: "UTC",
        cron: "0 9 * * *",
        intervalDays: 3,
        oneTimeLocalIso: "2026-06-23T09:00",
        endsMode: TaskScheduleEndsMode.ON,
        endOnLocalDate: "2026-06-25",
      }),
    ).toBeNull();
  });

  it("accepts a recurring end date that includes its first upcoming occurrence", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));

    expect(
      selectionToApiBody({
        mode: "recurring",
        timezone: "UTC",
        cron: "0 9 * * *",
        endsMode: TaskScheduleEndsMode.ON,
        endOnLocalDate: "2026-06-25",
      }),
    ).toEqual({
      mode: "recurring",
      expr: "0 9 * * *",
      timezone: "UTC",
      endsMode: TaskScheduleEndsMode.ON,
      endsOn: new Date("2026-06-25T23:59:59.999Z"),
    });
  });

  it("rejects calendar-invalid local date-times", () => {
    expect(
      selectionToApiBody({
        mode: "once",
        timezone: "UTC",
        oneTimeLocalIso: "2026-02-31T09:00",
      }),
    ).toBeNull();
  });

  it("accepts ambiguous and nonexistent local times supported by timezone conversion", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    for (const oneTimeLocalIso of ["2026-03-08T02:30", "2026-11-01T01:30"]) {
      expect(
        selectionToApiBody({
          mode: "once",
          timezone: "America/New_York",
          oneTimeLocalIso,
        }),
      ).toEqual({
        mode: "once",
        runAt: expect.any(Date),
      });
    }
  });
});

describe("hasTaskScheduleChanged", () => {
  const originalOnce = {
    mode: "once" as const,
    timezone: "UTC",
    oneTimeLocalIso: "2026-06-24T09:00",
  };

  it("returns false when an unchanged one-time schedule is saved again", () => {
    expect(
      hasTaskScheduleChanged(
        originalOnce,
        {
          mode: "once",
          timezone: "UTC",
          oneTimeLocalIso: "2026-06-24T09:00",
        },
        true,
      ),
    ).toBe(false);
  });

  it("returns true when clearing an existing schedule", () => {
    expect(
      hasTaskScheduleChanged(
        originalOnce,
        { mode: "none", timezone: "UTC" },
        true,
      ),
    ).toBe(true);
  });

  it("returns true when adding a schedule to a task that had none", () => {
    expect(
      hasTaskScheduleChanged(
        { mode: "none", timezone: "UTC" },
        originalOnce,
        false,
      ),
    ).toBe(true);
  });
});
