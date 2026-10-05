import { describe, expect, it } from "vitest";

import {
  computeIntervalNextRun,
  validateTaskScheduleRule,
} from "@/helpers/task-schedule";

describe("computeIntervalNextRun", () => {
  it("computes interval next run from anchor", () => {
    const anchorAt = new Date("2026-06-01T09:00:00.000Z");
    const from = new Date("2026-06-05T10:00:00.000Z");

    expect(computeIntervalNextRun(anchorAt, 2, from)).toEqual(
      new Date("2026-06-07T09:00:00.000Z"),
    );
  });

  it("advances interval next run after a due anchor Run", () => {
    const anchorAt = new Date("2026-06-01T09:00:00.000Z");

    expect(computeIntervalNextRun(anchorAt, 2, anchorAt)).toEqual(
      new Date("2026-06-03T09:00:00.000Z"),
    );
  });

  it("keeps today's interval slot when that local time is still ahead", () => {
    const anchorAt = new Date("2026-06-01T09:00:00.000Z");
    const from = new Date("2026-06-05T08:00:00.000Z");

    expect(computeIntervalNextRun(anchorAt, 2, from)).toEqual(
      new Date("2026-06-05T09:00:00.000Z"),
    );
  });

  it("keeps local wall-clock time across DST boundaries", () => {
    const anchorAt = new Date("2026-03-07T14:00:00.000Z");
    const from = new Date("2026-03-07T15:00:00.000Z");

    expect(
      computeIntervalNextRun(anchorAt, 1, from, "America/New_York"),
    ).toEqual(new Date("2026-03-08T13:00:00.000Z"));
  });
});

describe("validateTaskScheduleRule", () => {
  const rule = {
    expr: "0 9 * * 1",
    timezone: "UTC",
    endsMode: "NEVER" as const,
  };

  it("accepts a rule with a next Run", () => {
    expect(() => validateTaskScheduleRule(rule)).not.toThrow();
  });

  it.each([
    "0 9 * * MON-FRI",
    "30 8 1,15 JAN,JUL *",
    "0 17 * * 5L",
    "0 9 * * 1#1",
    "0 0 L * *",
    "0 9 ? * thu",
  ])("accepts supported five-field syntax %s", (expr) => {
    expect(() => validateTaskScheduleRule({ ...rule, expr })).not.toThrow();
  });

  it("rejects an unknown timezone", () => {
    expect(() =>
      validateTaskScheduleRule({ ...rule, timezone: "Mars/Olympus" }),
    ).toThrow("timezone is invalid");
  });

  it("rejects a cron that is not five fields", () => {
    expect(() =>
      validateTaskScheduleRule({ ...rule, expr: "0 0 9 * * 1" }),
    ).toThrow("expr must be a five-field cron expression");
  });

  it.each(["99 9 * * *", "0 9 * * 1#6", "@daily * * * *"])(
    "rejects invalid cron semantics %s even for an interval rule",
    (expr) => {
      expect(() =>
        validateTaskScheduleRule({
          ...rule,
          expr,
          intervalDays: 2,
          anchorAt: "2030-01-01T09:00:00.000Z",
        }),
      ).toThrow("expr is not a valid cron expression for the timezone");
    },
  );

  it("rejects an end in the past", () => {
    expect(() =>
      validateTaskScheduleRule({
        ...rule,
        endsMode: "ON",
        endsOn: "2020-01-01T00:00:00.000Z",
      }),
    ).toThrow("endsOn must be in the future");
  });
});
