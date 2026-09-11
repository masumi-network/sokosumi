import type { Account } from "@sokosumi/utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import DisconnectModal from "./disconnect-modal";

const mockRefresh = vi.fn();
const mockSignInEmail = vi.fn();
const mockSignInSocial = vi.fn();
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
const mockUnlinkAccount = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/connections",
  useRouter: () => ({
    refresh: mockRefresh,
  }),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
    success: (...args: unknown[]) => mockToastSuccess(...args),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => mockSignInEmail(...args),
      social: (...args: unknown[]) => mockSignInSocial(...args),
    },
    unlinkAccount: (...args: unknown[]) => mockUnlinkAccount(...args),
  },
  useSession: () => ({
    data: { user: { email: "owner@example.com" } },
  }),
}));

const googleAccount: Account = {
  accountId: "google-account",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "account-google",
  providerId: "google",
  updatedAt: "2026-01-01T00:00:00.000Z",
  userId: "user-1",
};

const passwordAccount: Account = {
  accountId: "credential-account",
  createdAt: "2026-01-01T00:00:00.000Z",
  id: "account-credential",
  providerId: "credential",
  updatedAt: "2026-01-01T00:00:00.000Z",
  userId: "user-1",
};

describe("DisconnectModal", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    mockSignInEmail.mockReset();
    mockSignInEmail.mockResolvedValue({ data: {}, error: null });
    mockSignInSocial.mockReset();
    mockSignInSocial.mockResolvedValue({ data: {}, error: null });
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    mockUnlinkAccount.mockReset();
    mockUnlinkAccount.mockResolvedValue({ data: {}, error: null });
  });

  it("unlinks the account when the session is fresh", async () => {
    render(
      <DisconnectModal
        account={googleAccount}
        accounts={[googleAccount, passwordAccount]}
        open
        setOpen={vi.fn()}
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "confirm" }));

    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("success");
    });
    expect(
      screen.queryByTestId("reauth-field-currentPassword"),
    ).not.toBeInTheDocument();
  });

  it("asks for the password again when the session is not fresh", async () => {
    mockUnlinkAccount
      .mockResolvedValueOnce({
        data: null,
        error: { code: "SESSION_NOT_FRESH", message: "Session is not fresh" },
      })
      .mockResolvedValue({ data: {}, error: null });

    const setOpen = vi.fn();
    render(
      <DisconnectModal
        account={googleAccount}
        accounts={[googleAccount, passwordAccount]}
        open
        setOpen={setOpen}
      />,
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "confirm" }));

    const passwordField = await screen.findByTestId(
      "reauth-field-currentPassword",
    );
    // The confirmation dialog closes so the two never stack.
    expect(setOpen).toHaveBeenCalledWith(false);
    expect(mockToastError).not.toHaveBeenCalled();

    await user.type(passwordField, "correct horse");
    await user.click(screen.getByRole("button", { name: "confirm" }));

    await waitFor(() => {
      expect(mockSignInEmail).toHaveBeenCalledWith({
        email: "owner@example.com",
        password: "correct horse",
      });
    });

    // The gate re-authenticates and stops. Resuming here would unlink the
    // account without the viewer pressing Confirm a second time.
    await waitFor(() => {
      expect(mockToastSuccess).toHaveBeenCalledWith("retryPrompt");
    });
    expect(mockUnlinkAccount).toHaveBeenCalledTimes(1);
    expect(mockToastSuccess).not.toHaveBeenCalledWith("success");
  });

  it("reports a normal unlink failure instead of asking to sign in again", async () => {
    mockUnlinkAccount.mockResolvedValue({
      data: null,
      error: { code: "FAILED_TO_UNLINK_LAST_ACCOUNT", message: "nope" },
    });

    render(
      <DisconnectModal
        account={googleAccount}
        accounts={[googleAccount, passwordAccount]}
        open
        setOpen={vi.fn()}
      />,
    );

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "confirm" }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("nope");
    });
    expect(
      screen.queryByTestId("reauth-field-currentPassword"),
    ).not.toBeInTheDocument();
  });
});
