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
      forUser: userId,
    }));
  });

  it("fans out a personalized DTO to each room user member", async () => {
    findManyMembersMock.mockResolvedValue([
      { userId: "user_a" },
      { userId: "user_b" },
    ]);

    await publishChatRoomMessageRealtime(baseMessage as never);

    expect(findManyMembersMock).toHaveBeenCalledWith({
      where: { roomId: baseMessage.roomId },
      select: { userId: true },
    });
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledTimes(2);
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_a",
      message: {
        id: baseMessage.id,
        roomId: baseMessage.roomId,
        forUser: "user_a",
      },
    });
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_b",
      message: {
        id: baseMessage.id,
        roomId: baseMessage.roomId,
        forUser: "user_b",
      },
    });
  });

  it("swallows publish errors", async () => {
    findManyMembersMock.mockResolvedValue([{ userId: "user_a" }]);
    publishChatRoomMessageEventMock.mockRejectedValue(new Error("ably down"));

    await expect(
      publishChatRoomMessageRealtime(baseMessage as never),
    ).resolves.toBeUndefined();
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
      forUser: userId,
    }));
  });

  it("loads the message then fans out", async () => {
    findUniqueMessageMock.mockResolvedValue(baseMessage);
    findManyMembersMock.mockResolvedValue([{ userId: "user_a" }]);

    await publishChatRoomMessageRealtimeById(baseMessage.id);

    expect(findUniqueMessageMock).toHaveBeenCalledWith({
      where: { id: baseMessage.id },
      include: {},
    });
    expect(publishChatRoomMessageEventMock).toHaveBeenCalledWith({
      userId: "user_a",
      message: {
        id: baseMessage.id,
        roomId: baseMessage.roomId,
        forUser: "user_a",
      },
    });
  });

  it("no-ops when the message is missing", async () => {
    findUniqueMessageMock.mockResolvedValue(null);

    await publishChatRoomMessageRealtimeById(baseMessage.id);

    expect(publishChatRoomMessageEventMock).not.toHaveBeenCalled();
  });
});
