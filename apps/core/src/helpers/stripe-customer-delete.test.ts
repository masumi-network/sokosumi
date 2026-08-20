import { beforeEach, describe, expect, it, vi } from "vitest";

import { deleteStripeCustomerBestEffort } from "./stripe-customer-delete";

const {
  deleteCustomerMock,
  captureExternalServiceErrorMock,
  subscriptionFindFirstMock,
} = vi.hoisted(() => ({
  deleteCustomerMock: vi.fn(),
  captureExternalServiceErrorMock: vi.fn(),
  subscriptionFindFirstMock: vi.fn(),
}));

vi.mock("@/clients/stripe.client", () => ({
  stripeClient: {
    deleteCustomer: (...args: unknown[]) => deleteCustomerMock(...args),
  },
}));

vi.mock("@/lib/external-service-errors", () => ({
  captureExternalServiceError: (...args: unknown[]) =>
    captureExternalServiceErrorMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    subscription: {
      findFirst: (...args: unknown[]) => subscriptionFindFirstMock(...args),
    },
  },
}));

describe("deleteStripeCustomerBestEffort", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    deleteCustomerMock.mockResolvedValue({ id: "cus_1", deleted: true });
    subscriptionFindFirstMock.mockResolvedValue(null);
  });

  it("skips Stripe when there is no customer id", async () => {
    await expect(
      deleteStripeCustomerBestEffort({
        stripeCustomerId: null,
        ownerType: "user",
        ownerId: "user_1",
      }),
    ).resolves.toBeUndefined();

    expect(deleteCustomerMock).not.toHaveBeenCalled();
  });

  it("deletes the Stripe customer after allow", async () => {
    await expect(
      deleteStripeCustomerBestEffort({
        stripeCustomerId: "cus_1",
        ownerType: "organization",
        ownerId: "org_1",
      }),
    ).resolves.toBeUndefined();

    expect(deleteCustomerMock).toHaveBeenCalledWith("cus_1", {
      timeout: 2500,
    });
    expect(captureExternalServiceErrorMock).not.toHaveBeenCalled();
  });

  it("skips Stripe customer delete when a running subscription remains", async () => {
    subscriptionFindFirstMock.mockResolvedValue({ id: "sub_running" });

    await expect(
      deleteStripeCustomerBestEffort({
        stripeCustomerId: "cus_1",
        ownerType: "user",
        ownerId: "user_1",
      }),
    ).resolves.toBeUndefined();

    expect(subscriptionFindFirstMock).toHaveBeenCalledWith({
      where: {
        referenceId: "user_1",
        stripeSubscriptionId: { not: null },
        status: { in: ["active", "trialing", "past_due", "unpaid"] },
      },
      select: { id: true },
    });
    expect(deleteCustomerMock).not.toHaveBeenCalled();
  });

  it("logs a thrown Stripe delete and does not fail allow", async () => {
    const stripeDown = new Error("stripe unavailable");
    deleteCustomerMock.mockRejectedValue(stripeDown);

    await expect(
      deleteStripeCustomerBestEffort({
        stripeCustomerId: "cus_1",
        ownerType: "user",
        ownerId: "user_1",
      }),
    ).resolves.toBeUndefined();

    expect(deleteCustomerMock).toHaveBeenCalledWith("cus_1", {
      timeout: 2500,
    });
    expect(captureExternalServiceErrorMock).toHaveBeenCalledWith(stripeDown, {
      label: "stripe_customer_delete",
      sentry: {
        tags: {
          context: "stripe_customer_delete",
          ownerType: "user",
        },
      },
      extra: {
        ownerId: "user_1",
        stripeCustomerId: "cus_1",
      },
    });
  });

  it("treats Stripe resource_missing as success", async () => {
    deleteCustomerMock.mockRejectedValue({ code: "resource_missing" });

    await expect(
      deleteStripeCustomerBestEffort({
        stripeCustomerId: "cus_1",
        ownerType: "user",
        ownerId: "user_1",
      }),
    ).resolves.toBeUndefined();

    expect(captureExternalServiceErrorMock).not.toHaveBeenCalled();
  });
});
