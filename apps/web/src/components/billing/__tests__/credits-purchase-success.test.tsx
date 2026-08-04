import { act, render, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoworkerOption } from "@/lib/types/coworker";

const purchaseSuccessModalMock = vi.fn();

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/components/billing/purchase-success-modal", () => ({
  PurchaseSuccessModal: (props: unknown) => {
    purchaseSuccessModalMock(props);
    return null;
  },
}));

import { CreditsPurchaseSuccess } from "../credits-purchase-success";

const coworkersPromise: Promise<CoworkerOption[]> = Promise.resolve([]);

describe("CreditsPurchaseSuccess", () => {
  beforeEach(() => {
    purchaseSuccessModalMock.mockClear();
  });

  it("opens the modal when initialOpen is true", () => {
    render(
      <CreditsPurchaseSuccess
        coworkersPromise={coworkersPromise}
        initialOpen
      />,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?session_id=cs_test_123",
        }),
      },
    );

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        headline: "creditsTitle",
        description: "creditsDescription",
        coworkersPromise,
      }),
    );
  });

  it("does not open the modal when initialOpen is false", () => {
    render(<CreditsPurchaseSuccess coworkersPromise={coworkersPromise} />, {
      wrapper: withNuqsTestingAdapter({}),
    });

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("clears session_id from the URL when the modal is dismissed", async () => {
    const onUrlUpdate = vi.fn();

    render(
      <CreditsPurchaseSuccess
        coworkersPromise={coworkersPromise}
        initialOpen
      />,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?session_id=cs_test_123",
          onUrlUpdate,
        }),
      },
    );

    const { onOpenChange } = purchaseSuccessModalMock.mock.calls.at(-1)?.[0];
    onOpenChange(false);

    await waitFor(() => {
      expect(onUrlUpdate).toHaveBeenCalled();
    });
    const event = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(event?.searchParams.has("session_id")).toBe(false);
  });

  it("does not clear the URL when the modal open-change fires with open=true", () => {
    const onUrlUpdate = vi.fn();

    render(
      <CreditsPurchaseSuccess
        coworkersPromise={coworkersPromise}
        initialOpen
      />,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?session_id=cs_test_123",
          onUrlUpdate,
        }),
      },
    );

    const { onOpenChange } = purchaseSuccessModalMock.mock.calls.at(-1)?.[0];
    onOpenChange(true);

    expect(onUrlUpdate).not.toHaveBeenCalled();
  });

  it("keeps the modal closed after dismiss via local open latch", async () => {
    render(
      <CreditsPurchaseSuccess
        coworkersPromise={coworkersPromise}
        initialOpen
      />,
      {
        wrapper: withNuqsTestingAdapter({
          searchParams: "?session_id=cs_test_123",
        }),
      },
    );

    const { onOpenChange } = purchaseSuccessModalMock.mock.calls.at(-1)?.[0];
    await act(async () => {
      onOpenChange(false);
    });

    expect(purchaseSuccessModalMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: false }),
    );
  });
});
