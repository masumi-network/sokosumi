import { beforeEach, describe, expect, it, vi } from "vitest";

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

const getAssignedMemberCountMock = vi.fn();
const getOrganizationMemberUserIdsMock = vi.fn();
const getUnassignedMemberUserIdsMock = vi.fn();
const ensureLocalFreeSubscriptionPeriodMock = vi.fn();
const grantFreeOrganizationMemberSubscriptionCreditsMock = vi.fn();
const resolveActiveSubscriptionByReferenceIdMock = vi.fn();
const resolveOrganizationBillingPlanMock = vi.fn();
const prismaTransactionMock = vi.fn();
const updateSubscriptionRecordMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getAssignedMemberCount: (...args: unknown[]) =>
      getAssignedMemberCountMock(...args),
    getOrganizationMemberUserIds: (...args: unknown[]) =>
      getOrganizationMemberUserIdsMock(...args),
    getUnassignedMemberUserIds: (...args: unknown[]) =>
      getUnassignedMemberUserIdsMock(...args),
  },
  subscriptionRepository: {
    resolveActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      resolveActiveSubscriptionByReferenceIdMock(...args),
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
    ensureLocalFreeSubscriptionPeriodMock(...args),
  grantFreeOrganizationMemberSubscriptionCredits: (...args: unknown[]) =>
    grantFreeOrganizationMemberSubscriptionCreditsMock(...args),
  resolvePurchasedSeats: (seats: number | null | undefined) =>
    seats && seats > 0 ? seats : 1,
  resolveOrganizationBillingPlan: (...args: unknown[]) =>
    resolveOrganizationBillingPlanMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
    member: {
      count: vi.fn(),
    },
    subscription: {
      update: (...args: unknown[]) => updateSubscriptionRecordMock(...args),
    },
  },
}));

describe("organizationSubscriptionHooksService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (callback) =>
        await callback({
          __tx: true,
          subscription: {
            update: (...args: unknown[]) =>
              updateSubscriptionRecordMock(...args),
          },
        }),
    );
  });

  describe("ensureCanAcceptInvitation", () => {
    it("allows invitations for enterprise contract organizations without Stripe subscription", async () => {
      resolveOrganizationBillingPlanMock.mockResolvedValue({
        mode: "enterprise_contract",
        plan: "enterprise",
        isConsumable: true,
        purchasedSeats: 5,
        contractId: "contract-1",
        endsAt: new Date("2027-01-01T00:00:00.000Z"),
        activatedAt: new Date("2026-01-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        periodEnd: null,
      });

      const { organizationSubscriptionHooksService } = await import(
        "../organization-subscription-hooks.service"
      );

      await organizationSubscriptionHooksService.ensureCanAcceptInvitation(
        "org-1",
      );

      expect(resolveOrganizationBillingPlanMock).toHaveBeenCalledWith(
        "org-1",
        expect.any(Object),
      );
      expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
    });

    it("throws when no active organization subscription exists", async () => {
      resolveOrganizationBillingPlanMock.mockResolvedValue({
        mode: "self_serve",
        plan: "free",
        purchasedSeats: 0,
        subscriptionId: null,
        cancelAtPeriodEnd: false,
        periodEnd: null,
      });
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);

      const { organizationSubscriptionHooksService } = await import(
        "../organization-subscription-hooks.service"
      );

      await expect(
        organizationSubscriptionHooksService.ensureCanAcceptInvitation("org-1"),
      ).rejects.toThrow(
        "An active organization subscription is required before adding members.",
      );

      expect(getAssignedMemberCountMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });

    it("does not pre-allocate seats for a local free subscription", async () => {
      resolveOrganizationBillingPlanMock.mockResolvedValue({
        mode: "self_serve",
        plan: "free",
        purchasedSeats: 2,
        subscriptionId: "sub-row-1",
        cancelAtPeriodEnd: false,
        periodEnd: null,
      });
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "free",
        seats: 2,
        stripeSubscriptionId: null,
      });

      const { organizationSubscriptionHooksService } = await import(
        "../organization-subscription-hooks.service"
      );

      await organizationSubscriptionHooksService.ensureCanAcceptInvitation(
        "org-1",
      );

      expect(resolveActiveSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
        "org-1",
        expect.any(Object),
      );
      expect(getAssignedMemberCountMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });

    it("does not auto-increase Stripe seats when accepting an invitation", async () => {
      resolveOrganizationBillingPlanMock.mockResolvedValue({
        mode: "self_serve",
        plan: "starter",
        purchasedSeats: 2,
        subscriptionId: "sub-row-1",
        cancelAtPeriodEnd: false,
        periodEnd: null,
      });
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "starter",
        seats: 2,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionHooksService } = await import(
        "../organization-subscription-hooks.service"
      );

      await organizationSubscriptionHooksService.ensureCanAcceptInvitation(
        "org-1",
      );

      expect(getAssignedMemberCountMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });
  });

  describe("syncLocalFreeSeatsAndCreditsForCurrentMembers", () => {
    it("syncs local free credits for all organization members", async () => {
      const periodStart = new Date("2026-04-08T00:00:00.000Z");
      const periodEnd = new Date("2026-05-08T00:00:00.000Z");
      resolveOrganizationBillingPlanMock.mockResolvedValue({
        cancelAtPeriodEnd: false,
        mode: "self_serve",
        periodEnd: null,
        plan: "free",
        purchasedSeats: 5,
        subscriptionId: "sub-row-1",
      });
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        createdAt: periodStart,
        id: "sub-row-1",
        plan: "free",
        seats: 5,
        periodEnd,
        periodStart,
        stripeSubscriptionId: null,
      });
      getOrganizationMemberUserIdsMock.mockResolvedValue(["user-1", "user-2"]);
      ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue(undefined);

      const { organizationSubscriptionHooksService } = await import(
        "../organization-subscription-hooks.service"
      );

      await expect(
        organizationSubscriptionHooksService.syncLocalFreeSeatsAndCreditsForCurrentMembers(
          "org-1",
        ),
      ).resolves.toBeUndefined();

      expect(getOrganizationMemberUserIdsMock).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          __tx: true,
        }),
      );
      expect(getUnassignedMemberUserIdsMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
      expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
        {
          billingAnchorDate: periodStart,
          memberUserIds: ["user-1", "user-2"],
          organizationId: "org-1",
          periodEnd,
          periodStart,
          purchasedSeats: 5,
          referenceId: "org-1",
        },
        expect.objectContaining({
          __tx: true,
        }),
      );
    });

    it("grants free monthly credits to unassigned members in a paid organization without a local-free subscription row", async () => {
      const periodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      resolveOrganizationBillingPlanMock.mockResolvedValue({
        cancelAtPeriodEnd: false,
        mode: "self_serve",
        periodEnd: null,
        plan: "starter",
        purchasedSeats: 5,
        subscriptionId: "sub-row-1",
      });
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "starter",
        seats: 5,
        periodEnd,
        stripeSubscriptionId: "sub_stripe_1",
      });
      getUnassignedMemberUserIdsMock.mockResolvedValue(["user-2", "user-3"]);
      grantFreeOrganizationMemberSubscriptionCreditsMock.mockResolvedValue(2);

      const { organizationSubscriptionHooksService } = await import(
        "../organization-subscription-hooks.service"
      );

      await expect(
        organizationSubscriptionHooksService.syncLocalFreeSeatsAndCreditsForCurrentMembers(
          "org-1",
        ),
      ).resolves.toBeUndefined();

      expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
      expect(
        grantFreeOrganizationMemberSubscriptionCreditsMock,
      ).toHaveBeenCalledWith(
        {
          memberUserIds: ["user-2", "user-3"],
          organizationId: "org-1",
          periodEnd,
        },
        expect.objectContaining({
          __tx: true,
        }),
      );
    });

    it("skips local free sync while an enterprise contract is consumable", async () => {
      resolveOrganizationBillingPlanMock.mockResolvedValue({
        activatedAt: new Date("2026-01-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        contractId: "contract-1",
        endsAt: new Date("2027-01-01T00:00:00.000Z"),
        isConsumable: true,
        mode: "enterprise_contract",
        periodEnd: null,
        plan: "enterprise",
        purchasedSeats: 5,
      });

      const { organizationSubscriptionHooksService } = await import(
        "../organization-subscription-hooks.service"
      );

      await expect(
        organizationSubscriptionHooksService.syncLocalFreeSeatsAndCreditsForCurrentMembers(
          "org-1",
        ),
      ).resolves.toBeUndefined();

      expect(resolveActiveSubscriptionByReferenceIdMock).not.toHaveBeenCalled();
      expect(ensureLocalFreeSubscriptionPeriodMock).not.toHaveBeenCalled();
      expect(
        grantFreeOrganizationMemberSubscriptionCreditsMock,
      ).not.toHaveBeenCalled();
    });

    it("syncs local free credits after the enterprise commercial term ends", async () => {
      const periodStart = new Date("2026-04-08T00:00:00.000Z");
      const periodEnd = new Date("2026-05-08T00:00:00.000Z");
      resolveOrganizationBillingPlanMock.mockResolvedValue({
        activatedAt: new Date("2026-01-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        contractId: "contract-1",
        endsAt: new Date("2026-02-01T00:00:00.000Z"),
        isConsumable: false,
        mode: "enterprise_contract",
        periodEnd: null,
        plan: "enterprise",
        purchasedSeats: 5,
      });
      resolveActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        createdAt: periodStart,
        id: "sub-row-1",
        plan: "free",
        seats: 5,
        periodEnd,
        periodStart,
        stripeSubscriptionId: null,
      });
      getOrganizationMemberUserIdsMock.mockResolvedValue(["user-1", "user-2"]);
      ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue(undefined);

      const { organizationSubscriptionHooksService } = await import(
        "../organization-subscription-hooks.service"
      );

      await expect(
        organizationSubscriptionHooksService.syncLocalFreeSeatsAndCreditsForCurrentMembers(
          "org-1",
        ),
      ).resolves.toBeUndefined();

      expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
        {
          billingAnchorDate: periodStart,
          memberUserIds: ["user-1", "user-2"],
          organizationId: "org-1",
          periodEnd,
          periodStart,
          purchasedSeats: 5,
          referenceId: "org-1",
        },
        expect.objectContaining({
          __tx: true,
        }),
      );
    });
  });
});
