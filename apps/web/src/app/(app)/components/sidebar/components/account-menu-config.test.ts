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
