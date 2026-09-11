import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const headersMock = vi.fn();
const captureMessageMock = vi.fn();
const setTagMock = vi.fn();
const setContextMock = vi.fn();
const callOrder: string[] = [];

const SESSION_COOKIE =
  "sokosumi-localhost-preprod.session_token=session-token-value";

vi.mock("server-only", () => ({}));

vi.mock("@sentry/nextjs", () => ({
  captureMessage: (...args: unknown[]) => captureMessageMock(...args),
  withScope: (
    callback: (scope: {
      setTag: typeof setTagMock;
      setContext: typeof setContextMock;
    }) => void,
  ) => {
    callback({ setTag: setTagMock, setContext: setContextMock });
  },
}));

vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/config/env.secrets", () => ({
  getEnvSecrets: () => ({
    NETWORK: "Preprod",
    VERCEL_ENV: "development",
    VERCEL_GIT_COMMIT_REF: "main",
  }),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreAppBaseUrl: () => "http://localhost:8787",
}));

describe("auth.server", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    callOrder.length = 0;
    headersMock.mockImplementation(async () => {
      callOrder.push("headers");
      return new Headers({ cookie: SESSION_COOKIE });
    });
    fetchMock.mockImplementation(async () => {
      callOrder.push("fetch");
      return {
        ok: true,
        json: async () => ({
          session: { activeOrganizationId: null },
          user: { id: "user_123" },
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("uses headers then fetch for getSession", async () => {
    const { getSession } = await import("./auth.server");

    await getSession();

    expect(callOrder.slice(0, 2)).toEqual(["headers", "fetch"]);
  });

  it("uses headers then fetch for refreshed getSession", async () => {
    const { getSession } = await import("./auth.server");

    await getSession({ refresh: true });

    expect(callOrder.slice(0, 2)).toEqual(["headers", "fetch"]);
  });

  it("rethrows hanging-promise aborts from headers for refreshed getSession", async () => {
    const hanging = Object.assign(new Error("Hanging promise rejection"), {
      digest: "HANGING_PROMISE_REJECTION",
    });
    headersMock.mockRejectedValue(hanging);

    const { getSession } = await import("./auth.server");

    await expect(getSession({ refresh: true })).rejects.toBe(hanging);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses headers for listUserAccounts", async () => {
    fetchMock.mockImplementation(async () => {
      callOrder.push("fetch");
      return {
        ok: true,
        json: async () => [],
      };
    });

    const { listUserAccounts } = await import("./auth.server");

    await listUserAccounts();

    expect(callOrder.slice(0, 2)).toEqual(["headers", "fetch"]);
  });

  it("skips Core when no session cookie is present", async () => {
    headersMock.mockResolvedValue(new Headers({}));

    const { getSession, getSessionResult } = await import("./auth.server");

    const result = await getSessionResult();
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
    await expect(getSession()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips Core for refresh when no session cookie is present", async () => {
    headersMock.mockResolvedValue(new Headers({}));

    const { getSession, getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
    await expect(getSession({ refresh: true })).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gets a refreshed session by disabling Better Auth cookie cache", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        session: {
          activeOrganizationId: null,
        },
        user: {
          id: "user_123",
        },
      }),
    });

    const { getSession } = await import("./auth.server");

    await expect(getSession({ refresh: true })).resolves.toEqual({
      session: {
        activeOrganizationId: null,
      },
      user: {
        id: "user_123",
      },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://localhost:8787/auth/get-session?disableCookieCache=true"),
      {
        headers: { cookie: SESSION_COOKIE },
        cache: "no-store",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("returns null when Core reports no session", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => null,
    });

    const { getSession, getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("returns err, not ok(null), when Core responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => null,
    });

    const { getSession, getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        path: "/auth/get-session",
        reason: "http",
        status: 500,
      });
    }
    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("returns err, not ok(null), when the fetch rejects", async () => {
    fetchMock.mockRejectedValue(new Error("Core unreachable"));

    const { getSession, getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        path: "/auth/get-session",
        reason: "network",
      });
    }
    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("returns err with reason timeout when the session read times out", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    const { getSession, getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        path: "/auth/get-session",
        reason: "timeout",
      });
    }
    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("gives the Core session read 8 seconds", async () => {
    const timeoutMock = vi.spyOn(AbortSignal, "timeout");

    const { getSession } = await import("./auth.server");
    await getSession({ refresh: true });

    expect(timeoutMock).toHaveBeenCalledWith(8000);
    timeoutMock.mockRestore();
  });

  it("rethrows Cache Components hanging-promise aborts instead of null", async () => {
    const hanging = Object.assign(new Error("Hanging promise rejection"), {
      digest: "HANGING_PROMISE_REJECTION",
    });
    fetchMock.mockRejectedValue(hanging);

    const { getSession } = await import("./auth.server");

    await expect(getSession({ refresh: true })).rejects.toBe(hanging);
  });

  it("returns err, not ok(null), when the response body is not valid JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    const { getSession, getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error).toMatchObject({
        path: "/auth/get-session",
        reason: "invalid_json",
      });
    }
    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  /**
   * `getSession` collapses every failure to null for its ~70 callers.
   * `getSessionResult` is the contract that keeps "Core could not be asked"
   * apart from "this browser has no session", so the route handlers can answer
   * 503 instead of signing a working session out. Assert it directly: a test
   * that only reads `getSession` passes just as well when the Result collapses
   * back to `ok(null)`, which is the bug.
   */
  it("reports a Core timeout as an outage, not a signed-out browser", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);

    const { getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({
      path: "/auth/get-session",
      reason: "timeout",
    });
  });

  /**
   * `AbortSignal.timeout` covers the body stream too, so a Core that sends
   * headers and then stalls surfaces the abort out of `response.json()`.
   * Filing that as a parse fault would make the 503 reason lie about the
   * outage.
   */
  it("reports a stall during the body read as a timeout", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw timeout;
      },
    });

    const { getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });

    expect(result._unsafeUnwrapErr()).toEqual({
      path: "/auth/get-session",
      reason: "timeout",
    });
  });

  it("reports a malformed body as invalid_json", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    const { getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });

    expect(result._unsafeUnwrapErr()).toEqual({
      path: "/auth/get-session",
      reason: "invalid_json",
    });
  });

  it("rethrows a hanging-promise abort raised by the body read", async () => {
    const hanging = Object.assign(new Error("Hanging promise rejection"), {
      digest: "HANGING_PROMISE_REJECTION",
    });
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw hanging;
      },
    });

    const { getSession } = await import("./auth.server");

    await expect(getSession({ refresh: true })).rejects.toBe(hanging);
  });

  /**
   * An auth status is about this request's credentials, not about Core being
   * reachable. Answering 503 with `Retry-After` would tell the browser to
   * retry a condition that never clears.
   */
  it("reads a Core 401 as signed out rather than an outage", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => null,
    });

    const { getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });

    expect(result.isOk()).toBe(true);
    expect(result._unsafeUnwrap()).toBeNull();
  });

  /**
   * Neither status is about this browser's credentials. A 403 is Better
   * Auth's trusted-origin check or a WAF rule on the web-to-Core hop; a 404
   * means the route is gone. Reading either as "signed out" logs every user
   * out silently and hides the misconfiguration behind a sign-in page.
   */
  it.each([403, 404])("keeps a Core %i in the outage path", async (status) => {
    fetchMock.mockResolvedValue({
      ok: false,
      status,
      json: async () => null,
    });

    const { getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });

    expect(result._unsafeUnwrapErr()).toEqual({
      path: "/auth/get-session",
      reason: "http",
      status,
    });
  });

  it("reports an unexpected Core status as an outage", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => null,
    });

    const { getSessionResult } = await import("./auth.server");

    const result = await getSessionResult({ refresh: true });

    expect(result._unsafeUnwrapErr()).toEqual({
      path: "/auth/get-session",
      reason: "http",
      status: 500,
    });
  });

  /**
   * The literal, not the constant: reading `CORE_AUTH_REQUEST_TIMEOUT_MS`
   * here would assert the budget against itself and let any drift through.
   * 8s is what the callers in front of this read allow - the background chat
   * reads give the browser 20-30s - and 5s is what turned a Core stall into
   * "no session". The Better Auth client hop keeps its own 5s on purpose.
   */
  it("spends the 8s Core auth budget on the session read", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

    const { getSession } = await import("./auth.server");

    await getSession({ refresh: true });

    expect(timeoutSpy).toHaveBeenCalledWith(8000);
    timeoutSpy.mockRestore();
  });

  /**
   * The redirect is for an answered read that carried no session. Sending a
   * signed-in user to /signin because Core was slow reads as a logout and
   * loses the page they were on.
   */
  it("throws instead of redirecting to sign-in when Core cannot be read", async () => {
    const timeout = new Error("The operation was aborted due to timeout");
    timeout.name = "TimeoutError";
    fetchMock.mockRejectedValue(timeout);

    const { getSessionOrRedirect } = await import("./auth.server");
    const { redirect } = await import("next/navigation");

    await expect(getSessionOrRedirect()).rejects.toMatchObject({
      name: "CoreAuthUnavailableError",
      reason: "timeout",
    });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("redirects to sign-in when Core answers with no session", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => null });

    const { getSessionOrRedirect } = await import("./auth.server");
    const { redirect } = await import("next/navigation");

    await getSessionOrRedirect();

    expect(redirect).toHaveBeenCalledWith(expect.stringContaining("/signin"));
  });

  it("lists user accounts from Core", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "account_1",
          providerId: "google",
        },
      ],
    });

    const { listUserAccounts } = await import("./auth.server");

    const result = await listUserAccounts();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([
        {
          id: "account_1",
          providerId: "google",
        },
      ]);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://localhost:8787/auth/list-accounts"),
      {
        headers: { cookie: SESSION_COOKIE },
        cache: "no-store",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("returns ok with an empty array when the user has no linked accounts", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const { listUserAccounts } = await import("./auth.server");

    const result = await listUserAccounts();

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([]);
    }
  });

  it("returns err with reason invalid_json when list-accounts body is not an array", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => null,
    });

    const { listUserAccounts } = await import("./auth.server");

    const result = await listUserAccounts();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("invalid_json");
      expect(result.error.path).toBe("/auth/list-accounts");
    }
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Failed to fetch user accounts from Core: response was not an array",
      "error",
    );
  });

  it("returns err when user accounts cannot be loaded", async () => {
    fetchMock.mockRejectedValue(new Error("Core unreachable"));

    const { listUserAccounts } = await import("./auth.server");

    const result = await listUserAccounts();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("network");
      expect(result.error.path).toBe("/auth/list-accounts");
    }
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Failed to fetch user accounts from Core",
      "error",
    );
  });

  it("returns err with reason invalid_json when the body fails to parse", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    const { listUserAccounts } = await import("./auth.server");

    const result = await listUserAccounts();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("invalid_json");
      expect(result.error.path).toBe("/auth/list-accounts");
    }
  });

  it("returns err with reason timeout when the request times out", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    const { listUserAccounts } = await import("./auth.server");

    const result = await listUserAccounts();

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("timeout");
      expect(result.error.path).toBe("/auth/list-accounts");
    }
  });

  it("fetches public OAuth client metadata", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        client_id: "client_123",
        client_name: "My App",
      }),
    });

    const { getOAuthClientPublic } = await import("./auth.server");

    const result = await getOAuthClientPublic("client_123");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual({
        client_id: "client_123",
        client_name: "My App",
      });
    }

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://localhost:8787/auth/oauth2/public-client?client_id=client_123",
      ),
      {
        headers: { cookie: SESSION_COOKIE },
        cache: "no-store",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("returns ok with null when the OAuth client is absent", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => null,
    });

    const { getOAuthClientPublic } = await import("./auth.server");

    const result = await getOAuthClientPublic("client_123");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
  });

  it("returns ok with null when the OAuth client responds with 404", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => null,
    });
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => {});
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const { getOAuthClientPublic } = await import("./auth.server");

    const result = await getOAuthClientPublic("client_123");

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toBeNull();
    }
    expect(captureMessageMock).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Failed to fetch OAuth client from Core",
      {
        path: "/auth/oauth2/public-client",
        status: 404,
      },
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("returns err when public OAuth client metadata cannot be loaded", async () => {
    fetchMock.mockRejectedValue(new Error("Core unreachable"));

    const { getOAuthClientPublic } = await import("./auth.server");

    const result = await getOAuthClientPublic("client_123");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("network");
      expect(result.error.path).toBe("/auth/oauth2/public-client");
    }
  });

  it("returns err with reason invalid_json when OAuth client body fails to parse", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    const { getOAuthClientPublic } = await import("./auth.server");

    const result = await getOAuthClientPublic("client_123");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("invalid_json");
      expect(result.error.path).toBe("/auth/oauth2/public-client");
    }
  });

  it("returns err with reason timeout when OAuth client request times out", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    const { getOAuthClientPublic } = await import("./auth.server");

    const result = await getOAuthClientPublic("client_123");

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("timeout");
      expect(result.error.path).toBe("/auth/oauth2/public-client");
    }
  });
});
