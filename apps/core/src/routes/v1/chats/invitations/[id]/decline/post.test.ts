import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeclineInviteeInvitation from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  userFindUniqueMock,
  invitationFindUniqueMock,
  invitationUpdateManyMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  invitationFindUniqueMock: vi.fn(),
  invitationUpdateManyMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const INVITE_ID = "550e8400-e29b-41d4-a716-446655440010";
const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const GUEST_ID = "user_guest";
const INVITER_ID = "user_inviter";
const ORG_ID = "org_1";

const tx = {
  user: { findUnique: userFindUniqueMock },
  chatRoomGuestInvitation: {
    findUnique: invitationFindUniqueMock,
    updateMany: invitationUpdateManyMock,
  },
};

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
    c.set("requestId", "req_decline_invite");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountDeclineInviteeInvitation(app);
  return app;
}

function pendingInvitation(status = "pending") {
  return {
    id: INVITE_ID,
    roomId: ROOM_ID,
    email: "guest@example.com",
    inviterId: INVITER_ID,
    status,
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
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (cb) => cb(tx));
  userFindUniqueMock.mockResolvedValue({ email: "guest@example.com" });
  invitationFindUniqueMock.mockResolvedValue(pendingInvitation());
  invitationUpdateManyMock.mockResolvedValue({ count: 1 });
});

describe("POST /chats/invitations/{id}/decline", () => {
  it("decline sets declined", async () => {
    const response = await createApp().request(`/${INVITE_ID}/decline`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: INVITE_ID,
      status: "declined",
      email: "guest@example.com",
      roomName: "Client Room",
      organizationName: "Acme Corp",
    });

    expect(invitationUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: INVITE_ID,
          status: "pending",
          expiresAt: { gt: expect.any(Date) },
        }),
        data: { status: "declined" },
      }),
    );
  });

  it("decline rejects email mismatch", async () => {
    userFindUniqueMock.mockResolvedValue({ email: "wrong@example.com" });

    const response = await createApp().request(`/${INVITE_ID}/decline`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(invitationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("decline is idempotent when already declined", async () => {
    invitationFindUniqueMock.mockResolvedValue(pendingInvitation("declined"));

    const response = await createApp().request(`/${INVITE_ID}/decline`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("declined");
    expect(invitationUpdateManyMock).not.toHaveBeenCalled();
  });

  it("decline fails when invitation is no longer pending (accept race)", async () => {
    invitationUpdateManyMock.mockResolvedValue({ count: 0 });

    const response = await createApp().request(`/${INVITE_ID}/decline`, {
      method: "POST",
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.message).toMatch(/no longer pending/i);
  });
});
