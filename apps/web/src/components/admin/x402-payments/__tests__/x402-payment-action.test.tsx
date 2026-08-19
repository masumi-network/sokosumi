import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { refundActionMock, resolveActionMock, refreshMock, toastErrorMock } =
  vi.hoisted(() => ({
    refundActionMock: vi.fn(),
    resolveActionMock: vi.fn(),
    refreshMock: vi.fn(),
    toastErrorMock: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: vi.fn() },
}));

vi.mock("@/lib/actions/admin-task-x402-payments/action", () => ({
  refundTaskX402PaymentAction: (...args: unknown[]) =>
    refundActionMock(...args),
  resolveTaskX402PaymentAction: (...args: unknown[]) =>
    resolveActionMock(...args),
}));

import { X402PaymentAction } from "../x402-payment-action";

describe("X402PaymentAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an actionable toast when the session wrapper throws", async () => {
    refundActionMock.mockRejectedValue(new Error("Unauthenticated"));
    render(
      <X402PaymentAction
        paymentId="payment_1"
        asset="0x1111111111111111111111111111111111111111"
        payTo="0x2222222222222222222222222222222222222222"
        action="refund"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions.refund" }));
    const refundButtons = await screen.findAllByRole("button", {
      name: "Actions.refund",
    });
    fireEvent.click(refundButtons.at(-1) as HTMLButtonElement);

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith("Actions.actionFailed");
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
