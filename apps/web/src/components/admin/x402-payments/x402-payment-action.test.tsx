import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  refundActionMock,
  resolveActionMock,
  refreshMock,
  toastErrorMock,
  toastSuccessMock,
} = vi.hoisted(() => ({
  refundActionMock: vi.fn(),
  resolveActionMock: vi.fn(),
  refreshMock: vi.fn(),
  toastErrorMock: vi.fn(),
  toastSuccessMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: { error: toastErrorMock, success: toastSuccessMock },
}));

vi.mock("@/lib/actions/admin-task-x402-payments/action", () => ({
  refundTaskX402PaymentAction: (...args: unknown[]) =>
    refundActionMock(...args),
  resolveTaskX402PaymentAction: (...args: unknown[]) =>
    resolveActionMock(...args),
}));

import { X402PaymentAction } from "./x402-payment-action";

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

  it("toasts success and refreshes after a resolve", async () => {
    resolveActionMock.mockResolvedValue({ ok: true });
    render(
      <X402PaymentAction
        paymentId="payment_1"
        asset="0x1111111111111111111111111111111111111111"
        payTo="0x2222222222222222222222222222222222222222"
        action="resolve"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions.resolve" }));
    const resolveButtons = await screen.findAllByRole("button", {
      name: "Actions.resolve",
    });
    fireEvent.click(resolveButtons.at(-1) as HTMLButtonElement);

    await waitFor(() => {
      expect(toastSuccessMock).toHaveBeenCalledWith("Actions.resolveSuccess");
    });
    expect(resolveActionMock).toHaveBeenCalledWith({
      paymentId: "payment_1",
      reason: "account_deletion_blocked",
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("does not open resolve while the authorization-risk window is open", () => {
    render(
      <X402PaymentAction
        paymentId="payment_1"
        asset="0x1111111111111111111111111111111111111111"
        payTo="0x2222222222222222222222222222222222222222"
        action="resolve"
        disabledUntil={new Date(Date.now() + 60_000)}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Actions.resolve" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Actions.resolve" }));
    expect(
      screen.queryByText("Actions.resolveConfirmTitle"),
    ).not.toBeInTheDocument();
  });

  it("opens resolve after the authorization-risk window", async () => {
    render(
      <X402PaymentAction
        paymentId="payment_1"
        asset="0x1111111111111111111111111111111111111111"
        payTo="0x2222222222222222222222222222222222222222"
        action="resolve"
        disabledUntil={new Date(Date.now() - 60_000)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Actions.resolve" }));
    expect(
      await screen.findByText("Actions.resolveConfirmTitle"),
    ).toBeInTheDocument();
  });
});
