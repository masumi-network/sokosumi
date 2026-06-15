import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildOAuthConsentReturnUrlFromSearchParams } from "@/lib/auth/auth.utils";

import SocialSignupAutoInitiator from "../social-signup-auto-initiator";

const mockSocialSignIn = vi.fn();

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
    mockSocialSignIn.mockResolvedValue({});
    mockSearchParams = new URLSearchParams();
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

  it("builds oauth consent returnUrl from signed query when returnUrl is missing", async () => {
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

    const expectedReturnUrl = buildOAuthConsentReturnUrlFromSearchParams(
      new URLSearchParams(mockSearchParams.toString()),
    );

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
});
