import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyConsentMode,
  CONSENT_COOKIE,
  writeConsent,
} from "@/lib/analytics/consent";
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
} from "./purchase-tracker";

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

function clearConsent() {
  document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
}

function decide(analytics: boolean) {
  act(() => {
    applyConsentMode(writeConsent({ analytics, marketing: false }));
  });
}

/** A reload starts a new JS realm: only sessionStorage survives. */
function simulateReload() {
  const stored = { ...window.sessionStorage };
  resetFiredPurchaseSessionIdsForTests();
  for (const [key, value] of Object.entries(stored)) {
    window.sessionStorage.setItem(key, value);
  }
}

describe("PurchaseTracker", () => {
  beforeEach(() => {
    purchaseMock.mockClear();
    resetFiredPurchaseSessionIdsForTests();
    clearConsent();
    window.dataLayer = [];
  });

  describe("with analytics consent granted", () => {
    beforeEach(() => {
      writeConsent({ analytics: true, marketing: false });
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

    it("does not re-fire after a reload of the return URL", () => {
      render(<PurchaseTracker checkoutSession={checkoutSession} />);
      simulateReload();

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

  it("waits for the banner and fires once consent is granted", () => {
    render(<PurchaseTracker checkoutSession={checkoutSession} />);
    expect(purchaseMock).not.toHaveBeenCalled();

    decide(true);

    expect(purchaseMock).toHaveBeenCalledTimes(1);
    // The purchase lands after consent_status, which GTM's trigger groups need.
    expect(window.dataLayer?.at(-1)).toMatchObject({ event: "consent_status" });
  });

  it("never fires when consent is refused", () => {
    render(<PurchaseTracker checkoutSession={checkoutSession} />);

    decide(false);

    expect(purchaseMock).not.toHaveBeenCalled();
  });

  it("does not fire for a stored refusal", () => {
    writeConsent({ analytics: false, marketing: true });

    render(<PurchaseTracker checkoutSession={checkoutSession} />);

    expect(purchaseMock).not.toHaveBeenCalled();
  });

  it("fires on a reload after consent was granted if it was blocked before", () => {
    render(<PurchaseTracker checkoutSession={checkoutSession} />);
    expect(purchaseMock).not.toHaveBeenCalled();

    simulateReload();
    writeConsent({ analytics: true, marketing: false });
    render(<PurchaseTracker checkoutSession={checkoutSession} />);

    expect(purchaseMock).toHaveBeenCalledTimes(1);
  });

  it("does not mark the session when dispatch throws", () => {
    writeConsent({ analytics: true, marketing: false });
    vi.spyOn(console, "error").mockImplementation(() => {});
    purchaseMock.mockImplementationOnce(() => {
      throw new Error("dataLayer unavailable");
    });

    render(<PurchaseTracker checkoutSession={checkoutSession} />);
    expect(purchaseMock).toHaveBeenCalledTimes(1);

    simulateReload();
    render(<PurchaseTracker checkoutSession={checkoutSession} />);

    expect(purchaseMock).toHaveBeenCalledTimes(2);
    vi.mocked(console.error).mockRestore();
  });

  it("stops listening after unmount", () => {
    const { unmount } = render(
      <PurchaseTracker checkoutSession={checkoutSession} />,
    );
    unmount();

    decide(true);

    expect(purchaseMock).not.toHaveBeenCalled();
  });
});
