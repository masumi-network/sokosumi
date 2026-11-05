import type { Session } from "@sokosumi/utils";
import { act, render, waitFor } from "@testing-library/react";
import type Ably from "ably";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionGuard } from "@/app/components/auth-session-guard";
import { AuthSessionHydrator } from "@/app/components/auth-session-hydrator.client";
import {
  discardRetiredAblyRealtimeClient,
  getAblyRealtimeClient,
  subscribeToAblyRealtimeClient,
} from "@/lib/ably/realtime-singleton.client";
import { authClient } from "@/lib/auth/auth.client";

const replaceMock = vi.fn();
const { RealtimeMock } = vi.hoisted(() => ({
  RealtimeMock: vi.fn(function Realtime(
    this: { close: ReturnType<typeof vi.fn> },
    _options: { authCallback: NonNullable<Ably.AuthOptions["authCallback"]> },
  ) {
    this.close = vi.fn();
    return this;
  }),
}));

vi.mock("ably", () => ({ default: { Realtime: RealtimeMock } }));
vi.mock("ably/push", () => ({ default: {} }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    replace: replaceMock,
  }),
}));

vi.mock("@/lib/auth/auth.client", () => ({
  authClient: {
    getSession: vi.fn(),
    hydrateSession: vi.fn(),
  },
}));

const presentSession = {
  data: {
    session: {
      activeOrganizationId: null,
      userId: "alice",
    },
  },
  error: null,
};

const renderedSession: Session = {
  user: {
    id: "alice",
    name: "Alice",
    email: "alice@example.com",
    emailVerified: true,
    image: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    termsAccepted: true,
    marketingOptIn: false,
  },
  session: {
    id: "session-alice",
    userId: "alice",
    token: "token-alice",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-02-01T00:00:00.000Z",
    activeOrganizationId: null,
  },
};

const differentUserSession = {
  data: {
    session: { ...presentSession.data.session, userId: "bob" },
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

/** Exercise the real singleton's retirement through failed token requests. */
async function retireRealtimeClient() {
  const client = getAblyRealtimeClient();
  const callback = RealtimeMock.mock.calls[0]?.[0].authCallback;
  if (!callback) throw new Error("Realtime auth callback missing");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await new Promise<void>((resolve) => callback({}, () => resolve()));
  }
  expect(RealtimeMock.mock.instances[0]?.close).toHaveBeenCalledOnce();
  return client;
}

describe("AuthSessionGuard", () => {
  beforeEach(() => {
    replaceMock.mockReset();
    vi.mocked(authClient.getSession).mockReset();
    globalThis.__sokosumiAblyRealtimeClient = undefined;
    discardRetiredAblyRealtimeClient();
    RealtimeMock.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    window.history.replaceState({}, "", "/agents?view=grid");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
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

  it("keeps the authenticated page during a structured session outage", async () => {
    vi.mocked(authClient.getSession).mockResolvedValue({
      data: null,
      error: {
        status: 503,
        statusText: "Service Unavailable",
        message: "Temporary outage",
      },
    });

    render(<AuthSessionGuard />);

    await act(async () => {
      await Promise.resolve();
    });

    expect(authClient.getSession).toHaveBeenCalledOnce();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("closes the old realtime client and reloads when another account owns the first probe", async () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    vi.mocked(authClient.getSession).mockResolvedValue(differentUserSession);
    const oldClient = getAblyRealtimeClient();

    render(
      <AuthSessionGuard>
        <AuthSessionHydrator session={renderedSession} />
      </AuthSessionGuard>,
    );

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(oldClient.close).toHaveBeenCalledOnce();
    expect(RealtimeMock).toHaveBeenCalledOnce();
    expect(authClient.getSession).toHaveBeenCalledOnce();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("reloads when the rendered account arrives after the fresh session probe", async () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    vi.mocked(authClient.getSession).mockResolvedValue(differentUserSession);
    const oldClient = getAblyRealtimeClient();
    const view = render(<AuthSessionGuard />);
    await vi.dynamicImportSettled();
    expect(reload).not.toHaveBeenCalled();

    view.rerender(
      <AuthSessionGuard>
        <AuthSessionHydrator session={renderedSession} />
      </AuthSessionGuard>,
    );

    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(oldClient.close).toHaveBeenCalledOnce();
    expect(authClient.getSession).toHaveBeenCalledOnce();
  });

  it("reloads again when a kept document still shows another account", async () => {
    // A `beforeunload` prompt for unsaved edits can keep the document. The
    // reload mock stands in for the reader choosing to stay. Dismissing the
    // prompt refocuses the window, which must not ask again at once, or the
    // reader could never reach the editor. Returning to the tab asks again.
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(presentSession)
      .mockResolvedValue(differentUserSession);
    const oldClient = getAblyRealtimeClient();
    render(
      <AuthSessionGuard>
        <AuthSessionHydrator session={renderedSession} />
      </AuthSessionGuard>,
    );
    await vi.dynamicImportSettled();

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await Promise.resolve();
    });
    expect(authClient.getSession).toHaveBeenCalledTimes(2);
    expect(reload).toHaveBeenCalledOnce();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));

    expect(oldClient.close).toHaveBeenCalled();
    expect(authClient.getSession).toHaveBeenCalledTimes(3);
    expect(RealtimeMock).toHaveBeenCalledOnce();
  });

  it("reloads for another account without waiting for the realtime chunk", async () => {
    vi.doMock(
      "@/lib/ably/realtime-singleton.client",
      () => new Promise(() => {}),
    );
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    vi.mocked(authClient.getSession).mockResolvedValue(differentUserSession);

    try {
      render(
        <AuthSessionGuard>
          <AuthSessionHydrator session={renderedSession} />
        </AuthSessionGuard>,
      );

      await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    } finally {
      vi.doUnmock("@/lib/ably/realtime-singleton.client");
    }
  });

  it("does not reload from an older account result while a newer probe is pending", async () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    const newestProbe = deferred<typeof presentSession>();
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(differentUserSession)
      .mockImplementationOnce(() => newestProbe.promise);
    const oldClient = getAblyRealtimeClient();
    const view = render(<AuthSessionGuard />);
    await vi.dynamicImportSettled();

    window.dispatchEvent(new Event("focus"));
    view.rerender(
      <AuthSessionGuard>
        <AuthSessionHydrator session={renderedSession} />
      </AuthSessionGuard>,
    );
    await vi.dynamicImportSettled();
    expect(reload).not.toHaveBeenCalled();

    await act(async () => {
      newestProbe.resolve(presentSession);
      await vi.dynamicImportSettled();
    });

    expect(reload).not.toHaveBeenCalled();
    expect(oldClient.close).not.toHaveBeenCalled();
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

  it("replaces a retired realtime client after focus confirms a restored session", async () => {
    vi.mocked(authClient.getSession).mockResolvedValue(presentSession);
    render(<AuthSessionGuard />);
    await vi.dynamicImportSettled();

    const retired = await retireRealtimeClient();
    const replaceRealtime = vi.fn(() => getAblyRealtimeClient());
    const unsubscribe = subscribeToAblyRealtimeClient(replaceRealtime);
    try {
      window.dispatchEvent(new Event("focus"));

      await waitFor(() => {
        expect(getAblyRealtimeClient()).not.toBe(retired);
      });
      expect(replaceRealtime).toHaveBeenCalledOnce();
      expect(RealtimeMock).toHaveBeenCalledTimes(2);
      expect(authClient.getSession).toHaveBeenCalledTimes(2);
      expect(replaceMock).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it("keeps a retired client when a newer probe invalidates an older valid session", async () => {
    const retired = await retireRealtimeClient();
    const staleProbe = deferred<typeof presentSession>();
    vi.mocked(authClient.getSession)
      .mockImplementationOnce(() => staleProbe.promise)
      .mockResolvedValueOnce(missingSession);
    render(<AuthSessionGuard />);

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(replaceMock).toHaveBeenCalledOnce());
    await act(async () => {
      staleProbe.resolve(presentSession);
      await vi.dynamicImportSettled();
    });

    expect(getAblyRealtimeClient()).toBe(retired);
    expect(RealtimeMock).toHaveBeenCalledOnce();
  });

  it("does not revive a retired client from a session probe after unmount", async () => {
    const retired = await retireRealtimeClient();
    const probe = deferred<typeof presentSession>();
    vi.mocked(authClient.getSession).mockImplementation(() => probe.promise);
    const view = render(<AuthSessionGuard />);
    view.unmount();

    await act(async () => {
      probe.resolve(presentSession);
      await vi.dynamicImportSettled();
    });

    expect(getAblyRealtimeClient()).toBe(retired);
    expect(RealtimeMock).toHaveBeenCalledOnce();
  });
});
