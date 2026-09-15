import { describe, expect, it } from "vitest";

import { hasAdminRole } from "./user-role";

describe("hasAdminRole", () => {
  it.each([
    ["admin", true],
    ["user,admin", true],
    ["admin,user", true],
    [" Admin ", true],
    ["ADMIN", true],
    ["user", false],
    ["member", false],
    ["administrator", false],
    ["", false],
  ])("role %j returns %s", (role, expected) => {
    expect(hasAdminRole(role)).toBe(expected);
  });

  it("returns false for nullish roles", () => {
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
  });
});
