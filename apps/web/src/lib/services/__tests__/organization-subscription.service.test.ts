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
const getMembersByOrganizationIdMock = vi.fn();
const memberCountMock = vi.fn();
const ensureLocalFreeSubscriptionPeriodMock = vi.fn();
const getLatestActiveSubscriptionByReferenceIdMock = vi.fn();
const prismaTransactionMock = vi.fn();
const updateSubscriptionRecordMock = vi.fn();
const retrieveStripeSubscriptionMock = vi.fn();
const updateStripeSubscriptionMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
    getMembersByOrganizationId: (...args: unknown[]) =>
      getMembersByOrganizationIdMock(...args),
  },
  subscriptionRepository: {
    getLatestActiveSubscriptionByReferenceId: (...args: unknown[]) =>
      getLatestActiveSubscriptionByReferenceIdMock(...args),
  },
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ensureLocalFreeSubscriptionPeriod: (...args: unknown[]) =>
    ensureLocalFreeSubscriptionPeriodMock(...args),
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
      count: (...args: unknown[]) => memberCountMock(...args),
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
      expect(memberCountMock).not.toHaveBeenCalled();
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

      expect(memberCountMock).not.toHaveBeenCalled();
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
      expect(memberCountMock).not.toHaveBeenCalled();
      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });

    it("updates Stripe and local subscription seats when a paid subscription lacks capacity", async () => {
      memberCountMock.mockResolvedValue(4);
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

      await organizationSubscriptionService.ensureCanAcceptInvitation("org-1");

      expect(retrieveStripeSubscriptionMock).toHaveBeenCalledWith(
        "sub_stripe_1",
        { expand: ["items"] },
      );
      expect(updateStripeSubscriptionMock).toHaveBeenCalledWith(
        "sub_stripe_1",
        {
          items: [{ id: "si_1", quantity: 5 }],
          payment_behavior: "error_if_incomplete",
          proration_behavior: "always_invoice",
        },
      );
      expect(updateSubscriptionRecordMock).toHaveBeenCalledWith({
        where: { id: "sub-row-1" },
        data: { seats: 5 },
      });
    });

    it("does not update Stripe when existing seats already satisfy requirement", async () => {
      memberCountMock.mockResolvedValue(3);
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "starter",
        seats: 10,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await organizationSubscriptionService.ensureCanAcceptInvitation("org-1");

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

    it("updates Stripe and local seats immediately", async () => {
      getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
        role: "admin",
      });
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

    it("syncs local free seats to member count and ensures current-period grants", async () => {
      getMemberByUserIdAndOrganizationIdMock.mockResolvedValue({
        role: "admin",
      });
      const periodStart = new Date("2026-04-08T00:00:00.000Z");
      const periodEnd = new Date("2026-05-08T00:00:00.000Z");
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "free",
        seats: 2,
        periodEnd,
        periodStart,
        stripeSubscriptionId: null,
      });
      getMembersByOrganizationIdMock.mockResolvedValue([
        { role: "OWNER", userId: "user-1" },
        { role: "MEMBER", userId: "user-2" },
        { role: "MEMBER", userId: "user-3" },
      ]);
      updateSubscriptionRecordMock.mockResolvedValue({});
      ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue(undefined);

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
        seats: 3,
      });

      expect(prismaTransactionMock).toHaveBeenCalledTimes(1);
      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).toHaveBeenCalledWith({
        where: { id: "sub-row-1" },
        data: { seats: 3 },
      });
      expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
        {
          memberUserIds: ["user-1", "user-2", "user-3"],
          organizationId: "org-1",
          periodEnd,
          periodStart,
          referenceId: "org-1",
        },
        expect.objectContaining({
          __tx: true,
        }),
      );
    });

    it("syncs local free seats and credits after members change", async () => {
      const periodStart = new Date("2026-04-08T00:00:00.000Z");
      const periodEnd = new Date("2026-05-08T00:00:00.000Z");
      getLatestActiveSubscriptionByReferenceIdMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "free",
        seats: 1,
        periodEnd,
        periodStart,
        stripeSubscriptionId: null,
      });
      getMembersByOrganizationIdMock.mockResolvedValue([
        { role: "OWNER", userId: "user-1" },
        { role: "MEMBER", userId: "user-2" },
      ]);
      updateSubscriptionRecordMock.mockResolvedValue({});
      ensureLocalFreeSubscriptionPeriodMock.mockResolvedValue(undefined);

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await expect(
        organizationSubscriptionService.syncLocalFreeSeatsAndCreditsForCurrentMembers(
          "org-1",
        ),
      ).resolves.toBeUndefined();

      expect(getMembersByOrganizationIdMock).toHaveBeenCalledWith(
        "org-1",
        expect.objectContaining({
          __tx: true,
        }),
      );
      expect(updateSubscriptionRecordMock).toHaveBeenCalledWith({
        where: { id: "sub-row-1" },
        data: { seats: 2 },
      });
      expect(ensureLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
        {
          memberUserIds: ["user-1", "user-2"],
          organizationId: "org-1",
          periodEnd,
          periodStart,
          referenceId: "org-1",
        },
        expect.objectContaining({
          __tx: true,
        }),
      );
    });
  });
});
