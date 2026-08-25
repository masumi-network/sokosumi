import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SocialAuthCallback from "../social-auth-callback";

const mockReplace = vi.fn();
const mockSignIn = vi.fn();
const mockSignUp = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock("@/lib/gtm-events", () => ({
  fireGTMEvent: {
    signIn: (...args: unknown[]) => mockSignIn(...args),
    signUp: (...args: unknown[]) => mockSignUp(...args),
  },
}));

describe("SocialAuthCallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    window.history.replaceState({}, "", "/");
  });

  function setSearch(search: string) {
    window.history.replaceState({}, "", `/auth/callback/signin${search}`);
  }

  it.each(["credential", "magic-link", "passkey", "google"] as const)(
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

  it("fires sign_up on the signup callback", async () => {
    setSearch("?provider=microsoft");

    render(<SocialAuthCallback eventType="signUp" />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/");
    });
    expect(mockSignUp).toHaveBeenCalledWith("microsoft");
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
