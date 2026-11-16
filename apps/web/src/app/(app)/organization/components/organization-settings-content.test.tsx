import { MemberRole } from "@sokosumi/core-client";
import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { Nothing, csvButton, getMyMemberInOrganization, getPendingInvitations } =
  vi.hoisted(() => ({
    Nothing: () => null,
    csvButton: vi.fn(),
    getMyMemberInOrganization: vi.fn(),
    getPendingInvitations: vi.fn(),
  }));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/services/user.service", () => ({
  userService: { getMyMemberInOrganization },
}));
vi.mock("@/lib/services/organization.service", () => ({
  organizationService: {
    getPendingInvitations,
    getOrganizationInviteLinks: async () => [],
  },
}));
vi.mock("@/lib/services/organization-seat.service", () => ({
  organizationSeatService: { getSeatSummary: async () => null },
}));
vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getOrganizationDeletion: async () => ({ data: { blockers: [] } }),
    getOrganizationMembers: async () => ({ data: [] }),
    getOrganizationBillingDetails: async () => ({ data: undefined }),
  },
}));
vi.mock("@/components/members-table/members-csv-button", () => ({
  MembersCsvButton: (props: unknown) => {
    csvButton(props);
    return null;
  },
}));
vi.mock("@/components/members-table/members-table", () => ({
  default: Nothing,
}));
vi.mock("@/components/organizations/role-badge", () => ({
  OrganizationRoleBadge: Nothing,
}));
vi.mock("@/components/billing/billing-portal-error-toast", () => ({
  BillingPortalErrorToast: Nothing,
}));
vi.mock("@/components/auth/core-auth-read-retry", () => ({
  CoreAuthReadRetry: Nothing,
}));
vi.mock(
  "@/app/organizations/[organizationSlug]/components/organization-billing-access-restricted",
  () => ({ OrganizationBillingAccessRestricted: Nothing }),
);
vi.mock(
  "@/app/organizations/[organizationSlug]/components/organization-billing-details",
  () => ({ default: Nothing }),
);
vi.mock(
  "@/app/organizations/[organizationSlug]/components/organization-coworker-access",
  () => ({ OrganizationCoworkerAccess: Nothing }),
);
vi.mock(
  "@/app/organizations/[organizationSlug]/components/organization-credit-spend",
  () => ({ OrganizationCreditSpendCard: Nothing }),
);
vi.mock(
  "@/app/organizations/[organizationSlug]/components/organization-information",
  () => ({ default: Nothing }),
);
vi.mock(
  "@/app/organizations/[organizationSlug]/components/organization-invite-button",
  () => ({ default: Nothing }),
);
vi.mock(
  "@/app/organizations/[organizationSlug]/components/organization-invite-links",
  () => ({ OrganizationInviteLinks: Nothing }),
);
vi.mock(
  "@/app/organizations/[organizationSlug]/components/organization-seat-summary",
  () => ({ OrganizationSeatSummaryCard: Nothing }),
);
vi.mock(
  "@/app/organizations/[organizationSlug]/components/organization-vendor-grants",
  () => ({ OrganizationVendorGrants: Nothing }),
);

import { OrganizationSettingsContent } from "./organization-settings-content";

const organization = { id: "org-1", slug: "utxo" } as Parameters<
  typeof OrganizationSettingsContent
>[0]["organization"];

async function renderAs(role: MemberRole) {
  getMyMemberInOrganization.mockResolvedValueOnce({ id: "member-1", role });
  render(await OrganizationSettingsContent({ organization }));
}

describe("OrganizationSettingsContent member CSV", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("offers the download to an admin once invitations loaded", async () => {
    getPendingInvitations.mockResolvedValueOnce([]);
    await renderAs(MemberRole.ADMIN);
    expect(csvButton).toHaveBeenCalledWith(
      expect.objectContaining({ organizationSlug: "utxo" }),
    );
  });

  it("hides the download when invitations failed to load", async () => {
    getPendingInvitations.mockRejectedValueOnce(new Error("core down"));
    await renderAs(MemberRole.OWNER);
    expect(csvButton).not.toHaveBeenCalled();
  });

  it("never offers the download to a plain member", async () => {
    await renderAs(MemberRole.MEMBER);
    expect(csvButton).not.toHaveBeenCalled();
    expect(getPendingInvitations).not.toHaveBeenCalled();
  });
});
