import { CORE_API_ERROR_KINDS } from "@sokosumi/utils";
import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountCreateAdminMatchedChannel from "./post";

const { chatRoomCreateMock, chatRoomFindFirstMock, authContextState } =
  vi.hoisted(() => ({
    authContextState: {
      current: {
        actor: "user",
        userId: "user_admin",
        organizationId: null,
        role: "admin",
      } as AuthenticationContext,
    },
    chatRoomCreateMock: vi.fn(),
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
      create: (...args: unknown[]) => chatRoomCreateMock(...args),
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
  mountCreateAdminMatchedChannel(app);
  return app;
}

async function post(body: Record<string, unknown> = { slug: "partners" }) {
  return createApp().request("http://localhost/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /admin/matched-channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    };
    chatRoomFindFirstMock.mockResolvedValue(null);
    chatRoomCreateMock.mockResolvedValue({
      id: ROOM_ID,
      name: "Partners",
      slug: "partners",
      archivedAt: null,
    });
  });

  it("creates an org-less matched channel without seeding the creator on the roster", async () => {
    const response = await post({
      name: "Partners",
      slug: "partners",
      topic: "Partner coordination",
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.data).toEqual({
      id: ROOM_ID,
      name: "Partners",
      slug: "partners",
      archivedAt: null,
    });
    expect(chatRoomCreateMock).toHaveBeenCalledWith({
      data: {
        organizationId: null,
        createdByUserId: "user_admin",
        kind: "channel",
        discoverability: "matched",
        name: "Partners",
        slug: "partners",
        topic: "Partner coordination",
      },
      select: { id: true, name: true, slug: true, archivedAt: true },
    });
  });

  it("returns 409 CHANNEL_SLUG_TAKEN when an org-less channel already has the slug", async () => {
    chatRoomFindFirstMock.mockResolvedValue({ id: ROOM_ID });

    const response = await post({ slug: "partners" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.kind).toBe(CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN);
    expect(body.message).toBe("This Channel slug is taken.");
    expect(chatRoomCreateMock).not.toHaveBeenCalled();
  });

  it("derives the name from the slug when name is omitted", async () => {
    chatRoomCreateMock.mockResolvedValue({
      id: ROOM_ID,
      name: "Team Soko",
      slug: "team-soko",
      archivedAt: null,
    });

    const response = await post({ slug: "team-soko" });
    expect(response.status).toBe(201);
    expect(chatRoomCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Team Soko",
          slug: "team-soko",
          topic: null,
        }),
      }),
    );
  });

  it("returns 409 CHANNEL_SLUG_TAKEN when the slug is taken", async () => {
    chatRoomCreateMock.mockRejectedValue({
      code: "P2002",
      meta: { target: ["slug"] },
    });

    const response = await post({ slug: "partners" });
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.kind).toBe(CORE_API_ERROR_KINDS.CHANNEL_SLUG_TAKEN);
  });

  it("rejects non-admin users", async () => {
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "user",
    };
    expect((await post()).status).toBe(403);
    expect(chatRoomCreateMock).not.toHaveBeenCalled();
  });

  it("rejects a coworker actor", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    };
    expect((await post()).status).toBe(403);
    expect(chatRoomCreateMock).not.toHaveBeenCalled();
  });
});
