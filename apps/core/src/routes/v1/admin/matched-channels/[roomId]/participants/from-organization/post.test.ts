import { createMiddleware } from "hono/factory";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthenticationContext } from "@/middleware/auth";
import { requireAdminAuthContext } from "@/middleware/auth";

import { ADMIN_MATCHED_CHANNEL_ORG_SNAPSHOT_MAX_MEMBERS } from "@/schemas/admin.schema";

import mountAddAdminMatchedChannelParticipantsFromOrganization from "./post";

const {
  getAdminOrganizationBySlugMock,
  organizationFindUniqueMock,
  memberFindManyMock,
  ensureMatchedChannelParticipantMock,
  prismaTransactionMock,
  publishChatRoomMessageRealtimeMock,
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
  organizationFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  ensureMatchedChannelParticipantMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  publishChatRoomMessageRealtimeMock: vi.fn(),
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

vi.mock("@/helpers/chat-room-matched-membership.js", () => ({
  ensureMatchedChannelParticipant: (...args: unknown[]) =>
    ensureMatchedChannelParticipantMock(...args),
}));

vi.mock("@/helpers/chat-room-message-realtime.js", () => ({
  publishChatRoomMessageRealtime: (...args: unknown[]) =>
    publishChatRoomMessageRealtimeMock(...args),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    organization: {
      findUnique: (...args: unknown[]) => organizationFindUniqueMock(...args),
    },
    member: {
      findMany: (...args: unknown[]) => memberFindManyMock(...args),
    },
    $transaction: (...args: unknown[]) => prismaTransactionMock(...args),
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
  mountAddAdminMatchedChannelParticipantsFromOrganization(app);
  return app;
}

async function post(body: Record<string, unknown>) {
  return createApp().request(
    `http://localhost/${ROOM_ID}/participants/from-organization`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("POST /admin/matched-channels/{roomId}/participants/from-organization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authContextState.current = {
      actor: "user",
      userId: "user_admin",
      organizationId: null,
      role: "admin",
    };
    organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
    getAdminOrganizationBySlugMock.mockResolvedValue({
      id: "org_1",
      slug: "acme",
    });
    memberFindManyMock.mockResolvedValue([
      { userId: "user_a" },
      { userId: "user_b" },
      { userId: "user_c" },
    ]);
    prismaTransactionMock.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
    );
    ensureMatchedChannelParticipantMock
      .mockResolvedValueOnce({
        result: { outcome: "joined", userId: "user_a", roomId: ROOM_ID },
        statusMessages: [{ id: "msg_a" }],
      })
      .mockResolvedValueOnce({
        result: {
          outcome: "already_member",
          userId: "user_b",
          roomId: ROOM_ID,
        },
        statusMessages: [],
      })
      .mockResolvedValueOnce({
        result: { outcome: "joined", userId: "user_c", roomId: ROOM_ID },
        statusMessages: [{ id: "msg_c" }],
      });
  });

  it("snapshots org members by organizationId and returns counts", async () => {
    const response = await post({ organizationId: "org_1" });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toEqual({
      added: 2,
      alreadyMember: 1,
      totalMembers: 3,
    });
    expect(organizationFindUniqueMock).toHaveBeenCalledWith({
      where: { id: "org_1" },
      select: { id: true },
    });
    expect(ensureMatchedChannelParticipantMock).toHaveBeenCalledTimes(3);
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledTimes(2);
  });

  it("resolves the organization by slug", async () => {
    const response = await post({ organizationSlug: "acme" });
    expect(response.status).toBe(200);
    expect(getAdminOrganizationBySlugMock).toHaveBeenCalledWith(
      "acme",
      expect.anything(),
    );
    expect(organizationFindUniqueMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the organization is missing", async () => {
    organizationFindUniqueMock.mockResolvedValue(null);
    const response = await post({ organizationId: "missing" });
    expect(response.status).toBe(404);
    expect(memberFindManyMock).not.toHaveBeenCalled();
  });

  it("rejects when the organization exceeds the snapshot member soft cap", async () => {
    memberFindManyMock.mockResolvedValue(
      Array.from(
        { length: ADMIN_MATCHED_CHANNEL_ORG_SNAPSHOT_MAX_MEMBERS + 1 },
        (_, index) => ({ userId: `user_${index}` }),
      ),
    );

    const response = await post({ organizationId: "org_1" });
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.message).toMatch(/Snapshot is limited/i);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
    expect(ensureMatchedChannelParticipantMock).not.toHaveBeenCalled();
  });

  it("rejects when both id and slug are provided", async () => {
    const response = await post({
      organizationId: "org_1",
      organizationSlug: "acme",
    });
    expect(response.status).toBe(422);
  });
});
