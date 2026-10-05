import type { Account } from "@sokosumi/utils";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ReauthDialog } from "./reauth-dialog";

/** Flipped per test, because an unverified address changes the offer. */
let emailVerified = true;
/** True until the session atom resolves, which decides what is on offer. */
let isPending = false;
/** Resolved with no session: a 401 or a failed first load reports this. */
let sessionLost = false;
let captchaBlocked = false;
const captchaFetchOptions = {
  headers: { "x-captcha-response": "reauth-token" },
};

vi.mock("@/components/auth-captcha", () => ({
  useAuthCaptcha: (entry: string) => ({
    widget: <div data-testid={`captcha-${entry}`} />,
    runWithCaptcha: async (
      action: (options: typeof captchaFetchOptions) => Promise<unknown>,
    ) => (captchaBlocked ? null : action(captchaFetchOptions)),
    getErrorMessage: (error: { code?: string }, fallback: string) =>
      error.code === "MISSING_RESPONSE" ? "captchaMissing" : fallback,
  }),
}));

const { mockDiscardRetiredAblyRealtimeClient } = vi.hoisted(() => ({
  mockDiscardRetiredAblyRealtimeClient: vi.fn(),
}));

vi.mock("@/lib/ably/realtime-singleton.client", () => ({
  discardRetiredAblyRealtimeClient: mockDiscardRetiredAblyRealtimeClient,
}));

const mockSignInEmail = vi.fn();
const mockSendEmailCode = vi.fn();
const mockSignInEmailCode = vi.fn();
const mockSignInSocial = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/account",
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => mockSendEmailCode(...args),
    },
    signIn: {
      email: (...args: unknown[]) => mockSignInEmail(...args),
      emailOtp: (...args: unknown[]) => mockSignInEmailCode(...args),
      social: (...args: unknown[]) => mockSignInSocial(...args),
    },
  },
  useSession: () => ({
    // Null while pending, the way the session atom reports it.
    data:
      isPending || sessionLost
        ? null
        : { user: { email: "owner@example.com", emailVerified } },
    isPending,
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
  const onOpenChange = vi.fn();
  const onReauthenticated = vi.fn();

  render(
    <ReauthDialog
      accounts={accounts}
      onOpenChange={onOpenChange}
      onReauthenticated={onReauthenticated}
      open
    />,
  );

  return { onOpenChange, onReauthenticated };
}

describe("ReauthDialog", () => {
  beforeEach(() => {
    emailVerified = true;
    isPending = false;
    sessionLost = false;
    captchaBlocked = false;
    mockDiscardRetiredAblyRealtimeClient.mockClear();
    mockSignInEmail.mockReset();
    mockSignInEmail.mockResolvedValue({ data: {}, error: null });
    mockSendEmailCode.mockReset();
    mockSendEmailCode.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    mockSignInEmailCode.mockReset();
    mockSignInEmailCode.mockResolvedValue({ data: {}, error: null });
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
      fetchOptions: captchaFetchOptions,
      email: "owner@example.com",
      password: "correct horse",
      rememberMe: true,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("drops a client the Ably singleton retired for the lost session", async () => {
    // This path keeps the document, so the retired client would otherwise
    // outlive the session that retired it and realtime would stay dead.
    renderDialog([passwordAccount]);

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId("reauth-field-currentPassword"),
      "correct horse",
    );
    await user.click(screen.getByRole("button", { name: "confirm" }));

    await waitFor(() => {
      expect(mockDiscardRetiredAblyRealtimeClient).toHaveBeenCalledTimes(1);
    });
  });

  // SOK-1259: every log-in is persistent, so there is nothing to choose.
  it("offers no Keep me logged in choice", () => {
    renderDialog([passwordAccount]);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
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

    // Submitting leaves focus on the button, so the error has to be announced
    // and tied to the field a screen reader would return to.
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invalid password");
    expect(
      screen.getByTestId("reauth-field-currentPassword"),
    ).toHaveAccessibleDescription("Invalid password");
    expect(onReauthenticated).not.toHaveBeenCalled();
  });

  it("never marks the password invalid for another path's failure", async () => {
    mockSendEmailCode.mockResolvedValue({
      data: null,
      error: { message: "Mail is down" },
    });

    renderDialog([passwordAccount]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Mail is down");
    // The viewer never typed here, so marking it invalid would blame the
    // wrong field and send a screen reader to unrelated text.
    const field = screen.getByTestId("reauth-field-currentPassword");
    expect(field).not.toHaveAccessibleDescription();
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("leaves for the provider and returns to the same route", async () => {
    renderDialog([googleAccount]);

    expect(
      screen.queryByTestId("reauth-field-currentPassword"),
    ).not.toBeInTheDocument();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "continueWithGoogle" }));

    await waitFor(() => {
      expect(mockSignInSocial).toHaveBeenCalledWith({
        callbackURL: expect.stringContaining("/account"),
        provider: "google",
      });
    });
  });

  it("confirms with an emailed code a viewer who owns nothing else", async () => {
    // An email-code sign-up writes no `account` row, so such a viewer has
    // neither a password nor a provider. Email is all they have.
    const { onOpenChange, onReauthenticated } = renderDialog([]);

    expect(
      screen.queryByTestId("reauth-field-currentPassword"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("orEmail")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    expect(mockSendEmailCode).toHaveBeenCalledWith({
      fetchOptions: captchaFetchOptions,
      email: "owner@example.com",
      type: "sign-in",
    });
    // The sixth digit confirms; Confirm is not needed.
    await user.type(
      await screen.findByRole("textbox", { name: "codeLabel" }),
      "042917",
    );

    await waitFor(() => {
      expect(onReauthenticated).toHaveBeenCalledTimes(1);
    });
    expect(mockSignInEmailCode).toHaveBeenCalledExactlyOnceWith({
      email: "owner@example.com",
      otp: "042917",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockDiscardRetiredAblyRealtimeClient).toHaveBeenCalled();
  });

  it("checks a typed code once, with Confirm busy meanwhile", async () => {
    mockSignInEmailCode.mockReturnValue(new Promise(() => {}));
    renderDialog([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await user.type(code, "042917");

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "confirmCode" }),
      ).toBeDisabled(),
    );
    // Like the sign-in step: nothing changes the code while it is checked.
    expect(code).toBeDisabled();
    expect(mockSignInEmailCode).toHaveBeenCalledOnce();
  });

  it("shares the pending code request with simultaneous manual confirmation", async () => {
    mockSignInEmailCode.mockReturnValue(new Promise(() => {}));
    renderDialog([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));
    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    const formElement = code.closest("form");
    if (!formElement) throw new Error("Missing reauth code form");
    act(() => {
      fireEvent.change(code, { target: { value: "042917" } });
      fireEvent.submit(formElement);
      fireEvent.submit(formElement);
    });
    expect(mockSignInEmailCode).toHaveBeenCalledExactlyOnceWith({
      email: "owner@example.com",
      otp: "042917",
    });
    expect(code).toBeDisabled();
    fireEvent.submit(formElement);
    expect(mockSignInEmailCode).toHaveBeenCalledOnce();
    await act(async () => {});
  });

  it("announces a refused code, empties the field and sends the same code again", async () => {
    mockSignInEmailCode.mockResolvedValue({
      data: null,
      error: { code: "INVALID_OTP", message: "Invalid OTP" },
    });
    renderDialog([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await user.type(code, "000000");

    // Focus returns to the field once it is enabled again, and the field's
    // description, which now names the refusal, is what gets read out.
    await waitFor(() => expect(code).toHaveFocus());
    expect(code).toBeEnabled();
    expect(code).toHaveValue("");
    expect(code).toHaveAccessibleDescription(/invalid$/);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await user.type(code, "000000");
    await waitFor(() => expect(mockSignInEmailCode).toHaveBeenCalledTimes(2));
    expect(mockSignInEmailCode).toHaveBeenLastCalledWith({
      email: "owner@example.com",
      otp: "000000",
    });
  });

  it("keeps the dialog open on a wrong code and says so beside the field", async () => {
    mockSignInEmailCode.mockResolvedValue({
      data: null,
      error: { code: "INVALID_OTP", message: "Invalid OTP" },
    });
    const { onReauthenticated } = renderDialog([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await user.type(code, "000000");

    await waitFor(() => expect(code).toHaveAccessibleDescription(/invalid$/));
    expect(onReauthenticated).not.toHaveBeenCalled();
  });

  it("names a terms block on the code path", async () => {
    mockSignInEmailCode.mockResolvedValue({
      data: null,
      error: { code: "TERMS_NOT_ACCEPTED" },
    });
    renderDialog([]);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));

    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await user.type(code, "042917");

    await waitFor(() =>
      expect(code).toHaveAccessibleDescription(/termsNotAccepted$/),
    );
  });

  it("never offers the code while the address is unproven", async () => {
    // Better Auth's `revokeUnprovenAccountAccess` deletes every linked account
    // and revokes every session when an unverified viewer signs in by email.
    emailVerified = false;
    renderDialog([passwordAccount, googleAccount]);

    expect(
      screen.queryByRole("button", { name: "continueWithEmail" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("orEmail")).not.toBeInTheDocument();

    // The methods that cannot destroy anything stay on offer.
    expect(
      screen.getByTestId("reauth-field-currentPassword"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "continueWithGoogle" }),
    ).toBeInTheDocument();
  });

  it("says what to do when the unproven viewer owns nothing else", () => {
    emailVerified = false;
    renderDialog([]);

    expect(screen.getByText("noMethod")).toBeInTheDocument();
  });

  it("sends a new code on request once the wait is over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderDialog([]);
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await user.click(
        screen.getByRole("button", { name: "continueWithEmail" }),
      );
      // The first email is usually still on its way.
      expect(
        await screen.findByRole("button", { name: "resendIn" }),
      ).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(30_000);
      });
      await user.click(screen.getByRole("button", { name: "resend" }));

      await waitFor(() => {
        expect(mockSendEmailCode).toHaveBeenCalledTimes(2);
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("names a terms block instead of blaming the password", async () => {
    // Core throws this with a code and no message, so the default branch
    // would tell a viewer their correct password was wrong.
    mockSignInEmail.mockResolvedValue({
      data: null,
      error: { code: "TERMS_NOT_ACCEPTED" },
    });

    renderDialog([passwordAccount]);

    const user = userEvent.setup();
    await user.type(
      screen.getByTestId("reauth-field-currentPassword"),
      "correct horse",
    );
    await user.click(screen.getByRole("button", { name: "confirm" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "termsNotAccepted",
    );
  });

  it("says nothing about methods before the session resolves", () => {
    // `emailVerified` is unknown while pending, so the viewer would otherwise
    // be told to verify an address that may already be verified.
    isPending = true;
    renderDialog([]);

    expect(screen.queryByText("noMethod")).not.toBeInTheDocument();
  });

  it("spins instead of looking broken while the session loads", () => {
    // Confirm needs the address the session carries, so it is disabled until
    // then. Without the spinner it reads as a dead button.
    isPending = true;
    renderDialog([passwordAccount]);

    const confirm = screen.getByRole("button", { name: "confirm" });
    expect(confirm).toBeDisabled();
    expect(confirm.querySelector(".animate-spin")).toBeInTheDocument();
  });

  it("says the session is gone rather than offering what cannot work", () => {
    // Better Auth reports a 401 as resolved with null data. Every offer needs
    // the address the session carries, so none of them can work.
    sessionLost = true;
    renderDialog([passwordAccount, googleAccount]);

    expect(screen.getByText("sessionLost")).toBeInTheDocument();
    expect(
      screen.queryByTestId("reauth-field-currentPassword"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "continueWithGoogle" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("noMethod")).not.toBeInTheDocument();
  });

  it("shows one button per provider, not one per linked account", () => {
    // Better Auth is unique on providerId plus accountId, so a viewer can
    // hold two Google rows.
    renderDialog([googleAccount, account("google")]);

    expect(
      screen.getAllByRole("button", { name: "continueWithGoogle" }),
    ).toHaveLength(1);
  });

  it("drops the code field once the password succeeds", async () => {
    renderDialog([passwordAccount]);

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "continueWithEmail" }));
    expect(
      await screen.findByRole("textbox", { name: "codeLabel" }),
    ).toBeInTheDocument();

    await user.type(
      screen.getByTestId("reauth-field-currentPassword"),
      "correct horse",
    );
    await user.click(screen.getByRole("button", { name: "confirm" }));

    // The code is no longer needed, so asking for it would mislead.
    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "codeLabel" }),
      ).not.toBeInTheDocument();
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

  it("unlocks the dialog when the social start fails to navigate", async () => {
    mockSignInSocial.mockResolvedValue({
      data: null,
      error: { message: "Provider is down" },
    });

    renderDialog([googleAccount]);

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "continueWithGoogle" }));

    await waitFor(() => {
      expect(screen.getByText("Provider is down")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "continueWithGoogle" }),
    ).not.toBeDisabled();
  });
  // A visitor Cloudflare wants to see would otherwise get two checkboxes.
  it("renders one challenge for the password and the email code", () => {
    renderDialog([passwordAccount]);
    expect(
      screen.getByRole("button", { name: "continueWithEmail" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId(/^captcha-/)).toHaveLength(1);
    expect(screen.getByTestId("captcha-signin")).toBeInTheDocument();
  });

  it("renders the challenge on the email path when there is no password", () => {
    renderDialog([]);
    expect(
      screen.getByRole("button", { name: "continueWithEmail" }),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId(/^captcha-/)).toHaveLength(1);
    expect(screen.getByTestId("captcha-email-code")).toBeInTheDocument();
  });

  it.each(["password", "email-code"])(
    "does not submit %s when CAPTCHA cannot complete",
    async (method) => {
      captchaBlocked = true;
      const { onReauthenticated, onOpenChange } = renderDialog([
        passwordAccount,
      ]);
      const user = userEvent.setup();
      if (method === "password") {
        await user.type(
          screen.getByTestId("reauth-field-currentPassword"),
          "correct horse",
        );
        await user.click(screen.getByRole("button", { name: "confirm" }));
      } else {
        await user.click(
          screen.getByRole("button", { name: "continueWithEmail" }),
        );
      }
      expect(mockSignInEmail).not.toHaveBeenCalled();
      expect(mockSendEmailCode).not.toHaveBeenCalled();
      expect(onReauthenticated).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalled();
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "continueWithEmail" }),
      ).not.toBeDisabled();
    },
  );

  it.each(["password", "email-code"])(
    "names a CAPTCHA rejection on the %s path",
    async (method) => {
      const rejection = { data: null, error: { code: "MISSING_RESPONSE" } };
      mockSignInEmail.mockResolvedValue(rejection);
      mockSendEmailCode.mockResolvedValue(rejection);
      renderDialog([passwordAccount]);
      const user = userEvent.setup();
      if (method === "password") {
        await user.type(
          screen.getByTestId("reauth-field-currentPassword"),
          "correct horse",
        );
        await user.click(screen.getByRole("button", { name: "confirm" }));
      } else {
        await user.click(
          screen.getByRole("button", { name: "continueWithEmail" }),
        );
      }
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "captchaMissing",
      );
    },
  );
});
