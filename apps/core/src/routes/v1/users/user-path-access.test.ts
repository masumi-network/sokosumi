import { describe, expect, it } from "vitest";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import {
  requireAccessToTargetUserData,
  resolveUsersPathUserId,
  USERS_PATH_ME,
} from "./user-path-access";

describe("requireAccessToTargetUserData", () => {
  const target = "usr_target";

  it("allows session user for their own id", () => {
    const ctx = requireAccessToTargetUserData(
      {
        actor: "user",
        userId: target,
        organizationId: null,
        role: "user",
      },
      target,
    );
    expect(ctx.source).toBe("session");
    expect(ctx.userId).toBe(target);
  });

  it("allows delegated coworker when user id matches", () => {
    const ctx = requireAccessToTargetUserData(
      {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
        context: { userId: target, organizationId: null },
      },
      target,
    );
    expect(ctx.source).toBe("context");
    expect(ctx.userId).toBe(target);
  });

  it("allows session admin for another user id", () => {
    const ctx = requireAccessToTargetUserData(
      {
        actor: "user",
        userId: "usr_admin",
        organizationId: null,
        role: "admin",
      },
      target,
    );
    expect(ctx.source).toBe("session");
    expect(ctx.userId).toBe("usr_admin");
  });

  it("rejects session non-admin for another user id", () => {
    expect(() =>
      requireAccessToTargetUserData(
        {
          actor: "user",
          userId: "usr_other",
          organizationId: null,
          role: "user",
        },
        target,
      ),
    ).toThrow();
  });

  it("rejects coworker delegation mismatch", () => {
    expect(() =>
      requireAccessToTargetUserData(
        {
          actor: "coworker",
          coworkerId: "cow_1",
          vendorId: TEST_VENDOR_ID,
          context: { userId: "usr_other", organizationId: null },
        },
        target,
      ),
    ).toThrow();
  });
});

describe("resolveUsersPathUserId", () => {
  it("resolves me to the session user id", () => {
    const { resolvedUserId, userContext } = resolveUsersPathUserId(
      {
        actor: "user",
        userId: "usr_self",
        organizationId: null,
        role: "user",
      },
      USERS_PATH_ME,
    );
    expect(resolvedUserId).toBe("usr_self");
    expect(userContext.source).toBe("session");
    expect(userContext.userId).toBe("usr_self");
  });

  it("rejects coworker for me", () => {
    expect(() =>
      resolveUsersPathUserId(
        {
          actor: "coworker",
          coworkerId: "cow_1",
          vendorId: TEST_VENDOR_ID,
          context: { userId: "usr_x", organizationId: null },
        },
        USERS_PATH_ME,
      ),
    ).toThrow();
  });

  it("delegates to requireAccessToTargetUserData for concrete ids", () => {
    const { resolvedUserId, userContext } = resolveUsersPathUserId(
      {
        actor: "user",
        userId: "usr_self",
        organizationId: null,
        role: "user",
      },
      "usr_self",
    );
    expect(resolvedUserId).toBe("usr_self");
    expect(userContext.userId).toBe("usr_self");
  });
});
