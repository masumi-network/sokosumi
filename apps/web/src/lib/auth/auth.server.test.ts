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

    const { getSession } = await import("./auth.server");

    await expect(getSession()).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("skips Core for refresh when no session cookie is present", async () => {
    headersMock.mockResolvedValue(new Headers({}));

    const { getSession } = await import("./auth.server");

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

    const { getSession } = await import("./auth.server");

    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("returns null when Core responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => null,
    });

    const { getSession } = await import("./auth.server");

    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("returns null when the fetch rejects instead of throwing", async () => {
    fetchMock.mockRejectedValue(new Error("Core unreachable"));

    const { getSession } = await import("./auth.server");

    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("rethrows Cache Components hanging-promise aborts instead of null", async () => {
    const hanging = Object.assign(new Error("Hanging promise rejection"), {
      digest: "HANGING_PROMISE_REJECTION",
    });
    fetchMock.mockRejectedValue(hanging);

    const { getSession } = await import("./auth.server");

    await expect(getSession({ refresh: true })).rejects.toBe(hanging);
  });

  it("returns null when the response body is not valid JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    });

    const { getSession } = await import("./auth.server");

    await expect(getSession({ refresh: true })).resolves.toBeNull();
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
        throw new Error("Unexpected token < in JSON");
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

  it("lists active subscriptions with customer type query params", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        {
          plan: "pro",
          periodEnd: "2026-04-01T00:00:00.000Z",
        },
      ],
    });

    const { listActiveSubscriptions } = await import("./auth.server");

    const result = await listActiveSubscriptions({ customerType: "user" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([
        {
          plan: "pro",
          periodEnd: "2026-04-01T00:00:00.000Z",
        },
      ]);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://localhost:8787/auth/subscription/list?customerType=user"),
      {
        headers: { cookie: SESSION_COOKIE },
        cache: "no-store",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("returns ok with an empty array when the user has no active subscriptions", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const { listActiveSubscriptions } = await import("./auth.server");

    const result = await listActiveSubscriptions({ customerType: "user" });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value).toEqual([]);
    }
  });

  it("returns err with reason invalid_json when subscription body is not an array", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const { listActiveSubscriptions } = await import("./auth.server");

    const result = await listActiveSubscriptions({ customerType: "user" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("invalid_json");
      expect(result.error.path).toBe("/auth/subscription/list");
    }
    expect(captureMessageMock).toHaveBeenCalledWith(
      "Failed to fetch active subscriptions from Core: response was not an array",
      "error",
    );
  });

  it("returns err when active subscriptions cannot be loaded", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => null,
    });

    const { listActiveSubscriptions } = await import("./auth.server");

    const result = await listActiveSubscriptions({ customerType: "user" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("http");
      expect(result.error.status).toBe(503);
      expect(result.error.path).toBe("/auth/subscription/list");
    }
  });

  it("returns err with reason invalid_json when subscription body fails to parse", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    });

    const { listActiveSubscriptions } = await import("./auth.server");

    const result = await listActiveSubscriptions({ customerType: "user" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("invalid_json");
      expect(result.error.path).toBe("/auth/subscription/list");
    }
  });

  it("returns err with reason timeout when subscription request times out", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );

    const { listActiveSubscriptions } = await import("./auth.server");

    const result = await listActiveSubscriptions({ customerType: "user" });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.reason).toBe("timeout");
      expect(result.error.path).toBe("/auth/subscription/list");
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
        throw new Error("Unexpected token < in JSON");
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
