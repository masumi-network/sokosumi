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
  getCreditsMock,
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
  getCreditsMock: vi.fn(),
  buildCreditsPayloadMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", () => ({
  getUnusedSeatCount: (purchased: number, assigned: number) =>
    Math.max(purchased - assigned, 0),
  resolveOrganizationBillingPlan: (...args: unknown[]) =>
    resolveOrganizationBillingPlanMock(...args),
}));

vi.mock("@sokosumi/database/repositories", () => ({
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

vi.mock("@/helpers/user.js", () => ({
  getCredits: (...args: unknown[]) => getCreditsMock(...args),
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

function createTx(
  ownerUserId: string | null,
  firstMemberUserId: string | null,
) {
  const memberFindFirst = vi.fn(async (args: { where?: { role?: string } }) => {
    if (args.where?.role === "owner") {
      return ownerUserId ? { userId: ownerUserId } : null;
    }
    return firstMemberUserId ? { userId: firstMemberUserId } : null;
  });

  return {
    member: {
      findFirst: memberFindFirst,
    },
    memberFindFirst,
  };
}

describe("buildAdminOrganizationOverviewDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUniqueOrganizationWithRelationsMock.mockResolvedValue(ORGANIZATION);
    getAssignedMemberCountMock.mockResolvedValue(0);
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);
    getLatestSubscriptionByReferenceIdMock.mockResolvedValue(null);
    getCreditsMock.mockResolvedValue(90_246);
  });

  it("returns numeric pool remaining credits for self-serve via getCredits with the owner", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "free",
      purchasedSeats: 0,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    const { memberFindFirst, ...tx } = createTx("user_owner", "user_member");

    const detail = await buildAdminOrganizationOverviewDetail(
      "acme-corp",
      tx as unknown as Prisma.TransactionClient,
    );

    expect(detail?.totalCredits).toBe(90_246);
    expect(getCreditsMock).toHaveBeenCalledWith(
      "user_owner",
      "org_1",
      expect.anything(),
    );
    expect(memberFindFirst).toHaveBeenCalledTimes(1);
  });

  it("falls back to the earliest member when the organization has no owner", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "free",
      purchasedSeats: 0,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    const { memberFindFirst, ...tx } = createTx(null, "user_member");

    const detail = await buildAdminOrganizationOverviewDetail(
      "acme-corp",
      tx as unknown as Prisma.TransactionClient,
    );

    expect(detail?.totalCredits).toBe(90_246);
    expect(getCreditsMock).toHaveBeenCalledWith(
      "user_member",
      "org_1",
      expect.anything(),
    );
    expect(memberFindFirst).toHaveBeenCalledTimes(2);
  });

  it("returns 0 for self-serve when the organization has no members", async () => {
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      mode: "self_serve",
      plan: "free",
      purchasedSeats: 0,
      cancelAtPeriodEnd: false,
      periodEnd: null,
    });
    const tx = createTx(null, null);

    const detail = await buildAdminOrganizationOverviewDetail(
      "acme-corp",
      tx as unknown as Prisma.TransactionClient,
    );

    expect(detail?.totalCredits).toBe(0);
    expect(getCreditsMock).not.toHaveBeenCalled();
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
    const tx = createTx("user_owner", "user_member");

    const detail = await buildAdminOrganizationOverviewDetail(
      "acme-corp",
      tx as unknown as Prisma.TransactionClient,
    );

    expect(detail?.totalCredits).toBe(1_200);
    expect(getCreditsMock).not.toHaveBeenCalled();
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
