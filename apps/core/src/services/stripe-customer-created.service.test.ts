import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  applyInvoiceCreditsToCustomerMock,
  ensureInitialLocalFreeSubscriptionPeriodMock,
  getCouponByIdMock,
  getUserByIdMock,
  prismaOrganizationUpdateMock,
  prismaUserUpdateMock,
} = vi.hoisted(() => ({
  applyInvoiceCreditsToCustomerMock: vi.fn(),
  ensureInitialLocalFreeSubscriptionPeriodMock: vi.fn(),
  getCouponByIdMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  prismaOrganizationUpdateMock: vi.fn(),
  prismaUserUpdateMock: vi.fn(),
}));

vi.mock("@sokosumi/database/helpers", () => ({
  ensureInitialLocalFreeSubscriptionPeriod:
    ensureInitialLocalFreeSubscriptionPeriodMock,
}));

vi.mock("@sokosumi/database/repositories", () => ({
  userRepository: {
    getUserById: getUserByIdMock,
  },
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    applyInvoiceCreditsToCustomer: applyInvoiceCreditsToCustomerMock,
    getCouponById: getCouponByIdMock,
  },
}));

vi.mock("@/config/env", () => ({
  getEnv: () => ({
    STRIPE_WELCOME_COUPON: "coupon_welcome",
  }),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: (callback: (tx: unknown) => unknown) => callback({}),
    organization: {
      update: (...args: unknown[]) => prismaOrganizationUpdateMock(...args),
    },
    user: {
      update: (...args: unknown[]) => prismaUserUpdateMock(...args),
    },
  },
}));

async function getService() {
  return await import("./stripe-customer-created.service");
}

describe("handleCustomerCreatedEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureInitialLocalFreeSubscriptionPeriodMock.mockResolvedValue(undefined);
    prismaUserUpdateMock.mockResolvedValue({
      createdAt: new Date("2026-04-09T07:03:48.591Z"),
      id: "user-1",
    });
    prismaOrganizationUpdateMock.mockResolvedValue({
      createdAt: new Date("2026-04-09T07:03:48.591Z"),
      id: "org-1",
    });
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      stripeCustomerId: "cus_user_1",
    });
    getCouponByIdMock.mockResolvedValue({ id: "coupon_welcome" });
    applyInvoiceCreditsToCustomerMock.mockResolvedValue({
      id: "in_welcome_1",
      status: "paid",
    });
  });

  it("stores Stripe customer ids for newly created organization customers without claiming a coupon", async () => {
    const { handleCustomerCreatedEvent } = await getService();

    await handleCustomerCreatedEvent({
      id: "cus_org_1",
      metadata: {
        customerType: "organization",
        organizationId: "org-1",
      },
    } as never);

    expect(prismaOrganizationUpdateMock).toHaveBeenCalledWith({
      where: { id: "org-1" },
      data: { stripeCustomerId: "cus_org_1" },
    });
    expect(ensureInitialLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      {
        createdAt: new Date("2026-04-09T07:03:48.591Z"),
        kind: "organization",
        organizationId: "org-1",
        stripeCustomerId: "cus_org_1",
      },
      expect.anything(),
    );
    expect(applyInvoiceCreditsToCustomerMock).not.toHaveBeenCalled();
  });

  it("claims the welcome coupon for user customers with the stable idempotency key base", async () => {
    const { handleCustomerCreatedEvent } = await getService();

    await handleCustomerCreatedEvent({
      id: "cus_user_1",
      metadata: {
        customerType: "user",
        userId: "user-1",
      },
    } as never);

    expect(prismaUserUpdateMock).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { stripeCustomerId: "cus_user_1" },
    });
    expect(ensureInitialLocalFreeSubscriptionPeriodMock).toHaveBeenCalledWith(
      {
        createdAt: new Date("2026-04-09T07:03:48.591Z"),
        kind: "user",
        stripeCustomerId: "cus_user_1",
        userId: "user-1",
      },
      expect.anything(),
    );
    expect(applyInvoiceCreditsToCustomerMock).toHaveBeenCalledWith(
      "cus_user_1",
      "coupon_welcome",
      "welcome-coupon_welcome-user-1",
      {
        redemption_type: "welcome_coupon",
        welcome_source: "customer.created",
        user_id: "user-1",
        user_email: "user@example.com",
      },
    );
  });

  it("ignores customers with an unknown customer type", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      const { handleCustomerCreatedEvent } = await getService();

      await handleCustomerCreatedEvent({
        id: "cus_other_1",
        metadata: { customerType: "something-else" },
      } as never);

      expect(prismaUserUpdateMock).not.toHaveBeenCalled();
      expect(prismaOrganizationUpdateMock).not.toHaveBeenCalled();
      expect(consoleLogSpy).toHaveBeenCalledWith(
        "Unknown customer type something-else",
      );
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("does not fail customer creation when the welcome coupon claim fails", async () => {
    const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    applyInvoiceCreditsToCustomerMock.mockRejectedValue(
      new Error("stripe down"),
    );

    try {
      const { handleCustomerCreatedEvent } = await getService();

      await expect(
        handleCustomerCreatedEvent({
          id: "cus_user_1",
          metadata: {
            customerType: "user",
            userId: "user-1",
          },
        } as never),
      ).resolves.toBeUndefined();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        "⚠️ Failed to claim welcome coupon for user user-1",
      );
    } finally {
      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    }
  });

  it("rethrows when the user write-back fails so Stripe retries the event", async () => {
    prismaUserUpdateMock.mockRejectedValue(new Error("user missing"));

    const { handleCustomerCreatedEvent } = await getService();

    await expect(
      handleCustomerCreatedEvent({
        id: "cus_user_1",
        metadata: {
          customerType: "user",
          userId: "user-1",
        },
      } as never),
    ).rejects.toThrow("user missing");

    expect(applyInvoiceCreditsToCustomerMock).not.toHaveBeenCalled();
  });
});

describe("claimWelcomeCoupon", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserByIdMock.mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
      stripeCustomerId: "cus_user_1",
    });
    getCouponByIdMock.mockResolvedValue({ id: "coupon_welcome" });
    applyInvoiceCreditsToCustomerMock.mockResolvedValue({
      id: "in_welcome_1",
      status: "paid",
    });
  });

  it("returns the paid invoice id on success", async () => {
    const { claimWelcomeCoupon } = await getService();

    await expect(claimWelcomeCoupon("user-1")).resolves.toEqual({
      couponApplied: true,
      invoiceId: "in_welcome_1",
    });
  });

  it.each([
    ["user missing", () => getUserByIdMock.mockResolvedValue(null)],
    [
      "user without stripe customer id",
      () =>
        getUserByIdMock.mockResolvedValue({
          id: "user-1",
          stripeCustomerId: null,
        }),
    ],
    ["coupon missing", () => getCouponByIdMock.mockResolvedValue(null)],
    [
      "invoice not paid",
      () =>
        applyInvoiceCreditsToCustomerMock.mockResolvedValue({
          id: "in_welcome_1",
          status: "open" as Stripe.Invoice.Status,
        }),
    ],
  ])("returns couponApplied false when %s", async (_label, arrange) => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    arrange();

    try {
      const { claimWelcomeCoupon } = await getService();

      await expect(claimWelcomeCoupon("user-1")).resolves.toEqual({
        couponApplied: false,
        invoiceId: null,
      });
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
