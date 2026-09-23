import { beforeEach, describe, expect, it, vi } from "vitest";

const handleEventMock = vi.fn();
const handleSubscriptionDeletedEventMock = vi.fn();
const handleCheckoutSessionCompletedEventMock = vi.fn();
const handleSubscriptionCreatedEventMock = vi.fn();
const captureExceptionMock = vi.fn();
const notifyPaymentFailedMock = vi.fn();
const notifySubscriptionEndingMock = vi.fn();
const resolveBillingWalletByStripeCustomerIdMock = vi.fn();

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock("@/helpers/billing-notifications", () => ({
  notifyPaymentFailed: (...args: unknown[]) => notifyPaymentFailedMock(...args),
  notifySubscriptionEnding: (...args: unknown[]) =>
    notifySubscriptionEndingMock(...args),
  resolveBillingWalletByStripeCustomerId: (...args: unknown[]) =>
    resolveBillingWalletByStripeCustomerIdMock(...args),
}));

vi.mock("@/services/stripe-webhook.service", () => ({
  stripeWebhookService: {
    handleEvent: (...args: unknown[]) => handleEventMock(...args),
  },
}));

vi.mock("@/services/stripe-backed-subscription.service", () => ({
  handleSubscriptionDeletedEvent: (...args: unknown[]) =>
    handleSubscriptionDeletedEventMock(...args),
  handleCheckoutSessionCompletedEvent: (...args: unknown[]) =>
    handleCheckoutSessionCompletedEventMock(...args),
  handleSubscriptionCreatedEvent: (...args: unknown[]) =>
    handleSubscriptionCreatedEventMock(...args),
}));

import {
  handleStripeAuthWebhookOnEvent,
  isBillingStripeEventType,
} from "./stripe-auth-webhook-on-event";

describe("isBillingStripeEventType", () => {
  it.each(["invoice.paid", "customer.created"] as const)(
    "returns true for %s",
    (eventType) => {
      expect(isBillingStripeEventType(eventType)).toBe(true);
    },
  );

  it.each(["customer.subscription.deleted", "customer.updated"] as const)(
    "returns false for %s",
    (eventType) => {
      expect(isBillingStripeEventType(eventType)).toBe(false);
    },
  );
});

describe("handleStripeAuthWebhookOnEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleEventMock.mockResolvedValue(undefined);
    handleSubscriptionDeletedEventMock.mockResolvedValue(undefined);
    handleCheckoutSessionCompletedEventMock.mockResolvedValue(undefined);
    handleSubscriptionCreatedEventMock.mockResolvedValue(undefined);
    resolveBillingWalletByStripeCustomerIdMock.mockResolvedValue({
      userId: "user-1",
      organizationId: null,
    });
  });

  it("tells the wallet behind a failed invoice payment", async () => {
    await handleStripeAuthWebhookOnEvent({
      id: "evt_failed",
      type: "invoice.payment_failed",
      data: { object: { id: "in_failed", customer: "cus_123" } },
    } as never);

    expect(resolveBillingWalletByStripeCustomerIdMock).toHaveBeenCalledWith(
      "cus_123",
    );
    expect(notifyPaymentFailedMock).toHaveBeenCalledWith(
      { userId: "user-1", organizationId: null },
      { invoiceId: "in_failed" },
    );
    expect(handleEventMock).not.toHaveBeenCalled();
  });

  it("tells nobody about a failed payment for a customer Sokosumi does not hold", async () => {
    resolveBillingWalletByStripeCustomerIdMock.mockResolvedValue(null);

    await handleStripeAuthWebhookOnEvent({
      id: "evt_failed",
      type: "invoice.payment_failed",
      data: { object: { id: "in_failed", customer: "cus_stranger" } },
    } as never);

    expect(notifyPaymentFailedMock).not.toHaveBeenCalled();
  });

  /**
   * The wallet lookup failing must not fail the webhook: Stripe would retry
   * and replay the plugin's own subscription handling for a notification.
   */
  it("reports a wallet lookup failure and still returns", async () => {
    const failure = new Error("db down");
    resolveBillingWalletByStripeCustomerIdMock.mockRejectedValue(failure);

    await expect(
      handleStripeAuthWebhookOnEvent({
        id: "evt_failed",
        type: "invoice.payment_failed",
        data: { object: { id: "in_failed", customer: "cus_123" } },
      } as never),
    ).resolves.toBeUndefined();

    expect(captureExceptionMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: { stripeEventType: "invoice.payment_failed" },
        extra: { eventId: "evt_failed", stripeCustomerId: "cus_123" },
      }),
    );
    expect(notifyPaymentFailedMock).not.toHaveBeenCalled();
  });

  it("tells the wallet when a subscription is set to end at period end", async () => {
    await handleStripeAuthWebhookOnEvent({
      id: "evt_sub_updated",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: { id: "cus_123" },
          cancel_at_period_end: true,
          cancel_at: 1_800_000_000,
        },
        previous_attributes: { cancel_at_period_end: false },
      },
    } as never);

    expect(resolveBillingWalletByStripeCustomerIdMock).toHaveBeenCalledWith(
      "cus_123",
    );
    expect(notifySubscriptionEndingMock).toHaveBeenCalledWith(
      { userId: "user-1", organizationId: null },
      { stripeSubscriptionId: "sub_123", cancelAt: 1_800_000_000 },
    );
  });

  it.each([
    {
      name: "a subscription that stays set to end",
      previous_attributes: { items: {} },
      cancel_at_period_end: true,
    },
    {
      name: "a subscription that was resumed",
      previous_attributes: { cancel_at_period_end: true },
      cancel_at_period_end: false,
    },
    {
      name: "an update Stripe sent with no previous attributes",
      previous_attributes: undefined,
      cancel_at_period_end: true,
    },
  ])("says nothing about $name", async (variant) => {
    await handleStripeAuthWebhookOnEvent({
      id: "evt_sub_updated",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_123",
          customer: "cus_123",
          cancel_at_period_end: variant.cancel_at_period_end,
          cancel_at: null,
        },
        previous_attributes: variant.previous_attributes,
      },
    } as never);

    expect(resolveBillingWalletByStripeCustomerIdMock).not.toHaveBeenCalled();
    expect(notifySubscriptionEndingMock).not.toHaveBeenCalled();
  });

  it("routes billing events through stripeWebhookService", async () => {
    const event = {
      id: "evt_invoice",
      type: "invoice.paid",
      data: { object: { id: "in_123" } },
    } as never;

    await handleStripeAuthWebhookOnEvent(event);

    expect(handleEventMock).toHaveBeenCalledWith(event);
    expect(handleSubscriptionDeletedEventMock).not.toHaveBeenCalled();
  });

  it("handles checkout.session.completed", async () => {
    const session = { id: "cs_123", subscription: "sub_123" };

    await handleStripeAuthWebhookOnEvent({
      id: "evt_checkout",
      type: "checkout.session.completed",
      data: { object: session },
    } as never);

    expect(handleCheckoutSessionCompletedEventMock).toHaveBeenCalledWith(
      session,
    );
    expect(handleEventMock).not.toHaveBeenCalled();
  });

  it("handles customer.subscription.created", async () => {
    const subscription = { id: "sub_123", customer: "cus_123" };
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      await handleStripeAuthWebhookOnEvent({
        id: "evt_sub_created",
        type: "customer.subscription.created",
        data: { object: subscription },
      } as never);

      expect(handleSubscriptionCreatedEventMock).toHaveBeenCalledWith(
        subscription,
      );
      expect(handleEventMock).not.toHaveBeenCalled();
      // Handled, so it must not fall through to the unhandled-type log.
      expect(infoSpy).not.toHaveBeenCalled();
    } finally {
      infoSpy.mockRestore();
    }
  });

  it("reports a failed created reconciliation and rethrows so Stripe retries", async () => {
    const failure = new Error("reconcile failed");
    handleSubscriptionCreatedEventMock.mockRejectedValue(failure);

    await expect(
      handleStripeAuthWebhookOnEvent({
        id: "evt_sub_created",
        type: "customer.subscription.created",
        data: { object: { id: "sub_123", customer: "cus_123" } },
      } as never),
    ).rejects.toThrow("reconcile failed");

    expect(captureExceptionMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: expect.objectContaining({
          stripeEventType: "customer.subscription.created",
          stripeSubscriptionId: "sub_123",
        }),
        extra: { customer: "cus_123", eventId: "evt_sub_created" },
      }),
    );
  });

  it("handles customer.subscription.deleted", async () => {
    const subscription = { id: "sub_123", customer: "cus_123" };

    await handleStripeAuthWebhookOnEvent({
      id: "evt_sub_deleted",
      type: "customer.subscription.deleted",
      data: { object: subscription },
    } as never);

    expect(handleSubscriptionDeletedEventMock).toHaveBeenCalledWith(
      subscription,
    );
    expect(handleEventMock).not.toHaveBeenCalled();
  });

  it("reports subscription delete handler failures to Sentry", async () => {
    const failure = new Error("delete failed");
    handleSubscriptionDeletedEventMock.mockRejectedValue(failure);

    await expect(
      handleStripeAuthWebhookOnEvent({
        id: "evt_sub_deleted",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_123", customer: "cus_123" } },
      } as never),
    ).rejects.toThrow("delete failed");

    expect(captureExceptionMock).toHaveBeenCalledWith(
      failure,
      expect.objectContaining({
        tags: expect.objectContaining({
          stripeEventType: "customer.subscription.deleted",
        }),
      }),
    );
  });
});
