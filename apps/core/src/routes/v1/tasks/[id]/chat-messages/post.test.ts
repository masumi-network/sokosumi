import { beforeEach, describe, expect, it, vi } from "vitest";
import { notFound } from "@/helpers/error";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountPostTaskChatMessage from "./post";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  lockMock,
  requireTaskReadMock,
  requireWritableChatRoomMock,
  emitEffectsMock,
  dispatchMock,
  publishMock,
  messageFindUniqueMock,
  messageCreateMock,
  roomUpdateMock,
  readStateUpsertMock,
  transactionMock,
} = vi.hoisted(() => ({
  requireTaskReadMock: vi.fn(),
  requireWritableChatRoomMock: vi.fn(),
  emitEffectsMock: vi.fn(),
  dispatchMock: vi.fn(),
  publishMock: vi.fn(),
  messageFindUniqueMock: vi.fn(),
  messageCreateMock: vi.fn(),
  roomUpdateMock: vi.fn(),
  readStateUpsertMock: vi.fn(),
  transactionMock: vi.fn(),
  lockMock: vi.fn(),
}));

vi.mock("./send-lock", () => ({ lockTaskChatSend: lockMock }));
vi.mock("@/helpers/access-control", () => ({
  requireTaskReadForRouteVars: requireTaskReadMock,
}));
vi.mock("@/routes/v1/chats/rooms/writable-chat-room", () => ({
  requireWritableChatRoom: requireWritableChatRoomMock,
}));
vi.mock("@/routes/v1/chats/rooms/human-message-effects", () => ({
  emitHumanRoomMessageEffects: emitEffectsMock,
}));
// The agent boundary: a shared Task must never reach it.
vi.mock("@/services/chat-room-coworker-dispatch.service", () => ({
  dispatchChatRoomMention: dispatchMock,
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: publishMock,
}));

const tx = {
  chatRoomMessage: {
    findUnique: messageFindUniqueMock,
    create: messageCreateMock,
  },
  chatRoom: { update: roomUpdateMock },
  chatRoomReadState: { upsert: readStateUpsertMock },
};

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: transactionMock,
    chatRoomMessage: {
      findUnique: messageFindUniqueMock,
      groupBy: vi.fn().mockResolvedValue([]),
    },
  },
}));

const USER_ID = "user_1";
const TASK_ID = "0190a000-0000-7000-8000-000000000001";
const ROOM_ID = "0190a000-0000-7000-8000-000000000002";
const MESSAGE_ID = "0190a000-0000-7000-8000-000000000003";
const CLIENT_ID = "attempt-1";
const LINK = `[SOK-12 Weekly report](/tasks/${TASK_ID})`;

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

function createApp() {
  const app = new OpenAPIHonoWithAuth();
  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", userAuthContext);
    return await next();
  });
  mountPostTaskChatMessage(app);
  return app;
}

function task(overrides: Record<string, unknown> = {}) {
  return {
    id: TASK_ID,
    name: "Weekly report",
    number: 12,
    visibility: "PUBLIC",
    project: { identifier: "SOK" },
    workspace: { organizationId: "org_1" },
    ...overrides,
  };
}

function room(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOM_ID,
    name: "general",
    groupName: null,
    organizationId: "org_1",
    kind: "channel",
    directKey: null,
    discoverability: "public",
    sharedSokoBot: null,
    userMembers: [
      { userId: USER_ID, access: "member", user: { name: "Pat" } },
      { userId: "user_2", access: "member", user: { name: "Sam" } },
    ],
    coworkerMembers: [],
    sokoBotMembers: [],
    ...overrides,
  };
}

function message(
  content: string,
  {
    senderUserId = USER_ID,
    attempt = { taskId: TASK_ID, note: "" },
  }: {
    senderUserId?: string;
    attempt?: { taskId: string; note: string };
  } = {},
) {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    senderUserId,
    senderCoworkerId: null,
    senderSokoBotId: null,
    content,
    metadata: { client_message_id: CLIENT_ID, task_chat_attempt: attempt },
    createdAt: new Date("2026-11-10T10:00:00.000Z"),
    editedAt: null,
    senderUser: {
      id: senderUserId,
      name: "Pat",
      email: "pat@example.com",
      image: null,
      sessions: [],
    },
    senderCoworker: null,
    senderSokoBot: null,
    mentionsAsSource: [],
    reactions: [],
    replies: [],
    pins: [],
  };
}

function send(body: Record<string, unknown> = {}) {
  return createApp().request(`/${TASK_ID}/chat-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      roomId: ROOM_ID,
      clientMessageId: CLIENT_ID,
      ...body,
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  transactionMock.mockImplementation(async (callback) => callback(tx));
  requireTaskReadMock.mockResolvedValue(task());
  requireWritableChatRoomMock.mockResolvedValue(room());
  messageFindUniqueMock.mockResolvedValue(null);
  lockMock.mockResolvedValue(undefined);
  messageCreateMock.mockImplementation(async ({ data }) =>
    message(data.content, { attempt: data.metadata.task_chat_attempt }),
  );
  roomUpdateMock.mockResolvedValue({});
  readStateUpsertMock.mockResolvedValue({});
  publishMock.mockResolvedValue(undefined);
});

describe("POST /tasks/{id}/chat-messages", () => {
  it("posts the current Task as a passive message that starts no agent", async () => {
    const response = await send({ note: "Can you take this?" });

    expect(response.status).toBe(201);
    expect(requireTaskReadMock).toHaveBeenCalledWith(
      expect.anything(),
      TASK_ID,
      tx,
      expect.any(Object),
    );
    expect(messageCreateMock).toHaveBeenCalledTimes(1);
    const { data } = messageCreateMock.mock.calls[0]![0];
    expect(data).toEqual({
      roomId: ROOM_ID,
      senderUserId: USER_ID,
      content: `Can you take this?\n\n${LINK}`,
      clientMessageId: CLIENT_ID,
      metadata: {
        client_message_id: CLIENT_ID,
        task_chat_attempt: { taskId: TASK_ID, note: "Can you take this?" },
      },
    });
    expect(data).not.toHaveProperty("mentionsAsSource");
    expect(data).not.toHaveProperty("userMentionsAsSource");
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(emitEffectsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authorUserId: USER_ID,
        mentionedUserIds: [],
        room: expect.objectContaining({
          memberUserIds: [USER_ID, "user_2"],
        }),
      }),
    );
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a Task made private after the dialog loaded", async () => {
    requireTaskReadMock.mockResolvedValue(task({ visibility: "PRIVATE" }));

    const response = await send();

    expect(response.status).toBe(403);
    expect(messageCreateMock).not.toHaveBeenCalled();
  });

  it("refuses a Task the caller can no longer read in this workspace", async () => {
    // Moved away, or access revoked: the active-workspace read misses.
    requireTaskReadMock.mockRejectedValue(notFound("Task not found"));

    const response = await send();

    expect(response.status).toBe(404);
    expect(messageCreateMock).not.toHaveBeenCalled();
  });

  it.each([
    ["turned external", room({ discoverability: "external" })],
    [
      "holding a guest",
      room({
        userMembers: [
          { userId: USER_ID, access: "member", user: { name: "Pat" } },
          { userId: "guest_1", access: "guest", user: { name: "Gus" } },
        ],
      }),
    ],
    [
      "with a Soko Bot (Direct)",
      room({
        kind: "direct",
        discoverability: null,
        sokoBotMembers: [
          { sokoBot: { id: "bot_1", name: "Nora", user: null } },
        ],
      }),
    ],
    [
      "with a Coworker",
      room({
        coworkerMembers: [
          { coworker: { id: "cw_1", name: "Hannah", slug: "hannah" } },
        ],
      }),
    ],
    ["of another organization", room({ organizationId: "org_2" })],
    [
      "a personal Direct",
      room({ kind: "direct", organizationId: null, discoverability: null }),
    ],
  ])("refuses a room %s at send time", async (_label, target) => {
    requireWritableChatRoomMock.mockResolvedValue(target);

    const response = await send();

    expect(response.status).toBe(403);
    expect(messageCreateMock).not.toHaveBeenCalled();
    expect(emitEffectsMock).not.toHaveBeenCalled();
  });

  it("sends a personal Task to the sender's notes", async () => {
    requireTaskReadMock.mockResolvedValue(
      task({
        workspace: { organizationId: null },
        project: null,
        number: null,
      }),
    );
    requireWritableChatRoomMock.mockResolvedValue(
      room({
        kind: "direct",
        organizationId: null,
        discoverability: null,
        directKey: `direct:self:${USER_ID}`,
        userMembers: [
          { userId: USER_ID, access: "member", user: { name: "Pat" } },
        ],
      }),
    );

    const response = await send();

    expect(response.status).toBe(201);
    expect(messageCreateMock.mock.calls[0]![0].data.content).toBe(
      `[Weekly report](/tasks/${TASK_ID})`,
    );
  });

  it("locks the Task, memberships and room before it reads them", async () => {
    await send();

    expect(lockMock).toHaveBeenCalledWith(tx, {
      taskId: TASK_ID,
      roomId: ROOM_ID,
      userId: USER_ID,
    });
    const lockedAt = lockMock.mock.invocationCallOrder[0]!;
    expect(lockedAt).toBeLessThan(
      requireTaskReadMock.mock.invocationCallOrder[0]!,
    );
    expect(lockedAt).toBeLessThan(
      requireWritableChatRoomMock.mock.invocationCallOrder[0]!,
    );
  });

  it("answers 404 when the sender left the organization or room", async () => {
    lockMock.mockRejectedValue(notFound("Room not found"));

    const response = await send();

    expect(response.status).toBe(404);
    expect(requireTaskReadMock).not.toHaveBeenCalled();
    expect(messageCreateMock).not.toHaveBeenCalled();
  });

  it("answers a retry of the same attempt with the first message, once", async () => {
    messageFindUniqueMock.mockResolvedValue(message(LINK));

    const response = await send();

    expect(response.status).toBe(201);
    expect(messageCreateMock).not.toHaveBeenCalled();
    expect(emitEffectsMock).not.toHaveBeenCalled();
  });

  it.each([
    ["the Task was renamed", "[SOK-12 Old name](/tasks/x)"],
    ["the message was edited", "edited by its sender"],
  ])(
    "replays the first message when %s after a lost response",
    async (_label, storedContent) => {
      messageFindUniqueMock.mockResolvedValue(
        message(storedContent, { attempt: { taskId: TASK_ID, note: "Hi" } }),
      );

      const response = await send({ note: "  Hi " });

      expect(response.status).toBe(201);
      const body = (await response.json()) as { data: { id: string } };
      expect(body.data.id).toBe(MESSAGE_ID);
      expect(messageCreateMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["another note", { taskId: TASK_ID, note: "Old note" }, USER_ID],
    ["another Task", { taskId: "other-task", note: "" }, USER_ID],
    ["another sender", { taskId: TASK_ID, note: "" }, "user_2"],
  ])(
    "refuses an id already used for %s",
    async (_label, attempt, senderUserId) => {
      messageFindUniqueMock.mockResolvedValue(
        message(LINK, { attempt, senderUserId }),
      );

      const response = await send();

      expect(response.status).toBe(409);
      expect(messageCreateMock).not.toHaveBeenCalled();
    },
  );

  it("returns the winner when two sends of one attempt race", async () => {
    transactionMock.mockRejectedValueOnce(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    messageFindUniqueMock.mockResolvedValue(message(LINK));

    const response = await send();

    expect(response.status).toBe(201);
    expect(emitEffectsMock).not.toHaveBeenCalled();
    expect(publishMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a race winner that carried another note or Task", async () => {
    transactionMock.mockRejectedValueOnce(
      Object.assign(new Error("unique"), { code: "P2002" }),
    );
    messageFindUniqueMock.mockResolvedValue(
      message(LINK, { attempt: { taskId: "other-task", note: "Other" } }),
    );

    const response = await send();

    expect(response.status).toBe(409);
    expect(publishMock).not.toHaveBeenCalled();
  });
});
