import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ResendButton } from "./resend-button";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { seconds?: number }) =>
    values?.seconds === undefined ? key : `${key} ${values.seconds}`,
}));

describe("ResendButton", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-01T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits 30 seconds after a code was sent before offering a new one", () => {
    const onResend = vi.fn();
    render(
      <ResendButton
        sentAt={Date.now()}
        onResend={onResend}
        isSending={false}
      />,
    );

    expect(screen.getByRole("button")).toHaveTextContent("resendIn 30");
    expect(screen.getByRole("button")).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(screen.getByRole("button")).toHaveTextContent("resendIn 1");
    expect(screen.getByRole("button")).toBeDisabled();

    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(screen.getByRole("button")).toHaveTextContent("resend");
    fireEvent.click(screen.getByRole("button"));
    expect(onResend).toHaveBeenCalledOnce();
  });

  it("starts the wait again once the new code is sent", () => {
    const { rerender } = render(
      <ResendButton sentAt={Date.now()} onResend={vi.fn()} isSending={false} />,
    );
    act(() => {
      vi.advanceTimersByTime(45_000);
    });
    expect(screen.getByRole("button")).toBeEnabled();

    rerender(
      <ResendButton sentAt={Date.now()} onResend={vi.fn()} isSending={false} />,
    );

    expect(screen.getByRole("button")).toHaveTextContent("resendIn 30");
    expect(screen.getByRole("button")).toBeDisabled();
  });

  it("stays unavailable while a code is on its way", () => {
    render(<ResendButton sentAt={0} onResend={vi.fn()} isSending={true} />);

    expect(screen.getByRole("button")).toHaveTextContent("resend");
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
