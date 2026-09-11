import type { Account } from "@sokosumi/utils";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { canReauthenticateWith, ReauthDialog } from "./reauth-dialog";

const mockSignInEmail = vi.fn();
const mockSignInSocial = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/account",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => mockSignInEmail(...args),
      social: (...args: unknown[]) => mockSignInSocial(...args),
    },
  },
  useSession: () => ({
    data: { user: { email: "owner@example.com" } },
  }),
}));

function account(providerId: string): Account {
  return {
    accountId: `${providerId}-account`,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: `account-${providerId}`,
    providerId,
    updatedAt: "2026-01-01T00:00:00.000Z",
    userId: "user-1",
  };
}

const passwordAccount = account("credential");
const googleAccount = account("google");
const microsoftAccount = account("microsoft");

function renderDialog(accounts: Account[]) {
  const onBeforeRedirect = vi.fn();
  const onOpenChange = vi.fn();
  const onReauthenticated = vi.fn();

  render(
    <ReauthDialog
      accounts={accounts}
      onBeforeRedirect={onBeforeRedirect}
      onOpenChange={onOpenChange}
      onReauthenticated={onReauthenticated}
      open
    />,
  );

  return { onBeforeRedirect, onOpenChange, onReauthenticated };
}

describe("canReauthenticateWith", () => {
  it("is true for a password or a supported provider", () => {
    expect(canReauthenticateWith([passwordAccount])).toBe(true);
    expect(canReauthenticateWith([googleAccount])).toBe(true);
    expect(canReauthenticateWith([microsoftAccount])).toBe(true);
  });

  it("is false with no accounts or only an unsupported provider", () => {
    expect(canReauthenticateWith([])).toBe(false);
    expect(canReauthenticateWith([account("apple")])).toBe(false);
  });
});

describe("ReauthDialog", () => {
  beforeEach(() => {
    mockSignInEmail.mockReset();
    mockSignInEmail.mockResolvedValue({ data: {}, error: null });
    mockSignInSocial.mockReset();
    mockSignInSocial.mockResolvedValue({ data: {}, error: null });
  });

  it("signs in with the password and reports success once", async () => {
    const { onOpenChange, onReauthenticated } = renderDialog([passwordAccount]);

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId("reauth-field-currentPassword"),
      "correct horse",
    );
    await user.click(screen.getByRole("button", { name: "confirm" }));

    await waitFor(() => {
      expect(onReauthenticated).toHaveBeenCalledTimes(1);
    });
    expect(mockSignInEmail).toHaveBeenCalledWith({
      email: "owner@example.com",
      password: "correct horse",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps the dialog open and shows why when the password is wrong", async () => {
    mockSignInEmail.mockResolvedValue({
      data: null,
      error: { message: "Invalid password" },
    });

    const { onReauthenticated } = renderDialog([passwordAccount]);

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId("reauth-field-currentPassword"),
      "wrong",
    );
    await user.click(screen.getByRole("button", { name: "confirm" }));

    await waitFor(() => {
      expect(screen.getByText("Invalid password")).toBeInTheDocument();
    });
    expect(onReauthenticated).not.toHaveBeenCalled();
  });

  it("records the pending intent before leaving for the provider", async () => {
    const { onBeforeRedirect } = renderDialog([googleAccount]);

    expect(
      screen.queryByTestId("reauth-field-currentPassword"),
    ).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "continueWithGoogle" }));

    expect(onBeforeRedirect).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mockSignInSocial).toHaveBeenCalledWith({
        callbackURL: expect.stringContaining("/account"),
        provider: "google",
      });
    });
  });

  it("names each provider rather than echoing its wire id", () => {
    renderDialog([googleAccount, microsoftAccount, passwordAccount]);

    expect(
      screen.getByRole("button", { name: "continueWithGoogle" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "continueWithMicrosoft" }),
    ).toBeInTheDocument();
    expect(screen.getByText("orSocial")).toBeInTheDocument();
  });

  it("says so when the viewer owns no method it can offer", () => {
    renderDialog([]);

    expect(screen.getByText("noMethod")).toBeInTheDocument();
    expect(
      screen.queryByTestId("reauth-field-currentPassword"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "confirm" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^continueWith/ }),
    ).not.toBeInTheDocument();
  });
});
