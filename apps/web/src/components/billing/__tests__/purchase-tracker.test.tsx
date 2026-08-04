import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CheckoutSessionAnalytics } from "@/lib/clients/generated/core";

const purchaseMock = vi.fn();

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    purchase: (...args: unknown[]) => purchaseMock(...args),
  },
}));

import {
  PurchaseTracker,
  resetFiredPurchaseSessionIdsForTests,
} from "../purchase-tracker";

const checkoutSession: CheckoutSessionAnalytics = {
  sessionId: "cs_once",
  currency: "eur",
  value: 12,
  items: [
    {
      itemId: "credits",
      itemName: "Credits",
      quantity: 100,
    },
  ],
};

describe("PurchaseTracker", () => {
  beforeEach(() => {
    purchaseMock.mockClear();
    resetFiredPurchaseSessionIdsForTests();
  });

  it("fires the GTM purchase event on mount", () => {
    render(<PurchaseTracker checkoutSession={checkoutSession} />);

    expect(purchaseMock).toHaveBeenCalledTimes(1);
    expect(purchaseMock).toHaveBeenCalledWith("cs_once", "eur", 12, [
      { item_id: "credits", item_name: "Credits", quantity: 100 },
    ]);
  });

  it("does not re-fire for the same session id after remount", () => {
    const { unmount } = render(
      <PurchaseTracker checkoutSession={checkoutSession} />,
    );
    unmount();

    render(<PurchaseTracker checkoutSession={checkoutSession} />);

    expect(purchaseMock).toHaveBeenCalledTimes(1);
  });

  it("fires again for a different session id", () => {
    render(<PurchaseTracker checkoutSession={checkoutSession} />);
    render(
      <PurchaseTracker
        checkoutSession={{ ...checkoutSession, sessionId: "cs_other" }}
      />,
    );

    expect(purchaseMock).toHaveBeenCalledTimes(2);
  });
});
