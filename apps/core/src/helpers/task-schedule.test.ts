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

  it("rejects an unknown timezone", () => {
    expect(() =>
      validateTaskScheduleRule({ ...rule, timezone: "Mars/Olympus" }),
    ).toThrow("timezone is invalid");
  });

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
