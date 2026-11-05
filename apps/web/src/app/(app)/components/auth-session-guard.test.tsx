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
    Reflect.deleteProperty(document, "visibilityState");
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
    // The render disagreed with the probe, so it is asked again first.
    expect(authClient.getSession).toHaveBeenCalledTimes(2);
  });

  it("asks again instead of reloading when the document renders a new account", async () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(presentSession)
      .mockResolvedValue(differentUserSession);
    const view = render(
      <AuthSessionGuard>
        <AuthSessionHydrator session={renderedSession} />
      </AuthSessionGuard>,
    );
    await vi.dynamicImportSettled();
    expect(reload).not.toHaveBeenCalled();

    // A sign-in inside the document: the shell now renders the account the
    // cookie holds, and the last probe is older than that.
    view.rerender(
      <AuthSessionGuard>
        <AuthSessionHydrator
          session={{
            ...renderedSession,
            user: { ...renderedSession.user, id: "bob" },
            session: { ...renderedSession.session, userId: "bob" },
          }}
        />
      </AuthSessionGuard>,
    );

    await waitFor(() => expect(authClient.getSession).toHaveBeenCalledTimes(2));
    await vi.dynamicImportSettled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("sends a kept document to sign-in when its session ends on focus", async () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(presentSession)
      .mockResolvedValueOnce(differentUserSession)
      .mockResolvedValue(missingSession);
    render(
      <AuthSessionGuard>
        <AuthSessionHydrator session={renderedSession} />
      </AuthSessionGuard>,
    );
    await vi.dynamicImportSettled();

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    // The reader chose to stay; the other account then signed out too.
    window.dispatchEvent(new Event("focus"));
    await waitFor(() =>
      expect(replaceMock).toHaveBeenCalledWith(
        "/signin?returnUrl=%2Fagents%3Fview%3Dgrid",
      ),
    );
    expect(reload).toHaveBeenCalledOnce();
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
    // Dismissing the prompt refocuses the window: probed, not asked again.
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(authClient.getSession).toHaveBeenCalledTimes(3));
    await vi.dynamicImportSettled();
    expect(reload).toHaveBeenCalledOnce();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));

    expect(oldClient.close).toHaveBeenCalled();
    expect(authClient.getSession).toHaveBeenCalledTimes(4);
    expect(RealtimeMock).toHaveBeenCalledOnce();
  });

  it("asks a kept document again when the cookie returns and switches once more", async () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    // Mount: alice. Focus: bob, reload asked and declined. Focus: alice is
    // back, which closes that ask. Focus: bob again, a new switch.
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(presentSession)
      .mockResolvedValueOnce(differentUserSession)
      .mockResolvedValueOnce(presentSession)
      .mockResolvedValue(differentUserSession);
    render(
      <AuthSessionGuard>
        <AuthSessionHydrator session={renderedSession} />
      </AuthSessionGuard>,
    );
    await vi.dynamicImportSettled();

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(reload).toHaveBeenCalledOnce());
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(authClient.getSession).toHaveBeenCalledTimes(3));
    await vi.dynamicImportSettled();
    expect(reload).toHaveBeenCalledOnce();

    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
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

  it("drops an older probe's account that lands after a newer probe answered", async () => {
    const reload = vi
      .spyOn(window.location, "reload")
      .mockImplementation(() => {});
    const olderProbe = deferred<typeof presentSession>();
    // Mount: bob. Focus: the older probe, left pending. The render below
    // disagrees with bob and asks a third time, which answers alice.
    vi.mocked(authClient.getSession)
      .mockResolvedValueOnce(differentUserSession)
      .mockImplementationOnce(() => olderProbe.promise)
      .mockResolvedValue(presentSession);
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
    expect(replaceMock).not.toHaveBeenCalled();

    // The older probe answers last, with an account the document does not
    // render. Taken as the newest word, it would reload the document.
    await act(async () => {
      olderProbe.resolve(differentUserSession);
      await vi.dynamicImportSettled();
    });

    expect(reload).not.toHaveBeenCalled();
    expect(oldClient.close).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
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
