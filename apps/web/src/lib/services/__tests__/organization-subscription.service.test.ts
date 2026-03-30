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
const memberCountMock = vi.fn();
const findSubscriptionMock = vi.fn();
const updateSubscriptionRecordMock = vi.fn();
const retrieveStripeSubscriptionMock = vi.fn();
const updateStripeSubscriptionMock = vi.fn();

vi.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  __esModule: true,
  default: {
    member: {
      count: (...args: unknown[]) => memberCountMock(...args),
    },
    subscription: {
      findFirst: (...args: unknown[]) => findSubscriptionMock(...args),
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
      findSubscriptionMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "starter",
        seats: 2,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionService } = await import(
        "../organization-subscription.service"
      );

      await organizationSubscriptionService.ensureCanCreateInvitation("org-1");

      expect(findSubscriptionMock).not.toHaveBeenCalled();
      expect(memberCountMock).not.toHaveBeenCalled();
      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });
  });

  describe("ensureCanAcceptInvitation", () => {
    it("throws when no active organization subscription exists", async () => {
      findSubscriptionMock.mockResolvedValue(null);

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

    it("updates Stripe and local seats when a free subscription lacks capacity", async () => {
      memberCountMock.mockResolvedValue(4);
      findSubscriptionMock.mockResolvedValue({
        id: "sub-row-1",
        plan: "free",
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

      expect(findSubscriptionMock).toHaveBeenCalledWith({
        where: {
          referenceId: "org-1",
          status: {
            in: ["active", "trialing", "past_due", "unpaid"],
          },
        },
        orderBy: [{ periodEnd: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          seats: true,
          stripeSubscriptionId: true,
        },
      });
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

    it("updates Stripe and local subscription seats when a paid subscription lacks capacity", async () => {
      memberCountMock.mockResolvedValue(4);
      findSubscriptionMock.mockResolvedValue({
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
      findSubscriptionMock.mockResolvedValue({
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
      findSubscriptionMock.mockResolvedValue(null);

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
      findSubscriptionMock.mockResolvedValue({
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
      findSubscriptionMock.mockResolvedValue({
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
  });
});
