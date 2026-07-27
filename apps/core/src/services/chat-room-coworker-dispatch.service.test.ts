import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findUniqueMock,
  findManyMentionMock,
  updateManyMock,
  updateMock,
  findFirstMock,
  findManyMock,
  createMock,
  generateTextMock,
  createCoworkerConversationMock,
  getSokosumiProviderMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMentionMock: vi.fn(),
  updateManyMock: vi.fn(),
  updateMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  createMock: vi.fn(),
  generateTextMock: vi.fn(),
  createCoworkerConversationMock: vi.fn(),
  getSokosumiProviderMock: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMention: {
      findUnique: findUniqueMock,
      findMany: findManyMentionMock,
      updateMany: updateManyMock,
      update: updateMock,
      findFirst: findFirstMock,
    },
    chatRoomMessage: {
      findMany: findManyMock,
      create: createMock,
    },
    chatRoom: {
      update: vi.fn(),
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        chatRoomMessage: { create: createMock },
        chatRoomMention: { update: updateMock },
        chatRoom: { update: vi.fn() },
      }),
    ),
  },
}));

vi.mock("@/lib/sokosumi-ai-provider", () => ({
  getSokosumiProvider: getSokosumiProviderMock,
}));

vi.mock("@/routes/v1/chats/stream/coworker-conversation", () => ({
  createCoworkerConversation: createCoworkerConversationMock,
}));

vi.mock("ai", () => ({
  generateText: generateTextMock,
}));

import {
  buildRoomMentionPrompt,
  dispatchChatRoomMention,
  listStaleSentChatRoomMentionIds,
  ROOM_SENT_STALE_MS,
} from "./chat-room-coworker-dispatch.service";

const MENTION_ID = "mention_1";

function pendingMention() {
  return {
    id: MENTION_ID,
    status: "pending",
    providerConversationId: null,
    coworkerId: "cow_1",
    coworker: {
      id: "cow_1",
      slug: "hannah",
      name: "Hannah",
      baseURL: "https://coworker.example",
      archivedAt: null,
      isWhitelisted: true,
      capabilities: ["chat"],
    },
    message: {
      id: "msg_1",
      roomId: "room_1",
      content: "@hannah hi",
      parentMessageId: null,
      senderUserId: "user_1",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      senderUser: { id: "user_1", name: "Patrick" },
      room: {
        id: "room_1",
        name: "general",
        organizationId: "org_1",
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSokosumiProviderMock.mockReturnValue(() => "mock-model");
  createCoworkerConversationMock.mockResolvedValue({ id: "provider_conv_1" });
  findManyMock.mockResolvedValue([]);
  generateTextMock.mockResolvedValue({ text: "Hello back" });
  createMock.mockResolvedValue({ id: "reply_1" });
  updateMock.mockResolvedValue({});
  updateManyMock.mockResolvedValue({ count: 1 });
});

describe("buildRoomMentionPrompt", () => {
  it("returns the bare mention block when there is no context", () => {
    const prompt = buildRoomMentionPrompt({
      roomName: "general",
      senderName: "Patrick",
      content: "@hannah what's up?",
      isThreadReply: false,
      contextMessages: [],
    });

    expect(prompt).toBe(
      "Patrick mentioned you in #general:\n\n@hannah what's up?",
    );
  });

  it("prefixes recent messages with a CONTEXT block, oldest first", () => {
    const prompt = buildRoomMentionPrompt({
      roomName: "general",
      senderName: "Patrick",
      content: "@hannah summarize this",
      isThreadReply: false,
      contextMessages: [
        { senderName: "Andreas", isCoworker: false, content: "First message" },
        { senderName: "Hannah", isCoworker: true, content: "Second\nmessage" },
      ],
    });

    expect(prompt).toBe(
      [
        "CONTEXT (last 2 messages in #general):",
        "- Andreas: First message",
        "- Hannah (AI coworker): Second message",
        "",
        "Patrick mentioned you in #general:",
        "",
        "@hannah summarize this",
      ].join("\n"),
    );
  });

  it("labels thread replies instead of claiming a mention", () => {
    const prompt = buildRoomMentionPrompt({
      roomName: "general",
      senderName: "Patrick",
      content: "sounds good, go ahead",
      isThreadReply: true,
      contextMessages: [],
    });

    expect(prompt).toBe(
      "Patrick replied to a thread you are part of in #general:\n\nsounds good, go ahead",
    );
  });

  it("truncates oversized context messages", () => {
    const prompt = buildRoomMentionPrompt({
      roomName: "general",
      senderName: "Patrick",
      content: "@hannah tldr?",
      isThreadReply: false,
      contextMessages: [
        { senderName: "Andreas", isCoworker: false, content: "x".repeat(800) },
      ],
    });

    expect(prompt).toContain(`- Andreas: ${"x".repeat(500)}…`);
    expect(prompt).not.toContain("x".repeat(501));
  });
});

describe("dispatchChatRoomMention claim", () => {
  it("exits without provider work when claim loses (updateMany count 0)", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 0 });

    await dispatchChatRoomMention(MENTION_ID);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: "pending" },
      data: { status: "sent", error: null },
    });
    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: MENTION_ID,
          status: "sent",
          updatedAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    );
    expect(generateTextMock).not.toHaveBeenCalled();
    expect(createCoworkerConversationMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("runs provider work when claim wins (updateMany count 1)", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });

    await dispatchChatRoomMention(MENTION_ID);

    expect(generateTextMock).toHaveBeenCalled();
    expect(createCoworkerConversationMock).toHaveBeenCalled();
  });

  it("reclaims a stale sent mention and runs provider work", async () => {
    findUniqueMock.mockResolvedValue({
      ...pendingMention(),
      status: "sent",
      updatedAt: new Date(Date.now() - ROOM_SENT_STALE_MS - 1_000),
    });
    updateManyMock
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await dispatchChatRoomMention(MENTION_ID);

    expect(updateManyMock).toHaveBeenNthCalledWith(1, {
      where: { id: MENTION_ID, status: "pending" },
      data: { status: "sent", error: null },
    });
    expect(updateManyMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: MENTION_ID,
          status: "sent",
        }),
        data: { status: "sent", error: null },
      }),
    );
    expect(generateTextMock).toHaveBeenCalled();
  });

  it("does not reclaim a fresh sent mention still in flight", async () => {
    findUniqueMock.mockResolvedValue({
      ...pendingMention(),
      status: "sent",
      updatedAt: new Date(),
    });
    updateManyMock.mockResolvedValue({ count: 0 });

    await dispatchChatRoomMention(MENTION_ID);

    expect(generateTextMock).not.toHaveBeenCalled();
    expect(createCoworkerConversationMock).not.toHaveBeenCalled();
  });
});

describe("listStaleSentChatRoomMentionIds", () => {
  it("queries sent mentions older than the stale window for the room", async () => {
    findManyMentionMock.mockResolvedValue([{ id: MENTION_ID }]);
    const now = new Date("2025-06-01T12:00:00.000Z");

    const ids = await listStaleSentChatRoomMentionIds("room_1", { now });

    expect(ids).toEqual([MENTION_ID]);
    expect(findManyMentionMock).toHaveBeenCalledWith({
      where: {
        status: "sent",
        updatedAt: { lt: new Date(now.getTime() - ROOM_SENT_STALE_MS) },
        message: { roomId: "room_1" },
      },
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: 10,
    });
  });
});
