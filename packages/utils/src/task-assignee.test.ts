import { describe, expect, it } from "vitest";

import { countSetAssignees, hasAssigneeValue } from "./task-assignee.js";

describe("hasAssigneeValue", () => {
  it.each([null, undefined, "", "   "])("rejects %j", (value) => {
    expect(hasAssigneeValue(value)).toBe(false);
  });

  it("accepts a non-blank id", () => {
    expect(hasAssigneeValue("user_1")).toBe(true);
  });
});

describe("countSetAssignees", () => {
  it("counts only set slots", () => {
    expect(countSetAssignees(null, "bot_1", "  ")).toBe(1);
    expect(countSetAssignees("cow_1", "bot_1", "user_1")).toBe(3);
    expect(countSetAssignees(null, null, null)).toBe(0);
  });
});
