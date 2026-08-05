import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeclineInviteeInvitation from "./post";

const {
  userFindUniqueMock,
  invitationFindUniqueMock,
  invitationUpdateMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  invitationFindUniqueMock: vi.fn(),
  invitationUpdateMock: vi.fn(),
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
    update: invitationUpdateMock,
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
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_decline_invite");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountDeclineInviteeInvitation(app as unknown as OpenAPIHonoWithAuth);
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
  invitationUpdateMock.mockResolvedValue(pendingInvitation("declined"));
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

    expect(invitationUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: INVITE_ID },
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
    expect(invitationUpdateMock).not.toHaveBeenCalled();
  });

  it("decline is idempotent when already declined", async () => {
    invitationFindUniqueMock.mockResolvedValue(pendingInvitation("declined"));

    const response = await createApp().request(`/${INVITE_ID}/decline`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("declined");
    expect(invitationUpdateMock).not.toHaveBeenCalled();
  });
});
