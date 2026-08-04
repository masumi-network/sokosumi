import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoworkerOption } from "@/lib/types/coworker";

const getCheckoutSessionAnalyticsMock = vi.fn();
const creditsPurchaseSuccessMock = vi.fn();
const purchaseTrackerMock = vi.fn();
const creditsCancelModalMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/clients/core.client", () => ({
  coreClient: {
    getCheckoutSessionAnalytics: (...args: unknown[]) =>
      getCheckoutSessionAnalyticsMock(...args),
  },
}));

vi.mock("@/components/billing/credits-purchase-success", () => ({
  CreditsPurchaseSuccess: (props: unknown) => {
    creditsPurchaseSuccessMock(props);
    return <div data-testid="credits-purchase-success" />;
  },
}));

vi.mock("@/components/billing/purchase-tracker", () => ({
  PurchaseTracker: (props: unknown) => {
    purchaseTrackerMock(props);
    return <div data-testid="purchase-tracker" />;
  },
}));

vi.mock("@/components/billing/credits-cancel-modal", () => ({
  CreditsCancelModal: () => {
    creditsCancelModalMock();
    return <div data-testid="credits-cancel-modal" />;
  },
}));

import { CreditsCheckoutReturn } from "../credits-checkout-return";

const coworkersPromise: Promise<CoworkerOption[]> = Promise.resolve([]);

describe("CreditsCheckoutReturn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when there is no session id or cancel marker", async () => {
    const view = render(await CreditsCheckoutReturn({ coworkersPromise }));

    expect(view.container).toBeEmptyDOMElement();
    expect(getCheckoutSessionAnalyticsMock).not.toHaveBeenCalled();
  });

  it("mounts success UI and tracker when session validates", async () => {
    const checkoutSession = {
      sessionId: "cs_1",
      currency: "eur",
      value: 1,
      items: [],
    };
    getCheckoutSessionAnalyticsMock.mockResolvedValue({
      data: checkoutSession,
    });

    render(
      await CreditsCheckoutReturn({
        coworkersPromise,
        sessionId: "cs_1",
      }),
    );

    expect(creditsPurchaseSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ coworkersPromise, initialOpen: true }),
    );
    expect(purchaseTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutSession }),
    );
    expect(creditsCancelModalMock).not.toHaveBeenCalled();
  });

  it("does not mount success UI when session validation fails", async () => {
    getCheckoutSessionAnalyticsMock.mockRejectedValue(new Error("not found"));

    render(
      await CreditsCheckoutReturn({
        coworkersPromise,
        sessionId: "cs_invalid",
      }),
    );

    expect(creditsPurchaseSuccessMock).not.toHaveBeenCalled();
    expect(purchaseTrackerMock).not.toHaveBeenCalled();
  });

  it("mounts the cancel modal when cancel is present", async () => {
    render(
      await CreditsCheckoutReturn({
        cancel: "true",
        coworkersPromise,
      }),
    );

    expect(creditsCancelModalMock).toHaveBeenCalled();
    expect(creditsPurchaseSuccessMock).not.toHaveBeenCalled();
    expect(getCheckoutSessionAnalyticsMock).not.toHaveBeenCalled();
  });

  it("prefers success over cancel when both markers are present", async () => {
    const checkoutSession = {
      sessionId: "cs_both",
      currency: "eur",
      value: 1,
      items: [],
    };
    getCheckoutSessionAnalyticsMock.mockResolvedValue({
      data: checkoutSession,
    });

    render(
      await CreditsCheckoutReturn({
        cancel: "true",
        coworkersPromise,
        sessionId: "cs_both",
      }),
    );

    expect(getCheckoutSessionAnalyticsMock).toHaveBeenCalledWith("cs_both");
    expect(creditsPurchaseSuccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ coworkersPromise, initialOpen: true }),
    );
    expect(purchaseTrackerMock).toHaveBeenCalledWith(
      expect.objectContaining({ checkoutSession }),
    );
    expect(creditsCancelModalMock).not.toHaveBeenCalled();
  });
});
