import { describe, expect, it } from "vitest";

import { TaskScheduleEndsMode } from "@/lib/types/task-schedule";

import {
  selectionToWhen,
  upcomingRuns,
  whenCron,
  whenToSelection,
} from "./schedule-when";

const NOW = new Date("2030-01-01T08:00:00.000Z");
const BERLIN = "Europe/Berlin";

describe("selectionToWhen", () => {
  it.each([
    ["0 9 * * *", { repeat: "daily", time: "09:00" }],
    ["30 8 * * MON-FRI", { repeat: "weekdays", time: "08:30" }],
    ["30 8 * * MON,WED", { repeat: "weekly", weekdays: ["MON", "WED"] }],
    ["15 7 12 * *", { repeat: "monthly", dayOfMonth: 12, time: "07:15" }],
    ["0 9 1,15 * *", { repeat: "custom", customCron: "0 9 1,15 * *" }],
  ])("reads %s", (cron, expected) => {
    expect(selectionToWhen({ timezone: BERLIN, cron }, NOW)).toMatchObject(
      expected,
    );
  });

  it("reads an every-N-days rule from its anchor", () => {
    expect(
      selectionToWhen(
        {
          timezone: BERLIN,
          cron: "0 10 * * *",
          intervalDays: 3,
          firstRunLocalIso: "2030-01-07T10:00",
        },
        NOW,
      ),
    ).toMatchObject({
      repeat: "interval",
      intervalDays: 3,
      startDate: "2030-01-07",
      time: "10:00",
    });
  });
});

describe("whenToSelection", () => {
  const base = selectionToWhen({ timezone: BERLIN, cron: "0 9 * * *" }, NOW);

  it("builds each repeat's cron", () => {
    expect(whenCron({ ...base, repeat: "weekdays", time: "08:30" })).toBe(
      "30 8 * * MON,TUE,WED,THU,FRI",
    );
    expect(
      whenCron({ ...base, repeat: "weekly", weekdays: ["FRI", "MON"] }),
    ).toBe("0 9 * * MON,FRI");
    expect(whenCron({ ...base, repeat: "monthly", dayOfMonth: 3 })).toBe(
      "0 9 3 * *",
    );
    expect(whenCron({ ...base, repeat: "weekly", weekdays: [] })).toBeNull();
  });

  it("anchors an every-N-days rule on its start date and time", () => {
    expect(
      whenToSelection({
        ...base,
        repeat: "interval",
        intervalDays: 3,
        startDate: "2030-01-07",
        time: "07:15",
      }),
    ).toMatchObject({
      cron: "15 7 * * *",
      intervalDays: 3,
      firstRunLocalIso: "2030-01-07T07:15",
    });
  });

  it("carries the end", () => {
    expect(
      whenToSelection({
        ...base,
        endsMode: TaskScheduleEndsMode.AFTER,
        endAfterOccurrences: 4,
      }),
    ).toMatchObject({ endsMode: "after", endAfterOccurrences: 4 });
  });
});

describe("upcomingRuns", () => {
  it("stops after the set number of runs", () => {
    expect(
      upcomingRuns(
        {
          timezone: BERLIN,
          cron: "0 9 * * *",
          endsMode: TaskScheduleEndsMode.AFTER,
          endAfterOccurrences: 2,
        },
        3,
        NOW,
      ),
    ).toHaveLength(2);
  });
});
