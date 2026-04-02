import { describe, expect, it } from "vitest";

import type { UserAuthenticationContext } from "@/middleware/auth";

import { buildCurrentUserTaskContextWhere } from "./task-context";

const userAuthContext: UserAuthenticationContext = {
  actor: "user",
  userId: "user_123",
  organizationId: "org_123",
};

describe("buildCurrentUserTaskContextWhere", () => {
  it("builds the current user workspace filter", () => {
    expect(buildCurrentUserTaskContextWhere(userAuthContext)).toEqual({
      userId: "user_123",
      organizationId: "org_123",
    });
  });

  it("keeps personal context when organization is null", () => {
    expect(
      buildCurrentUserTaskContextWhere({
        ...userAuthContext,
        organizationId: null,
      }),
    ).toEqual({
      userId: "user_123",
      organizationId: null,
    });
  });
});
