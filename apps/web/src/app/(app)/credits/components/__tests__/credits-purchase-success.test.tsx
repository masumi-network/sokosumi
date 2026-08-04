import { render, waitFor } from "@testing-library/react";
import { withNuqsTestingAdapter } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
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
  it("opens the modal when session_id is present in the URL", () => {
    render(<CreditsPurchaseSuccess coworkersPromise={coworkersPromise} />, {
      wrapper: withNuqsTestingAdapter({
        searchParams: "?session_id=cs_test_123",
      }),
    });

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({
        open: true,
        headline: "creditsTitle",
        description: "creditsDescription",
        coworkersPromise,
      }),
    );
  });

  it("does not open the modal when session_id is absent", () => {
    render(<CreditsPurchaseSuccess coworkersPromise={coworkersPromise} />, {
      wrapper: withNuqsTestingAdapter({}),
    });

    expect(purchaseSuccessModalMock).toHaveBeenCalledWith(
      expect.objectContaining({ open: false }),
    );
  });

  it("clears session_id from the URL when the modal is dismissed", async () => {
    const onUrlUpdate = vi.fn();

    render(<CreditsPurchaseSuccess coworkersPromise={coworkersPromise} />, {
      wrapper: withNuqsTestingAdapter({
        searchParams: "?session_id=cs_test_123",
        onUrlUpdate,
      }),
    });

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

    render(<CreditsPurchaseSuccess coworkersPromise={coworkersPromise} />, {
      wrapper: withNuqsTestingAdapter({
        searchParams: "?session_id=cs_test_123",
        onUrlUpdate,
      }),
    });

    const { onOpenChange } = purchaseSuccessModalMock.mock.calls.at(-1)?.[0];
    onOpenChange(true);

    expect(onUrlUpdate).not.toHaveBeenCalled();
  });
});
