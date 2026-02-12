import { describe, expect, it } from "vitest";

import type { AuthenticationContext } from "@/middleware/auth";

import { requireCoworkerId } from "./helper";

describe("requireCoworkerId", () => {
  it("returns coworker id from auth context", () => {
    const authContext: AuthenticationContext = {
      userId: "user_123",
      organizationId: null,
      coworkerId: "cow_123",
    };

    expect(requireCoworkerId(authContext)).toBe("cow_123");
  });

  it("throws forbidden when auth context has no coworker id", () => {
    const authContext: AuthenticationContext = {
      userId: "user_123",
      organizationId: null,
      coworkerId: null,
    };

    expect(() => requireCoworkerId(authContext)).toThrow(
      "Coworker authentication required",
    );
  });
});
