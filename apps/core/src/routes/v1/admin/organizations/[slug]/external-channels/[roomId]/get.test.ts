import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";
import { TEST_VENDOR_ID } from "@/test-fixtures/vendor.js";

import mountGetAdminOrgExternalChannel from "./get";

const {
  getAdminOrganizationBySlugMock,
  chatRoomFindFirstMock,
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
  getAdminOrganizationBySlugMock: vi.fn(),
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

vi.mock("@/helpers/admin-organization-overview.js", () => ({
  getAdminOrganizationBySlug: (...args: unknown[]) =>
    getAdminOrganizationBySlugMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoom: {
      findFirst: (...args: unknown[]) => chatRoomFindFirstMock(...args),
    },
  },
}));

const ORG = { id: "org_1", slug: "acme" };
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
  mountGetAdminOrgExternalChannel(app);
  return app;
}

async function get() {
  return createApp().request(
    `http://localhost/acme/external-channels/${ROOM_ID}`,
  );
}

describe("GET /admin/organizations/{slug}/external-channels/{roomId}", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    };
    getAdminOrganizationBySlugMock.mockResolvedValue(ORG);
    chatRoomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      name: "Partners",
      slug: "partners",
      topic: "Partner coordination",
      userMembers: [
        {
          userId: "user_guest",
          user: { name: "Guest User", email: "guest@example.com" },
        },
      ],
    });
  });

  it("returns the channel detail including guests", async () => {
    const response = await get();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      id: ROOM_ID,
      name: "Partners",
      slug: "partners",
      topic: "Partner coordination",
      guests: [
        {
          userId: "user_guest",
          name: "Guest User",
          email: "guest@example.com",
        },
      ],
    });
    expect(chatRoomFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: ROOM_ID,
          organizationId: "org_1",
          kind: "channel",
          discoverability: "external",
          archivedAt: null,
        },
      }),
    );
  });

  it("returns 404 when the organization does not exist", async () => {
    getAdminOrganizationBySlugMock.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(chatRoomFindFirstMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the room is missing or not a live external channel for the org", async () => {
    chatRoomFindFirstMock.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
  });

  it("rejects non-admin users", async () => {
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "user",
    };
    expect((await get()).status).toBe(403);
  });

  it("rejects a coworker actor", async () => {
    authContextState.current = {
      actor: "coworker",
      coworkerId: "cow_123",
      vendorId: TEST_VENDOR_ID,
    };
    expect((await get()).status).toBe(403);
  });
});
