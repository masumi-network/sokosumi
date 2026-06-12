import { render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionGuard } from "@/app/components/auth-session-guard";

const replaceMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

describe("AuthSessionGuard", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);

    window.history.replaceState({}, "", "/agents?view=grid");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("revalidates the session without cookie cache on mount", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        session: {
          activeOrganizationId: null,
        },
      }),
    });

    render(<AuthSessionGuard />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", {
        cache: "no-store",
        credentials: "include",
      });
    });
  });

  it("redirects to sign-in when the session is missing", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ session: null }),
    });

    render(<AuthSessionGuard />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/signin?returnUrl=%2Fagents%3Fview%3Dgrid",
      );
    });
  });

  it("revalidates again on focus without redirecting when the session is present", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        session: {
          activeOrganizationId: null,
        },
      }),
    });

    render(<AuthSessionGuard />);

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
