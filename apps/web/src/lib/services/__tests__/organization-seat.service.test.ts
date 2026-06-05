import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("better-auth/api", () => ({
  APIError: class APIError extends Error {
    status?: string;
    constructor(code: string, options?: { message?: string }) {
      super(options?.message ?? "API error");
      this.name = "APIError";
      this.status = code;
    }
  },
}));

const getMemberByUserIdAndOrganizationIdMock = vi.fn();
const getAssignedMemberCountMock = vi.fn();
const assignSeatMock = vi.fn();
const unassignSeatMock = vi.fn();
const resolveActiveSubscriptionByReferenceIdMock = vi.fn();
const resolveOrganizationBillingPlanMock = vi.fn();
const memberCountMock = vi.fn();
const grantUnusedSeatSubscriptionCreditsIfEligibleMock = vi.fn();
const grantFreeOrganizationMemberSubscriptionCreditsMock = vi.fn();
const ensureLocalFreeSubscriptionPeriodMock = vi.fn();
const fetchOrganizationMemberUserIdsMock = vi.fn();
const transactionMock = vi.fn();

vi.mock("@/lib/services/organization-seat-credits.service", () => ({
  grantUnusedSeatSubscriptionCreditsIfEligible: (...args: unknown[]) =>
    grantUnusedSeatSubscriptionCreditsIfEligibleMock(...args),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
      ensureLocalFreeSubscriptionPeriodMock(...args),
    fetchOrganizationMemberUserIds: (...args: unknown[]) =>
      fetchOrganizationMemberUserIdsMock(...args),
    grantFreeOrganizationMemberSubscriptionCredits: (...args: unknown[]) =>
      grantFreeOrganizationMemberSubscriptionCreditsMock(...args),
    resolveOrganizationBillingPlan: (...args: unknown[]) =>
      resolveOrganizationBillingPlanMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    assignSeat: (...args: unknown[]) => assignSeatMock(...args),
    getAssignedMemberCount: (...args: unknown[]) =>
      getAssignedMemberCountMock(...args),
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
    unassignSeat: (...args: unknown[]) => unassignSeatMock(...args),
  },
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
    member: {
      count: (...args: unknown[]) => memberCountMock(...args),
    },
  },
}));

describe("organizationSeatService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({}),
    );
    grantUnusedSeatSubscriptionCreditsIfEligibleMock.mockResolvedValue({
      creditsGranted: 0,
      granted: false,
    });
    grantFreeOrganizationMemberSubscriptionCreditsMock.mockResolvedValue(1);
    ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue({
      grantsCreated: 0,
      subscriptionCreated: false,
      subscriptionId: "sub-local-free",
    });
    fetchOrganizationMemberUserIdsMock.mockResolvedValue([]);
  });

  it("returns zero purchased seats for free organizations", async () => {
    getAssignedMemberCountMock.mockResolvedValue(2);
    memberCountMock.mockResolvedValue(5);
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      mode: "self_serve",
      periodEnd: null,
      plan: "free",
      purchasedSeats: 0,
      subscriptionId: null,
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.getSeatSummary("org-1"),
    ).resolves.toEqual({
      assignedCount: 0,
      isEnterpriseContract: false,
      memberCount: 5,
      paidPlan: null,
      purchasedSeats: 0,
      unusedSeats: 0,
    });
  });

  it("returns paid seat counts for active paid subscriptions", async () => {
    getAssignedMemberCountMock.mockResolvedValue(2);
    memberCountMock.mockResolvedValue(5);
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      mode: "self_serve",
      periodEnd: null,
      plan: "starter",
      purchasedSeats: 4,
      subscriptionId: "sub-1",
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.getSeatSummary("org-1"),
    ).resolves.toEqual({
      assignedCount: 2,
      isEnterpriseContract: false,
      memberCount: 5,
      paidPlan: "starter",
      purchasedSeats: 4,
      unusedSeats: 2,
    });
  });

  it("returns enterprise seat summary for post-term enterprise contract", async () => {
    getAssignedMemberCountMock.mockResolvedValue(2);
    memberCountMock.mockResolvedValue(5);
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      contractId: "contract-1",
      isConsumable: false,
      mode: "enterprise_contract",
      periodEnd: null,
      plan: "enterprise",
      purchasedSeats: 12,
      activatedAt: new Date("2026-08-01T00:00:00.000Z"),
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.getSeatSummary("org-1"),
    ).resolves.toEqual({
      assignedCount: 2,
      isEnterpriseContract: true,
      memberCount: 5,
      paidPlan: "enterprise",
      purchasedSeats: 12,
      unusedSeats: 10,
    });
  });

  it("assigns a seat when caller is owner and capacity remains", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "owner" });
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      mode: "self_serve",
      periodEnd: null,
      plan: "starter",
      purchasedSeats: 3,
      subscriptionId: "sub-1",
    });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      seats: 3,
    });
    assignSeatMock.mockResolvedValue({
      id: "member-1",
      seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
      userId: "user-2",
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    const result = await organizationSeatService.assignSeat(
      "user-1",
      "org-1",
      "member-1",
    );

    expect(result.memberId).toBe("member-1");
    expect(assignSeatMock).toHaveBeenCalledWith(
      "member-1",
      "org-1",
      3,
      expect.any(Object),
    );
    expect(
      grantUnusedSeatSubscriptionCreditsIfEligibleMock,
    ).toHaveBeenCalledWith("org-1", "user-2", expect.any(Object));
  });

  it("skips self-serve credit grants when assigning seats on enterprise contracts", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "owner" });
    resolveOrganizationBillingPlanMock.mockResolvedValue({
      cancelAtPeriodEnd: false,
      endsAt: new Date("2027-01-01T00:00:00.000Z"),
      contractId: "contract-1",
      isConsumable: true,
      mode: "enterprise_contract",
      periodEnd: null,
      plan: "enterprise",
      purchasedSeats: 3,
      activatedAt: new Date("2026-05-01T00:00:00.000Z"),
    });
    assignSeatMock.mockResolvedValue({
      id: "member-1",
      seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
      userId: "user-2",
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await organizationSeatService.assignSeat("user-1", "org-1", "member-1");

    expect(assignSeatMock).toHaveBeenCalledWith(
      "member-1",
      "org-1",
      3,
      expect.any(Object),
    );
    expect(
      grantUnusedSeatSubscriptionCreditsIfEligibleMock,
    ).not.toHaveBeenCalled();
    expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
  });

  it("reads purchased seats inside the transaction before assigning", async () => {
    const callOrder: string[] = [];
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "owner" });
    resolveOrganizationBillingPlanMock.mockImplementation(async () => {
      callOrder.push("getBillingPlan");
      return {
        cancelAtPeriodEnd: false,
        mode: "self_serve",
        periodEnd: null,
        plan: "starter",
        purchasedSeats: 3,
        subscriptionId: "sub-1",
      };
    });
    resolveActiveSubscriptionByReferenceIdMock.mockImplementation(async () => {
      callOrder.push("getSubscription");
      return { seats: 3 };
    });
    assignSeatMock.mockImplementation(async () => {
      callOrder.push("assignSeat");
      return {
        id: "member-1",
        seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
        userId: "user-2",
      };
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await organizationSeatService.assignSeat("user-1", "org-1", "member-1");

    expect(callOrder).toEqual([
      "getBillingPlan",
      "getSubscription",
      "assignSeat",
    ]);
  });

  it("rejects seat assignment for non-admin members", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
      role: "member",
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.assignSeat("user-1", "org-1", "member-1"),
    ).rejects.toThrow(
      "Only organization owners and admins can manage seat assignments",
    );
  });

  it("grants free monthly credits when unassigning in a paid organization", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "owner" });
    unassignSeatMock.mockResolvedValue({
      id: "member-1",
      userId: "user-2",
    });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      periodEnd: new Date("2026-06-01T00:00:00.000Z"),
      plan: "starter",
      status: "active",
      stripeSubscriptionId: "sub_123",
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    const result = await organizationSeatService.unassignSeat(
      "user-1",
      "org-1",
      "member-1",
    );

    expect(result.memberId).toBe("member-1");
    expect(
      grantFreeOrganizationMemberSubscriptionCreditsMock,
    ).toHaveBeenCalledWith(
      {
        memberUserIds: ["user-2"],
        organizationId: "org-1",
        periodEnd: new Date("2026-06-01T00:00:00.000Z"),
      },
      expect.any(Object),
    );
    expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
  });

  it("does not grant free monthly credits when unassigning in a free organization", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "admin" });
    unassignSeatMock.mockResolvedValue({
      id: "member-1",
      userId: "user-2",
    });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-06-01T00:00:00.000Z"),
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      plan: "free",
      seats: 2,
      status: "active",
      stripeSubscriptionId: null,
    });
    fetchOrganizationMemberUserIdsMock.mockResolvedValue(["user-1", "user-2"]);

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await organizationSeatService.unassignSeat("user-1", "org-1", "member-1");

    expect(
      grantFreeOrganizationMemberSubscriptionCreditsMock,
    ).not.toHaveBeenCalled();
    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      {
        billingAnchorDate: new Date("2026-01-01T00:00:00.000Z"),
        memberUserIds: ["user-1", "user-2"],
        organizationId: "org-1",
        periodEnd: new Date("2026-06-01T00:00:00.000Z"),
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        purchasedSeats: 2,
        referenceId: "org-1",
      },
      expect.any(Object),
    );
  });

  it("syncs local-free credits for all members when assigning in a free organization", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "owner" });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-06-01T00:00:00.000Z"),
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      seats: 3,
      status: "active",
      stripeSubscriptionId: null,
    });
    assignSeatMock.mockResolvedValue({
      id: "member-1",
      seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
      userId: "user-2",
    });
    fetchOrganizationMemberUserIdsMock.mockResolvedValue(["user-1", "user-2"]);

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await organizationSeatService.assignSeat("user-1", "org-1", "member-1");

    expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      {
        billingAnchorDate: new Date("2026-01-01T00:00:00.000Z"),
        memberUserIds: ["user-1", "user-2"],
        organizationId: "org-1",
        periodEnd: new Date("2026-06-01T00:00:00.000Z"),
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        purchasedSeats: 3,
        referenceId: "org-1",
      },
      expect.any(Object),
    );
  });

  it("does not sync local-free credits when assigning in a paid organization", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "owner" });
    resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      seats: 3,
      status: "active",
      stripeSubscriptionId: "sub_123",
    });
    assignSeatMock.mockResolvedValue({
      id: "member-1",
      seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
      userId: "user-2",
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await organizationSeatService.assignSeat("user-1", "org-1", "member-1");

    expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
  });
});
