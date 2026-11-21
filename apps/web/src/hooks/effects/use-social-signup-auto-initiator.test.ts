import { act, renderHook, waitFor } from "@testing-library/react";
import { track } from "@vercel/analytics";
import type { useTranslations } from "next-intl";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSocialSignIn, mockLocationReplace } = vi.hoisted(() => ({
  mockSocialSignIn: vi.fn(),
  mockLocationReplace: vi.fn(),
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

import { useSocialSignupAutoInitiator } from "./use-social-signup-auto-initiator";

const t = ((key: string) => key) as unknown as ReturnType<
  typeof useTranslations<"Auth.Pages.SignUp">
>;

describe("useSocialSignupAutoInitiator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocialSignIn.mockResolvedValue({
      data: { url: "https://accounts.google.com/o/oauth2", redirect: false },
      error: null,
    });
    Object.defineProperty(window.location, "replace", {
      configurable: true,
      value: (...args: unknown[]) => mockLocationReplace(...args),
    });
  });

  it("initiates OAuth and replaces window location with a valid provider URL", async () => {
    const { result } = renderHook(() =>
      useSocialSignupAutoInitiator({
        provider: "google",
        messageKey: "Google",
        effectiveReturnUrl: "/chat",
        t,
      }),
    );

    await waitFor(() => {
      expect(mockLocationReplace).toHaveBeenCalledWith(
        "https://accounts.google.com/o/oauth2",
      );
    });
    expect(track).toHaveBeenCalledWith("Sign Up", {
      provider: "google",
      direct_signup_link: true,
    });
    expect(result.current.error).toBeNull();
    expect(result.current.isInitiating).toBe(true);
  });

  it("surfaces an error and stops initiating when the returned URL is invalid", async () => {
    mockSocialSignIn.mockResolvedValue({
      data: { url: "javascript:alert(1)", redirect: false },
      error: null,
    });

    const { result } = renderHook(() =>
      useSocialSignupAutoInitiator({
        provider: "google",
        messageKey: "Google",
        effectiveReturnUrl: undefined,
        t,
      }),
    );

    await waitFor(() => {
      expect(result.current.isInitiating).toBe(false);
    });
    expect(result.current.error).toBe("Google.error");
    expect(toast.error).toHaveBeenCalledWith("Google.error");
    expect(mockLocationReplace).not.toHaveBeenCalled();
  });

  it("clears initiating state when restored from bfcache via persisted pageshow", async () => {
    const { result } = renderHook(() =>
      useSocialSignupAutoInitiator({
        provider: "microsoft",
        messageKey: "Microsoft",
        effectiveReturnUrl: undefined,
        t,
      }),
    );

    await waitFor(() => expect(mockLocationReplace).toHaveBeenCalled());

    const persistedEvent = new Event("pageshow");
    Object.defineProperty(persistedEvent, "persisted", { value: true });
    act(() => {
      window.dispatchEvent(persistedEvent);
    });

    expect(result.current.isInitiating).toBe(false);
  });
});
