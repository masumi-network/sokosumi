import { describe, expect, it } from "vitest";

import { userHasName } from "../persist-user-name";

describe("userHasName", () => {
  it("is false for blank names", () => {
    expect(userHasName("")).toBe(false);
    expect(userHasName("   ")).toBe(false);
    expect(userHasName(null)).toBe(false);
    expect(userHasName(undefined)).toBe(false);
  });

  it("is true for a trimmed name", () => {
    expect(userHasName("Ada")).toBe(true);
    expect(userHasName("  Ada  ")).toBe(true);
  });
});
