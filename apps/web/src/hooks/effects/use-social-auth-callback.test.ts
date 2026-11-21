import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockReplace, mockSignIn, mockSignUp, mockClaimSignUp, mockWait } =
  vi.hoisted(() => ({
    mockReplace: vi.fn(),
    mockSignIn: vi.fn(),
    mockSignUp: vi.fn(),
    mockClaimSignUp: vi.fn(),
    mockWait: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/lib/actions/auth/action", () => ({
  claimSignUpConversion: () => mockClaimSignUp(),
}));

vi.mock("@/lib/auth/finish-auth.client", () => ({
  waitForClientSession: (...args: unknown[]) => mockWait(...args),
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    signIn: (...args: unknown[]) => mockSignIn(...args),
    signUp: (...args: unknown[]) => mockSignUp(...args),
  },
}));

import { useSocialAuthCallback } from "./use-social-auth-callback";

describe("useSocialAuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWait.mockResolvedValue({ id: "session-1" });
    mockClaimSignUp.mockResolvedValue("google");
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  it("fires sign-in GTM event and replaces route to returnUrl when session exists", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback/signin?provider=google&returnUrl=%2Ftasks",
    );

    renderHook(() => useSocialAuthCallback("signIn"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/tasks");
    });
    expect(mockSignIn).toHaveBeenCalledWith("google");
    expect(mockClaimSignUp).not.toHaveBeenCalled();
  });

  it("claims conversion and fires sign-up GTM event on signUp", async () => {
    window.history.replaceState(
      {},
      "",
      "/auth/callback/signup?provider=microsoft",
    );

    renderHook(() => useSocialAuthCallback("signUp"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(mockClaimSignUp).toHaveBeenCalledTimes(1);
    expect(mockSignUp).toHaveBeenCalledWith("google");
  });

  it("skips session wait for invalid providers and still forwards", async () => {
    window.history.replaceState({}, "", "/auth/callback/signin?provider=bogus");

    renderHook(() => useSocialAuthCallback("signIn"));

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(mockWait).not.toHaveBeenCalled();
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
