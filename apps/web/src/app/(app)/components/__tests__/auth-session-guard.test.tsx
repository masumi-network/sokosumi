import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionGuard } from "@/app/components/auth-session-guard";
import { authClient } from "@/lib/auth/auth.client";
import { SESSION_RESUME_DEBOUNCE_MS } from "@/lib/auth/auth.utils";

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

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AuthSessionGuard", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    vi.mocked(authClient.getSession).mockReset();
    vi.useRealTimers();

    window.history.replaceState({}, "", "/agents?view=grid");
  });

  afterEach(() => {
    vi.useRealTimers();
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
    vi.useFakeTimers();
    vi.mocked(authClient.getSession).mockResolvedValue(missingSession);

    render(<AuthSessionGuard />);
    await flushMicrotasks();
    await advance(250);
    await flushMicrotasks();
    await advance(750);
    await flushMicrotasks();

    expect(replaceMock).toHaveBeenCalledWith(
      "/signin?returnUrl=%2Fagents%3Fview%3Dgrid",
    );
    expect(authClient.getSession).toHaveBeenCalledTimes(3);
  });

  it("stays signed in when mount briefly returns null then a session", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(missingSession)
      .mockResolvedValueOnce(presentSession);

    render(<AuthSessionGuard />);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();

    await advance(250);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(2);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect when mount probing throws", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.getSession).mockRejectedValueOnce(
      new Error("network"),
    );

    render(<AuthSessionGuard />);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(1);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("revalidates again on focus without redirecting when the session is present", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.getSession).mockResolvedValue(presentSession);

    render(<AuthSessionGuard />);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    await advance(SESSION_RESUME_DEBOUNCE_MS);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(2);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("stays signed in when resume briefly returns null then a session", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(presentSession)
      .mockResolvedValueOnce(missingSession)
      .mockResolvedValueOnce(presentSession);

    render(<AuthSessionGuard />);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    await advance(SESSION_RESUME_DEBOUNCE_MS);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(2);

    await advance(250);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(3);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("redirects after resume retries when the session stays missing", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(presentSession)
      .mockResolvedValue(missingSession);

    render(<AuthSessionGuard />);
    await flushMicrotasks();

    window.dispatchEvent(new Event("focus"));
    await advance(SESSION_RESUME_DEBOUNCE_MS);
    await flushMicrotasks();
    await advance(250);
    await flushMicrotasks();
    await advance(750);
    await flushMicrotasks();

    expect(replaceMock).toHaveBeenCalledWith(
      "/signin?returnUrl=%2Fagents%3Fview%3Dgrid",
    );
    expect(authClient.getSession).toHaveBeenCalledTimes(4);
  });

  it("coalesces focus and visibility into a single resume probe wave", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.getSession).mockResolvedValue(presentSession);

    render(<AuthSessionGuard />);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event("focus"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));

    await advance(SESSION_RESUME_DEBOUNCE_MS);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(2);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect when resume probing throws", async () => {
    vi.useFakeTimers();
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(presentSession)
      .mockRejectedValueOnce(new Error("network"));

    render(<AuthSessionGuard />);
    await flushMicrotasks();

    window.dispatchEvent(new Event("focus"));
    await advance(SESSION_RESUME_DEBOUNCE_MS);
    await flushMicrotasks();

    expect(authClient.getSession).toHaveBeenCalledTimes(2);
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect when unmounted during an in-flight resume probe", async () => {
    vi.useFakeTimers();

    let resolveInFlightResume:
      | ((value: typeof missingSession) => void)
      | undefined;
    const inFlightResume = new Promise<typeof missingSession>((resolve) => {
      resolveInFlightResume = resolve;
    });
    let getSessionCalls = 0;

    vi.mocked(authClient.getSession).mockImplementation(() => {
      getSessionCalls += 1;
      if (getSessionCalls === 1) {
        return Promise.resolve(presentSession);
      }
      return inFlightResume;
    });

    const { unmount } = render(<AuthSessionGuard />);
    await flushMicrotasks();

    window.dispatchEvent(new Event("focus"));
    await advance(SESSION_RESUME_DEBOUNCE_MS);
    await flushMicrotasks();

    expect(getSessionCalls).toBe(2);

    unmount();
    window.history.replaceState({}, "", "/agents/other");
    resolveInFlightResume?.(missingSession);
    await flushMicrotasks();
    await advance(250);
    await flushMicrotasks();
    await advance(750);
    await flushMicrotasks();

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("does not redirect when an overlapping resume probe finds a session", async () => {
    vi.useFakeTimers();

    let resolveStaleResumeAttempt:
      | ((value: typeof missingSession) => void)
      | undefined;
    const staleResumeAttempt = new Promise<typeof missingSession>((resolve) => {
      resolveStaleResumeAttempt = resolve;
    });
    let getSessionCalls = 0;

    vi.mocked(authClient.getSession).mockImplementation(() => {
      getSessionCalls += 1;
      if (getSessionCalls === 1) {
        return Promise.resolve(presentSession);
      }
      if (getSessionCalls === 2) {
        return staleResumeAttempt;
      }
      if (getSessionCalls === 3) {
        return Promise.resolve(presentSession);
      }
      return Promise.resolve(missingSession);
    });

    render(<AuthSessionGuard />);
    await flushMicrotasks();

    window.dispatchEvent(new Event("focus"));
    await advance(SESSION_RESUME_DEBOUNCE_MS);
    await flushMicrotasks();

    expect(getSessionCalls).toBe(2);

    window.dispatchEvent(new Event("focus"));
    await advance(SESSION_RESUME_DEBOUNCE_MS);
    await flushMicrotasks();

    expect(getSessionCalls).toBe(3);
    expect(replaceMock).not.toHaveBeenCalled();

    resolveStaleResumeAttempt?.(missingSession);
    await flushMicrotasks();
    await advance(250);
    await flushMicrotasks();
    await advance(750);
    await flushMicrotasks();

    expect(replaceMock).not.toHaveBeenCalled();
  });
});
