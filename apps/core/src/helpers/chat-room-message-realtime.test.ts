import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueMessageMock,
  publishChatRoomMessageEventMock,
  mapChatRoomMessageMock,
} = vi.hoisted(() => ({
  findUniqueMessageMock: vi.fn(),
  publishChatRoomMessageEventMock: vi.fn(),
  mapChatRoomMessageMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
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

const viewerNeutralDto = {
  id: baseMessage.id,
  roomId: baseMessage.roomId,
  parentMessageId: null as string | null,
  reactions: [] as unknown[],
  mentions: [] as unknown[],
  unfurls: null as unknown,
};

describe("publishChatRoomMessageRealtime", () => {
  beforeEach(() => {
    findUniqueMessageMock.mockReset();
    publishChatRoomMessageEventMock.mockReset();
    mapChatRoomMessageMock.mockReset();
    publishChatRoomMessageEventMock.mockResolvedValue(undefined);
    mapChatRoomMessageMock.mockReturnValue(viewerNeutralDto);
  });

  it("maps once without a viewer id and publishes once to the room channel", async () => {
    await publishChatRoomMessageRealtime(baseMessage as never, "create");

    expect(mapChatRoomMessageMock).toHaveBeenCalledTimes(1);
    expect(mapChatRoomMessageMock).toHaveBeenCalledWith(baseMessage);
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledTimes(1);
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      eventType: "create",
      message: viewerNeutralDto,
    });
  });

  it("swallows publish errors", async () => {
    publishChatRoomMessageEventMock.mockRejectedValue(new Error("ably down"));

    await expect(
      publishChatRoomMessageRealtime(baseMessage as never, "create"),
    ).resolves.toBeUndefined();
  });

  it("publishes a reaction patch, not a full message DTO", async () => {
    mapChatRoomMessageMock.mockReturnValue({
      ...viewerNeutralDto,
      content: "hello",
      reactions: [
        {
          emoji: "👍",
          count: 1,
          reactedByCurrentUser: false,
          reactors: [{ id: "user_a", name: "Alice" }],
        },
      ],
    });

    await publishChatRoomMessageRealtime(baseMessage as never, "reaction");

    expect(mapChatRoomMessageMock).toHaveBeenCalledWith(baseMessage);
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      eventType: "reaction",
      messageId: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: null,
      patch: {
        reactions: [
          {
            emoji: "👍",
            count: 1,
            reactedByCurrentUser: false,
            reactors: [{ id: "user_a", name: "Alice" }],
          },
        ],
      },
    });
  });

  it("publishes an unfurl patch with unfurls only", async () => {
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
      ...viewerNeutralDto,
      parentMessageId: "parent-1",
      content: "link",
      unfurls,
    });

    await publishChatRoomMessageRealtime(baseMessage as never, "unfurl");

    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      eventType: "unfurl",
      messageId: baseMessage.id,
      roomId: baseMessage.roomId,
      parentMessageId: "parent-1",
      patch: { unfurls },
    });
  });

  it("publishes a mention_status patch with mentions only", async () => {
    const mentions = [
      {
        id: "men-1",
        coworkerId: "cow-1",
        status: "completed",
        responseMessageId: "resp-1",
      },
    ];
    mapChatRoomMessageMock.mockReturnValue({
      ...viewerNeutralDto,
      content: "hey",
      mentions,
    });

    await publishChatRoomMessageRealtime(
      baseMessage as never,
      "mention_status",
    );

    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
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
    findUniqueMessageMock.mockReset();
    publishChatRoomMessageEventMock.mockReset();
    mapChatRoomMessageMock.mockReset();
    publishChatRoomMessageEventMock.mockResolvedValue(undefined);
    mapChatRoomMessageMock.mockReturnValue(viewerNeutralDto);
  });

  it("loads the message then publishes once", async () => {
    findUniqueMessageMock.mockResolvedValue(baseMessage);

    await publishChatRoomMessageRealtimeById(baseMessage.id, "unfurl");

    expect(findUniqueMessageMock).toHaveBeenCalledWith({
      where: { id: baseMessage.id },
      include: {},
    });
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
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
