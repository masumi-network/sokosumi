import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionGuard } from "@/app/components/auth-session-guard";
import { authClient } from "@/lib/auth/auth.client";

const replaceMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: vi.fn(),
  },
}));

describe("AuthSessionGuard", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    vi.mocked(authClient.getSession).mockReset();

    window.history.replaceState({}, "", "/agents?view=grid");
  });

  it("revalidates the session without cookie cache on mount", async () => {
    vi.mocked(authClient.getSession).mockResolvedValue({
      data: {
        session: {
          activeOrganizationId: null,
        },
      },
      error: null,
    });

    render(<AuthSessionGuard />);

    await waitFor(() => {
      expect(authClient.getSession).toHaveBeenCalledWith({
        query: {
          disableCookieCache: true,
        },
      });
    });
  });

  it("redirects to sign-in when the session is missing", async () => {
    vi.mocked(authClient.getSession).mockResolvedValue({
      data: null,
      error: null,
    });

    render(<AuthSessionGuard />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/signin?returnUrl=%2Fagents%3Fview%3Dgrid",
      );
    });
  });

  it("revalidates again on focus without redirecting when the session is present", async () => {
    vi.mocked(authClient.getSession).mockResolvedValue({
      data: {
        session: {
          activeOrganizationId: null,
        },
      },
      error: null,
    });

    render(<AuthSessionGuard />);

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(authClient.getSession).toHaveBeenCalledTimes(2);
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
