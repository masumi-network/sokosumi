import { describe, expect, it } from "vitest";

import { isTaskScheduleCronShape } from "./task-schedule-cron.js";

describe("isTaskScheduleCronShape", () => {
  it.each([
    "0 9 * * *",
    "*/15 * * * *",
    "0 9 * * MON-FRI",
    "30 8 1,15 JAN,JUL *",
    "0 17 * * 5L",
    "0 9 * * 1#1",
    "0 0 L * *",
    "0 9 ? * THU",
    "  0   9 * * *  ",
  ])("accepts %s", (expr) => {
    expect(isTaskScheduleCronShape(expr)).toBe(true);
  });

  it.each([
    ["a seconds field", "0 0 9 * * *"],
    ["a macro", "@daily"],
    ["too few fields", "0 9 * *"],
    ["a hashed minute", "H 9 * * *"],
    ["a hashed step", "H/15 * * * *"],
    ["a hashed list item", "0,h 9 * * *"],
    ["a hashed step value", "*/H * * * *"],
    ["a hashed range end", "0 1-H * * *"],
    ["a hashed step after a range", "0-59/H * * * *"],
    ["an empty string", ""],
  ])("rejects %s", (_label, expr) => {
    expect(isTaskScheduleCronShape(expr)).toBe(false);
  });
});
