import "@testing-library/jest-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import SocialButtons from "../social-buttons";

const {
  buildOAuthConsentReturnUrlFromSearchParams:
    actualBuildOAuthConsentReturnUrlFromSearchParams,
} = jest.requireActual(
  "@/lib/utils/auth-redirect",
) as typeof import("@/lib/utils/auth-redirect");

const mockSocialSignIn = jest.fn();
const mockPasskeySignIn = jest.fn();
const mockRequestMagicLinkSignIn = jest.fn();
const mockToastError = jest.fn();
const mockRouterReplace = jest.fn();
const mockGetSession = jest.fn();
const mockIsConditionalMediationAvailable = jest.fn();
const mockWaitForAuthSession = jest.fn(() => Promise.resolve());

let mockSearchParams = new URLSearchParams();

jest.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: mockRouterReplace,
  }),
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

jest.mock("next-intl", () => ({
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
      if (key === "magicLinkProvider") {
        return "Magic Link";
      }
      if (key === "passkeyProvider") {
        return "Passkey";
      }
      if (key === "lastUsed") {
        return "last-used";
      }
      if (key === "magicLinkInputLabel") {
        return "magic-link-email";
      }
      return key;
    };

    translator.has = (key: string) => key === "lastUsed";

    return translator;
  },
}));

jest.mock("@vercel/analytics", () => ({
  track: jest.fn(),
}));

jest.mock("sonner", () => ({
  toast: {
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));

jest.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: (...args: unknown[]) => mockGetSession(...args),
    signIn: {
      passkey: (...args: unknown[]) => mockPasskeySignIn(...args),
      social: (...args: unknown[]) => mockSocialSignIn(...args),
    },
  },
}));

jest.mock("@/lib/actions/auth", () => ({
  requestMagicLinkSignIn: (...args: unknown[]) =>
    mockRequestMagicLinkSignIn(...args),
}));

jest.mock("@/lib/utils/auth-redirect", () => {
  const actual = jest.requireActual(
    "@/lib/utils/auth-redirect",
  ) as typeof import("@/lib/utils/auth-redirect");

  return {
    ...actual,
    normalizeAuthReturnUrl: (value?: string) => value ?? "/chat",
    waitForAuthSession: (...args: unknown[]) => mockWaitForAuthSession(...args),
  };
});

interface MockSocialButtonProps {
  onClick?: () => void;
  text?: string;
}

function MockSocialButton({ onClick, text }: MockSocialButtonProps) {
  return (
    <button type="button" onClick={onClick}>
      {text}
    </button>
  );
}

jest.mock("react-social-login-buttons", () => ({
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
    mockRequestMagicLinkSignIn.mockReset();
    mockRequestMagicLinkSignIn.mockResolvedValue({ ok: true });
    mockToastError.mockReset();
    mockRouterReplace.mockReset();
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
    mockWaitForAuthSession.mockResolvedValue(undefined);
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

  it("shows last used badge for matching provider", () => {
    render(<SocialButtons lastUsedMethod="google" />);

    expect(screen.getByText("last-used")).toBeInTheDocument();
  });

  it("shows last used badge for magic-link button", () => {
    render(<SocialButtons showMagicLink lastUsedMethod="magic-link" />);

    expect(screen.getByText("last-used")).toBeInTheDocument();
  });

  it("shows last used badge for passkey button", () => {
    render(<SocialButtons showPasskey lastUsedMethod="passkey" />);

    expect(screen.getByText("last-used")).toBeInTheDocument();
  });

  it("builds oauth consent returnUrl from signed query when prop is missing", async () => {
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://consumer.example.com/callback",
      code_challenge: "test-challenge",
      code_challenge_method: "S256",
      scope: "openid offline_access",
      state: "test-state",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
    });

    const expectedReturnUrl = actualBuildOAuthConsentReturnUrlFromSearchParams(
      new URLSearchParams(mockSearchParams.toString()),
    );

    render(<SocialButtons />);

    await clickGoogleButton();

    await waitFor(() => {
      expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
    });

    expect(getSubmittedReturnUrls()).toEqual({
      callbackReturnUrl: expectedReturnUrl,
      newUserCallbackReturnUrl: expectedReturnUrl,
    });
  });

  it("renders the passkey button between Microsoft and Magic Link", () => {
    render(<SocialButtons showMagicLink showPasskey />);

    const buttons = screen.getAllByRole("button");

    expect(buttons[0]).toHaveTextContent("continue-with-Google");
    expect(buttons[1]).toHaveTextContent("continue-with-Microsoft");
    expect(buttons[2]).toHaveTextContent("continue-with-Passkey");
    expect(buttons[3]).toHaveTextContent("continue-with-Magic Link");
  });

  it("signs in with a passkey and redirects to the return url", async () => {
    const user = userEvent.setup();

    render(<SocialButtons returnUrl="/jobs" showMagicLink showPasskey />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Passkey" }),
    );

    await waitFor(() => {
      expect(mockPasskeySignIn).toHaveBeenCalledWith({
        autoFill: false,
      });
    });

    await waitFor(() => {
      expect(mockRouterReplace).toHaveBeenCalledWith("/jobs");
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

    const waitForAuthSessionOptions = mockWaitForAuthSession.mock.calls[0]?.[0] as {
      getSession: () => Promise<null | { id: string }>;
    };

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

  it("reveals the magic-link panel and requests a Magic Link", async () => {
    const user = userEvent.setup();

    render(<SocialButtons showMagicLink />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Magic Link" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "magic-link-email" }),
      "login-user@example.com",
    );
    await user.click(screen.getByRole("button", { name: "magicLinkSubmit" }));

    await waitFor(() => {
      expect(mockRequestMagicLinkSignIn).toHaveBeenCalledWith(
        "login-user@example.com",
        undefined,
      );
    });

    expect(screen.getByText("magicLinkSuccess")).toHaveClass("text-center");
  });

  it("hides the magic-link panel when the trigger is clicked again", async () => {
    const user = userEvent.setup();

    render(<SocialButtons showMagicLink />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Magic Link" }),
    );
    expect(
      screen.getByRole("textbox", { name: "magic-link-email" }),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "continue-with-Magic Link" }),
    );

    expect(
      screen.queryByRole("textbox", { name: "magic-link-email" }),
    ).not.toBeInTheDocument();
  });

  it("passes signed OAuth returnUrl when requesting a magic link", async () => {
    const user = userEvent.setup();
    mockSearchParams = new URLSearchParams({
      client_id: "test-client",
      redirect_uri: "https://consumer.example.com/callback",
      code_challenge: "test-challenge",
      code_challenge_method: "S256",
      scope: "openid offline_access",
      state: "test-state",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
    });

    render(<SocialButtons showMagicLink />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Magic Link" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "magic-link-email" }),
      "oauth-login-user@example.com",
    );
    await user.click(screen.getByRole("button", { name: "magicLinkSubmit" }));

    await waitFor(() => {
      expect(mockRequestMagicLinkSignIn).toHaveBeenCalledTimes(1);
    });

    expect(mockRequestMagicLinkSignIn.mock.calls[0]?.[0]).toBe(
      "oauth-login-user@example.com",
    );
    expect(mockRequestMagicLinkSignIn.mock.calls[0]?.[1]).toContain(
      "/oauth/consent?",
    );
    expect(mockRequestMagicLinkSignIn.mock.calls[0]?.[1]).toContain(
      "client_id=test-client",
    );
    expect(mockRequestMagicLinkSignIn.mock.calls[0]?.[1]).toContain(
      "redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback",
    );
  });

  it("re-enables magic-link submit when the request rejects", async () => {
    const user = userEvent.setup();
    let rejectRequest: ((reason?: unknown) => void) | undefined;

    mockRequestMagicLinkSignIn.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );

    render(<SocialButtons showMagicLink />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Magic Link" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "magic-link-email" }),
      "login-user@example.com",
    );
    await user.click(screen.getByRole("button", { name: "magicLinkSubmit" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "magicLinkSubmitting" }),
      ).toBeDisabled();
    });

    await act(async () => {
      rejectRequest?.(new Error("Network failure"));
    });

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "magicLinkSubmit" }),
      ).toBeEnabled();
    });

    expect(mockToastError).toHaveBeenCalledWith("magicLinkError");
  });
});
