import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { track } from "@vercel/analytics";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SocialButtons from "./social-buttons";

const mockSocialSignIn = vi.fn();
const mockPasskeySignIn = vi.fn();
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
      if (key === "passkeyProvider") {
        return "Passkey";
      }
      if (key === "lastUsed") {
        return "last-used";
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
  disabled?: boolean;
  icon?: React.ComponentType<{ size: string | number; color: string }>;
  onClick?: () => void;
  text?: string;
}

function MockSocialButton({
  className,
  disabled,
  icon: Icon,
  onClick,
  text,
}: MockSocialButtonProps) {
  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {Icon ? <Icon size="26px" color="" /> : null}
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
    vi.mocked(track).mockReset();
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

  it("tracks a social button on the sign-in page as a sign-in", async () => {
    render(<SocialButtons />);

    await clickGoogleButton();

    expect(track).toHaveBeenCalledWith("Sign In", {
      provider: "google",
      direct_signup_link: false,
    });
  });

  it("tracks a social button on the sign-up page as a sign-up", async () => {
    render(<SocialButtons eventType="signUp" />);

    await clickGoogleButton();

    expect(track).toHaveBeenCalledWith("Sign Up", {
      provider: "google",
      direct_signup_link: false,
    });
    expect(track).not.toHaveBeenCalledWith("Sign In", expect.anything());
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
  ] as const)(
    "keeps a distinct hover fill for last-used %s",
    (method, label) => {
      render(<SocialButtons showPasskey lastUsedMethod={method} />);

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
    // The marker sits beside the button, so it fades with it on its own.
    expect(lastUsedLabel).toHaveClass(
      "group-has-[:disabled]/provider:opacity-50",
    );
    expect(badgeContainer).toHaveClass("group/provider", "relative");
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

  // happy-dom ignores `persisted` in the event init.
  function pageShow(persisted: boolean) {
    const event = new Event("pageshow");
    Object.defineProperty(event, "persisted", { value: persisted });
    return event;
  }

  function getButtons() {
    return {
      google: screen.getByRole("button", { name: "continue-with-Google" }),
      microsoft: screen.getByRole("button", {
        name: "continue-with-Microsoft",
      }),
      passkey: screen.getByRole("button", { name: "continue-with-Passkey" }),
    };
  }

  it("keeps every button waiting while a social sign-in starts", async () => {
    const pending = createDeferred<object>();
    mockSocialSignIn.mockReturnValue(pending.promise);
    render(<SocialButtons showPasskey />);
    const { google, microsoft, passkey } = getButtons();

    await clickGoogleButton();

    expect(google).toBeDisabled();
    expect(microsoft).toBeDisabled();
    expect(passkey).toBeDisabled();
    expect(google.querySelector("svg.animate-spin")).not.toBeNull();
    expect(microsoft.querySelector("svg")).toBeNull();
    expect(passkey.querySelector("svg.animate-spin")).toBeNull();

    // Success means the browser is leaving for the provider: stay busy.
    await act(async () => pending.resolve({}));
    expect(google).toBeDisabled();
    expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["an error", () => mockSocialSignIn.mockResolvedValue({ error: {} })],
    ["a thrown request", () => mockSocialSignIn.mockRejectedValue(new Error())],
  ])("frees the buttons again after %s", async (_case, arrange) => {
    arrange();
    render(<SocialButtons showPasskey />);
    const { google, microsoft, passkey } = getButtons();

    await clickGoogleButton();

    await waitFor(() => expect(google).toBeEnabled());
    expect(microsoft).toBeEnabled();
    expect(passkey).toBeEnabled();
    expect(google.querySelector("svg")).toBeNull();
    expect(mockToastError).toHaveBeenCalledWith("error");
  });

  it("frees the buttons when Back restores the page mid sign-in", async () => {
    mockSocialSignIn.mockReturnValue(createDeferred<object>().promise);
    render(<SocialButtons showPasskey />);
    const { google, microsoft } = getButtons();

    await clickGoogleButton();
    expect(google).toBeDisabled();

    await act(async () => {
      window.dispatchEvent(pageShow(false));
    });
    expect(google).toBeDisabled();

    await act(async () => {
      window.dispatchEvent(pageShow(true));
    });
    expect(google).toBeEnabled();
    expect(microsoft).toBeEnabled();
    expect(google.querySelector("svg")).toBeNull();
  });

  it("keeps the social buttons waiting while a passkey sign-in runs", async () => {
    const user = userEvent.setup();
    const pending = createDeferred<{ data: null; error: { code: string } }>();
    mockPasskeySignIn.mockReturnValue(pending.promise);
    render(<SocialButtons showPasskey />);
    const { google, microsoft, passkey } = getButtons();

    await user.click(passkey);

    expect(passkey).toBeDisabled();
    expect(google).toBeDisabled();
    expect(microsoft).toBeDisabled();
    expect(google.querySelector("svg")).toBeNull();

    await act(async () =>
      pending.resolve({ data: null, error: { code: "AUTH_CANCELLED" } }),
    );
    expect(google).toBeEnabled();
    expect(passkey).toBeEnabled();
  });

  it("waits while another sign-in on the page starts", async () => {
    render(<SocialButtons showPasskey disabled />);
    const { google, microsoft, passkey } = getButtons();

    expect(google).toBeDisabled();
    expect(microsoft).toBeDisabled();
    expect(passkey).toBeDisabled();
    await act(async () => google.click());
    expect(mockSocialSignIn).not.toHaveBeenCalled();
    expect(google.querySelector("svg")).toBeNull();
  });

  it("reports while a sign-in started here is running", async () => {
    const onPendingChange = vi.fn();
    mockSocialSignIn.mockResolvedValue({ error: {} });
    render(<SocialButtons onPendingChange={onPendingChange} />);
    expect(onPendingChange).not.toHaveBeenCalled();

    await clickGoogleButton();

    expect(onPendingChange).toHaveBeenCalledWith(true);
    await waitFor(() =>
      expect(onPendingChange).toHaveBeenLastCalledWith(false),
    );
  });

  it("renders the passkey button after Microsoft", () => {
    render(<SocialButtons showPasskey />);

    const buttons = screen.getAllByRole("button");

    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveTextContent("continue-with-Google");
    expect(buttons[1]).toHaveTextContent("continue-with-Microsoft");
    expect(buttons[2]).toHaveTextContent("continue-with-Passkey");
  });

  it("signs in with a passkey and redirects to the return url", async () => {
    const user = userEvent.setup();

    render(<SocialButtons returnUrl="/jobs" showPasskey />);

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

  // simplewebauthn's codes, which Better Auth passes on: a dismissed or
  // timed-out prompt (NotAllowedError), and a prompt another ceremony replaced.
  it.each(["ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", "ERROR_CEREMONY_ABORTED"])(
    "shows no error when the browser's passkey prompt ends with %s",
    async (code) => {
      const user = userEvent.setup();
      mockPasskeySignIn.mockResolvedValue({ data: null, error: { code } });

      render(<SocialButtons returnUrl="/jobs" showPasskey />);
      const passkey = screen.getByRole("button", {
        name: "continue-with-Passkey",
      });
      await user.click(passkey);

      await waitFor(() => expect(passkey).toBeEnabled());
      expect(mockToastError).not.toHaveBeenCalled();
    },
  );

  it("still reports a passkey the authenticator could not use", async () => {
    const user = userEvent.setup();
    mockPasskeySignIn.mockResolvedValue({
      data: null,
      error: { code: "ERROR_AUTHENTICATOR_GENERAL_ERROR" },
    });

    render(<SocialButtons returnUrl="/jobs" showPasskey />);
    await user.click(
      screen.getByRole("button", { name: "continue-with-Passkey" }),
    );

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("passkeyError");
    });
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
});
