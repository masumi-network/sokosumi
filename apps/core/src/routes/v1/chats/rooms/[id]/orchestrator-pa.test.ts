/**
 * SOK-942: Owner can add PA as orchestrator member, @mention it (starts a
 * Soko Bot turn), and see orchestrator sender identity. PA stays out of
 * coworker hire galleries; room orchestratorMembers feed mention pickers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";
import mountPostRoomMessage from "./messages/post";
import mountPatchChatRoom from "./patch";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  roomUpdateMock,
  sokoBotFindManyMock,
  workspaceFindUniqueMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  memberFindManyMock,
  orchestratorMemberDeleteManyMock,
  orchestratorMemberCreateManyMock,
  mentionUpdateManyMock,
  messageCreateMock,
  prismaTransactionMock,
  dispatchMock,
  waitUntilMock,
  membershipFindManyMock,
  readStateFindManyMock,
  readStateUpsertMock,
  threadReadUpsertMock,
  messageFindFirstMock,
  messageFindUniqueMock,
  scheduleUnfurlsMock,
  emitChatMentionNotificationsMock,
  emitChatDirectMessageNotificationsMock,
  roomUpdateActivityMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  sokoBotFindManyMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  memberFindManyMock: vi.fn(),
  orchestratorMemberDeleteManyMock: vi.fn(),
  orchestratorMemberCreateManyMock: vi.fn(),
  mentionUpdateManyMock: vi.fn(),
  messageCreateMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  dispatchMock: vi.fn(),
  waitUntilMock: vi.fn(),
  membershipFindManyMock: vi.fn(),
  readStateFindManyMock: vi.fn(),
  readStateUpsertMock: vi.fn(),
  threadReadUpsertMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageFindUniqueMock: vi.fn(),
  scheduleUnfurlsMock: vi.fn(),
  emitChatMentionNotificationsMock: vi.fn(),
  emitChatDirectMessageNotificationsMock: vi.fn(),
  roomUpdateActivityMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
    chatRoom: {
      findFirst: roomFindFirstMock,
    },
    chatRoomMessage: {
      findUnique: messageFindUniqueMock,
      findFirst: messageFindFirstMock,
    },
    chatRoomUserMember: {
      findMany: membershipFindManyMock,
    },
    chatRoomReadState: {
      findMany: readStateFindManyMock,
      upsert: readStateUpsertMock,
    },
    chatRoomThreadReadState: {
      upsert: threadReadUpsertMock,
    },
    chatRoomPinnedMessage: {
      groupBy: vi.fn().mockResolvedValue([]),
    },
    sokoBot: {
      findMany: sokoBotFindManyMock,
    },
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
    organization: {
      findUnique: organizationFindUniqueMock,
    },
    member: {
      findUnique: memberFindUniqueMock,
      findMany: memberFindManyMock,
    },
  },
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: waitUntilMock,
}));

vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: dispatchMock,
}));

vi.mock("@/services/chat-room-message-unfurl.service", () => ({
  scheduleChatRoomMessageUnfurls: scheduleUnfurlsMock,
}));

vi.mock("@/helpers/chat-mention-notifications", () => ({
  emitChatMentionNotifications: (...args: unknown[]) =>
    emitChatMentionNotificationsMock(...args),
}));

vi.mock("@/helpers/chat-direct-message-notifications", () => ({
  emitChatDirectMessageNotifications: (...args: unknown[]) =>
    emitChatDirectMessageNotificationsMock(...args),
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: vi.fn().mockResolvedValue(undefined),
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440002";
const MENTION_ID = "550e8400-e29b-41d4-a716-446655440003";
const ORCHESTRATOR_ID = "550e8400-e29b-41d4-a716-446655440099";
const USER_ID = "user_owner";
const ORG_ID = "org_123";
const WORKSPACE_ID = "550e8400-e29b-41d4-a716-446655440010";

function buildPatchApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: ORG_ID,
      role: "user",
    } as AuthVariables["authContext"]);
    return next();
  });
  mountPatchChatRoom(app);
  return app;
}

function buildMessageApp() {
  const app = new OpenAPIHonoWithAuth();
  app.onError(errorHandler);
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", {
      actor: "user",
      userId: USER_ID,
      organizationId: ORG_ID,
      role: "user",
    } as AuthVariables["authContext"]);
    return next();
  });
  mountPostRoomMessage(app);
  return app;
}

const orchestratorParticipant = {
  id: ORCHESTRATOR_ID,
  name: "Ada",
  slug: "ada",
  caption: "Owner's personal assistant",
  image: null,
  presence: "online" as const,
  avatarSeed: `orb:${USER_ID}`,
  ownerUserId: USER_ID,
};

const baseRoom = {
  id: ROOM_ID,
  organizationId: ORG_ID,
  name: "Launch",
  slug: "launch",
  kind: "channel",
  directKey: null,
  topic: null,
  discoverability: "public",
  createdByUserId: USER_ID,
  createdAt: new Date("2026-09-01T12:00:00.000Z"),
  updatedAt: new Date("2026-09-01T12:00:00.000Z"),
  archivedAt: null,
  userMembers: [
    {
      access: "member",
      createdAt: new Date("2026-09-01T12:00:00.000Z"),
      user: {
        id: USER_ID,
        name: "Owner",
        email: "owner@example.com",
        image: null,
      },
    },
  ],
  coworkerMembers: [],
  orchestratorMembers: [],
};

describe("SOK-942 PA as orchestrator member / mention / picker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitUntilMock.mockImplementation((p: Promise<unknown>) => p);
    dispatchMock.mockResolvedValue(undefined);
    scheduleUnfurlsMock.mockResolvedValue(undefined);
    emitChatMentionNotificationsMock.mockResolvedValue(undefined);
    emitChatDirectMessageNotificationsMock.mockResolvedValue(undefined);
    organizationFindUniqueMock.mockResolvedValue({
      id: ORG_ID,
      name: "Acme",
    });
    memberFindUniqueMock.mockResolvedValue({
      userId: USER_ID,
      organizationId: ORG_ID,
      role: "owner",
    });
    memberFindManyMock.mockResolvedValue([{ userId: USER_ID }]);
    workspaceFindUniqueMock.mockResolvedValue({ id: WORKSPACE_ID });
    membershipFindManyMock.mockResolvedValue([
      {
        roomId: ROOM_ID,
        userId: USER_ID,
        starredAt: null,
        mutedAt: null,
      },
    ]);
    readStateFindManyMock.mockResolvedValue([]);
    readStateUpsertMock.mockResolvedValue({});
    threadReadUpsertMock.mockResolvedValue({});
  });

  it("owner can add their PA to a room as an orchestrator member", async () => {
    const existing = {
      ...baseRoom,
      orchestratorMembers: [],
    };
    const updated = {
      ...baseRoom,
      orchestratorMembers: [
        {
          orchestrator: {
            id: ORCHESTRATOR_ID,
            name: "Ada",
            avatarImageUrl: null,
            avatarSeed: `orb:${USER_ID}`,
            userId: USER_ID,
            archivedAt: null,
            deletedAt: null,
            user: { name: "Owner User" },
          },
        },
      ],
    };

    roomFindFirstMock.mockResolvedValue(existing);
    sokoBotFindManyMock.mockResolvedValue([
      {
        id: ORCHESTRATOR_ID,
        name: "Ada",
        userId: USER_ID,
        workspaceId: WORKSPACE_ID,
        archivedAt: null,
        deletedAt: null,
      },
    ]);

    prismaTransactionMock.mockImplementation(
      async (fn: (tx: unknown) => unknown) => {
        const tx = {
          chatRoom: {
            findFirst: roomFindFirstMock,
            update: roomUpdateMock.mockResolvedValue(updated),
          },
          organization: { findUnique: organizationFindUniqueMock },
          member: {
            findUnique: memberFindUniqueMock,
            findMany: memberFindManyMock,
          },
          workspace: { findUnique: workspaceFindUniqueMock },
          sokoBot: { findMany: sokoBotFindManyMock },
          chatRoomOrchestratorMember: {
            deleteMany: orchestratorMemberDeleteManyMock.mockResolvedValue({
              count: 0,
            }),
            createMany: orchestratorMemberCreateManyMock.mockResolvedValue({
              count: 1,
            }),
          },
          chatRoomMention: {
            updateMany: mentionUpdateManyMock.mockResolvedValue({ count: 0 }),
          },
          chatRoomUserMember: {
            findMany: vi.fn().mockResolvedValue(existing.userMembers),
            count: vi.fn().mockResolvedValue(1),
            deleteMany: vi.fn(),
            updateMany: vi.fn(),
            createMany: vi.fn(),
          },
          chatRoomCoworkerMember: {
            deleteMany: vi.fn(),
            createMany: vi.fn(),
          },
          chatRoomReadState: {
            deleteMany: vi.fn(),
            createMany: vi.fn(),
          },
          chatRoomGuestInvitation: {
            count: vi.fn().mockResolvedValue(0),
            updateMany: vi.fn(),
          },
          chatRoomGuestInviteLink: {
            count: vi.fn().mockResolvedValue(0),
          },
          chatRoomMessage: { create: vi.fn() },
          $queryRaw: vi.fn().mockResolvedValue([{ id: ROOM_ID }]),
        };
        return fn(tx);
      },
    );

    const app = buildPatchApp();
    const response = await app.request(`http://localhost/${ROOM_ID}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orchestratorIds: [ORCHESTRATOR_ID] }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.orchestratorMembers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: ORCHESTRATOR_ID,
          name: "Ada",
          ownerUserId: USER_ID,
        }),
      ]),
    );
    expect(orchestratorMemberCreateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [{ roomId: ROOM_ID, orchestratorId: ORCHESTRATOR_ID }],
      }),
    );
    expect(body.data.coworkerMembers).toEqual([]);
  });

  it("owner @mention of PA creates orchestrator mention and dispatches turn", async () => {
    const roomWithPa = {
      ...baseRoom,
      providerConversationId: null,
      orchestratorMembers: [
        {
          orchestrator: {
            id: ORCHESTRATOR_ID,
            name: "Ada",
            avatarImageUrl: null,
            avatarSeed: `orb:${USER_ID}`,
            userId: USER_ID,
            archivedAt: null,
            deletedAt: null,
            user: { name: "Owner User" },
          },
        },
      ],
      coworkerMembers: [],
    };

    const createdMessage = {
      id: MESSAGE_ID,
      roomId: ROOM_ID,
      parentMessageId: null,
      content: "@orchestrator:ada hello",
      createdAt: new Date("2026-09-01T12:01:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: null,
      senderUserId: USER_ID,
      senderCoworkerId: null,
      senderOrchestratorId: null,
      senderUser: {
        id: USER_ID,
        name: "Owner",
        email: "owner@example.com",
        image: null,
      },
      senderCoworker: null,
      senderOrchestrator: null,
      mentionsAsSource: [
        {
          id: MENTION_ID,
          coworkerId: null,
          orchestratorId: ORCHESTRATOR_ID,
          status: "pending",
          responseMessageId: null,
        },
      ],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    };

    roomFindFirstMock.mockResolvedValue(roomWithPa);
    messageFindFirstMock.mockResolvedValue(null);
    messageFindUniqueMock.mockResolvedValue(createdMessage);

    prismaTransactionMock.mockImplementation(
      async (fn: (tx: unknown) => unknown) => {
        const tx = {
          chatRoom: {
            findFirst: roomFindFirstMock,
            update: roomUpdateActivityMock.mockResolvedValue({}),
          },
          chatRoomMessage: {
            findFirst: messageFindFirstMock,
            create: messageCreateMock.mockResolvedValue(createdMessage),
          },
          chatRoomReadState: { upsert: readStateUpsertMock },
          chatRoomThreadReadState: { upsert: threadReadUpsertMock },
          chatRoomUserMember: { findMany: membershipFindManyMock },
        };
        return fn(tx);
      },
    );

    const app = buildMessageApp();
    const response = await app.request(`http://localhost/${ROOM_ID}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "@orchestrator:ada hello",
        mentionedOrchestratorIds: [ORCHESTRATOR_ID],
      }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.data.mentions).toEqual([
      expect.objectContaining({
        id: MENTION_ID,
        coworkerId: null,
        orchestratorId: ORCHESTRATOR_ID,
        status: "pending",
      }),
    ]);
    expect(messageCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          mentionsAsSource: {
            create: [
              expect.objectContaining({
                orchestratorId: ORCHESTRATOR_ID,
              }),
            ],
          },
        }),
      }),
    );
    expect(waitUntilMock).toHaveBeenCalled();
    expect(dispatchMock).toHaveBeenCalledWith(MENTION_ID);
  });

  it("maps Thought / reply sender as orchestrator identity", async () => {
    // Exercise mapChatRoomMessage via a GET-shaped message with orchestrator sender.
    const { mapChatRoomMessage } = await import("../helpers");
    const mapped = mapChatRoomMessage({
      id: MESSAGE_ID,
      roomId: ROOM_ID,
      parentMessageId: null,
      content: "On it.",
      createdAt: new Date("2026-09-01T12:02:00.000Z"),
      deletedAt: null,
      editedAt: null,
      metadata: { thought: true },
      senderUser: null,
      senderCoworker: null,
      senderOrchestrator: {
        id: ORCHESTRATOR_ID,
        name: "Ada",
        avatarImageUrl: null,
        avatarSeed: `orb:${USER_ID}`,
        userId: USER_ID,
        archivedAt: null,
        deletedAt: null,
        user: { name: "Owner User" },
      },
      mentionsAsSource: [],
      reactions: [],
      replies: [],
      _count: { replies: 0 },
    } as never);

    expect(mapped.sender).toEqual({
      type: "orchestrator",
      orchestrator: expect.objectContaining({
        id: ORCHESTRATOR_ID,
        name: "Ada",
        ownerUserId: USER_ID,
      }),
    });
  });
});
