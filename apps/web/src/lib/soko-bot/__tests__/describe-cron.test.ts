import { describe, expect, it } from "vitest";

import { describeCron, describeSchedule } from "../describe-cron";

describe("describeCron", () => {
  it("names a stepped weekday window", () => {
    expect(describeCron("*/30 7-19 * * 1-5")).toBe(
      "Every 30 minutes between 07:00 and 19:59 on weekdays",
    );
  });

  it("names the shapes the assistant creates", () => {
    expect(describeCron("0 9 * * 1-5")).toBe("Weekdays at 09:00");
    expect(describeCron("0 10 * * 1")).toBe("Every Monday at 10:00");
    expect(describeCron("30 8 * * *")).toBe("Every day at 08:30");
    expect(describeCron("0 * * * *")).toBe("Every hour");
    expect(describeCron("0 9 * * 1,3,5")).toBe("Mon, Wed, Fri at 09:00");
  });

  it("names monthly shapes", () => {
    expect(describeCron("0 9 1 * *")).toBe("Monthly on day 1 at 09:00");
    expect(describeCron("0 9 L * *")).toBe("Last day of each month at 09:00");
    expect(describeCron("0 10 * * 1#1")).toBe(
      "First Monday of each month at 10:00",
    );
  });

  it("falls back to the expression for anything else", () => {
    expect(describeCron("0 9 1 6 *")).toBe("0 9 1 6 *");
    expect(describeCron("nonsense")).toBe("nonsense");
  });
});

describe("describeSchedule", () => {
  it("reads a one-time schedule as its moment in the schedule's timezone", () => {
    expect(
      describeSchedule({
        cronExpression: "0 9 1 10 *",
        runOnce: true,
        nextRunAt: "2026-10-01T07:00:00.000Z",
        timezone: "Europe/Berlin",
      }),
    ).toBe("Once, Thu 1 Oct, 09:00");
  });

  it("describes a recurring schedule by its cron", () => {
    expect(
      describeSchedule({
        cronExpression: "0 10 * * 1",
        nextRunAt: "2026-10-05T08:00:00.000Z",
        timezone: "Europe/Berlin",
      }),
    ).toBe("Every Monday at 10:00");
  });
});
