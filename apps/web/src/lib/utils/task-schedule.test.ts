import { afterEach, describe, expect, it, vi } from "vitest";

import { TaskScheduleEndsMode } from "@/lib/types/task-schedule";
import {
  hasTaskScheduleChanged,
  parseTaskScheduleSelection,
  schedulableOnceLocalIso,
  taskScheduleRuleToSelection,
} from "@/lib/utils/task-schedule";

afterEach(() => {
  vi.useRealTimers();
});

describe("taskScheduleRuleToSelection", () => {
  it("keeps an every-N-days anchor instead of the next daily slot", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T15:00:00.000Z"));

    const selection = taskScheduleRuleToSelection({
      expr: "0 9 * * *",
      timezone: "UTC",
      intervalDays: 3,
      anchorAt: new Date("2026-06-01T09:00:00.000Z"),
      endsMode: "NEVER",
      endsOn: null,
      targetRunCount: null,
    });

    expect(selection).toMatchObject({
      intervalDays: 3,
      oneTimeLocalIso: "2026-06-01T09:00",
      cron: "0 9 * * *",
    });
    expect(parseTaskScheduleSelection(selection)).toMatchObject({
      intervalDays: 3,
      anchorAt: new Date("2026-06-01T09:00:00.000Z"),
      expr: "0 9 * * *",
    });
  });
});

describe("taskScheduleRuleToSelection with an older every-N-days rule", () => {
  it("takes the time from the anchor, which Core runs at, not from the cron", () => {
    const selection = taskScheduleRuleToSelection({
      expr: "30 6 * * *",
      timezone: "Europe/Berlin",
      intervalDays: 2,
      anchorAt: new Date("2026-06-01T12:45:00.000Z"),
      endsMode: "NEVER",
      endsOn: null,
      targetRunCount: null,
    });

    expect(selection).toMatchObject({
      oneTimeLocalIso: "2026-06-01T14:45",
      cron: "45 14 * * *",
    });
    expect(selection.customCronExpr).toBeUndefined();
  });
});

describe("parseTaskScheduleSelection", () => {
  it("converts one-time schedules using the selected timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));

    const body = parseTaskScheduleSelection({
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

    const body = parseTaskScheduleSelection({
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
    const body = parseTaskScheduleSelection({
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
      parseTaskScheduleSelection({
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
      parseTaskScheduleSelection({
        mode: "once",
        timezone: "Not/AZone",
        oneTimeLocalIso: "2026-06-24T15:30",
      }),
    ).not.toThrow();

    expect(
      parseTaskScheduleSelection({
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
      parseTaskScheduleSelection({
        mode: "once",
        timezone: "UTC",
        oneTimeLocalIso: "2026-06-24T11:59",
      }),
    ).toBeNull();
  });

  it("rejects Prague calendar seeds that are already past at submit time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));

    expect(
      parseTaskScheduleSelection({
        mode: "once",
        timezone: "Europe/Prague",
        oneTimeLocalIso: "2026-09-08T00:00",
      }),
    ).toBeNull();
    expect(
      parseTaskScheduleSelection({
        mode: "once",
        timezone: "Europe/Prague",
        oneTimeLocalIso: "2026-09-08T12:00",
      }),
    ).toBeNull();
    expect(
      parseTaskScheduleSelection({
        mode: "once",
        timezone: "Europe/Prague",
        oneTimeLocalIso: "2026-09-08T18:00",
      }),
    ).toBeNull();
    expect(
      parseTaskScheduleSelection({
        mode: "once",
        timezone: "Europe/Prague",
        oneTimeLocalIso: "2026-09-08T19:00",
      }),
    ).toEqual({
      mode: "once",
      runAt: new Date("2026-09-08T17:00:00.000Z"),
    });
  });

  it("rejects recurring end dates in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));

    expect(
      parseTaskScheduleSelection({
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
      parseTaskScheduleSelection({
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
      parseTaskScheduleSelection({
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
      parseTaskScheduleSelection({
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
      parseTaskScheduleSelection({
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
        parseTaskScheduleSelection({
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

describe("schedulableOnceLocalIso", () => {
  it("keeps a future once-time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));

    expect(schedulableOnceLocalIso("2026-09-08T19:00", "Europe/Prague")).toBe(
      "2026-09-08T19:00",
    );
  });

  it("snaps a past Prague slot to five minutes from now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));

    expect(schedulableOnceLocalIso("2026-09-08T18:00", "Europe/Prague")).toBe(
      "2026-09-08T18:06",
    );
  });

  it("keeps the snapped time schedulable after two minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));

    const snapped = schedulableOnceLocalIso(
      "2026-09-08T18:00",
      "Europe/Prague",
    );
    vi.advanceTimersByTime(2 * 60 * 1000);

    expect(
      parseTaskScheduleSelection({
        mode: "once",
        timezone: "Europe/Prague",
        oneTimeLocalIso: snapped,
      }),
    ).toEqual({
      mode: "once",
      runAt: new Date("2026-09-08T16:06:00.000Z"),
    });
  });

  it("does not snap a malformed once-time", () => {
    expect(schedulableOnceLocalIso("not-a-datetime", "UTC")).toBe(
      "not-a-datetime",
    );
  });

  it("does not snap or throw for an invalid timezone", () => {
    expect(() =>
      schedulableOnceLocalIso("2026-09-08T18:00", "Not/AZone"),
    ).not.toThrow();
    expect(schedulableOnceLocalIso("2026-09-08T18:00", "Not/AZone")).toBe(
      "2026-09-08T18:00",
    );
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
