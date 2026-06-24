import { describe, expect, it } from "vitest";

import { TaskScheduleEndsMode } from "@/lib/types/task-schedule";
import { selectionToApiBody } from "@/lib/utils/task-schedule";

describe("selectionToApiBody", () => {
  it("converts one-time schedules using the selected timezone", () => {
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
});
