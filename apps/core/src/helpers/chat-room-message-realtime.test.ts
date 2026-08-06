import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findManyMembersMock,
  findUniqueMessageMock,
  publishChatRoomMessageEventMock,
  mapChatRoomMessageMock,
} = vi.hoisted(() => ({
  findManyMembersMock: vi.fn(),
  findUniqueMessageMock: vi.fn(),
  publishChatRoomMessageEventMock: vi.fn(),
  mapChatRoomMessageMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomUserMember: {
      findMany: (...args: unknown[]) => findManyMembersMock(...args),
    },
    chatRoomMessage: {
      findUnique: (...args: unknown[]) => findUniqueMessageMock(...args),
    },
  },
}));

vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomMessageEvent: (...args: unknown[]) =>
    publishChatRoomMessageEventMock(...args),
}));

vi.mock("@/routes/v1/chats/rooms/helpers", () => ({
  chatRoomMessageInclude: {},
  mapChatRoomMessage: (...args: unknown[]) => mapChatRoomMessageMock(...args),
}));

vi.mock("@/schemas/chat-room.schema", () => ({
  chatRoomMessageSchema: {
    parse: (value: unknown) => value,
  },
}));

import {
  publishChatRoomMessageRealtime,
  publishChatRoomMessageRealtimeById,
} from "./chat-room-message-realtime";

const baseMessage = {
  id: "550e8400-e29b-41d4-a716-446655440000",
  roomId: "660e8400-e29b-41d4-a716-446655440000",
  parentMessageId: null,
  content: "hello",
  createdAt: new Date("2026-08-03T12:00:00.000Z"),
  deletedAt: null,
  editedAt: null,
  senderUserId: "user_a",
  senderCoworkerId: null,
  senderUser: null,
  senderCoworker: null,
  mentionsAsSource: [],
  reactions: [],
  replies: [],
  _count: { replies: 0 },
  metadata: null,
};

describe("publishChatRoomMessageRealtime", () => {
  beforeEach(() => {
    findManyMembersMock.mockReset();
    findUniqueMessageMock.mockReset();
    publishChatRoomMessageEventMock.mockReset();
    mapChatRoomMessageMock.mockReset();
    publishChatRoomMessageEventMock.mockResolvedValue(undefined);
    mapChatRoomMessageMock.mockImplementation((_message, userId: string) => ({
      id: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: null,
      forUser: userId,
      reactions: [],
      mentions: [],
      unfurls: null,
    }));
  });

  it("fans out a personalized DTO to each room user member", async () => {
    findManyMembersMock.mockResolvedValue([
      { userId: "user_a" },
      { userId: "user_b" },
    ]);

    await publishChatRoomMessageRealtime(baseMessage as never, "create");

    expect(findManyMembersMock).toHaveBeenCalledWith({
      where: { roomId: baseMessage.roomId },
      select: { userId: true },
    });
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledTimes(2);
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_a",
      eventType: "create",
      message: {
        id: baseMessage.id,
        roomId: baseMessage.roomId,
        parentMessageId: null,
        forUser: "user_a",
        reactions: [],
        mentions: [],
        unfurls: null,
      },
    });
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_b",
      eventType: "create",
      message: {
        id: baseMessage.id,
        roomId: baseMessage.roomId,
        parentMessageId: null,
        forUser: "user_b",
        reactions: [],
        mentions: [],
        unfurls: null,
      },
    });
  });

  it("swallows publish errors", async () => {
    findManyMembersMock.mockResolvedValue([{ userId: "user_a" }]);
    publishChatRoomMessageEventMock.mockRejectedValue(new Error("ably down"));

    await expect(
      publishChatRoomMessageRealtime(baseMessage as never, "create"),
    ).resolves.toBeUndefined();
  });

  it("keeps publishing to other members when one fan-out fails", async () => {
    findManyMembersMock.mockResolvedValue([
      { userId: "user_a" },
      { userId: "user_b" },
    ]);
    publishChatRoomMessageEventMock.mockImplementation(
      async ({ userId }: { userId: string }) => {
        if (userId === "user_a") {
          throw new Error("ably down for user_a");
        }
      },
    );

    await expect(
      publishChatRoomMessageRealtime(baseMessage as never, "reaction"),
    ).resolves.toBeUndefined();

    expect(publishChatRoomMessageEventMock).toHaveBeenCalledTimes(2);
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_b",
      eventType: "reaction",
      messageId: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: null,
      patch: { reactions: [] },
    });
  });

  it("publishes a reaction patch, not a full message DTO", async () => {
    findManyMembersMock.mockResolvedValue([{ userId: "user_a" }]);
    mapChatRoomMessageMock.mockReturnValue({
      id: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: null,
      content: "hello",
      reactions: [
        {
          emoji: "👍",
          count: 1,
          reactedByCurrentUser: true,
          reactors: [{ id: "user_a", name: "Alice" }],
        },
      ],
      mentions: [],
      unfurls: null,
    });

    await publishChatRoomMessageRealtime(baseMessage as never, "reaction");

    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_a",
      eventType: "reaction",
      messageId: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: null,
      patch: {
        reactions: [
          {
            emoji: "👍",
            count: 1,
            reactedByCurrentUser: true,
            reactors: [{ id: "user_a", name: "Alice" }],
          },
        ],
      },
    });
  });

  it("publishes an unfurl patch with unfurls only", async () => {
    findManyMembersMock.mockResolvedValue([{ userId: "user_a" }]);
    const unfurls = [
      {
        url: "https://example.com",
        title: "Example",
        description: null,
        imageUrl: null,
        siteName: null,
      },
    ];
    mapChatRoomMessageMock.mockReturnValue({
      id: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: "parent-1",
      content: "link",
      reactions: [],
      mentions: [],
      unfurls,
    });

    await publishChatRoomMessageRealtime(baseMessage as never, "unfurl");

    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_a",
      eventType: "unfurl",
      messageId: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: "parent-1",
      patch: { unfurls },
    });
  });

  it("publishes a mention_status patch with mentions only", async () => {
    findManyMembersMock.mockResolvedValue([{ userId: "user_a" }]);
    const mentions = [
      {
        id: "men-1",
        coworkerId: "cow-1",
        status: "completed",
        responseMessageId: "resp-1",
      },
    ];
    mapChatRoomMessageMock.mockReturnValue({
      id: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: null,
      content: "hey",
      reactions: [],
      mentions,
      unfurls: null,
    });

    await publishChatRoomMessageRealtime(
      baseMessage as never,
      "mention_status",
    );

    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_a",
      eventType: "mention_status",
      messageId: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: null,
      patch: { mentions },
    });
  });
});

describe("publishChatRoomMessageRealtimeById", () => {
  beforeEach(() => {
    findManyMembersMock.mockReset();
    findUniqueMessageMock.mockReset();
    publishChatRoomMessageEventMock.mockReset();
    mapChatRoomMessageMock.mockReset();
    publishChatRoomMessageEventMock.mockResolvedValue(undefined);
    mapChatRoomMessageMock.mockImplementation((_message, userId: string) => ({
      id: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: null,
      forUser: userId,
      reactions: [],
      mentions: [],
      unfurls: null,
    }));
  });

  it("loads the message then fans out", async () => {
    findUniqueMessageMock.mockResolvedValue(baseMessage);
    findManyMembersMock.mockResolvedValue([{ userId: "user_a" }]);

    await publishChatRoomMessageRealtimeById(baseMessage.id, "unfurl");

    expect(findUniqueMessageMock).toHaveBeenCalledWith({
      where: { id: baseMessage.id },
      include: {},
    });
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_a",
      eventType: "unfurl",
      messageId: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: null,
      patch: { unfurls: null },
    });
  });

  it("no-ops when the message is missing", async () => {
    findUniqueMessageMock.mockResolvedValue(null);

    await publishChatRoomMessageRealtimeById(baseMessage.id, "create");

    expect(publishChatRoomMessageEventMock).not.toHaveBeenCalled();
  });
});
