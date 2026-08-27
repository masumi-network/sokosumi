import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { MemberRole } from "../types/organization.js";
import {
  assertOrganizationRetainsOwner,
  OrganizationOwnerRetentionError,
} from "./organization-owner.js";

describe("assertOrganizationRetainsOwner", () => {
  it("allows demoting a non-owner member", async () => {
    const tx = {
      member: {
        findFirst: async () => ({ role: MemberRole.ADMIN }),
        count: async () => {
          throw new Error("should not count owners");
        },
      },
    };

    await assertOrganizationRetainsOwner(
      "org-1",
      "member-1",
      MemberRole.MEMBER,
      tx as never,
    );
  });

  it("allows removing a non-owner member", async () => {
    const tx = {
      member: {
        findFirst: async () => ({ role: MemberRole.MEMBER }),
        count: async () => {
          throw new Error("should not count owners");
        },
      },
    };

    await assertOrganizationRetainsOwner(
      "org-1",
      "member-1",
      null,
      tx as never,
    );
  });

  it("rejects removing the last owner", async () => {
    const tx = {
      member: {
        findFirst: async () => ({ role: MemberRole.OWNER }),
        count: async () => 0,
      },
    };

    await assert.rejects(
      () =>
        assertOrganizationRetainsOwner("org-1", "member-1", null, tx as never),
      OrganizationOwnerRetentionError,
    );
  });

  it("allows removing an owner when another owner exists", async () => {
    const tx = {
      member: {
        findFirst: async () => ({ role: MemberRole.OWNER }),
        count: async () => 1,
      },
    };

    await assertOrganizationRetainsOwner(
      "org-1",
      "member-1",
      null,
      tx as never,
    );
  });
});
