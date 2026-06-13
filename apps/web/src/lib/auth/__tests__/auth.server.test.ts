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
});
