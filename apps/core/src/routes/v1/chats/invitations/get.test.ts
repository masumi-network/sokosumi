import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountListInviteeInvitations from "./get";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const { userFindUniqueMock, invitationFindManyMock } = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  invitationFindManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    chatRoomGuestInvitation: { findMany: invitationFindManyMock },
  },
}));

const INVITE_ID = "550e8400-e29b-41d4-a716-446655440010";
const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const GUEST_ID = "user_guest";
const INVITER_ID = "user_inviter";
const ORG_ID = "org_1";

function createApp(
  authContext: AuthVariables["authContext"] = {
    actor: "user",
    userId: GUEST_ID,
    organizationId: "guest_org",
    role: "user",
  },
) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("requestId", "req_list_invitee");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountListInviteeInvitations(app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindUniqueMock.mockResolvedValue({ email: "  Guest@Example.com " });
  invitationFindManyMock.mockResolvedValue([
    {
      id: INVITE_ID,
      roomId: ROOM_ID,
      email: "guest@example.com",
      inviterId: INVITER_ID,
      status: "pending",
      expiresAt: new Date("2099-08-12T12:00:00.000Z"),
      acceptedAt: null,
      acceptedByUserId: null,
      createdAt: new Date("2026-08-05T12:00:00.000Z"),
      updatedAt: new Date("2026-08-05T12:00:00.000Z"),
      inviter: { id: INVITER_ID, name: "Ada Lovelace" },
      room: {
        id: ROOM_ID,
        name: "Client Room",
        organizationId: ORG_ID,
        organization: { id: ORG_ID, name: "Acme Corp" },
      },
    },
  ]);
});

describe("GET /chats/invitations", () => {
  it("list pending returns invite for matching email", async () => {
    const response = await createApp().request("/?status=pending", {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toEqual([
      expect.objectContaining({
        id: INVITE_ID,
        roomId: ROOM_ID,
        roomName: "Client Room",
        organizationId: ORG_ID,
        organizationName: "Acme Corp",
        email: "guest@example.com",
        status: "pending",
        inviter: { id: INVITER_ID, name: "Ada Lovelace" },
      }),
    ]);

    expect(invitationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          email: "guest@example.com",
          status: "pending",
          expiresAt: { gt: expect.any(Date) },
          room: { archivedAt: null },
        }),
      }),
    );
  });

  it("defaults status to pending", async () => {
    const response = await createApp().request("/", { method: "GET" });

    expect(response.status).toBe(200);
    expect(invitationFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "pending" }),
      }),
    );
  });
});
