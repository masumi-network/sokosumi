import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import mountGetAdminMatchedChannel from "./get";

const { chatRoomFindFirstMock, authContextState } = vi.hoisted(() => ({
  authContextState: {
    current: {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    } as AuthenticationContext,
  },
  chatRoomFindFirstMock: vi.fn(),
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
      findFirst: (...args: unknown[]) => chatRoomFindFirstMock(...args),
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
  mountGetAdminMatchedChannel(app);
  return app;
}

describe("GET /admin/matched-channels/{roomId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    };
    chatRoomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      name: "Partners",
      slug: "partners",
      topic: "Hello",
      archivedAt: null,
      userMembers: [
        {
          userId: "user_1",
          access: "member",
          user: { name: "Ada", email: "ada@example.com" },
        },
      ],
    });
  });

  it("returns detail with member roster", async () => {
    const response = await createApp().request(`http://localhost/${ROOM_ID}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      id: ROOM_ID,
      name: "Partners",
      slug: "partners",
      topic: "Hello",
      archivedAt: null,
      participants: [
        {
          userId: "user_1",
          name: "Ada",
          email: "ada@example.com",
          access: "member",
        },
      ],
    });
    expect(chatRoomFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: ROOM_ID,
          organizationId: null,
          kind: "channel",
          discoverability: "matched",
        },
      }),
    );
  });

  it("returns detail for an archived matched channel", async () => {
    const archivedAt = new Date("2026-03-01T12:00:00.000Z");
    chatRoomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      name: "Partners",
      slug: "partners",
      topic: "Hello",
      archivedAt,
      userMembers: [],
    });

    const response = await createApp().request(`http://localhost/${ROOM_ID}`);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.archivedAt).toBe(archivedAt.toISOString());
    expect(body.data.participants).toEqual([]);
  });

  it("returns 404 when the room is missing", async () => {
    chatRoomFindFirstMock.mockResolvedValue(null);
    const response = await createApp().request(`http://localhost/${ROOM_ID}`);
    expect(response.status).toBe(404);
  });
});
