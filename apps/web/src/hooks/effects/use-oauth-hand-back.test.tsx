import { act, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockContinue, mockClaimSignUpConversion, mockSignUpEvent } = vi.hoisted(
  () => ({
    mockContinue: vi.fn(),
    mockClaimSignUpConversion: vi.fn(),
    mockSignUpEvent: vi.fn(),
  }),
);

vi.mock("@/lib/actions/auth/action", () => ({
  claimSignUpConversion: () => mockClaimSignUpConversion(),
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    signUp: (...args: unknown[]) => mockSignUpEvent(...args),
  },
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    oauth2: {
      continue: (...args: unknown[]) => mockContinue(...args),
    },
  },
}));

import { useOAuthHandBack } from "./use-oauth-hand-back";

describe("useOAuthHandBack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClaimSignUpConversion.mockResolvedValue(null);
    mockContinue.mockResolvedValue({
      data: { redirect: true, url: "https://app.cmo.xyz/callback?code=abc" },
      error: null,
    });
  });

  it("auto-starts exactly once under StrictMode when autoStart is true", async () => {
    mockClaimSignUpConversion.mockResolvedValue("google");

    renderHook(() => useOAuthHandBack("client_id=cmo", { autoStart: true }), {
      wrapper: StrictMode,
    });

    await waitFor(() => {
      expect(mockContinue).toHaveBeenCalledWith({
        created: true,
        oauth_query: "client_id=cmo",
      });
    });
    expect(mockContinue).toHaveBeenCalledTimes(1);
    expect(mockSignUpEvent).toHaveBeenCalledWith("google");
  });

  it("does not auto-start when autoStart is omitted and marks failure when provider refuses", async () => {
    mockContinue.mockResolvedValue({
      data: null,
      error: { status: 400, message: "invalid_signature" },
    });

    const { result } = renderHook(() => useOAuthHandBack("client_id=cmo"));
    expect(mockContinue).not.toHaveBeenCalled();

    act(() => {
      result.current.handBack();
    });

    await waitFor(() => {
      expect(result.current.hasFailed).toBe(true);
    });
  });
});
