import { OpenAPIHono } from "@hono/zod-openapi";
import { MemberRole } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetChatRooms from "./get";

const {
  roomFindManyMock,
  roomCountMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindManyMock: vi.fn(),
  roomCountMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { $transaction: prismaTransactionMock },
}));

const USER_ID = "user_123";
const ORG_ID = "org_1";

const tx = {
  chatRoom: {
    findMany: roomFindManyMock,
    count: roomCountMock,
  },
  organization: { findUnique: organizationFindUniqueMock },
  member: { findUnique: memberFindUniqueMock },
};

function createApp(organizationId: string | null) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId,
      role: "user",
    });
    return await next();
  });
  mountGetChatRooms(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: ORG_ID });
  memberFindUniqueMock.mockResolvedValue({ role: MemberRole.MEMBER });
  roomFindManyMock.mockResolvedValue([]);
  roomCountMock.mockResolvedValue(0);
});

describe("GET /chats/rooms", () => {
  it("lists archived rooms the plain member created", async () => {
    const response = await createApp(ORG_ID).request("/?status=archived");

    expect(response.status).toBe(200);
    expect(roomFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          archivedAt: { not: null },
          organizationId: ORG_ID,
          createdByUserId: USER_ID,
          userMembers: { some: { userId: USER_ID } },
        }),
      }),
    );
    expect(roomCountMock).toHaveBeenCalledWith({
      where: expect.objectContaining({
        archivedAt: { not: null },
        createdByUserId: USER_ID,
        organizationId: ORG_ID,
      }),
    });
  });

  it.each([
    ["admin", MemberRole.ADMIN],
    ["owner", MemberRole.OWNER],
  ])(
    "lists all archived membership rooms for an organization %s",
    async (_label, role) => {
      memberFindUniqueMock.mockResolvedValue({ role });

      const response = await createApp(ORG_ID).request("/?status=archived");

      expect(response.status).toBe(200);
      const where = roomFindManyMock.mock.calls[0]?.[0]?.where as Record<
        string,
        unknown
      >;
      expect(where).toMatchObject({
        archivedAt: { not: null },
        organizationId: ORG_ID,
        userMembers: { some: { userId: USER_ID } },
      });
      expect(where).not.toHaveProperty("createdByUserId");
    },
  );

  it("returns an empty page for archived status with no active organization", async () => {
    const response = await createApp(null).request("/?status=archived");

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([]);
    expect(roomFindManyMock).not.toHaveBeenCalled();
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("defaults to active rooms (archivedAt null) without creator filter", async () => {
    const response = await createApp(ORG_ID).request("/");

    expect(response.status).toBe(200);
    const where = roomFindManyMock.mock.calls[0]?.[0]?.where as Record<
      string,
      unknown
    >;
    expect(where).toMatchObject({
      archivedAt: null,
      organizationId: ORG_ID,
    });
    expect(where).not.toHaveProperty("createdByUserId");
  });
});
