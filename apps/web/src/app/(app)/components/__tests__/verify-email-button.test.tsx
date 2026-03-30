import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

import VerifyEmailButton from "@/app/components/verify-email-button";
import { authClient } from "@/lib/auth/auth.client";

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => {
    const labels: Record<string, string> = {
      sendSuccess: "Verification email sent.",
      sendError: "Failed to send verification email.",
    };

    return labels[key] ?? key;
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    sendVerificationEmail: vi.fn(),
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("VerifyEmailButton", () => {
  beforeEach(() => {
    vi.mocked(authClient.sendVerificationEmail).mockReset();
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
  });

  it("sends verification email with the current page callback URL and shows success", async () => {
    let resolveRequest: ((value: unknown) => void) | undefined;

    vi.mocked(authClient.sendVerificationEmail).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }) as Promise<unknown>,
    );

    const user = userEvent.setup();
    render(<VerifyEmailButton email="user@example.com" label="Verify email" />);

    const button = screen.getByRole("button", { name: "Verify email" });
    await user.click(button);

    expect(authClient.sendVerificationEmail).toHaveBeenCalledWith({
      email: "user@example.com",
      callbackURL: window.location.href,
    });
    expect(button).toBeDisabled();

    resolveRequest?.({ data: { status: true }, error: null });

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Verification email sent.");
      expect(button).not.toBeDisabled();
    });
  });

  it("shows a fallback error toast when sending verification email throws", async () => {
    vi.mocked(authClient.sendVerificationEmail).mockRejectedValueOnce(
      new Error("network-error"),
    );

    const user = userEvent.setup();
    render(<VerifyEmailButton email="user@example.com" label="Verify email" />);

    await user.click(screen.getByRole("button", { name: "Verify email" }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(
        "Failed to send verification email.",
      );
    });
  });
});
