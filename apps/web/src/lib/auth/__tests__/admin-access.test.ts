import { describe, expect, it } from "vitest";

import { hasAdminRole } from "../has-admin-role";

describe("hasAdminRole", () => {
  it("returns true when role contains admin", () => {
    expect(hasAdminRole("admin")).toBe(true);
    expect(hasAdminRole("user,admin")).toBe(true);
    expect(hasAdminRole("ADMIN")).toBe(true);
    expect(hasAdminRole(" user , admin ")).toBe(true);
  });

  it("returns false for non-admin roles", () => {
    expect(hasAdminRole("user")).toBe(false);
    expect(hasAdminRole("")).toBe(false);
    expect(hasAdminRole(null)).toBe(false);
    expect(hasAdminRole(undefined)).toBe(false);
    expect(hasAdminRole("administrator")).toBe(false);
  });
});
