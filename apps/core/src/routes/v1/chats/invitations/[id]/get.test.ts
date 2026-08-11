import { OpenAPIHono } from "@hono/zod-openapi";
import type { RequestIdVariables } from "hono/request-id";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountGetInviteeInvitation from "./get";

const {
  userFindUniqueMock,
  invitationFindUniqueMock,
  invitationUpdateManyMock,
} = vi.hoisted(() => ({
  userFindUniqueMock: vi.fn(),
  invitationFindUniqueMock: vi.fn(),
  invitationUpdateManyMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    user: { findUnique: userFindUniqueMock },
    chatRoomGuestInvitation: {
      findUnique: invitationFindUniqueMock,
      updateMany: invitationUpdateManyMock,
    },
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
  const app = new OpenAPIHono<{
    Variables: AuthVariables & RequestIdVariables;
  }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("requestId", "req_get_invitee");
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  app.onError(errorHandler);
  mountGetInviteeInvitation(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  userFindUniqueMock.mockResolvedValue({ email: "guest@example.com" });
  invitationFindUniqueMock.mockResolvedValue({
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
  });
});

describe("GET /chats/invitations/{id}", () => {
  it("returns invitation for matching email", async () => {
    const response = await createApp().request(`/${INVITE_ID}`, {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      id: INVITE_ID,
      roomName: "Client Room",
      organizationName: "Acme Corp",
      status: "pending",
      email: "guest@example.com",
    });
  });

  it("returns 404 on email mismatch", async () => {
    userFindUniqueMock.mockResolvedValue({ email: "wrong@example.com" });

    const response = await createApp().request(`/${INVITE_ID}`, {
      method: "GET",
    });

    expect(response.status).toBe(404);
  });

  it("marks expired pending invitations", async () => {
    invitationFindUniqueMock.mockResolvedValue({
      id: INVITE_ID,
      roomId: ROOM_ID,
      email: "guest@example.com",
      inviterId: INVITER_ID,
      status: "pending",
      expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      acceptedAt: null,
      acceptedByUserId: null,
      createdAt: new Date("2019-12-01T00:00:00.000Z"),
      updatedAt: new Date("2019-12-01T00:00:00.000Z"),
      inviter: { id: INVITER_ID, name: "Ada Lovelace" },
      room: {
        id: ROOM_ID,
        name: "Client Room",
        organizationId: ORG_ID,
        organization: { id: ORG_ID, name: "Acme Corp" },
      },
    });

    const response = await createApp().request(`/${INVITE_ID}`, {
      method: "GET",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.status).toBe("expired");
    expect(invitationUpdateManyMock).toHaveBeenCalledWith({
      where: { id: INVITE_ID, status: "pending" },
      data: { status: "expired" },
    });
  });
});
