import { describe, expect, it } from "vitest";
import { isOrganizationOwnerOrAdmin } from "./organization-role";

describe("isOrganizationOwnerOrAdmin", () => {
  it.each([
    ["owner", true],
    ["admin", true],
    ["member", false],
    ["", false],
    ["OWNER", false],
  ])("%s -> %s", (role, expected) => {
    expect(isOrganizationOwnerOrAdmin(role)).toBe(expected);
  });
});
