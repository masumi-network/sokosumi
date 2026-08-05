import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSessionMock, getHermesUnreadCountMock } = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getHermesUnreadCountMock: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
}));

vi.mock("@/lib/auth/auth.server", () => ({
  getSession: (...args: unknown[]) => getSessionMock(...args),
}));

vi.mock("@/lib/clients/core.client", () => ({
  CoreApiRequestError: class CoreApiRequestError extends Error {
    status?: number;
    constructor(message: string, options?: { status?: number }) {
      super(message);
      this.name = "CoreApiRequestError";
      this.status = options?.status;
    }
  },
  coreClient: {
    getHermesUnreadCount: (...args: unknown[]) =>
      getHermesUnreadCountMock(...args),
  },
  toCoreApiActionError: (error: unknown) => ({
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error ? error.message : "unknown",
  }),
}));

import { CommonErrorCode } from "@/lib/actions/errors";
import { getHermesUnreadCountAction } from "@/lib/actions/hermes";

describe("getHermesUnreadCountAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("soft-returns UNAUTHENTICATED when session is missing instead of throwing", async () => {
    getSessionMock.mockResolvedValue(null);

    const result = await getHermesUnreadCountAction({});

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected Err");
    }
    expect(result.error).toEqual({
      code: CommonErrorCode.UNAUTHENTICATED,
    });
    expect(getHermesUnreadCountMock).not.toHaveBeenCalled();
  });

  it("returns unread payload when session and Core succeed", async () => {
    getSessionMock.mockResolvedValue({
      user: { id: "user_1" },
      session: { activeOrganizationId: null },
    });
    getHermesUnreadCountMock.mockResolvedValue({
      data: {
        count: 2,
        avatarSeed: "orb-1",
        assistantName: "Ada",
        hasInstance: true,
      },
    });

    const result = await getHermesUnreadCountAction({});

    expect(result).toEqual({
      ok: true,
      data: {
        count: 2,
        avatarSeed: "orb-1",
        assistantName: "Ada",
        hasInstance: true,
      },
    });
  });
});
