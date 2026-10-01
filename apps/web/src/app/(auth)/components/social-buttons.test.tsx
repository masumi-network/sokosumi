import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  captchaErrorMessageMock,
  captchaFetchOptions,
  requestCaptchaMock,
} from "@/test/auth-captcha-mock";

import SocialButtons from "./social-buttons";

const mockSocialSignIn = vi.fn();
const mockPasskeySignIn = vi.fn();
const mockSendEmailCode = vi.fn();
const mockEmailCodeSignIn = vi.fn();
const mockToastError = vi.fn();
const mockRouterReplace = vi.fn();
const mockLocationReplace = vi.fn();
const mockGetSession = vi.fn();
const mockIsConditionalMediationAvailable = vi.fn();

interface MockWaitForAuthSessionOptions {
  getSession: () => Promise<null | { id: string }>;
}

const mockWaitForAuthSession = vi.fn(
  async (
    _options: MockWaitForAuthSessionOptions,
  ): Promise<{ id: string } | null> => ({ id: "session-id" }),
);
const mockSignInEvent = vi.fn();

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    const translator = (
      key: string,
      values?: {
        provider?: string;
      },
    ) => {
      if (key === "continueWith") {
        return `continue-with-${values?.provider ?? "unknown"}`;
      }
      if (key === "emailCodeProvider") {
        return "email code";
      }
      if (key === "passkeyProvider") {
        return "Passkey";
      }
      if (key === "lastUsed") {
        return "last-used";
      }
      if (key === "emailCodeInputLabel") {
        return "email-code-email";
      }
      return key;
    };

    translator.has = (key: string) => key === "lastUsed";

    return translator;
  },
}));

vi.mock("@vercel/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    signIn: {
      passkey: (...args: unknown[]) => mockPasskeySignIn(...args),
      social: (...args: unknown[]) => mockSocialSignIn(...args),
      emailOtp: (...args: unknown[]) => mockEmailCodeSignIn(...args),
    },
    emailOtp: {
      sendVerificationOtp: (...args: unknown[]) => mockSendEmailCode(...args),
    },
  },
}));

vi.mock("@/lib/actions/auth/action", () => ({}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    signIn: (...args: unknown[]) => mockSignInEvent(...args),
  },
}));

vi.mock("@/lib/auth/auth.utils", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/auth.utils")>(
    "@/lib/auth/auth.utils",
  );

  return {
    ...actual,
    normalizeAuthReturnUrl: (value?: string) => value ?? "/chat",
    waitForAuthSession: (options: MockWaitForAuthSessionOptions) =>
      mockWaitForAuthSession(options),
  };
});

interface MockSocialButtonProps {
  className?: string;
  onClick?: () => void;
  text?: string;
}

function MockSocialButton({ className, onClick, text }: MockSocialButtonProps) {
  return (
    <button type="button" className={className} onClick={onClick}>
      {text}
    </button>
  );
}

function createDeferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  let reject: ((error?: unknown) => void) | undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return {
    promise,
    resolve: (value: T) => resolve?.(value),
    reject: (error?: unknown) => reject?.(error),
  };
}

vi.mock("react-social-login-buttons", () => ({
  GoogleLoginButton: MockSocialButton,
  MicrosoftLoginButton: MockSocialButton,
}));

describe("SocialButtons", () => {
  beforeEach(() => {
    mockSocialSignIn.mockReset();
    mockSocialSignIn.mockResolvedValue({});
    mockPasskeySignIn.mockReset();
    mockPasskeySignIn.mockResolvedValue({
      data: {
        session: {
          id: "session-id",
        },
      },
      error: null,
    });
    mockSendEmailCode.mockReset();
    mockSendEmailCode.mockResolvedValue({
      data: { success: true },
      error: null,
    });
    mockEmailCodeSignIn.mockReset();
    mockEmailCodeSignIn.mockResolvedValue({
      data: { token: "session-token", user: { id: "user-1" } },
      error: null,
    });
    mockToastError.mockReset();
    mockRouterReplace.mockReset();
    mockLocationReplace.mockReset();
    Object.defineProperty(window.location, "replace", {
      configurable: true,
      value: (...args: unknown[]) => mockLocationReplace(...args),
    });
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          id: "session-id",
        },
      },
      error: null,
    });
    mockWaitForAuthSession.mockReset();
    mockWaitForAuthSession.mockResolvedValue({ id: "session-id" });
    mockSignInEvent.mockReset();
    mockIsConditionalMediationAvailable.mockReset();
    mockIsConditionalMediationAvailable.mockResolvedValue(false);
    mockSearchParams = new URLSearchParams();
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: {
        isConditionalMediationAvailable: mockIsConditionalMediationAvailable,
      },
    });
  });

  async function clickGoogleButton() {
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "continue-with-Google" }),
    );
  }

  function getSubmittedReturnUrls(): {
    callbackReturnUrl: string | null;
    newUserCallbackReturnUrl: string | null;
  } {
    const payload = mockSocialSignIn.mock.calls[0]?.[0] as {
      callbackURL: string;
      newUserCallbackURL: string;
    };
    const callbackUrl = new URL(payload.callbackURL, "https://example.com");
    const newUserCallbackUrl = new URL(
      payload.newUserCallbackURL,
      "https://example.com",
    );

    return {
      callbackReturnUrl: callbackUrl.searchParams.get("returnUrl"),
      newUserCallbackReturnUrl:
        newUserCallbackUrl.searchParams.get("returnUrl"),
    };
  }

  it("sends a failed social sign-in back to this page without its old error", async () => {
    const startPage = window.location.href;
    window.history.replaceState(
      null,
      "",
      "/signin?returnUrl=%2Fchat&error=account_not_linked",
    );
    try {
      render(<SocialButtons />);

      await clickGoogleButton();

      await waitFor(() => {
        expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
      });
      expect(mockSocialSignIn.mock.calls[0]?.[0]).toMatchObject({
        errorCallbackURL: `${window.location.origin}/signin?returnUrl=%2Fchat`,
      });
    } finally {
      window.history.replaceState(null, "", startPage);
    }
  });

  it("passes provided returnUrl to social sign-in callbacks", async () => {
    render(<SocialButtons returnUrl="/oauth/consent?client_id=prop-client" />);

    await clickGoogleButton();

    await waitFor(() => {
      expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
    });

    expect(getSubmittedReturnUrls()).toEqual({
      callbackReturnUrl: "/oauth/consent?client_id=prop-client",
      newUserCallbackReturnUrl: "/oauth/consent?client_id=prop-client",
    });
  });

  it.each([
    ["google", "Google"],
    ["passkey", "Passkey"],
    ["email-otp", "email code"],
  ] as const)(
    "keeps a distinct hover fill for last-used %s",
    (method, label) => {
      render(
        <SocialButtons showPasskey showEmailCode lastUsedMethod={method} />,
      );

      const button = screen.getByRole("button", {
        name: `continue-with-${label}`,
      });
      const important = method === "google" ? "!" : "";
      expect(button).toHaveClass(
        `bg-primary-quinary${important}`,
        `hover:bg-primary-quaternary${important}`,
      );
      expect(button).not.toHaveClass(`dark:bg-primary-quaternary${important}`);
    },
  );

  it("shows an inline marker on the matching provider button", () => {
    render(<SocialButtons lastUsedMethod="google" />);

    const button = screen.getByRole("button", { name: "continue-with-Google" });
    const lastUsedLabel = screen.getByText("last-used");
    const badgeContainer = button.parentElement;

    expect(lastUsedLabel).toBeInTheDocument();
    expect(lastUsedLabel).toHaveClass("absolute", "top-1.5", "right-2");
    expect(badgeContainer).toHaveClass("relative");
    expect(badgeContainer).toContainElement(lastUsedLabel);
  });

  it("shows an inline marker on the email code button", () => {
    render(<SocialButtons showEmailCode lastUsedMethod="email-otp" />);

    const button = screen.getByRole("button", {
      name: "continue-with-email code",
    });
    const lastUsedLabel = screen.getByText("last-used");
    const badgeContainer = button.parentElement;

    expect(lastUsedLabel).toBeInTheDocument();
    expect(lastUsedLabel).toHaveClass("absolute", "top-1.5", "right-2");
    expect(button).toHaveClass("border-primary-tertiary", "bg-primary-quinary");
    expect(badgeContainer).toHaveClass("relative");
    expect(badgeContainer).toContainElement(lastUsedLabel);
  });

  it("shows an inline marker on the passkey button", () => {
    render(<SocialButtons showPasskey lastUsedMethod="passkey" />);

    const button = screen.getByRole("button", {
      name: "continue-with-Passkey",
    });
    const lastUsedLabel = screen.getByText("last-used");
    const badgeContainer = button.parentElement;

    expect(lastUsedLabel).toBeInTheDocument();
    expect(lastUsedLabel).toHaveClass("absolute", "top-1.5", "right-2");
    expect(button).toHaveClass("border-primary-tertiary", "bg-primary-quinary");
    expect(badgeContainer).toHaveClass("relative");
    expect(badgeContainer).toContainElement(lastUsedLabel);
  });

  it("returns an OAuth visitor to the sign-in page with the signed request", async () => {
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://consumer.example.com/callback",
      code_challenge: "test-challenge",
      code_challenge_method: "S256",
      scope: "openid",
      state: "test-state",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
    });

    render(<SocialButtons />);

    await clickGoogleButton();

    await waitFor(() => {
      expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
    });

    const expectedReturnUrl =
      "/signin?client_id=test-client&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&code_challenge=test-challenge&code_challenge_method=S256&scope=openid&state=test-state&response_type=code&exp=1772367377&sig=signed-value";
    expect(getSubmittedReturnUrls()).toEqual({
      callbackReturnUrl: expectedReturnUrl,
      newUserCallbackReturnUrl: expectedReturnUrl,
    });
  });

  it("renders the passkey button between Microsoft and the email code", () => {
    render(<SocialButtons showEmailCode showPasskey />);

    const buttons = screen.getAllByRole("button");

    expect(buttons[0]).toHaveTextContent("continue-with-Google");
    expect(buttons[1]).toHaveTextContent("continue-with-Microsoft");
    expect(buttons[2]).toHaveTextContent("continue-with-Passkey");
    expect(buttons[3]).toHaveTextContent("continue-with-email code");
  });

  it("signs in with a passkey and redirects to the return url", async () => {
    const user = userEvent.setup();

    render(<SocialButtons returnUrl="/jobs" showEmailCode showPasskey />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Passkey" }),
    );

    await waitFor(() => {
      expect(mockPasskeySignIn).toHaveBeenCalledWith({
        autoFill: false,
      });
    });

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith("/jobs");
      // A soft nav would be served the pre-login middleware redirect.
      expect(mockRouterReplace).not.toHaveBeenCalled();
    });
    expect(mockSignInEvent).toHaveBeenCalledWith("passkey");
  });

  it("does not fire login when passkey sign-in succeeds without a session", async () => {
    const user = userEvent.setup();

    mockWaitForAuthSession.mockResolvedValue(null);

    render(<SocialButtons returnUrl="/jobs" showPasskey />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Passkey" }),
    );

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith("/jobs");
    });
    expect(mockSignInEvent).not.toHaveBeenCalled();
  });

  it("does not fire login when passkey sign-in fails", async () => {
    const user = userEvent.setup();

    mockPasskeySignIn.mockResolvedValue({
      data: null,
      error: { message: "failed", code: "FAILED" },
    });

    render(<SocialButtons returnUrl="/jobs" showPasskey />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Passkey" }),
    );

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("passkeyError");
    });
    expect(mockSignInEvent).not.toHaveBeenCalled();
    expect(mockLocationReplace).not.toHaveBeenCalled();
  });

  it("does not fire login when passkey sign-in is cancelled", async () => {
    const user = userEvent.setup();

    mockPasskeySignIn.mockResolvedValue({
      data: null,
      error: { code: "AUTH_CANCELLED" },
    });

    render(<SocialButtons returnUrl="/jobs" showPasskey />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Passkey" }),
    );

    await waitFor(() => {
      expect(mockPasskeySignIn).toHaveBeenCalledWith({
        autoFill: false,
      });
    });
    expect(mockToastError).not.toHaveBeenCalled();
    expect(mockSignInEvent).not.toHaveBeenCalled();
    expect(mockLocationReplace).not.toHaveBeenCalled();
  });

  it("passes unwrapped session data to waitForAuthSession", async () => {
    const user = userEvent.setup();

    mockGetSession.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    render(<SocialButtons returnUrl="/jobs" showPasskey />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Passkey" }),
    );

    await waitFor(() => {
      expect(mockWaitForAuthSession).toHaveBeenCalledTimes(1);
    });

    const firstWaitForAuthSessionCall = mockWaitForAuthSession.mock.calls[0];

    expect(firstWaitForAuthSessionCall).toBeDefined();

    if (!firstWaitForAuthSessionCall) {
      throw new Error("waitForAuthSession was not called");
    }

    const [waitForAuthSessionOptions] = firstWaitForAuthSessionCall;

    await expect(waitForAuthSessionOptions.getSession()).resolves.toBeNull();
  });

  it("starts conditional passkey UI only when supported", async () => {
    mockIsConditionalMediationAvailable.mockResolvedValueOnce(true);

    render(<SocialButtons showPasskey />);

    await waitFor(() => {
      expect(mockPasskeySignIn).toHaveBeenCalledWith({
        autoFill: true,
      });
    });
  });

  it("ignores stale conditional passkey results after return url changes", async () => {
    const firstPasskeyRequest = createDeferred<{
      data: {
        session: {
          id: string;
        };
      };
      error: null;
    }>();
    const secondPasskeyRequest = createDeferred<{
      data: {
        session: {
          id: string;
        };
      };
      error: null;
    }>();

    mockIsConditionalMediationAvailable.mockResolvedValue(true);
    mockPasskeySignIn
      .mockReturnValueOnce(firstPasskeyRequest.promise)
      .mockReturnValueOnce(secondPasskeyRequest.promise);

    const { rerender } = render(
      <SocialButtons returnUrl="/jobs" showPasskey />,
    );

    await waitFor(() => {
      expect(mockPasskeySignIn).toHaveBeenCalledTimes(1);
    });

    rerender(<SocialButtons returnUrl="/profile" showPasskey />);

    await waitFor(() => {
      expect(mockPasskeySignIn).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      firstPasskeyRequest.resolve({
        data: {
          session: {
            id: "session-old",
          },
        },
        error: null,
      });
      await Promise.resolve();
    });

    expect(mockLocationReplace).not.toHaveBeenCalled();

    await act(async () => {
      secondPasskeyRequest.resolve({
        data: {
          session: {
            id: "session-new",
          },
        },
        error: null,
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith("/profile");
    });
  });

  it("fails softly when conditional passkey UI is unavailable", async () => {
    Object.defineProperty(window, "PublicKeyCredential", {
      configurable: true,
      value: undefined,
    });

    render(<SocialButtons showPasskey />);

    await waitFor(() => {
      expect(mockPasskeySignIn).not.toHaveBeenCalled();
    });
  });

  async function openEmailCodePanel(email = "login-user@example.com") {
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "continue-with-email code" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "email-code-email" }),
      { target: { value: email } },
    );
    return user;
  }

  it("emails a sign-in code and then asks for it", async () => {
    render(<SocialButtons showEmailCode />);
    const user = await openEmailCodePanel();

    await user.click(screen.getByRole("button", { name: "emailCodeSend" }));

    expect(mockSendEmailCode).toHaveBeenCalledWith({
      fetchOptions: captchaFetchOptions,
      email: "login-user@example.com",
      type: "sign-in",
    });
    expect(
      await screen.findByRole("textbox", { name: "codeLabel" }),
    ).toHaveFocus();
  });

  it("signs in with the emailed code and goes to the return url", async () => {
    render(<SocialButtons showEmailCode returnUrl="/jobs" />);
    const user = await openEmailCodePanel();
    await user.click(screen.getByRole("button", { name: "emailCodeSend" }));

    await user.type(
      await screen.findByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    await user.click(screen.getByRole("button", { name: "emailCodeSubmit" }));

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith("/jobs");
    });
    expect(mockEmailCodeSignIn).toHaveBeenCalledWith({
      email: "login-user@example.com",
      otp: "042917",
    });
    expect(mockSignInEvent).toHaveBeenCalledWith("email-otp");
  });

  it("lets Core's OAuth provider answer a code sign-in for another app", async () => {
    mockSearchParams = new URLSearchParams({
      client_id: "cmo",
      exp: "9999999999",
      sig: "signed-value",
    });
    mockEmailCodeSignIn.mockResolvedValue({
      data: { redirect: true, url: "https://app.cmo.xyz/api/auth/callback" },
      error: null,
    });
    render(<SocialButtons showEmailCode />);
    const user = await openEmailCodePanel();
    await user.click(screen.getByRole("button", { name: "emailCodeSend" }));

    await user.type(
      await screen.findByRole("textbox", { name: "codeLabel" }),
      "042917",
    );
    await user.click(screen.getByRole("button", { name: "emailCodeSubmit" }));

    await waitFor(() => expect(mockSignInEvent).toHaveBeenCalled());
    expect(mockLocationReplace).not.toHaveBeenCalled();
  });

  it("explains a wrong code beside the field and stays on the page", async () => {
    mockEmailCodeSignIn.mockResolvedValue({
      data: null,
      error: { code: "INVALID_OTP", message: "Invalid OTP" },
    });
    render(<SocialButtons showEmailCode />);
    const user = await openEmailCodePanel();
    await user.click(screen.getByRole("button", { name: "emailCodeSend" }));

    const code = await screen.findByRole("textbox", { name: "codeLabel" });
    await user.type(code, "000000");
    await user.click(screen.getByRole("button", { name: "emailCodeSubmit" }));

    await waitFor(() => expect(code).toHaveAccessibleDescription(/invalid$/));
    expect(mockLocationReplace).not.toHaveBeenCalled();
  });

  it("asks again for the code when the address is edited after sending", async () => {
    render(<SocialButtons showEmailCode />);
    const user = await openEmailCodePanel();
    await user.click(screen.getByRole("button", { name: "emailCodeSend" }));
    await screen.findByRole("textbox", { name: "codeLabel" });

    fireEvent.change(
      screen.getByRole("textbox", { name: "email-code-email" }),
      { target: { value: "other@example.com" } },
    );

    expect(
      screen.queryByRole("textbox", { name: "codeLabel" }),
    ).not.toBeInTheDocument();
  });

  it("asks for the email code address with an email keyboard and no autocorrect", async () => {
    const user = userEvent.setup();
    render(<SocialButtons showEmailCode />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-email code" }),
    );

    const email = screen.getByRole("textbox", { name: "email-code-email" });
    expect(email).toHaveAttribute("type", "email");
    expect(email).toHaveAttribute("autocomplete", "email");
    expect(email).toHaveAttribute("autocapitalize", "none");
    expect(email).toHaveAttribute("spellcheck", "false");
  });

  it("says in its own words when the email code address is invalid", async () => {
    render(<SocialButtons showEmailCode />);
    const user = await openEmailCodePanel("not-an-email");

    await user.click(screen.getByRole("button", { name: "emailCodeSend" }));

    expect(mockToastError).toHaveBeenCalledWith("emailCodeInvalidEmail");
    expect(mockSendEmailCode).not.toHaveBeenCalled();
  });

  it("releases Send code without sending mail when the captcha is cancelled", async () => {
    requestCaptchaMock.mockResolvedValueOnce(null);
    render(<SocialButtons showEmailCode />);
    const user = await openEmailCodePanel();

    await user.click(screen.getByRole("button", { name: "emailCodeSend" }));

    expect(requestCaptchaMock).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "emailCodeSend" }),
      ).toBeEnabled(),
    );
    expect(mockSendEmailCode).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("textbox", { name: "codeLabel" }),
    ).not.toBeInTheDocument();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows translated captcha errors for email code requests", async () => {
    const error = {
      code: "VERIFICATION_FAILED",
      message: "Captcha verification failed",
    };
    mockSendEmailCode.mockResolvedValueOnce({ data: null, error });
    captchaErrorMessageMock.mockReturnValue("Translated captcha error");
    const user = userEvent.setup();
    render(<SocialButtons showEmailCode prefilledEmail="person@example.com" />);
    await user.click(
      screen.getByRole("button", { name: "continue-with-email code" }),
    );
    await user.click(screen.getByRole("button", { name: "emailCodeSend" }));

    expect(captchaErrorMessageMock).toHaveBeenCalledWith(error, error.message);
    expect(mockToastError).toHaveBeenLastCalledWith("Translated captcha error");
    expect(
      screen.queryByRole("textbox", { name: "codeLabel" }),
    ).not.toBeInTheDocument();
  });

  it("hides the email code panel when the trigger is clicked again", async () => {
    const user = userEvent.setup();

    render(<SocialButtons showEmailCode />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-email code" }),
    );
    expect(
      screen.getByRole("textbox", { name: "email-code-email" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "continue-with-email code" }),
    );

    expect(
      screen.queryByRole("textbox", { name: "email-code-email" }),
    ).not.toBeInTheDocument();
  });

  it("re-enables Send code when the request returns an error", async () => {
    mockSendEmailCode.mockResolvedValueOnce({
      data: null,
      error: { message: "Network failure", status: 500, statusText: "Error" },
    });
    render(<SocialButtons showEmailCode />);
    const user = await openEmailCodePanel();

    await user.click(screen.getByRole("button", { name: "emailCodeSend" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "emailCodeSend" }),
      ).toBeEnabled();
    });
    expect(mockToastError).toHaveBeenCalledWith("Network failure");
  });
});

vi.mock("@/components/auth-captcha", () => import("@/test/auth-captcha-mock"));
