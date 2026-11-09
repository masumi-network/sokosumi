import { describe, expect, it } from "vitest";

import {
  type ScheduleWhen,
  selectionToWhen,
  upcomingRuns,
} from "@/lib/schedules/schedule-when";
import { describeCron } from "@/lib/soko-bot/describe-cron";
import { isValidCronExpression } from "@/lib/utils/task-schedule";

import { sokoBotScheduleCron } from "./schedule-cron";

const TZ = "America/Los_Angeles";
const START = selectionToWhen({ timezone: TZ, cron: "0 9 * * 1-5" });

function when(patch: Partial<ScheduleWhen>): ScheduleWhen {
  return { ...START, ...patch };
}

describe("sokoBotScheduleCron", () => {
  it("reads the default weekday cron back as Weekdays", () => {
    expect(START.repeat).toBe("weekdays");
    expect(START.time).toBe("09:00");
  });

  it.each([
    [
      when({ repeat: "daily", time: "08:30" }),
      "30 8 * * *",
      "Every day at 08:30",
    ],
    [when({ repeat: "weekdays" }), "0 9 * * 1-5", "Weekdays at 09:00"],
    [
      when({ repeat: "weekly", time: "16:00", weekdays: ["FRI"] }),
      "0 16 * * 5",
      "Every Friday at 16:00",
    ],
    [
      when({ repeat: "weekly", time: "16:00", weekdays: ["FRI", "MON"] }),
      "0 16 * * 1,5",
      "Mon, Fri at 16:00",
    ],
    [
      when({ repeat: "monthly", dayOfMonth: 15 }),
      "0 9 15 * *",
      "Monthly on day 15 at 09:00",
    ],
  ])("turns %o into %s, described as %s", (value, cron, described) => {
    expect(sokoBotScheduleCron(value)).toBe(cron);
    expect(describeCron(cron)).toBe(described);
  });

  it("has no cron for a weekly schedule without days", () => {
    expect(
      sokoBotScheduleCron(when({ repeat: "weekly", weekdays: [] })),
    ).toBeNull();
  });

  it("passes a custom cron through and leaves validity to the check", () => {
    const custom = when({ repeat: "custom", customCron: " 0 7 * * 0 " });
    expect(sokoBotScheduleCron(custom)).toBe("0 7 * * 0");
    expect(isValidCronExpression("0 7 * * 0", TZ)).toBe(true);
    expect(isValidCronExpression("every friday", TZ)).toBe(false);
    expect(isValidCronExpression("0 99 * * *", TZ)).toBe(false);
  });

  it("runs on the owner's clock, not UTC", () => {
    const cron = sokoBotScheduleCron(
      when({ repeat: "weekly", time: "16:00", weekdays: ["FRI"] }),
    );
    const [next] = upcomingRuns(
      { timezone: TZ, cron: cron ?? "" },
      1,
      new Date("2026-11-09T12:00:00Z"),
    );
    // Friday 16:00 in Los Angeles (PST, UTC-8) is Saturday 00:00 UTC.
    expect(next?.toISOString()).toBe("2026-11-14T00:00:00.000Z");
  });
});
