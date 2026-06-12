import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();
const headersMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  headers: (...args: unknown[]) => headersMock(...args),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

vi.mock("@/lib/auth/forward-cookies", () => ({
  buildAuthRequestHeadersForForwarding: vi.fn(async () =>
    Promise.resolve(new Headers({ cookie: "session=abc" })),
  ),
}));

vi.mock("@/lib/auth/auth", () => ({
  auth: {
    api: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
    },
  },
}));

describe("auth utils", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    headersMock.mockResolvedValue(new Headers({ cookie: "session=abc" }));
  });

  it("gets a refreshed session by disabling Better Auth cookie cache", async () => {
    getSessionMock.mockResolvedValue({
      session: {
        activeOrganizationId: null,
      },
      user: {
        id: "user_123",
      },
    });

    const { getSession } = await import("../utils");

    await expect(getSession({ refresh: true })).resolves.toEqual({
      session: {
        activeOrganizationId: null,
      },
      user: {
        id: "user_123",
      },
    });

    expect(getSessionMock).toHaveBeenCalledWith({
      query: {
        disableCookieCache: true,
      },
      headers: expect.any(Headers),
    });
  });
});
