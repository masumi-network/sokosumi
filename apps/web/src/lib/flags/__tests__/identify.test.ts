import { beforeEach, describe, expect, it, vi } from "vitest";

export {};

vi.mock("server-only", () => ({}));

const getSessionMock = vi.fn();

vi.mock("flags/next", () => ({
  dedupe: <T extends (...args: never[]) => unknown>(fn: T): T => fn,
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

describe("identify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("returns empty entities when session is missing", async () => {
    getSessionMock.mockResolvedValue(null);

    const { identify } = await import("../identify");

    await expect(identify()).resolves.toEqual({});
  });

  it("returns user and organization from session", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user_1", email: "a@nmkr.io" },
      session: { activeOrganizationId: "org_1" },
    });

    const { identify } = await import("../identify");

    await expect(identify()).resolves.toEqual({
      user: { id: "user_1", email: "a@nmkr.io" },
      organization: { id: "org_1" },
    });
  });

  it("omits organization when active organization is missing", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user_1", email: "a@nmkr.io" },
      session: {},
    });

    const { identify } = await import("../identify");

    await expect(identify()).resolves.toEqual({
      user: { id: "user_1", email: "a@nmkr.io" },
      organization: undefined,
    });
  });
});
