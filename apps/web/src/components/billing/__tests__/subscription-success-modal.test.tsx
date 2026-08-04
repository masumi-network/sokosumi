import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { SubscriptionSuccessModal } from "../subscription-success-modal";

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
        returnPath="/billing?tab=subscription"
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
        returnPath="/billing?tab=subscription"
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
        returnPath="/billing?tab=subscription"
        status="cancel"
      />,
    );

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("strips the status param via router.replace when dismissed", () => {
    render(
      <SubscriptionSuccessModal
        coworkersPromise={coworkersPromise}
        description="Your subscription is now active."
        headline="You're on the Pro plan!"
        returnPath="/billing?tab=subscription"
        status="success"
      />,
    );

    const { onOpenChange } = purchaseSuccessModalMock.mock.calls.at(-1)?.[0];
    onOpenChange(false);

    expect(replaceMock).toHaveBeenCalledWith("/billing?tab=subscription");
  });

  it("does not call router.replace when the modal reports open=true", () => {
    render(
      <SubscriptionSuccessModal
        coworkersPromise={coworkersPromise}
        description="Your subscription is now active."
        headline="You're on the Pro plan!"
        returnPath="/billing?tab=subscription"
        status="success"
      />,
    );

    const { onOpenChange } = purchaseSuccessModalMock.mock.calls.at(-1)?.[0];
    onOpenChange(true);

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
