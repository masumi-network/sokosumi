import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();
const headersMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/clients/utils/core-api-base-url", () => ({
  getServerCoreAppBaseUrl: () => "http://localhost:8787",
}));

describe("auth.server", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    headersMock.mockResolvedValue(new Headers({ cookie: "session=abc" }));
    vi.stubGlobal("fetch", fetchMock);
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

    const { getSession } = await import("../auth.server");

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
        headers: { cookie: "session=abc" },
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

    const { getSession } = await import("../auth.server");

    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("returns null when Core responds with a non-ok status", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => null,
    });

    const { getSession } = await import("../auth.server");

    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("returns null when the fetch rejects instead of throwing", async () => {
    fetchMock.mockRejectedValue(new Error("Core unreachable"));

    const { getSession } = await import("../auth.server");

    await expect(getSession({ refresh: true })).resolves.toBeNull();
  });

  it("returns null when the response body is not valid JSON", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    });

    const { getSession } = await import("../auth.server");

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

    const { listUserAccounts } = await import("../auth.server");

    await expect(listUserAccounts()).resolves.toEqual([
      {
        id: "account_1",
        providerId: "google",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://localhost:8787/auth/list-accounts"),
      {
        headers: { cookie: "session=abc" },
        cache: "no-store",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("returns an empty array when user accounts cannot be loaded", async () => {
    fetchMock.mockRejectedValue(new Error("Core unreachable"));

    const { listUserAccounts } = await import("../auth.server");

    await expect(listUserAccounts()).resolves.toEqual([]);
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

    const { listActiveSubscriptions } = await import("../auth.server");

    await expect(
      listActiveSubscriptions({ customerType: "user" }),
    ).resolves.toEqual([
      {
        plan: "pro",
        periodEnd: "2026-04-01T00:00:00.000Z",
      },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://localhost:8787/auth/subscription/list?customerType=user"),
      {
        headers: { cookie: "session=abc" },
        cache: "no-store",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("returns an empty array when active subscriptions cannot be loaded", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => null,
    });

    const { listActiveSubscriptions } = await import("../auth.server");

    await expect(
      listActiveSubscriptions({ customerType: "user" }),
    ).resolves.toEqual([]);
  });

  it("fetches public OAuth client metadata", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        client_id: "client_123",
        client_name: "My App",
      }),
    });

    const { getOAuthClientPublic } = await import("../auth.server");

    await expect(getOAuthClientPublic("client_123")).resolves.toEqual({
      client_id: "client_123",
      client_name: "My App",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "http://localhost:8787/auth/oauth2/public-client?client_id=client_123",
      ),
      {
        headers: { cookie: "session=abc" },
        cache: "no-store",
        signal: expect.any(AbortSignal),
      },
    );
  });

  it("returns null when public OAuth client metadata cannot be loaded", async () => {
    fetchMock.mockRejectedValue(new Error("Core unreachable"));

    const { getOAuthClientPublic } = await import("../auth.server");

    await expect(getOAuthClientPublic("client_123")).resolves.toBeNull();
  });
});
