import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SocialAuthCallback from "./social-auth-callback";

const mockReplace = vi.fn();
const mockSignIn = vi.fn();
const mockSignUp = vi.fn();
const mockClaimSignUpConversion = vi.fn();

vi.mock("@/lib/actions/auth/action", () => ({
  claimSignUpConversion: () => mockClaimSignUpConversion(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

const mockGetSession = vi.fn();

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: { getSession: () => mockGetSession() },
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    signIn: (...args: unknown[]) => mockSignIn(...args),
    signUp: (...args: unknown[]) => mockSignUp(...args),
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
}));

describe("SocialAuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      data: { session: { id: "session-1" } },
      error: null,
    });
    mockClaimSignUpConversion.mockResolvedValue("microsoft");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  function setSearch(search: string) {
    window.history.replaceState({}, "", `/auth/callback/signin${search}`);
  }

  it.each(["credential", "email-otp", "passkey", "google"] as const)(
    "fires login for provider=%s and forwards to returnUrl",
    async (provider) => {
      setSearch(`?provider=${provider}&returnUrl=%2Fchat`);

      render(<SocialAuthCallback eventType="signIn" />);

      await waitFor(() => {
        expect(mockReplace).toHaveBeenCalledWith("/chat");
      });
      expect(mockSignIn).toHaveBeenCalledWith(provider);
      expect(mockSignUp).not.toHaveBeenCalled();
    },
  );

  it("fires sign_up for the social sign-up it claims", async () => {
    setSearch("?provider=microsoft");

    render(<SocialAuthCallback eventType="signUp" />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(mockClaimSignUpConversion).toHaveBeenCalledTimes(1);
    expect(mockSignUp).toHaveBeenCalledWith("microsoft");
  });

  it("fires no second sign_up for a sign-up another page already counted", async () => {
    mockClaimSignUpConversion.mockResolvedValue(null);
    setSearch("?provider=microsoft");

    render(<SocialAuthCallback eventType="signUp" />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(mockSignUp).not.toHaveBeenCalled();
  });

  it("claims no sign-up on the sign-in callback", async () => {
    setSearch("?provider=google");

    render(<SocialAuthCallback eventType="signIn" />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(mockClaimSignUpConversion).not.toHaveBeenCalled();
  });

  it("fires login when the session appears on retry", async () => {
    mockGetSession
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: { session: { id: "session-1" } },
        error: null,
      });
    setSearch("?provider=credential&returnUrl=%2Fchat");

    render(<SocialAuthCallback eventType="signIn" />);

    await waitFor(
      () => {
        expect(mockSignIn).toHaveBeenCalledWith("credential");
      },
      { timeout: 2000 },
    );
    expect(mockReplace).toHaveBeenCalledWith("/chat");
    expect(mockGetSession).toHaveBeenCalledTimes(2);
  });

  it("fires nothing without a session but still forwards", async () => {
    mockGetSession.mockResolvedValue({ data: null, error: null });
    setSearch("?provider=credential&returnUrl=%2Fchat");

    render(<SocialAuthCallback eventType="signIn" />);

    await waitFor(
      () => {
        expect(mockReplace).toHaveBeenCalledWith("/chat");
      },
      { timeout: 2000 },
    );
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it("fires nothing for an unknown provider but still forwards", async () => {
    setSearch("?provider=evil");

    render(<SocialAuthCallback eventType="signIn" />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
