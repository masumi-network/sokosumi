import {
  act,
  type RenderOptions,
  render as renderComponent,
  waitFor,
} from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PurchaseTracker,
  resetFiredPurchaseSessionIdsForTests,
} from "@/components/billing/purchase-tracker";
import {
  applyConsentMode,
  CONSENT_COOKIE,
  writeConsent,
} from "@/lib/analytics/consent";
import type { CoworkerOption } from "@/lib/types/coworker";

const replaceMock = vi.fn();
const purchaseSuccessModalMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/components/billing/purchase-success-modal", () => ({
  PurchaseSuccessModal: (props: unknown) => {
    purchaseSuccessModalMock(props);
    return null;
  },
}));

import { SubscriptionSuccessModal } from "./subscription-success-modal";

function render(ui: ReactNode, options?: RenderOptions) {
  return renderComponent(ui, {
    wrapper: withNuqsTestingAdapter({}),
    ...options,
  });
}

const coworkersPromise: Promise<CoworkerOption[]> = Promise.resolve([]);

describe("SubscriptionSuccessModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens with the given headline/description when status is success", () => {
    render(
      <SubscriptionSuccessModal
        coworkersPromise={coworkersPromise}
        description="Your subscription is now active."
        headline="You're on the Pro plan!"
        status="success"
      />,
    );

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        headline: "You're on the Pro plan!",
        description: "Your subscription is now active.",
        coworkersPromise,
      }),
    );
  });

  it("does not open when status is null", () => {
    render(
      <SubscriptionSuccessModal
        coworkersPromise={coworkersPromise}
        description="Your subscription is now active."
        headline="You're on the Pro plan!"
        status={null}
      />,
    );

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("does not open when status is cancel", () => {
    render(
      <SubscriptionSuccessModal
        coworkersPromise={coworkersPromise}
        description="Your subscription is now active."
        headline="You're on the Pro plan!"
        status="cancel"
      />,
    );

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("strips only the status param when dismissed", async () => {
    const onUrlUpdate = vi.fn();
    render(
      <SubscriptionSuccessModal
        coworkersPromise={coworkersPromise}
        description="Your subscription is now active."
        headline="You're on the Pro plan!"
        status="success"
      />,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?status=success",
          onUrlUpdate,
        }),
      },
    );

    const { onOpenChange } = purchaseSuccessModalMock.mock.calls.at(-1)?.[0];
    act(() => onOpenChange(false));

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    expect(onUrlUpdate.mock.calls.at(-1)?.[0].searchParams.has("status")).toBe(
      false,
    );
  });

  it("does not call router.replace when the modal reports open=true", () => {
    render(
      <SubscriptionSuccessModal
        coworkersPromise={coworkersPromise}
        description="Your subscription is now active."
        headline="You're on the Pro plan!"
        status="success"
      />,
    );

    const { onOpenChange } = purchaseSuccessModalMock.mock.calls.at(-1)?.[0];
    onOpenChange(true);

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("preserves the checkout return when dismissed before consent, then dispatches once", async () => {
    document.cookie = `${CONSENT_COOKIE}=; Max-Age=0; Path=/`;
    resetFiredPurchaseSessionIdsForTests();
    window.dataLayer = [];
    const onUrlUpdate = vi.fn();
    render(
      <>
        <SubscriptionSuccessModal
          coworkersPromise={coworkersPromise}
          description="Active"
          headline="Subscribed"
          status="success"
        />
        <PurchaseTracker
          checkoutSession={{
            sessionId: "cs_test_later",
            currency: "eur",
            value: 25,
            items: [],
          }}
        />
      </>,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams:
            "?tab=credits&status=success&checkout_session_id=cs_test_later",
          onUrlUpdate,
        }),
      },
    );

    act(() =>
      purchaseSuccessModalMock.mock.calls.at(-1)?.[0].onOpenChange(false),
    );
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled());
    const { searchParams } = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(searchParams.get("checkout_session_id")).toBe("cs_test_later");
    expect(searchParams.get("tab")).toBe("credits");
    expect(searchParams.has("status")).toBe(false);
    expect(replaceMock).not.toHaveBeenCalled();
    expect(window.dataLayer).not.toContainEqual(
      expect.objectContaining({ event: "purchase" }),
    );

    act(() => {
      applyConsentMode(writeConsent({ analytics: true, marketing: false }));
      applyConsentMode(writeConsent({ analytics: false, marketing: false }));
      applyConsentMode(writeConsent({ analytics: true, marketing: false }));
    });
    expect(
      window.dataLayer?.filter(
        (event) => "event" in event && event.event === "purchase",
      ),
    ).toEqual([
      {
        event: "purchase",
        transaction_id: "cs_test_later",
        currency: "eur",
        value: 25,
        items: [],
      },
    ]);
  });
});
