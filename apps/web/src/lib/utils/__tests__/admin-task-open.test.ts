import { describe, expect, it } from "vitest";

import { canOpenAdminTaskAsUser } from "../admin-task-open";

describe("canOpenAdminTaskAsUser", () => {
  it("allows opening an organization task when the admin is a member", () => {
    expect(
      canOpenAdminTaskAsUser({
        taskUserId: "user_other",
        taskOrganizationId: "org_1",
        sessionUserId: "admin_1",
        memberOrganizationIds: ["org_1", "org_2"],
      }),
    ).toBe(true);
  });

  it("denies opening an organization task when the admin is not a member", () => {
    expect(
      canOpenAdminTaskAsUser({
        taskUserId: "user_other",
        taskOrganizationId: "org_1",
        sessionUserId: "admin_1",
        memberOrganizationIds: ["org_2"],
      }),
    ).toBe(false);
  });

  it("allows opening the admin's own personal-workspace task", () => {
    expect(
      canOpenAdminTaskAsUser({
        taskUserId: "admin_1",
        taskOrganizationId: null,
        sessionUserId: "admin_1",
        memberOrganizationIds: [],
      }),
    ).toBe(true);
  });

  it("denies opening another user's personal-workspace task", () => {
    expect(
      canOpenAdminTaskAsUser({
        taskUserId: "user_other",
        taskOrganizationId: null,
        sessionUserId: "admin_1",
        memberOrganizationIds: ["org_1"],
      }),
    ).toBe(false);
  });

  it("denies when there is no session user", () => {
    expect(
      canOpenAdminTaskAsUser({
        taskUserId: "user_other",
        taskOrganizationId: null,
        sessionUserId: null,
        memberOrganizationIds: [],
      }),
    ).toBe(false);
  });
});
