import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCheckoutSessionAnalyticsMock = vi.fn();
const purchaseTrackerMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getCheckoutSessionAnalytics: (...args: unknown[]) =>
      getCheckoutSessionAnalyticsMock(...args),
  },
}));

vi.mock("@/components/billing/purchase-tracker", () => ({
  PurchaseTracker: (props: unknown) => {
    purchaseTrackerMock(props);
    return <div data-testid="purchase-tracker" />;
  },
}));

import { SubscriptionCheckoutReturn } from "./subscription-checkout-return";

describe("SubscriptionCheckoutReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing without a session id", async () => {
    const view = render(await SubscriptionCheckoutReturn({}));

    expect(view.container).toBeEmptyDOMElement();
    expect(getCheckoutSessionAnalyticsMock).not.toHaveBeenCalled();
  });

  it("ignores the unsubstituted Stripe placeholder", async () => {
    const view = render(
      await SubscriptionCheckoutReturn({ sessionId: "{CHECKOUT_SESSION_ID}" }),
    );

    expect(view.container).toBeEmptyDOMElement();
    expect(getCheckoutSessionAnalyticsMock).not.toHaveBeenCalled();
  });

  it("mounts the purchase tracker when Core validates the session", async () => {
    const checkoutSession = {
      sessionId: "cs_test_sub",
      currency: "eur",
      value: 4900,
      items: [{ itemId: "prod_pro", itemName: "Pro", quantity: 1 }],
    };
    getCheckoutSessionAnalyticsMock.mockResolvedValue({
      data: checkoutSession,
    });

    render(await SubscriptionCheckoutReturn({ sessionId: "cs_test_sub" }));

    expect(getCheckoutSessionAnalyticsMock).toHaveBeenCalledWith("cs_test_sub");
    expect(purchaseTrackerMock).toHaveBeenCalledWith({ checkoutSession });
  });

  it("renders nothing when Core rejects the session", async () => {
    getCheckoutSessionAnalyticsMock.mockRejectedValue(new Error("not found"));

    const view = render(
      await SubscriptionCheckoutReturn({ sessionId: "cs_test_other" }),
    );

    expect(view.container).toBeEmptyDOMElement();
    expect(purchaseTrackerMock).not.toHaveBeenCalled();
  });
});
