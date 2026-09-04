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
    expect(ctx).toEqual({
      source: "context",
      userId: target,
      organizationId: null,
    });
  });

  it("allows an orchestrator only for its fixed owner id", () => {
    const authContext = {
      actor: "orchestrator" as const,
      sokoBotId: "11111111-1111-7111-8111-111111111111",
      userId: target,
      workspaceId: "22222222-2222-7222-8222-222222222222",
      organizationId: null,
    };

    expect(requireAccessToTargetUserData(authContext, target)).toEqual({
      source: "context",
      userId: target,
      organizationId: null,
    });
    expect(() =>
      requireAccessToTargetUserData(authContext, "usr_other"),
    ).toThrow();
  });

  it("rejects bare coworker without context headers", () => {
    expect(() =>
      requireAccessToTargetUserData(
        {
          actor: "coworker",
          coworkerId: "cow_1",
          vendorId: TEST_VENDOR_ID,
        },
        target,
      ),
    ).toThrow();
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

  it("rejects coworker context for a different user id", () => {
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

  it("resolves me to the coworker context user id", () => {
    const { resolvedUserId, userContext } = resolveUsersPathUserId(
      {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
        context: { userId: "usr_ctx", organizationId: "org_1" },
      },
      USERS_PATH_ME,
    );
    expect(resolvedUserId).toBe("usr_ctx");
    expect(userContext).toEqual({
      source: "context",
      userId: "usr_ctx",
      organizationId: "org_1",
    });
  });

  it("resolves me to the orchestrator owner id", () => {
    const { resolvedUserId, userContext } = resolveUsersPathUserId(
      {
        actor: "orchestrator",
        sokoBotId: "11111111-1111-7111-8111-111111111111",
        userId: "usr_owner",
        workspaceId: "22222222-2222-7222-8222-222222222222",
        organizationId: "org_1",
      },
      USERS_PATH_ME,
    );

    expect(resolvedUserId).toBe("usr_owner");
    expect(userContext).toEqual({
      source: "context",
      userId: "usr_owner",
      organizationId: "org_1",
    });
  });

  it("rejects bare coworker for me", () => {
    expect(() =>
      resolveUsersPathUserId(
        {
          actor: "coworker",
          coworkerId: "cow_1",
          vendorId: TEST_VENDOR_ID,
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

  it("allows coworker with matching concrete user id", () => {
    const { resolvedUserId, userContext } = resolveUsersPathUserId(
      {
        actor: "coworker",
        coworkerId: "cow_1",
        vendorId: TEST_VENDOR_ID,
        context: { userId: "usr_self", organizationId: null },
      },
      "usr_self",
    );
    expect(resolvedUserId).toBe("usr_self");
    expect(userContext.source).toBe("context");
    expect(userContext.userId).toBe("usr_self");
  });
});
