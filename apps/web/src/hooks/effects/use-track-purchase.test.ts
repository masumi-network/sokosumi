import type { CheckoutSessionAnalytics } from "@sokosumi/core-client";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyConsentMode,
  CONSENT_COOKIE,
  writeConsent,
} from "@/lib/analytics/consent";

const purchaseMock = vi.fn();

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    purchase: (...args: unknown[]) => purchaseMock(...args),
  },
}));

import { expectConsole } from "@sokosumi/utils/test-console";
import {
  resetFiredPurchaseSessionIdsForTests,
  useTrackPurchase,
} from "./use-track-purchase";

const checkoutSession: CheckoutSessionAnalytics = {
  sessionId: "cs_hook_once",
  currency: "eur",
  value: 25,
  items: [{ itemId: "credits", itemName: "Credits", quantity: 250 }],
};

describe("useTrackPurchase", () => {
  beforeEach(() => {
    purchaseMock.mockClear();
    resetFiredPurchaseSessionIdsForTests();
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
    window.dataLayer = [];
  });

  it("fires once per session id when analytics consent is granted and ignores remounts", () => {
    writeConsent({ analytics: true, marketing: false });

    const { unmount } = renderHook(() => useTrackPurchase(checkoutSession));
    expect(purchaseMock).toHaveBeenCalledTimes(1);
    expect(purchaseMock).toHaveBeenCalledWith("cs_hook_once", "eur", 25, [
      { item_id: "credits", item_name: "Credits", quantity: 250 },
    ]);

    unmount();
    renderHook(() => useTrackPurchase(checkoutSession));
    expect(purchaseMock).toHaveBeenCalledTimes(1);
  });

  it("waits for consent change and stops listening after unmount", () => {
    const { unmount } = renderHook(() => useTrackPurchase(checkoutSession));
    expect(purchaseMock).not.toHaveBeenCalled();

    unmount();
    act(() => {
      applyConsentMode(writeConsent({ analytics: true, marketing: false }));
    });
    expect(purchaseMock).not.toHaveBeenCalled();
  });

  it("fires when consent is granted while mounted and retries if dispatch throws", () => {
    expectConsole("error", "[purchase-tracker] purchase dispatch failed");
    purchaseMock.mockImplementationOnce(() => {
      throw new Error("dataLayer unavailable");
    });

    const { rerender } = renderHook(
      ({ session }: { session: CheckoutSessionAnalytics }) =>
        useTrackPurchase(session),
      { initialProps: { session: checkoutSession } },
    );

    act(() => {
      applyConsentMode(writeConsent({ analytics: true, marketing: false }));
    });
    expect(purchaseMock).toHaveBeenCalledTimes(1);

    rerender({ session: { ...checkoutSession } });
    expect(purchaseMock).toHaveBeenCalledTimes(2);
  });
});
