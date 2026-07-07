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
} from "../stripe-auth-webhook-on-event";

describe("isBillingStripeEventType", () => {
  it.each([
    "invoice.paid",
    "customer.created",
  ] as const)("returns true for %s", (eventType) => {
    expect(isBillingStripeEventType(eventType)).toBe(true);
  });

  it.each([
    "customer.subscription.deleted",
    "customer.updated",
  ] as const)("returns false for %s", (eventType) => {
    expect(isBillingStripeEventType(eventType)).toBe(false);
  });
});

describe("handleStripeAuthWebhookOnEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleEventMock.mockResolvedValue(undefined);
    handleSubscriptionDeletedEventMock.mockResolvedValue(undefined);
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
