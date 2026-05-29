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

const getLatestActiveSubscriptionByReferenceIdMock = vi.fn();
const getOrganizationMemberUserIdsMock = vi.fn();
const getUnassignedMemberUserIdsMock = vi.fn();
const ensureLocalFreeSubscriptionPeriodMock = vi.fn();
const grantFreeOrganizationMemberSubscriptionCreditsMock = vi.fn();
const transactionMock = vi.fn();

const getMemberByUserIdAndOrganizationIdMock = vi.fn();
const assignSeatMock = vi.fn();
const unassignSeatMock = vi.fn();
const grantUnusedSeatSubscriptionCreditsIfEligibleMock = vi.fn();
const resolveOrganizationFreeCreditAudienceMock = vi.fn();
const ensureLocalFreeSubscriptionPeriodSeatMock = vi.fn();

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_123",
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    $transaction: (...args: unknown[]) => transactionMock(...args),
  },
}));

vi.mock("@/lib/services/organization-seat-credits.service", () => ({
  grantUnusedSeatSubscriptionCreditsIfEligible: (...args: unknown[]) =>
    grantUnusedSeatSubscriptionCreditsIfEligibleMock(...args),
}));

vi.mock("@sokosumi/database/helpers", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@sokosumi/database/helpers")>();
  return {
    ...actual,
    ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) => {
      ensureLocalFreeSubscriptionPeriodSeatMock(...args);
      return ensureLocalFreeSubscriptionPeriodMock(...args);
    },
    grantFreeOrganizationMemberSubscriptionCredits: (...args: unknown[]) =>
      grantFreeOrganizationMemberSubscriptionCreditsMock(...args),
    resolveOrganizationFreeCreditAudience: (...args: unknown[]) =>
      resolveOrganizationFreeCreditAudienceMock(...args),
  };
});

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    assignSeat: (...args: unknown[]) => assignSeatMock(...args),
    getAssignedMemberCount: vi.fn(),
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
    getOrganizationMemberUserIds: (...args: unknown[]) =>
      getOrganizationMemberUserIdsMock(...args),
    getUnassignedMemberUserIds: (...args: unknown[]) =>
      getUnassignedMemberUserIdsMock(...args),
    unassignSeat: (...args: unknown[]) => unassignSeatMock(...args),
  },
  subscriptionRepository: {
    getLatestActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestActiveSubscriptionByReferenceIdMock(...args),
  },
}));

const PERIOD_START = new Date("2026-04-08T00:00:00.000Z");
const PERIOD_END = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

const MEMBER_SYNC_MATRIX = [
  {
    name: "org local free — sync grants to all members",
    subscription: {
      createdAt: PERIOD_START,
      id: "sub-row-1",
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      plan: "free",
      seats: 5,
      stripeSubscriptionId: null,
    },
    memberUserIds: ["assigned-1", "unassigned-1"],
    unassignedMemberUserIds: ["unassigned-1"],
    expectLocalFreeSync: true,
    expectPaidUnassignedFreeSync: false,
    expectedFreeGrantUserIds: ["assigned-1", "unassigned-1"],
  },
  {
    name: "org paid — sync grants free tier to unassigned members only",
    subscription: {
      createdAt: PERIOD_START,
      id: "sub-row-1",
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      plan: "starter",
      seats: 5,
      stripeSubscriptionId: "sub_stripe_1",
    },
    memberUserIds: ["assigned-1", "unassigned-1"],
    unassignedMemberUserIds: ["unassigned-1"],
    expectLocalFreeSync: false,
    expectPaidUnassignedFreeSync: true,
    expectedFreeGrantUserIds: ["unassigned-1"],
  },
] as const;

const SEAT_ACTION_MATRIX = [
  {
    name: "org local free assign — safety net syncs all members",
    action: "assign" as const,
    subscription: {
      createdAt: PERIOD_START,
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      seats: 3,
      status: "active",
      stripeSubscriptionId: null,
    },
    audience: {
      kind: "local_free_org" as const,
      memberUserIds: ["assigned-1", "unassigned-1"],
    },
    expectLocalFreeSafetyNet: true,
    expectPaidMidPeriodGrant: false,
    expectPaidUnassignFreeGrant: false,
  },
  {
    name: "org paid assign — mid-period paid grant only",
    action: "assign" as const,
    subscription: {
      createdAt: PERIOD_START,
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      seats: 3,
      status: "active",
      stripeSubscriptionId: "sub_stripe_1",
    },
    audience: {
      kind: "paid_org_unassigned_free" as const,
      memberUserIds: ["unassigned-1"],
    },
    expectLocalFreeSafetyNet: false,
    expectPaidMidPeriodGrant: true,
    expectPaidUnassignFreeGrant: false,
  },
  {
    name: "org paid unassign — free tier for removed member only",
    action: "unassign" as const,
    subscription: {
      createdAt: PERIOD_START,
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      plan: "starter",
      seats: 3,
      status: "active",
      stripeSubscriptionId: "sub_stripe_1",
    },
    audience: {
      kind: "paid_org_unassigned_free" as const,
      memberUserIds: ["user-2"],
    },
    expectLocalFreeSafetyNet: false,
    expectPaidMidPeriodGrant: false,
    expectPaidUnassignFreeGrant: true,
  },
  {
    name: "org local free unassign — safety net syncs all members",
    action: "unassign" as const,
    subscription: {
      createdAt: PERIOD_START,
      periodEnd: PERIOD_END,
      periodStart: PERIOD_START,
      plan: "free",
      seats: 3,
      status: "active",
      stripeSubscriptionId: null,
    },
    audience: {
      kind: "local_free_org" as const,
      memberUserIds: ["user-1", "user-2"],
    },
    expectLocalFreeSafetyNet: true,
    expectPaidMidPeriodGrant: false,
    expectPaidUnassignFreeGrant: false,
  },
] as const;

describe("organization subscription credit routing matrix (web)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionMock.mockImplementation(
      async (callback: (tx: unknown) => unknown) => callback({ __tx: true }),
    );
    ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue({
      grantsCreated: 0,
      subscriptionCreated: false,
      subscriptionId: "sub-local-free",
    });
    grantFreeOrganizationMemberSubscriptionCreditsMock.mockResolvedValue(1);
    grantUnusedSeatSubscriptionCreditsIfEligibleMock.mockResolvedValue({
      creditsGranted: 0,
      granted: false,
    });
    getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({ role: "owner" });
  });

  describe.each(MEMBER_SYNC_MATRIX)("member sync — $name", ({
    expectedFreeGrantUserIds,
    expectLocalFreeSync,
    expectPaidUnassignedFreeSync,
    memberUserIds,
    subscription,
    unassignedMemberUserIds,
  }) => {
    it("routes to the correct credit sync path", async () => {
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue(
        subscription,
      );
      getOrganizationMemberUserIdsMock.mockResolvedValue(memberUserIds);
      getUnassignedMemberUserIdsMock.mockResolvedValue(unassignedMemberUserIds);

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await organizationSubscriptionService.syncLocalFreeSeatsAndCreditsForCurrentMembers(
        "org-1",
      );

      if (expectLocalFreeSync) {
        expect(getOrganizationMemberUserIdsMock).toHaveBeenCalledWith(
          "org-1",
          expect.objectContaining({ __tx: true }),
        );
        expect(getUnassignedMemberUserIdsMock).not.toHaveBeenCalled();
        expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
          expect.objectContaining({
            memberUserIds: expectedFreeGrantUserIds,
            organizationId: "org-1",
          }),
          expect.objectContaining({ __tx: true }),
        );
        expect(
          grantFreeOrganizationMemberSubscriptionCreditsMock,
        ).not.toHaveBeenCalled();
        return;
      }

      expect(expectPaidUnassignedFreeSync).toBe(true);
      expect(getOrganizationMemberUserIdsMock).not.toHaveBeenCalled();
      expect(getUnassignedMemberUserIdsMock).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({ __tx: true }),
      );
      expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
      expect(
        grantFreeOrganizationMemberSubscriptionCreditsMock,
      ).toHaveBeenCalledWith(
        {
          memberUserIds: expectedFreeGrantUserIds,
          organizationId: "org-1",
          periodEnd: PERIOD_END,
        },
        expect.objectContaining({ __tx: true }),
      );
    });
  });

  describe.each(SEAT_ACTION_MATRIX)("seat action — $name", ({
    action,
    audience,
    expectLocalFreeSafetyNet,
    expectPaidMidPeriodGrant,
    expectPaidUnassignFreeGrant,
    subscription,
  }) => {
    it("routes seat mutations to the correct credit handlers", async () => {
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue(
        subscription,
      );
      resolveOrganizationFreeCreditAudienceMock.mockResolvedValue(audience);

      if (action === "assign") {
        assignSeatMock.mockResolvedValue({
          id: "member-1",
          seatAssignedAt: new Date("2026-05-01T00:00:00.000Z"),
          userId: "user-2",
        });

        const { organizationSeatService } = await import(
          "../organization-seat.service"
        );

        await organizationSeatService.assignSeat("user-1", "org-1", "member-1");

        if (expectPaidMidPeriodGrant) {
          expect(
            grantUnusedSeatSubscriptionCreditsIfEligibleMock,
          ).toHaveBeenCalledWith("org-1", "user-2", expect.any(Object));
        } else {
          expect(
            grantUnusedSeatSubscriptionCreditsIfEligibleMock,
          ).toHaveBeenCalled();
        }
      } else {
        unassignSeatMock.mockResolvedValue({
          id: "member-1",
          userId: "user-2",
        });

        const { organizationSeatService } = await import(
          "../organization-seat.service"
        );

        await organizationSeatService.unassignSeat(
          "user-1",
          "org-1",
          "member-1",
        );

        if (expectPaidUnassignFreeGrant) {
          expect(
            grantFreeOrganizationMemberSubscriptionCreditsMock,
          ).toHaveBeenCalledWith(
            {
              memberUserIds: ["user-2"],
              organizationId: "org-1",
              periodEnd: PERIOD_END,
            },
            expect.any(Object),
          );
        } else {
          expect(
            grantFreeOrganizationMemberSubscriptionCreditsMock,
          ).not.toHaveBeenCalled();
        }
      }

      if (expectLocalFreeSafetyNet) {
        expect(ensureLocalFreeSubscriptionPeriodSeatMock).toHaveBeenCalledWith(
          expect.objectContaining({
            memberUserIds: audience.memberUserIds,
            organizationId: "org-1",
          }),
          expect.any(Object),
        );
      } else {
        expect(
          ensureLocalFreeSubscriptionPeriodSeatMock,
        ).not.toHaveBeenCalled();
      }
    });
  });
});
