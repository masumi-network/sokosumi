jest.mock("server-only", () => ({}));

jest.mock("better-auth/api", () => ({
  APIError: class APIError extends Error {
    constructor(_code: string, options?: { message?: string }) {
      super(options?.message ?? "API error");
      this.name = "APIError";
    }
  },
}));

const getMemberByUserIdAndOrganizationIdMock = jest.fn();
const memberCountMock = jest.fn();
const findSubscriptionMock = jest.fn();
const updateSubscriptionRecordMock = jest.fn();
const retrieveStripeSubscriptionMock = jest.fn();
const updateStripeSubscriptionMock = jest.fn();

jest.mock("@sokosumi/database/repositories", () => ({
  memberRepository: {
    getMemberByUserIdAndOrganizationId: (...args: unknown[]) =>
      getMemberByUserIdAndOrganizationIdMock(...args),
  },
}));

jest.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    STRIPE_SECRET_KEY: "sk_test_mock",
  }),
}));

jest.mock("@/lib/db/prisma", () => ({
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

jest.mock("stripe", () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => ({
      subscriptions: {
        retrieve: (...args: unknown[]) =>
          retrieveStripeSubscriptionMock(...args),
        update: (...args: unknown[]) => updateStripeSubscriptionMock(...args),
      },
    })),
  };
});

describe("organizationSubscriptionService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("ensureCanCreateInvitation", () => {
    it("throws when no active organization subscription exists", async () => {
      findSubscriptionMock.mockResolvedValue(null);

      const { organizationSubscriptionService } =
        await import("../organization-subscription.service");

      await expect(
        organizationSubscriptionService.ensureCanCreateInvitation("org-1"),
      ).rejects.toThrow(
        "An active organization subscription is required before adding members.",
      );
    });

    it("checks active subscription without updating seats", async () => {
      findSubscriptionMock.mockResolvedValue({
        id: "sub-row-1",
        seats: 2,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionService } =
        await import("../organization-subscription.service");

      await organizationSubscriptionService.ensureCanCreateInvitation("org-1");

      expect(memberCountMock).not.toHaveBeenCalled();
      expect(retrieveStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateStripeSubscriptionMock).not.toHaveBeenCalled();
      expect(updateSubscriptionRecordMock).not.toHaveBeenCalled();
    });
  });

  describe("ensureCanAcceptInvitation", () => {
    it("throws when no active organization subscription exists", async () => {
      memberCountMock.mockResolvedValue(2);
      findSubscriptionMock.mockResolvedValue(null);

      const { organizationSubscriptionService } =
        await import("../organization-subscription.service");

      await expect(
        organizationSubscriptionService.ensureCanAcceptInvitation("org-1"),
      ).rejects.toThrow(
        "An active organization subscription is required before adding members.",
      );
    });

    it("updates Stripe and local subscription seats when capacity is insufficient", async () => {
      memberCountMock.mockResolvedValue(4);
      findSubscriptionMock.mockResolvedValue({
        id: "sub-row-1",
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

      const { organizationSubscriptionService } =
        await import("../organization-subscription.service");

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
        expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^sub_stripe_1:seats:5:\d+$/),
        }),
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
        seats: 10,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionService } =
        await import("../organization-subscription.service");

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

      const { organizationSubscriptionService } =
        await import("../organization-subscription.service");

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

      const { organizationSubscriptionService } =
        await import("../organization-subscription.service");

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
        seats: 4,
        stripeSubscriptionId: "sub_stripe_1",
      });

      const { organizationSubscriptionService } =
        await import("../organization-subscription.service");

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

      const { organizationSubscriptionService } =
        await import("../organization-subscription.service");

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
        expect.objectContaining({
          idempotencyKey: expect.stringMatching(/^sub_stripe_1:seats:6:\d+$/),
        }),
      );
      expect(updateSubscriptionRecordMock).toHaveBeenCalledWith({
        where: { id: "sub-row-1" },
        data: { seats: 6 },
      });
    });
  });
});
