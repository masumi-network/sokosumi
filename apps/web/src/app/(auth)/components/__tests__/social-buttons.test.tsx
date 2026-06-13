import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SocialButtons from "../social-buttons";

const {
  buildOAuthConsentReturnUrlFromSearchParams:
    actualBuildOAuthConsentReturnUrlFromSearchParams,
} = await vi.importActual<typeof import("@/lib/auth/auth.utils")>(
  "@/lib/auth/auth.utils",
);

const mockSocialSignIn = vi.fn();
const mockPasskeySignIn = vi.fn();
const mockMagicLinkSignIn = vi.fn();
const mockToastError = vi.fn();
const mockRouterReplace = vi.fn();
const mockGetSession = vi.fn();
const mockIsConditionalMediationAvailable = vi.fn();

interface MockWaitForAuthSessionOptions {
  getSession: () => Promise<null | { id: string }>;
}

const mockWaitForAuthSession = vi.fn(
  async (_options: MockWaitForAuthSessionOptions) => undefined,
);

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
      magicLink: (...args: unknown[]) => mockMagicLinkSignIn(...args),
    },
  },
}));

vi.mock("@/lib/actions/auth", () => ({}));

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
    mockMagicLinkSignIn.mockReset();
    mockMagicLinkSignIn.mockResolvedValue({ data: null, error: null });
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

  it("shows an inline marker on the magic-link button", () => {
    render(<SocialButtons showMagicLink lastUsedMethod="magic-link" />);

    const button = screen.getByRole("button", {
      name: "continue-with-Magic Link",
    });
    const lastUsedLabel = screen.getByText("last-used");
    const badgeContainer = button.parentElement;

    expect(lastUsedLabel).toBeInTheDocument();
    expect(lastUsedLabel).toHaveClass("absolute", "top-1.5", "right-2");
    expect(button).toHaveClass("border-primary/60", "bg-primary/10");
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
    expect(button).toHaveClass("border-primary/60", "bg-primary/10");
    expect(badgeContainer).toHaveClass("relative");
    expect(badgeContainer).toContainElement(lastUsedLabel);
  });

  it("builds oauth consent returnUrl from signed query when prop is missing", async () => {
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

    expect(mockRouterReplace).not.toHaveBeenCalled();

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
      expect(mockRouterReplace).toHaveBeenCalledWith("/profile");
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
      expect(mockMagicLinkSignIn).toHaveBeenCalledWith({
        email: "login-user@example.com",
        callbackURL: "/",
      });
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
      scope: "openid",
      state: "test-state",
      response_type: "code",
      exp: "1772367377",
      sig: "signed-value",
    });

    render(<SocialButtons showMagicLink />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Magic Link" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "magic-link-email" }),
      {
        target: { value: "oauth-login-user@example.com" },
      },
    );
    await user.click(screen.getByRole("button", { name: "magicLinkSubmit" }));

    await waitFor(() => {
      expect(mockMagicLinkSignIn).toHaveBeenCalledTimes(1);
    });

    expect(mockMagicLinkSignIn.mock.calls[0]?.[0]?.email).toBe(
      "oauth-login-user@example.com",
    );
    expect(mockMagicLinkSignIn.mock.calls[0]?.[0]?.callbackURL).toContain(
      "/oauth/consent?",
    );
    expect(mockMagicLinkSignIn.mock.calls[0]?.[0]?.callbackURL).toContain(
      "client_id=test-client",
    );
    expect(mockMagicLinkSignIn.mock.calls[0]?.[0]?.callbackURL).toContain(
      "redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback",
    );
  });

  it("re-enables magic-link submit when the request rejects", async () => {
    const user = userEvent.setup();
    let rejectRequest: ((reason?: unknown) => void) | undefined;

    mockMagicLinkSignIn.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );

    render(<SocialButtons showMagicLink />);

    await user.click(
      screen.getByRole("button", { name: "continue-with-Magic Link" }),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "magic-link-email" }),
      {
        target: { value: "login-user@example.com" },
      },
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
