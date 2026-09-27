import { afterEach, describe, expect, it, vi } from "vitest";

import { zonedDateTimeLocalToUtc } from "@/lib/schedules/zoned-datetime";
import { TaskScheduleEndsMode } from "@/lib/types/task-schedule";
import {
  hasTaskScheduleChanged,
  parseTaskScheduleSelection,
  schedulableRunAtLocalIso,
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
      firstRunLocalIso: "2026-06-01T09:00",
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
      firstRunLocalIso: "2026-06-01T14:45",
      cron: "45 14 * * *",
    });
    expect(selection.customCronExpr).toBeUndefined();
  });
});

describe("parseTaskScheduleSelection", () => {
  it("converts recurring end dates using the selected timezone", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T00:00:00.000Z"));

    const body = parseTaskScheduleSelection({
      timezone: "America/New_York",
      cron: "30 15 * * *",
      endsMode: TaskScheduleEndsMode.ON,
      endOnLocalDate: "2026-06-24",
    });

    expect(body).toEqual({
      expr: "30 15 * * *",
      timezone: "America/New_York",
      endsMode: TaskScheduleEndsMode.ON,
      endsOn: new Date("2026-06-25T03:59:59.999Z"),
    });
  });

  it("sends interval metadata for every-N-days schedules", () => {
    const body = parseTaskScheduleSelection({
      timezone: "America/New_York",
      firstRunLocalIso: "2026-06-24T09:00",
      cron: "0 9 * * *",
      intervalDays: 2,
    });

    expect(body).toEqual({
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
        timezone: "UTC",
        cron: "not a cron expression",
        endsMode: TaskScheduleEndsMode.AFTER,
      }),
    ).toBeNull();
  });

  it("rejects an invalid timezone instead of throwing", () => {
    expect(
      parseTaskScheduleSelection({
        timezone: "Not/AZone",
        cron: "0 9 * * *",
      }),
    ).toBeNull();
  });

  it("rejects recurring end dates in the past", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T12:00:00.000Z"));

    expect(
      parseTaskScheduleSelection({
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
        timezone: "UTC",
        cron: "0 9 * * *",
        intervalDays: 3,
        firstRunLocalIso: "2026-06-23T09:00",
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
        timezone: "UTC",
        cron: "0 9 * * *",
        endsMode: TaskScheduleEndsMode.ON,
        endOnLocalDate: "2026-06-25",
      }),
    ).toEqual({
      expr: "0 9 * * *",
      timezone: "UTC",
      endsMode: TaskScheduleEndsMode.ON,
      endsOn: new Date("2026-06-25T23:59:59.999Z"),
    });
  });

  it("rejects a calendar-invalid every-N-days anchor", () => {
    expect(
      parseTaskScheduleSelection({
        timezone: "UTC",
        cron: "0 9 * * *",
        intervalDays: 2,
        firstRunLocalIso: "2026-02-31T09:00",
      }),
    ).toBeNull();
  });
});

describe("schedulableRunAtLocalIso", () => {
  it("keeps a future Run at", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));

    expect(schedulableRunAtLocalIso("2026-09-08T19:00", "Europe/Prague")).toBe(
      "2026-09-08T19:00",
    );
  });

  it("snaps a past Prague slot to five minutes from now", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));

    expect(schedulableRunAtLocalIso("2026-09-08T18:00", "Europe/Prague")).toBe(
      "2026-09-08T18:06",
    );
  });

  it("keeps the snapped time in the future after two minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));

    const snapped = schedulableRunAtLocalIso(
      "2026-09-08T18:00",
      "Europe/Prague",
    );
    vi.advanceTimersByTime(2 * 60 * 1000);

    const runAt = zonedDateTimeLocalToUtc(snapped, "Europe/Prague");
    expect(runAt).toEqual(new Date("2026-09-08T16:06:00.000Z"));
    expect(runAt?.getTime()).toBeGreaterThan(Date.now());
  });

  it("snaps past midnight and noon slots on the same day", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-08T16:01:43.868Z"));

    for (const localIso of ["2026-09-08T00:00", "2026-09-08T12:00"]) {
      expect(schedulableRunAtLocalIso(localIso, "Europe/Prague")).toBe(
        "2026-09-08T18:06",
      );
    }
  });

  it("keeps future ambiguous and nonexistent local times", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    for (const localIso of ["2026-03-08T02:30", "2026-11-01T01:30"]) {
      expect(schedulableRunAtLocalIso(localIso, "America/New_York")).toBe(
        localIso,
      );
    }
  });

  it("does not snap a malformed Run at", () => {
    expect(schedulableRunAtLocalIso("not-a-datetime", "UTC")).toBe(
      "not-a-datetime",
    );
  });

  it("does not snap or throw for an invalid timezone", () => {
    expect(() =>
      schedulableRunAtLocalIso("2026-09-08T18:00", "Not/AZone"),
    ).not.toThrow();
    expect(schedulableRunAtLocalIso("2026-09-08T18:00", "Not/AZone")).toBe(
      "2026-09-08T18:00",
    );
  });
});

describe("hasTaskScheduleChanged", () => {
  const original = {
    timezone: "UTC",
    cron: "0 9 * * *",
  };

  it("returns false when an unchanged rule is saved again", () => {
    expect(hasTaskScheduleChanged(original, { ...original })).toBe(false);
  });

  it("returns true when the rule changes", () => {
    expect(
      hasTaskScheduleChanged(original, { ...original, cron: "0 10 * * *" }),
    ).toBe(true);
  });
});
