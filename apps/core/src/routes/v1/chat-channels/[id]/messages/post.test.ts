import { OpenAPIHono } from "@hono/zod-openapi";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { OpenAPIHonoWithAuth } from "@/lib/hono";
import { defaultValidationHook } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostChannelMessage from "./post";

const {
  channelFindFirstMock,
  channelUpdateMock,
  messageFindFirstMock,
  messageFindManyMock,
  messageCreateMock,
  readStateUpsertMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  prismaTransactionMock,
  dispatchMock,
  waitUntilMock,
} = vi.hoisted(() => ({
  channelFindFirstMock: vi.fn(),
  channelUpdateMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindManyMock: vi.fn(),
  messageCreateMock: vi.fn(),
  readStateUpsertMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  dispatchMock: vi.fn(),
  waitUntilMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

vi.mock("@/services/chat-channel-coworker-dispatch.service", () => ({
  dispatchChatChannelMention: dispatchMock,
}));

const CHANNEL_ID = "550e8400-e29b-41d4-a716-446655440000";
const PARENT_MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const MENTION_ID = "550e8400-e29b-41d4-a716-446655440003";
const COWORKER_ID = "coworker_1";
const USER_ID = "user_123";

const tx = {
  chatChannel: {
    findFirst: channelFindFirstMock,
    update: channelUpdateMock,
  },
  chatChannelMessage: {
    findFirst: messageFindFirstMock,
    findMany: messageFindManyMock,
    create: messageCreateMock,
  },
  chatChannelReadState: {
    upsert: readStateUpsertMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHono<{ Variables: AuthVariables }>({
    defaultHook: defaultValidationHook,
  });

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountPostChannelMessage(app as unknown as OpenAPIHonoWithAuth);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

const coworkerAuthContext: AuthVariables["authContext"] = {
  actor: "coworker",
  coworkerId: COWORKER_ID,
  vendorId: "vendor_1",
};

function channelWithMembers() {
  return {
    id: CHANNEL_ID,
    organizationId: "org_1",
    name: "general",
    slug: "general",
    kind: "channel",
    directKey: null,
    topic: null,
    createdByUserId: USER_ID,
    createdAt: new Date("2025-01-01T00:00:00.000Z"),
    updatedAt: new Date("2025-01-01T00:00:00.000Z"),
    archivedAt: null,
    userMembers: [],
    coworkerMembers: [
      {
        coworker: {
          id: COWORKER_ID,
          name: "Hannah",
          slug: "hannah",
          caption: null,
          image: null,
        },
      },
    ],
  };
}

function createdMessage(
  overrides: Partial<{
    senderUserId: string | null;
    senderCoworkerId: string | null;
    parentMessageId: string | null;
    mentionsAsSource: Array<{
      id: string;
      coworkerId: string;
      status: string;
      responseMessageId: string | null;
    }>;
  }> = {},
) {
  return {
    id: "550e8400-e29b-41d4-a716-446655440002",
    channelId: CHANNEL_ID,
    parentMessageId: overrides.parentMessageId ?? null,
    senderUserId: overrides.senderUserId ?? null,
    senderCoworkerId: overrides.senderCoworkerId ?? null,
    content: "hello",
    metadata: null,
    createdAt: new Date("2025-01-02T00:00:00.000Z"),
    senderUser: overrides.senderUserId
      ? {
          id: overrides.senderUserId,
          name: "Patrick",
          email: "patrick@example.com",
          image: null,
          sessions: [],
        }
      : null,
    senderCoworker: overrides.senderCoworkerId
      ? {
          id: overrides.senderCoworkerId,
          name: "Hannah",
          slug: "hannah",
          caption: null,
          image: null,
        }
      : null,
    mentionsAsSource: overrides.mentionsAsSource ?? [],
    reactions: [],
    replies: [],
    _count: { replies: 0 },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaTransactionMock.mockImplementation(async (callback) => callback(tx));
  organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
  memberFindUniqueMock.mockResolvedValue({ role: "member" });
  channelUpdateMock.mockResolvedValue({});
  readStateUpsertMock.mockResolvedValue({});
  waitUntilMock.mockImplementation(() => {});
});

describe("POST /chat-channels/{id}/messages", () => {
  describe("coworker actor", () => {
    it("lets a member coworker post as itself without mention rows", async () => {
      channelFindFirstMock.mockResolvedValue({ id: CHANNEL_ID });
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderCoworkerId: COWORKER_ID }),
      );

      const app = createApp(coworkerAuthContext);
      const response = await app.request(`/${CHANNEL_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body.data.sender.type).toBe("coworker");
      expect(body.data.sender.coworker.id).toBe(COWORKER_ID);
      expect(body.data.mentions).toEqual([]);

      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            senderCoworkerId: COWORKER_ID,
            content: "hello",
          }),
        }),
      );
      const createData = messageCreateMock.mock.calls[0]?.[0]?.data;
      expect(createData?.mentionsAsSource).toBeUndefined();
      expect(createData?.senderUserId).toBeUndefined();
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(readStateUpsertMock).not.toHaveBeenCalled();

      // Membership is enforced in the channel lookup itself.
      expect(channelFindFirstMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            coworkerMembers: { some: { coworkerId: COWORKER_ID } },
          }),
        }),
      );
    });

    it("rejects a coworker that is not a channel member", async () => {
      channelFindFirstMock.mockResolvedValue(null);

      const app = createApp(coworkerAuthContext);
      const response = await app.request(`/${CHANNEL_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "hello" }),
      });

      expect(response.status).toBe(404);
      expect(messageCreateMock).not.toHaveBeenCalled();
    });
  });

  describe("thread replies", () => {
    it("delivers a user thread reply to coworkers already in the thread", async () => {
      channelFindFirstMock.mockResolvedValue(channelWithMembers());
      messageFindFirstMock.mockResolvedValue({
        id: PARENT_MESSAGE_ID,
        parentMessageId: null,
      });
      messageFindManyMock.mockResolvedValue([
        { senderCoworkerId: COWORKER_ID, mentionsAsSource: [] },
        {
          senderCoworkerId: null,
          mentionsAsSource: [{ coworkerId: "coworker_not_in_channel" }],
        },
      ]);
      messageCreateMock.mockResolvedValue(
        createdMessage({
          senderUserId: USER_ID,
          parentMessageId: PARENT_MESSAGE_ID,
          mentionsAsSource: [
            {
              id: MENTION_ID,
              coworkerId: COWORKER_ID,
              status: "pending",
              responseMessageId: null,
            },
          ],
        }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${CHANNEL_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "no mention here",
          parentMessageId: PARENT_MESSAGE_ID,
        }),
      });

      expect(response.status).toBe(201);

      // The thread coworker became a mention target without an @mention;
      // the non-member coworker id from the thread was filtered out.
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mentionsAsSource: {
              create: [{ coworkerId: COWORKER_ID }],
            },
          }),
        }),
      );
      expect(dispatchMock).toHaveBeenCalledWith(MENTION_ID);
    });

    it("does not add coworkers for a top-level message without mentions", async () => {
      channelFindFirstMock.mockResolvedValue(channelWithMembers());
      messageCreateMock.mockResolvedValue(
        createdMessage({ senderUserId: USER_ID }),
      );

      const app = createApp(userAuthContext);
      const response = await app.request(`/${CHANNEL_ID}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "no mention here" }),
      });

      expect(response.status).toBe(201);
      expect(messageFindManyMock).not.toHaveBeenCalled();
      expect(messageCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            mentionsAsSource: { create: [] },
          }),
        }),
      );
      expect(dispatchMock).not.toHaveBeenCalled();
    });
  });
});
