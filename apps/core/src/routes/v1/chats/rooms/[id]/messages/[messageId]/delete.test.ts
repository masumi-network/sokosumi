import { Prisma } from "@sokosumi/database";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import type { AuthVariables } from "@/middleware/auth";

import mountDeleteChatRoomMessage from "./delete";

vi.mock("@/middleware/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/middleware/auth")>();
  const { stubAuthMiddleware } = await import(
    "@/test-fixtures/auth-middleware"
  );
  return { ...actual, authMiddleware: stubAuthMiddleware };
});

const {
  roomFindFirstMock,
  organizationFindUniqueMock,
  memberFindUniqueMock,
  messageFindFirstMock,
  messageUpdateManyMock,
  mentionUpdateManyMock,
  pinDeleteManyMock,
  pinCountMock,
  prismaTransactionMock,
} = vi.hoisted(() => ({
  roomFindFirstMock: vi.fn(),
  organizationFindUniqueMock: vi.fn(),
  memberFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  messageUpdateManyMock: vi.fn(),
  mentionUpdateManyMock: vi.fn(),
  pinDeleteManyMock: vi.fn(),
  pinCountMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    $transaction: prismaTransactionMock,
  },
}));

const {
  publishChatRoomMessageRealtimeMock,
  publishChatRoomMessageRealtimeByIdMock,
} = vi.hoisted(() => ({
  publishChatRoomMessageRealtimeMock: vi.fn().mockResolvedValue(undefined),
  publishChatRoomMessageRealtimeByIdMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtime: publishChatRoomMessageRealtimeMock,
  publishChatRoomMessageRealtimeById: publishChatRoomMessageRealtimeByIdMock,
}));

vi.mock("@/helpers/chat-room-pinned-message-realtime", () => ({
  publishChatRoomPinnedMessageRealtime: vi.fn().mockResolvedValue(undefined),
}));

const { rewriteChatNotificationPreviewsMock } = vi.hoisted(() => ({
  rewriteChatNotificationPreviewsMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/helpers/chat-notification-fanout", () => ({
  rewriteChatNotificationPreviews: rewriteChatNotificationPreviewsMock,
}));

const {
  deleteChatRoomFilesIfOwnedMock,
  deleteSnapshotsMock,
  waitUntilPromises,
} = vi.hoisted(() => ({
  deleteChatRoomFilesIfOwnedMock: vi.fn().mockResolvedValue(undefined),
  deleteSnapshotsMock: vi.fn().mockResolvedValue(undefined),
  waitUntilPromises: [] as Promise<unknown>[],
}));

vi.mock("@/lib/blob", () => ({
  deleteChatRoomFilesIfOwned: deleteChatRoomFilesIfOwnedMock,
}));

vi.mock("@/lib/chat-unfurl-snapshot", () => ({
  deleteChatRoomUnfurlSnapshotsIfOwned: deleteSnapshotsMock,
}));

vi.mock("@vercel/functions", () => ({
  waitUntil: (promise: Promise<unknown>) => {
    waitUntilPromises.push(promise);
  },
}));

const ROOM_ID = "550e8400-e29b-41d4-a716-446655440000";
const MESSAGE_ID = "550e8400-e29b-41d4-a716-446655440001";
const USER_ID = "user_123";
const OTHER_USER_ID = "user_456";

const tx = {
  chatRoom: {
    findFirst: roomFindFirstMock,
  },
  organization: {
    findUnique: organizationFindUniqueMock,
  },
  member: {
    findUnique: memberFindUniqueMock,
  },
  chatRoomMessage: {
    findFirst: messageFindFirstMock,
    updateMany: messageUpdateManyMock,
  },
  chatRoomMention: {
    updateMany: mentionUpdateManyMock,
  },
  chatRoomPinnedMessage: {
    deleteMany: pinDeleteManyMock,
    count: pinCountMock,
  },
};

function createApp(authContext: AuthVariables["authContext"]) {
  const app = new OpenAPIHonoWithAuth();

  app.use("*", async (c, next) => {
    c.set("isAuthenticated", true);
    c.set("authContext", authContext);
    return await next();
  });

  mountDeleteChatRoomMessage(app);
  return app;
}

const userAuthContext: AuthVariables["authContext"] = {
  actor: "user",
  userId: USER_ID,
  organizationId: "org_1",
  role: "user",
};

function baseMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: MESSAGE_ID,
    roomId: ROOM_ID,
    parentMessageId: null,
    content: "secret oops",
    createdAt: new Date("2026-07-01T12:00:00.000Z"),
    deletedAt: null,
    senderUserId: USER_ID,
    senderCoworkerId: null,
    senderSokoBotId: null,
    metadata: { quote: { messageId: "x" } },
    senderUser: {
      id: USER_ID,
      name: "Ada",
      email: "ada@example.com",
      image: null,
    },
    senderCoworker: null,
    mentionsAsSource: [],
    reactions: [],
    _count: { replies: 0 },
    replies: [],
    ...overrides,
  };
}

describe("DELETE /chat-rooms/:id/messages/:messageId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    waitUntilPromises.length = 0;
    prismaTransactionMock.mockImplementation(
      async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    );
    roomFindFirstMock.mockResolvedValue({
      id: ROOM_ID,
      organizationId: "org_1",
      kind: "channel",
      archivedAt: null,
      userMembers: [{ userId: USER_ID }],
      coworkerMembers: [],
      sokoBotMembers: [],
    });
    organizationFindUniqueMock.mockResolvedValue({ id: "org_1" });
    memberFindUniqueMock.mockResolvedValue({
      id: "member_1",
      userId: USER_ID,
      organizationId: "org_1",
      role: "member",
    });
    const live = baseMessage();
    const tombstone = baseMessage({
      content: "",
      deletedAt: new Date("2026-08-02T05:00:00.000Z"),
      metadata: null,
    });
    // Auth load then post-update reload.
    messageFindFirstMock
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(tombstone);
    messageUpdateManyMock.mockResolvedValue({ count: 1 });
    mentionUpdateManyMock.mockResolvedValue({ count: 0 });
    pinDeleteManyMock.mockResolvedValue({ count: 0 });
    pinCountMock.mockResolvedValue(0);
  });

  /**
   * The body is wiped from the message row, so the copy of it that rode this
   * message's notifications has to go the same way. It stays readable through
   * the notifications API otherwise.
   */
  it("takes the message's text off its notifications", async () => {
    const app = createApp(userAuthContext);

    await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(rewriteChatNotificationPreviewsMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });
  });

  /**
   * A wipe that fails is only reported, so the rows keep the text and the
   * reader's one way back is to delete again. A repeat delete has to try.
   */
  it("tries again when the message was already deleted", async () => {
    messageUpdateManyMock.mockResolvedValue({ count: 0 });
    const app = createApp(userAuthContext);

    await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(rewriteChatNotificationPreviewsMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });
  });

  /**
   * A uuid is matched without case by the message's own column and with case
   * by the notification's, which stores it as text. Taking the ids off the
   * row rather than off the path keeps the two reads looking at one message.
   */
  it("names the message by the ids on its row, not the ones in the path", async () => {
    const app = createApp(userAuthContext);

    const response = await app.request(
      `/${ROOM_ID.toUpperCase()}/messages/${MESSAGE_ID.toUpperCase()}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    expect(rewriteChatNotificationPreviewsMock).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      messageId: MESSAGE_ID,
    });
  });

  /**
   * The reader is answered once the text is gone. Answering first would send
   * them back to a list that still carries it.
   */
  it("answers only once the wipe has run", async () => {
    const order: string[] = [];
    rewriteChatNotificationPreviewsMock.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push("wipe");
    });
    const app = createApp(userAuthContext);

    await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });
    order.push("answer");

    expect(order).toEqual(["wipe", "answer"]);
  });

  it("soft-deletes the author message and returns a tombstone", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data.content).toBe("");
    expect(body.data.deletedAt).toBeTruthy();
    expect(messageUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: MESSAGE_ID,
          roomId: ROOM_ID,
          deletedAt: null,
        },
        data: expect.objectContaining({
          content: "",
          // `DbNull`, not `null`: Prisma rejects a bare null for a Json column.
          metadata: Prisma.DbNull,
          deletedAt: expect.any(Date),
        }),
      }),
    );
    expect(mentionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        messageId: MESSAGE_ID,
        status: { in: ["pending", "sent"] },
      },
      data: {
        status: "failed",
        error: "Source message was deleted",
      },
    });
    expect(pinDeleteManyMock).toHaveBeenCalledWith({
      where: { roomId: ROOM_ID, messageId: MESSAGE_ID },
    });
  });

  it("returns 403 when a different member tries to delete", async () => {
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValue(
      baseMessage({ senderUserId: OTHER_USER_ID }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(403);
    expect(messageUpdateManyMock).not.toHaveBeenCalled();
  });

  it("is idempotent when the author deletes an already-deleted message", async () => {
    const tombstone = baseMessage({
      content: "",
      deletedAt: new Date("2026-08-01T00:00:00.000Z"),
      metadata: null,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValue(tombstone);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(messageUpdateManyMock).not.toHaveBeenCalled();
    expect(mentionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        messageId: MESSAGE_ID,
        status: { in: ["pending", "sent"] },
      },
      data: {
        status: "failed",
        error: "Source message was deleted",
      },
    });
    const body = await response.json();
    expect(body.data.deletedAt).toBeTruthy();
    expect(body.data.content).toBe("");
  });

  it("does not re-publish parent on idempotent re-delete of a reply", async () => {
    const parentId = "550e8400-e29b-41d4-a716-446655440099";
    const tombstone = baseMessage({
      parentMessageId: parentId,
      content: "",
      deletedAt: new Date("2026-08-01T00:00:00.000Z"),
      metadata: null,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValue(tombstone);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(messageUpdateManyMock).not.toHaveBeenCalled();
    expect(publishChatRoomMessageRealtimeByIdMock).not.toHaveBeenCalled();
  });

  it("re-publishes the thread parent when a reply is soft-deleted", async () => {
    const parentId = "550e8400-e29b-41d4-a716-446655440099";
    const live = baseMessage({ parentMessageId: parentId });
    const replyTombstone = baseMessage({
      parentMessageId: parentId,
      content: "",
      deletedAt: new Date("2026-08-02T05:00:00.000Z"),
      metadata: null,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(replyTombstone);
    messageUpdateManyMock.mockResolvedValue({ count: 1 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      replyTombstone,
      "delete",
    );
    expect(publishChatRoomMessageRealtimeByIdMock).toHaveBeenCalledWith(
      parentId,
      "update",
    );
  });

  it("does not re-publish parent when concurrent delete loses the tombstone race", async () => {
    const parentId = "550e8400-e29b-41d4-a716-446655440099";
    const live = baseMessage({ parentMessageId: parentId });
    const replyTombstone = baseMessage({
      parentMessageId: parentId,
      content: "",
      deletedAt: new Date("2026-08-02T05:00:00.000Z"),
      metadata: null,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock
      .mockResolvedValueOnce(live)
      .mockResolvedValueOnce(replyTombstone);
    // Another request already wrote deletedAt — conditional update matches 0 rows.
    messageUpdateManyMock.mockResolvedValue({ count: 0 });

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(messageUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: MESSAGE_ID,
          roomId: ROOM_ID,
          deletedAt: null,
        },
      }),
    );
    expect(publishChatRoomMessageRealtimeMock).toHaveBeenCalledWith(
      replyTombstone,
      "delete",
    );
    expect(publishChatRoomMessageRealtimeByIdMock).not.toHaveBeenCalled();
  });

  it("does not re-publish a parent when a top-level message is deleted", async () => {
    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(publishChatRoomMessageRealtimeByIdMock).not.toHaveBeenCalled();
  });

  it("returns 404 when the message is missing", async () => {
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValue(null);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(404);
  });

  it("schedules owned chat-file and unfurl snapshot deletes on first tombstone", async () => {
    const ownedFile = `https://abc.public.blob.vercel-storage.com/users/${USER_ID}/chats/${ROOM_ID}/report.pdf`;
    const ownedHeic = `https://abc.public.blob.vercel-storage.com/users/${USER_ID}/chats/${ROOM_ID}/photo.heic`;
    const snapshot = `https://abc.public.blob.vercel-storage.com/chats/${ROOM_ID}/unfurls/${MESSAGE_ID}/image-preview-xyz.png`;
    const live = baseMessage({
      content: `see [report](${ownedFile}) and [photo](${ownedHeic})`,
      metadata: {
        unfurls: [
          {
            url: "https://example.com/article",
            title: "Article",
            description: null,
            imageUrl: snapshot,
            siteName: "Example",
          },
        ],
      },
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValueOnce(live).mockResolvedValueOnce(
      baseMessage({
        content: "",
        deletedAt: new Date("2026-08-02T05:00:00.000Z"),
        metadata: null,
      }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    await Promise.all(waitUntilPromises);
    expect(deleteChatRoomFilesIfOwnedMock).toHaveBeenCalledWith(
      [ownedFile, ownedHeic],
      { kind: "user", userId: USER_ID },
      ROOM_ID,
    );
    expect(deleteSnapshotsMock).toHaveBeenCalledWith(
      [snapshot],
      ROOM_ID,
      MESSAGE_ID,
    );
  });

  it("names blob cleanup by the ids on the row, not the ones in the path", async () => {
    const ownedFile = `https://abc.public.blob.vercel-storage.com/users/${USER_ID}/chats/${ROOM_ID}/report.pdf`;
    const snapshot = `https://abc.public.blob.vercel-storage.com/chats/${ROOM_ID}/unfurls/${MESSAGE_ID}/image-preview-xyz.png`;
    const live = baseMessage({
      content: `see [report](${ownedFile})`,
      metadata: {
        unfurls: [
          {
            url: "https://example.com/article",
            title: "Article",
            description: null,
            imageUrl: snapshot,
            siteName: "Example",
          },
        ],
      },
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValueOnce(live).mockResolvedValueOnce(
      baseMessage({
        content: "",
        deletedAt: new Date("2026-08-02T05:00:00.000Z"),
        metadata: null,
      }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request(
      `/${ROOM_ID.toUpperCase()}/messages/${MESSAGE_ID.toUpperCase()}`,
      { method: "DELETE" },
    );

    expect(response.status).toBe(200);
    await Promise.all(waitUntilPromises);
    expect(deleteChatRoomFilesIfOwnedMock).toHaveBeenCalledWith(
      [ownedFile],
      { kind: "user", userId: USER_ID },
      ROOM_ID,
    );
    expect(deleteSnapshotsMock).toHaveBeenCalledWith(
      [snapshot],
      ROOM_ID,
      MESSAGE_ID,
    );
  });

  it("still tombstones when owned blob delete rejects", async () => {
    deleteChatRoomFilesIfOwnedMock.mockRejectedValueOnce(
      new Error("blob down"),
    );
    const ownedFile = `https://abc.public.blob.vercel-storage.com/users/${USER_ID}/chats/${ROOM_ID}/report.pdf`;
    const live = baseMessage({
      content: `see [report](${ownedFile})`,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValueOnce(live).mockResolvedValueOnce(
      baseMessage({
        content: "",
        deletedAt: new Date("2026-08-02T05:00:00.000Z"),
        metadata: null,
      }),
    );

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    await Promise.allSettled(waitUntilPromises);
    const body = await response.json();
    expect(body.data.deletedAt).toBeTruthy();
    expect(body.data.content).toBe("");
  });

  it("passes drive, other-sender, and hotlinked URLs through for ownership filtering", async () => {
    const drive = `https://abc.public.blob.vercel-storage.com/users/${USER_ID}/docs/notes.pdf`;
    const otherSender = `https://abc.public.blob.vercel-storage.com/users/${OTHER_USER_ID}/chats/${ROOM_ID}/file.pdf`;
    const hotlink = "https://pbs.twimg.com/media/foo.jpg";
    const foreignSnapshot = `https://abc.public.blob.vercel-storage.com/chats/${ROOM_ID}/unfurls/other-message/image-preview-z9.png`;
    const live = baseMessage({
      content: `see [drive](${drive}) and [theirs](${otherSender})`,
      metadata: {
        unfurls: [
          {
            url: "https://x.com/status/1",
            title: "Post",
            description: null,
            imageUrl: hotlink,
            siteName: "X",
          },
          {
            url: "https://example.com/other",
            title: "Other",
            description: null,
            imageUrl: foreignSnapshot,
            siteName: "Example",
          },
        ],
      },
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValueOnce(live).mockResolvedValueOnce(
      baseMessage({
        content: "",
        deletedAt: new Date("2026-08-02T05:00:00.000Z"),
        metadata: null,
      }),
    );

    const app = createApp(userAuthContext);
    await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });
    await Promise.all(waitUntilPromises);

    expect(deleteChatRoomFilesIfOwnedMock).toHaveBeenCalledWith(
      expect.arrayContaining([drive, otherSender]),
      { kind: "user", userId: USER_ID },
      ROOM_ID,
    );
    expect(deleteSnapshotsMock).toHaveBeenCalledWith(
      [hotlink, foreignSnapshot],
      ROOM_ID,
      MESSAGE_ID,
    );
  });

  it("does not schedule blob deletes on an already-tombstoned message", async () => {
    const tombstone = baseMessage({
      content: "",
      deletedAt: new Date("2026-08-01T00:00:00.000Z"),
      metadata: null,
    });
    messageFindFirstMock.mockReset();
    messageFindFirstMock.mockResolvedValue(tombstone);

    const app = createApp(userAuthContext);
    const response = await app.request(`/${ROOM_ID}/messages/${MESSAGE_ID}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(deleteChatRoomFilesIfOwnedMock).not.toHaveBeenCalled();
    expect(deleteSnapshotsMock).not.toHaveBeenCalled();
  });
});
