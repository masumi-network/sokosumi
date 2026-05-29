import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("better-auth/api", () => ({
  APIError: class APIError extends Error {
    constructor(_code: string, options?: { message?: string }) {
      super(options?.message ?? "API error");
      this.name = "APIError";
    }
  },
}));

const getMemberByUserIdAndOrganizationIdMock = vi.fn();
const getAssignedMemberCountMock = vi.fn();
const getAssignedMemberUserIdsMock = vi.fn();
const ensureLocalFreeSubscriptionPeriodMock = vi.fn();
const getLatestActiveSubscriptionByReferenceIdMock = vi.fn();
const prismaTransactionMock = vi.fn();
const updateSubscriptionRecordMock = vi.fn();
const retrieveStripeSubscriptionMock = vi.fn();
const updateStripeSubscriptionMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getAssignedMemberCount: (...args: unknown[]) =>
      getAssignedMemberCountMock(...args),
    getAssignedMemberUserIds: (...args: unknown[]) =>
      getAssignedMemberUserIdsMock(...args),
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
  subscriptionRepository: {
    getLatestActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestActiveSubscriptionByReferenceIdMock(...args),
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
    ensureLocalFreeSubscriptionPeriodMock(...args),
  ensurePurchasedSeatsSufficient: (purchased: number, assigned: number) => {
    if (purchased < assigned) {
      throw new Error(
        `Purchased seats (${purchased}) must be at least ${assigned} to cover all assigned members`,
      );
    }
  },
  resolvePurchasedSeats: (seats: number | null | undefined) =>
    seats && seats > 0 ? seats : 1,
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
  }),
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

vi.mock("stripe", () => {
  return {
    __esModule: true,
    default: vi.fn(function MockStripe() {
      return {
        subscriptions: {
          retrieve: (...args: unknown[]) =>
            retrieveStripeSubscriptionMock(...args),
          update: (...args: unknown[]) => updateStripeSubscriptionMock(...args),
        },
      };
    }),
  };
});

describe("organizationSubscriptionService", () => {
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

  describe("ensureCanCreateInvitation", () => {
    it("allows creating invitations without an active organization subscription", async () => {
      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.ensureCanCreateInvitation("org-1"),
      ).resolves.toBeUndefined();
    });

    it("does not load subscription data or update seats when creating invitations", async () => {
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "starter",
        seats: 2,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await organizationSubscriptionService.ensureCanCreateInvitation("org-1");

      expect(
        getLatestActiveSubscriptionByReferenceIdMock,
      ).not.toHaveBeenCalled();
      expect(getAssignedMemberCountMock).not.toHaveBeenCalled();
      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });
  });

  describe("ensureCanAcceptInvitation", () => {
    it("throws when no active organization subscription exists", async () => {
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.ensureCanAcceptInvitation("org-1"),
      ).rejects.toThrow(
        "An active organization subscription is required before adding members.",
      );

      expect(getAssignedMemberCountMock).not.toHaveBeenCalled();
      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });

    it("does not pre-allocate seats for a local free subscription", async () => {
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "free",
        seats: 2,
        stripeSubscriptionId: null,
      });

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await organizationSubscriptionService.ensureCanAcceptInvitation("org-1");

      expect(getLatestActiveSubscriptionByReferenceIdMock).toHaveBeenCalledWith(
        "org-1",
        expect.any(Object),
      );
      expect(getAssignedMemberCountMock).not.toHaveBeenCalled();
      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });

    it("does not auto-increase Stripe seats when accepting an invitation", async () => {
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "starter",
        seats: 2,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await organizationSubscriptionService.ensureCanAcceptInvitation("org-1");

      expect(getAssignedMemberCountMock).not.toHaveBeenCalled();
      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });
  });

  describe("updateOrganizationSeatsImmediately", () => {
    it("throws when the user is not owner or admin", async () => {
      getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
        role: "member",
      });

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          3,
        ),
      ).rejects.toThrow(
        "Only organization owners and admins can manage subscriptions",
      );
    });

    it("throws when no active organization subscription exists", async () => {
      getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
        role: "owner",
      });
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue(null);

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          3,
        ),
      ).rejects.toThrow(
        "An active organization subscription is required before updating seats.",
      );
    });

    it("returns current seats without calling Stripe when seats are unchanged", async () => {
      getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
        role: "owner",
      });
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "starter",
        seats: 4,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          4,
        ),
      ).resolves.toEqual({
        seats: 4,
      });

      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });

    it("throws when decreasing seats below assigned count", async () => {
      getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
        role: "owner",
      });
      getAssignedMemberCountMock.mockResolvedValue(4);
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "starter",
        seats: 6,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          3,
        ),
      ).rejects.toThrow(
        "Purchased seats (3) must be at least 4 to cover all assigned members",
      );
    });

    it("updates Stripe and local seats immediately", async () => {
      getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
        role: "admin",
      });
      getAssignedMemberCountMock.mockResolvedValue(2);
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "starter",
        seats: 2,
        stripeSubscriptionId: "sub_stripe_1",
      });
      retrieveStripeSubscriptionMock.mockResolvedValue({
        items: {
          data: [{ id: "si_1" }],
        },
      });
      updateStripeSubscriptionMock.mockResolvedValue({});
      updateSubscriptionRecordMock.mockResolvedValue({});

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          6,
        ),
      ).resolves.toEqual({
        seats: 6,
      });

      expect(updateStripeSubscriptionMock).toHaveBeenCalledWith(
        "sub_stripe_1",
        {
          items: [{ id: "si_1", quantity: 6 }],
          payment_behavior: "error_if_incomplete",
          proration_behavior: "always_invoice",
        },
      );
      expect(updateSubscriptionRecordMock).toHaveBeenCalledWith({
        where: { id: "sub-row-1" },
        data: { seats: 6 },
      });
    });

    it("updates purchased seats for local free subscriptions without syncing member count", async () => {
      getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
        role: "admin",
      });
      const periodStart = new Date("2026-04-08T00:00:00.000Z");
      const periodEnd = new Date("2026-05-08T00:00:00.000Z");
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        createdAt: periodStart,
        id: "sub-row-1",
        plan: "free",
        seats: 2,
        periodEnd,
        periodStart,
        stripeSubscriptionId: null,
      });
      updateSubscriptionRecordMock.mockResolvedValue({});

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.updateOrganizationSeatsImmediately(
          "user-1",
          "org-1",
          6,
        ),
      ).resolves.toEqual({
        seats: 6,
      });

      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).toHaveBeenCalledWith({
        where: { id: "sub-row-1" },
        data: { seats: 6 },
      });
    });

    it("syncs local free credits for assigned members only", async () => {
      const periodStart = new Date("2026-04-08T00:00:00.000Z");
      const periodEnd = new Date("2026-05-08T00:00:00.000Z");
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        createdAt: periodStart,
        id: "sub-row-1",
        plan: "free",
        seats: 5,
        periodEnd,
        periodStart,
        stripeSubscriptionId: null,
      });
      getAssignedMemberUserIdsMock.mockResolvedValue(["user-1"]);
      ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue(undefined);

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.syncLocalFreeSeatsAndCreditsForCurrentMembers(
          "org-1",
        ),
      ).resolves.toBeUndefined();

      expect(getAssignedMemberUserIdsMock).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          __tx: true,
        }),
      );
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
      expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
        {
          billingAnchorDate: periodStart,
          memberUserIds: ["user-1"],
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
