import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountRestoreAdminMatchedChannel from "./post";

const {
  queryRawMock,
  roomUpdateManyMock,
  prismaTransactionMock,
  authContextState,
} = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  queryRawMock: vi.fn(),
  roomUpdateManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
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
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";

const tx = {
  $queryRaw: queryRawMock,
  chatRoom: { updateMany: roomUpdateManyMock },
};

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
  mountRestoreAdminMatchedChannel(app);
  return app;
}

async function restore() {
  return createApp().request(`http://localhost/${ROOM_ID}/restore`, {
    method: "POST",
  });
}

describe("POST /admin/matched-channels/{roomId}/restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    };
    prismaTransactionMock.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    queryRawMock.mockResolvedValue([
      {
        id: ROOM_ID,
        organizationId: null,
        kind: "channel",
        discoverability: "matched",
        archivedAt: new Date("2026-03-01T12:00:00.000Z"),
        name: "Partners",
        slug: "partners",
      },
    ]);
    roomUpdateManyMock.mockResolvedValue({ count: 1 });
  });

  it("restores an archived matched channel", async () => {
    const response = await restore();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual({
      id: ROOM_ID,
      name: "Partners",
      slug: "partners",
      archivedAt: null,
    });
    expect(roomUpdateManyMock).toHaveBeenCalledWith({
      where: { id: ROOM_ID, archivedAt: { not: null } },
      data: { archivedAt: null },
    });
  });

  it("404s when the room is not archived", async () => {
    queryRawMock.mockResolvedValue([
      {
        id: ROOM_ID,
        organizationId: null,
        kind: "channel",
        discoverability: "matched",
        archivedAt: null,
        name: "Partners",
        slug: "partners",
      },
    ]);

    expect((await restore()).status).toBe(404);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });

  it("404s when the room is not an org-less matched channel", async () => {
    queryRawMock.mockResolvedValue([
      {
        id: ROOM_ID,
        organizationId: "org_1",
        kind: "channel",
        discoverability: "private",
        archivedAt: new Date("2026-03-01T12:00:00.000Z"),
        name: "Partners",
        slug: "partners",
      },
    ]);

    expect((await restore()).status).toBe(404);
    expect(roomUpdateManyMock).not.toHaveBeenCalled();
  });
});
