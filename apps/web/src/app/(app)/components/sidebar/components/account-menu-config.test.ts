import { describe, expect, it } from "vitest";
import type { MemberWithOrganization } from "@/lib/clients/generated/core";
import { MemberRole } from "@/lib/clients/generated/core";

import { getAccountNavItems } from "./account-menu-config";

function member(input: {
  organizationId: string;
  role?: MemberRole;
  slug?: string;
}): MemberWithOrganization {
  const createdAt = new Date("2026-01-01T00:00:00.000Z");
  return {
    id: `member_${input.organizationId}`,
    organizationId: input.organizationId,
    userId: "user_1",
    role: input.role ?? MemberRole.OWNER,
    createdAt,
    seatAssignedAt: null,
    organization: {
      id: input.organizationId,
      name: "Utxo",
      slug: input.slug ?? "utxo",
      createdAt,
      metadata: null,
      logo: null,
      stripeCustomerId: null,
    },
  };
}

describe("getAccountNavItems", () => {
  /**
   * Notifications is the one settings page a reader comes back to, so it is
   * reachable from the menu rather than from a link inside another page.
   */
  it("offers Notifications next to Account, whatever the workspace is", () => {
    for (const activeOrganizationId of ["org_1", null]) {
      const items = getAccountNavItems({
        activeOrganizationId,
        members: [member({ organizationId: "org_1" })],
      });

      expect(items.map((item) => item.key).slice(0, 2)).toEqual([
        "account",
        "notifications",
      ]);
      expect(items[1]).toMatchObject({ href: "/account/notifications" });
    }
  });

  it("links Organization to /organization when an org workspace is active", () => {
    const items = getAccountNavItems({
      activeOrganizationId: "org_1",
      members: [member({ organizationId: "org_1", slug: "utxo" })],
    });

    const organizationItem = items.find((item) => item.key === "organization");
    expect(organizationItem).toMatchObject({
      href: "/organization",
      translationKey: "organization",
    });
    expect(items.some((item) => item.href.includes("/organizations/"))).toBe(
      false,
    );
  });

  it("omits Organization when no organization workspace is active", () => {
    const items = getAccountNavItems({
      activeOrganizationId: null,
      members: [member({ organizationId: "org_1" })],
    });

    expect(items.find((item) => item.key === "organization")).toBeUndefined();
  });
});
