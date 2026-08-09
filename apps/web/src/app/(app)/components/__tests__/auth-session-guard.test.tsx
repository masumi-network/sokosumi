import { act, render, waitFor } from "@testing-library/react";
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

const presentSession = {
  data: {
    session: {
      activeOrganizationId: null,
    },
  },
  error: null,
};

const missingSession = {
  data: null,
  error: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe("AuthSessionGuard", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    vi.mocked(authClient.getSession).mockReset();

    window.history.replaceState({}, "", "/agents?view=grid");
  });

  it("revalidates the session without cookie cache on mount", async () => {
    vi.mocked(authClient.getSession).mockResolvedValue(presentSession);

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
    vi.mocked(authClient.getSession).mockResolvedValue(missingSession);

    render(<AuthSessionGuard />);

    await waitFor(() => {
      expect(replaceMock).toHaveBeenCalledWith(
        "/signin?returnUrl=%2Fagents%3Fview%3Dgrid",
      );
    });
  });

  it("revalidates again on focus without redirecting when the session is present", async () => {
    vi.mocked(authClient.getSession).mockResolvedValue(presentSession);

    render(<AuthSessionGuard />);

    window.dispatchEvent(new Event("focus"));

    await waitFor(() => {
      expect(authClient.getSession).toHaveBeenCalledTimes(2);
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("ignores a slower null probe after a newer probe confirms the session", async () => {
    const mountProbe = deferred<typeof presentSession>();
    const staleProbe = deferred<typeof missingSession>();
    const freshProbe = deferred<typeof presentSession>();

    vi.mocked(authClient.getSession)
      .mockImplementationOnce(() => mountProbe.promise)
      .mockImplementationOnce(() => staleProbe.promise)
      .mockImplementationOnce(() => freshProbe.promise);

    render(<AuthSessionGuard />);

    await act(async () => {
      mountProbe.resolve(presentSession);
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        get: () => "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
      await Promise.resolve();
    });

    expect(authClient.getSession).toHaveBeenCalledTimes(3);

    await act(async () => {
      freshProbe.resolve(presentSession);
      await Promise.resolve();
    });

    await act(async () => {
      staleProbe.resolve(missingSession);
      await Promise.resolve();
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect from an in-flight null probe after unmount", async () => {
    const mountProbe = deferred<typeof presentSession>();
    const resumeProbe = deferred<typeof missingSession>();

    vi.mocked(authClient.getSession)
      .mockImplementationOnce(() => mountProbe.promise)
      .mockImplementationOnce(() => resumeProbe.promise);

    const view = render(<AuthSessionGuard />);

    await act(async () => {
      mountProbe.resolve(presentSession);
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });

    expect(authClient.getSession).toHaveBeenCalledTimes(2);

    view.unmount();

    await act(async () => {
      resumeProbe.resolve(missingSession);
      await Promise.resolve();
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
