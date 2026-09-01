import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountListAdminMatchedChannels from "./get";

const { chatRoomFindManyMock, authContextState } = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  chatRoomFindManyMock: vi.fn(),
}));

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (
      c: {
        json: (body: unknown, status: number) => unknown;
        set: (key: string, value: unknown) => void;
      },
      next: () => Promise<unknown>,
    ) => {
      if (!authContextState.current) {
        return c.json({ error: "Unauthorized", message: "Unauthorized" }, 401);
      }
      c.set("isAuthenticated", true);
      c.set("authContext", authContextState.current);
      return await next();
    },
  };
});

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: {
      findMany: (...args: unknown[]) => chatRoomFindManyMock(...args),
    },
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use(
    "*",
    createMiddleware(async (c, next) => {
      requireAdminAuthContext(c.var.authContext);
      await next();
    }),
  );
  app.onError(errorHandler);
  mountListAdminMatchedChannels(app);
  return app;
}

describe("GET /admin/matched-channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    };
    chatRoomFindManyMock.mockResolvedValue([
      { id: ROOM_ID, name: "Partners", slug: "partners" },
    ]);
  });

  it("lists live org-less matched channels by default", async () => {
    chatRoomFindManyMock.mockResolvedValue([
      { id: ROOM_ID, name: "Partners", slug: "partners", archivedAt: null },
    ]);
    const response = await createApp().request("http://localhost/");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        id: ROOM_ID,
        name: "Partners",
        slug: "partners",
        archivedAt: null,
      },
    ]);
    expect(chatRoomFindManyMock).toHaveBeenCalledWith({
      where: {
        organizationId: null,
        kind: "channel",
        discoverability: "matched",
        archivedAt: null,
      },
      select: { id: true, name: true, slug: true, archivedAt: true },
      orderBy: { name: "asc" },
    });
  });

  it("lists archived matched channels when status=archived", async () => {
    const archivedAt = new Date("2026-03-01T12:00:00.000Z");
    chatRoomFindManyMock.mockResolvedValue([
      {
        id: ROOM_ID,
        name: "Partners",
        slug: "partners",
        archivedAt,
      },
    ]);

    const response = await createApp().request(
      "http://localhost/?status=archived",
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual([
      {
        id: ROOM_ID,
        name: "Partners",
        slug: "partners",
        archivedAt: archivedAt.toISOString(),
      },
    ]);
    expect(chatRoomFindManyMock).toHaveBeenCalledWith({
      where: {
        organizationId: null,
        kind: "channel",
        discoverability: "matched",
        archivedAt: { not: null },
      },
      select: { id: true, name: true, slug: true, archivedAt: true },
      orderBy: { name: "asc" },
    });
  });

  it("rejects non-admin users", async () => {
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "user",
    };
    expect((await createApp().request("http://localhost/")).status).toBe(403);
  });

  it("rejects a coworker actor", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    };
    expect((await createApp().request("http://localhost/")).status).toBe(403);
  });
});
