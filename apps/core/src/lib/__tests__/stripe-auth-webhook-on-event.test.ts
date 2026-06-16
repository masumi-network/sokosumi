import { beforeEach, describe, expect, it, vi } from "vitest";

const handleEventMock = vi.fn();
const handleSubscriptionDeletedEventMock = vi.fn();
const captureExceptionMock = vi.fn();

vi.mock("@sentry/node", () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

vi.mock("@/services/stripe-webhook.service", () => ({
  stripeWebhookService: {
    handleEvent: (...args: unknown[]) => handleEventMock(...args),
  },
}));

vi.mock("@/services/stripe-backed-subscription.service", () => ({
  handleSubscriptionDeletedEvent: (...args: unknown[]) =>
    handleSubscriptionDeletedEventMock(...args),
}));

import {
  handleStripeAuthWebhookOnEvent,
  isBillingStripeEventType,
  resolveStripeAuthWebhookSecret,
} from "../stripe-auth-webhook-on-event";

describe("resolveStripeAuthWebhookSecret", () => {
  it("uses the Better Auth secret while split endpoints are enabled", () => {
    expect(
      resolveStripeAuthWebhookSecret({
        useUnifiedStripeWebhook: false,
        stripeWebhookSecret: "whsec_billing",
        stripeBetterAuthWebhookSecret: "whsec_ba",
      }),
    ).toBe("whsec_ba");
  });

  it("uses the billing secret when unified webhooks are enabled", () => {
    expect(
      resolveStripeAuthWebhookSecret({
        useUnifiedStripeWebhook: true,
        stripeWebhookSecret: "whsec_billing",
        stripeBetterAuthWebhookSecret: "whsec_ba",
      }),
    ).toBe("whsec_billing");
  });
});

describe("isBillingStripeEventType", () => {
  it.each([
    "invoice.paid",
    "customer.created",
    "customer.updated",
  ] as const)("returns true for %s", (eventType) => {
    expect(isBillingStripeEventType(eventType)).toBe(true);
  });

  it("returns false for subscription lifecycle events", () => {
    expect(isBillingStripeEventType("customer.subscription.deleted")).toBe(
      false,
    );
  });
});

describe("handleStripeAuthWebhookOnEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleEventMock.mockResolvedValue(undefined);
    handleSubscriptionDeletedEventMock.mockResolvedValue(undefined);
  });

  it("routes billing events through stripeWebhookService when unified", async () => {
    const event = {
      id: "evt_invoice",
      type: "invoice.paid",
      data: { object: { id: "in_123" } },
    } as never;

    await handleStripeAuthWebhookOnEvent(event, {
      useUnifiedStripeWebhook: true,
    });

    expect(handleEventMock).toHaveBeenCalledWith(event);
    expect(handleSubscriptionDeletedEventMock).not.toHaveBeenCalled();
  });

  it("ignores billing events when unified mode is disabled", async () => {
    const consoleInfoSpy = vi
      .spyOn(console, "info")
      .mockImplementation(() => undefined);

    try {
      await handleStripeAuthWebhookOnEvent(
        {
          id: "evt_invoice",
          type: "invoice.paid",
          data: { object: { id: "in_123" } },
        } as never,
        { useUnifiedStripeWebhook: false },
      );

      expect(handleEventMock).not.toHaveBeenCalled();
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "Unhandled Stripe event type: invoice.paid",
      );
    } finally {
      consoleInfoSpy.mockRestore();
    }
  });

  it("handles customer.subscription.deleted regardless of unified mode", async () => {
    const subscription = { id: "sub_123", customer: "cus_123" };

    await handleStripeAuthWebhookOnEvent(
      {
        id: "evt_sub_deleted",
        type: "customer.subscription.deleted",
        data: { object: subscription },
      } as never,
      { useUnifiedStripeWebhook: false },
    );

    expect(handleSubscriptionDeletedEventMock).toHaveBeenCalledWith(
      subscription,
    );
    expect(handleEventMock).not.toHaveBeenCalled();
  });

  it("reports subscription delete handler failures to Sentry", async () => {
    const failure = new Error("delete failed");
    handleSubscriptionDeletedEventMock.mockRejectedValue(failure);

    await expect(
      handleStripeAuthWebhookOnEvent(
        {
          id: "evt_sub_deleted",
          type: "customer.subscription.deleted",
          data: { object: { id: "sub_123", customer: "cus_123" } },
        } as never,
        { useUnifiedStripeWebhook: true },
      ),
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
