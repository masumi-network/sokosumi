import type { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getUniqueOrganizationWithRelationsMock,
  getOrganizationLimitedInfoBySlugMock,
  getAssignedMemberCountMock,
  listMembersForAdminOverviewMock,
  resolveActiveSubscriptionByReferenceIdMock,
  getLatestSubscriptionByReferenceIdMock,
  resolveOrganizationBillingPlanMock,
  getEnterpriseContractBillingSummaryMock,
  sumOrganizationOwnedCreditBalancesMock,
  buildCreditsPayloadMock,
} = vi.hoisted(() => ({
  getUniqueOrganizationWithRelationsMock: vi.fn(),
  getOrganizationLimitedInfoBySlugMock: vi.fn(),
  getAssignedMemberCountMock: vi.fn(),
  listMembersForAdminOverviewMock: vi.fn(),
  resolveActiveSubscriptionByReferenceIdMock: vi.fn(),
  getLatestSubscriptionByReferenceIdMock: vi.fn(),
  resolveOrganizationBillingPlanMock: vi.fn(),
  getEnterpriseContractBillingSummaryMock: vi.fn(),
  sumOrganizationOwnedCreditBalancesMock: vi.fn(),
  buildCreditsPayloadMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", () => ({
  getUnusedSeatCount: (purchased: number, assigned: number) =>
    Math.max(purchased - assigned, 0),
  resolveOrganizationBillingPlan: (...args: unknown[]) =>
    resolveOrganizationBillingPlanMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
  creditBucketRepository: {
    sumOrganizationOwnedCreditBalances: (...args: unknown[]) =>
      sumOrganizationOwnedCreditBalancesMock(...args),
  },
  memberRepository: {
    getAssignedMemberCount: (...args: unknown[]) =>
      getAssignedMemberCountMock(...args),
    listMembersForAdminOverview: (...args: unknown[]) =>
      listMembersForAdminOverviewMock(...args),
  },
  organizationRepository: {
    getUniqueOrganizationWithRelations: (...args: unknown[]) =>
      getUniqueOrganizationWithRelationsMock(...args),
    getOrganizationLimitedInfoBySlug: (...args: unknown[]) =>
      getOrganizationLimitedInfoBySlugMock(...args),
  },
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
    getLatestSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestSubscriptionByReferenceIdMock(...args),
  },
}));

vi.mock("@/helpers/enterprise-contract-summary.js", () => ({
  getEnterpriseContractBillingSummary: (...args: unknown[]) =>
    getEnterpriseContractBillingSummaryMock(...args),
}));

vi.mock("@/helpers/subscription.js", () => ({
  buildCreditsPayload: (...args: unknown[]) => buildCreditsPayloadMock(...args),
}));

import {
  buildAdminOrganizationMemberOverviewPage,
  buildAdminOrganizationOverviewDetail,
} from "./admin-organization-overview.js";

const ORGANIZATION = {
  id: "org_1",
  name: "Acme Corp",
  slug: "acme-corp",
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  stripeCustomerId: null,
  _count: { members: 2 },
};

const OWNER_MEMBER = {
  id: "member_1",
  organizationId: "org_1",
  userId: "user_owner",
  role: "owner",
  seatAssignedAt: null,
  createdAt: new Date("2025-01-01T00:00:00.000Z"),
  lastSeenAt: null,
  user: {
    id: "user_owner",
    name: "Owner",
    email: "owner@example.com",
  },
};

const MEMBER = {
  id: "member_2",
  organizationId: "org_1",
  userId: "user_member",
  role: "member",
  seatAssignedAt: null,
  createdAt: new Date("2025-02-01T00:00:00.000Z"),
  lastSeenAt: null,
  user: {
    id: "user_member",
    name: "Member",
    email: "member@example.com",
  },
};

const POOL_REMAINING_CENTS = 90_246n * 10_000_000_000n;

describe("buildAdminOrganizationOverviewDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUniqueOrganizationWithRelationsMock.mockResolvedValue(ORGANIZATION);
    getAssignedMemberCountMock.mockResolvedValue(0);
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
    getLatestSubscriptionByReferenceIdMock.mockResolvedValue(null);
    sumOrganizationOwnedCreditBalancesMock.mockResolvedValue({
      totalCents: POOL_REMAINING_CENTS,
      remainingCents: POOL_REMAINING_CENTS,
    });
  });

  it("returns numeric org-owned remaining credits for self-serve", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "free",
      purchasedSeats: 0,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });

    const detail = await buildAdminOrganizationOverviewDetail(
      "acme-corp",
      {} as Prisma.TransactionClient,
    );

    expect(detail?.totalCredits).toBe(90_246);
    expect(sumOrganizationOwnedCreditBalancesMock).toHaveBeenCalledWith(
      "org_1",
      expect.anything(),
    );
  });

  it("does not seat-gate paid self-serve pool remaining", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "starter",
      purchasedSeats: 5,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    getAssignedMemberCountMock.mockResolvedValue(0);

    const detail = await buildAdminOrganizationOverviewDetail(
      "acme-corp",
      {} as Prisma.TransactionClient,
    );

    expect(detail?.totalCredits).toBe(90_246);
    expect(sumOrganizationOwnedCreditBalancesMock).toHaveBeenCalledWith(
      "org_1",
      expect.anything(),
    );
  });

  it("keeps the enterprise pool remaining credits path", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "enterprise_contract",
      plan: "enterprise",
      isConsumable: true,
      purchasedSeats: 10,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    getEnterpriseContractBillingSummaryMock.mockResolvedValue({
      poolRemainingCredits: 1_200,
      monthlyCredits: 500,
      purchasedSeats: 10,
      isConsumable: true,
    });
    getAssignedMemberCountMock.mockResolvedValue(2);

    const detail = await buildAdminOrganizationOverviewDetail(
      "acme-corp",
      {} as Prisma.TransactionClient,
    );

    expect(detail?.totalCredits).toBe(1_200);
    expect(sumOrganizationOwnedCreditBalancesMock).not.toHaveBeenCalled();
  });
});

describe("buildAdminOrganizationMemberOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOrganizationLimitedInfoBySlugMock.mockResolvedValue({
      id: "org_1",
      name: "Acme Corp",
      slug: "acme-corp",
    });
    listMembersForAdminOverviewMock.mockResolvedValue({
      members: [OWNER_MEMBER, MEMBER],
      total: 2,
    });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      plan: "starter",
      status: "active",
    });
    getLatestSubscriptionByReferenceIdMock.mockResolvedValue(null);
    buildCreditsPayloadMock.mockResolvedValue({
      credits: {
        total: 90_246,
        subscription: { plan: "starter", status: "active" },
      },
    });
  });

  it("stamps the org subscription on every member and omits credits", async () => {
    const page = await buildAdminOrganizationMemberOverviewPage(
      "acme-corp",
      { take: 20 },
      {} as Prisma.TransactionClient,
    );

    expect(page?.members).toHaveLength(2);
    for (const member of page?.members ?? []) {
      expect(member).not.toHaveProperty("credits");
      expect(member.subscriptionPlan).toBe("starter");
      expect(member.subscriptionStatus).toBe("active");
    }
    expect(buildCreditsPayloadMock).not.toHaveBeenCalled();
    expect(resolveActiveSubscriptionByReferenceIdMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to the latest org subscription when none is active", async () => {
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
    getLatestSubscriptionByReferenceIdMock.mockResolvedValue({
      plan: "pro",
      status: "canceled",
    });

    const page = await buildAdminOrganizationMemberOverviewPage(
      "acme-corp",
      { take: 20 },
      {} as Prisma.TransactionClient,
    );

    expect(page?.members[0]?.subscriptionPlan).toBe("pro");
    expect(page?.members[0]?.subscriptionStatus).toBe("canceled");
    expect(getLatestSubscriptionByReferenceIdMock).toHaveBeenCalledTimes(1);
    expect(buildCreditsPayloadMock).not.toHaveBeenCalled();
  });
});
