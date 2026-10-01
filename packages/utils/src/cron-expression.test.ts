import { describe, expect, it } from "vitest";

import { isFiveFieldCronExpression } from "./cron-expression.js";

describe("isFiveFieldCronExpression", () => {
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
    expect(isFiveFieldCronExpression(expr)).toBe(true);
  });

  it.each([
    ["a seconds field", "0 0 9 * * *"],
    ["a macro", "@daily"],
    ["too few fields", "0 9 * *"],
    ["a hashed minute", "H 9 * * *"],
    ["a hashed step", "H/15 * * * *"],
    ["a hashed list item", "0,h 9 * * *"],
    ["an empty string", ""],
  ])("rejects %s", (_label, expr) => {
    expect(isFiveFieldCronExpression(expr)).toBe(false);
  });
});
