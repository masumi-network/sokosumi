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
const getLatestActiveSubscriptionByReferenceIdMock = vi.fn();
const memberCountMock = vi.fn();
const grantUnusedSeatSubscriptionCreditsIfEligibleMock = vi.fn();
const grantFreeOrganizationMemberSubscriptionCreditsMock = vi.fn();
const ensureLocalFreeSubscriptionPeriodMock = vi.fn();
const resolveOrganizationFreeCreditAudienceMock = vi.fn();
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
    grantFreeOrganizationMemberSubscriptionCredits: (...args: unknown[]) =>
      grantFreeOrganizationMemberSubscriptionCreditsMock(...args),
    resolveOrganizationFreeCreditAudience: (...args: unknown[]) =>
      resolveOrganizationFreeCreditAudienceMock(...args),
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
    getLatestActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestActiveSubscriptionByReferenceIdMock(...args),
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
    resolveOrganizationFreeCreditAudienceMock.mockResolvedValue({
      kind: "paid_org_unassigned_free",
      memberUserIds: [],
    });
  });

  it("returns seat summary counts", async () => {
    getAssignedMemberCountMock.mockResolvedValue(2);
    memberCountMock.mockResolvedValue(5);
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      seats: 4,
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await expect(
      organizationSeatService.getSeatSummary("org-1"),
    ).resolves.toEqual({
      assignedCount: 2,
      memberCount: 5,
      paidPlan: null,
      purchasedSeats: 4,
      unusedSeats: 2,
    });
  });

  it("assigns a seat when caller is owner and capacity remains", async () => {
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "owner" });
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
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
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
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
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      periodEnd: new Date("2026-06-01T00:00:00.000Z"),
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      plan: "free",
      seats: 2,
      status: "active",
      stripeSubscriptionId: null,
    });
    resolveOrganizationFreeCreditAudienceMock.mockResolvedValue({
      kind: "local_free_org",
      memberUserIds: ["user-1", "user-2"],
    });

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
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
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
    resolveOrganizationFreeCreditAudienceMock.mockResolvedValue({
      kind: "local_free_org",
      memberUserIds: ["user-1", "user-2"],
    });

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
    getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
      seats: 3,
      status: "active",
      stripeSubscriptionId: "sub_123",
    });
    assignSeatMock.mockResolvedValue({
      id: "member-1",
      seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
      userId: "user-2",
    });
    resolveOrganizationFreeCreditAudienceMock.mockResolvedValue({
      kind: "paid_org_unassigned_free",
      memberUserIds: ["user-3"],
    });

    const { organizationSeatService } = await import(
      "../organization-seat.service"
    );

    await organizationSeatService.assignSeat("user-1", "org-1", "member-1");

    expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
  });
});
