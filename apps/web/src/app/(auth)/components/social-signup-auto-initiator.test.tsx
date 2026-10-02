import { act, render, screen, waitFor } from "@testing-library/react";
import { track } from "@vercel/analytics";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SocialSignupAutoInitiator from "./social-signup-auto-initiator";

const mockSocialSignIn = vi.fn();
const mockLocationReplace = vi.fn();

let mockSearchParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useSearchParams: () => mockSearchParams as unknown as URLSearchParams,
}));

vi.mock("next-intl", () => ({
  useTranslations: () => {
    return (key: string) => key;
  },
}));

vi.mock("@vercel/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    signIn: {
      social: (...args: unknown[]) => mockSocialSignIn(...args),
    },
  },
}));

describe("SocialSignupAutoInitiator", () => {
  beforeEach(() => {
    mockSocialSignIn.mockReset();
    mockSocialSignIn.mockResolvedValue({
      data: { url: "https://accounts.google.com/o/oauth2", redirect: false },
      error: null,
    });
    vi.mocked(track).mockReset();
    mockSearchParams = new URLSearchParams();
    mockLocationReplace.mockReset();
    Object.defineProperty(window.location, "replace", {
      configurable: true,
      value: (...args: unknown[]) => mockLocationReplace(...args),
    });
  });

  it("tracks a direct sign-up link as a sign-up", async () => {
    render(
      <SocialSignupAutoInitiator
        provider="microsoft"
        providerName="Microsoft"
      />,
    );

    await waitFor(() => {
      expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
    });
    expect(track).toHaveBeenCalledWith("Sign Up", {
      provider: "microsoft",
      direct_signup_link: true,
    });
    expect(track).not.toHaveBeenCalledWith("Sign In", expect.anything());
  });

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

  it("uses explicit returnUrl from query for both callbacks", async () => {
    mockSearchParams = new URLSearchParams({
      returnUrl: "/oauth/consent?client_id=explicit-client",
    });

    render(
      <SocialSignupAutoInitiator provider="google" providerName="Google" />,
    );

    await waitFor(() => {
      expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
    });

    expect(getSubmittedReturnUrls()).toEqual({
      callbackReturnUrl: "/oauth/consent?client_id=explicit-client",
      newUserCallbackReturnUrl: "/oauth/consent?client_id=explicit-client",
    });
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

    const expectedReturnUrl =
      "/signin?client_id=test-client&redirect_uri=https%3A%2F%2Fconsumer.example.com%2Fcallback&code_challenge=test-challenge&code_challenge_method=S256&scope=openid&state=test-state&response_type=code&exp=1772367377&sig=signed-value";

    render(
      <SocialSignupAutoInitiator provider="google" providerName="Google" />,
    );

    await waitFor(() => {
      expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
    });

    expect(getSubmittedReturnUrls()).toEqual({
      callbackReturnUrl: expectedReturnUrl,
      newUserCallbackReturnUrl: expectedReturnUrl,
    });
  });

  it("sends a failed sign-in to the sign-up page, not back into the auto start", async () => {
    const startPage = window.location.href;
    window.history.replaceState(null, "", "/auth/google?returnUrl=%2Fchat");
    try {
      render(
        <SocialSignupAutoInitiator provider="google" providerName="Google" />,
      );

      await waitFor(() => {
        expect(mockSocialSignIn).toHaveBeenCalledTimes(1);
      });
      expect(mockSocialSignIn.mock.calls[0]?.[0]).toMatchObject({
        errorCallbackURL: `${window.location.origin}/signup?returnUrl=%2Fchat`,
      });
    } finally {
      window.history.replaceState(null, "", startPage);
    }
  });

  // Back from the provider would land here and start it again, or, restored
  // from the back/forward cache, spin with nothing left to run.
  it("replaces this page with the provider, so Back skips it", async () => {
    render(
      <SocialSignupAutoInitiator provider="google" providerName="Google" />,
    );

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2",
      );
    });
    expect(mockSocialSignIn.mock.calls[0]?.[0]).toMatchObject({
      disableRedirect: true,
    });
  });

  it("offers to start again when the page comes back from the back/forward cache", async () => {
    render(
      <SocialSignupAutoInitiator provider="google" providerName="Google" />,
    );
    await waitFor(() => expect(mockLocationReplace).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Google.retry" })).toBeNull();

    const restored = new Event("pageshow");
    Object.defineProperty(restored, "persisted", { value: true });
    act(() => {
      window.dispatchEvent(restored);
    });

    expect(screen.getByRole("button", { name: "Google.retry" })).toBeVisible();
  });
});
