import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  turnFindUnique,
  mentionUpdateMany,
  messageUpdate,
  messageDelete,
  messageCreate,
  messageFindFirst,
  roomFindFirst,
  sokoBotFindFirst,
  roomUpdate,
  publish,
  messageUpsert,
} = vi.hoisted(() => ({
  messageUpsert: vi.fn(),
  turnFindUnique: vi.fn(),
  mentionUpdateMany: vi.fn(),
  messageUpdate: vi.fn(),
  messageDelete: vi.fn(),
  messageCreate: vi.fn(),
  messageFindFirst: vi.fn(),
  roomFindFirst: vi.fn(),
  sokoBotFindFirst: vi.fn(),
  roomUpdate: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomUserMember: {
      findMany: vi.fn().mockResolvedValue([{ userId: "reader" }]),
    },
    sokoBot: { findFirst: sokoBotFindFirst },
    sokoBotTurn: { findUnique: turnFindUnique },
    chatRoom: { findFirst: roomFindFirst },
    chatRoomMessage: {
      update: messageUpdate,
      updateMany: messageUpdate,
      findFirst: messageFindFirst,
      create: messageCreate,
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        sokoBotTurn: { findUnique: turnFindUnique },
        chatRoomMention: { updateMany: mentionUpdateMany },
        chatRoomMessage: {
          update: messageUpdate,
          delete: messageDelete,
          create: messageCreate,
          upsert: messageUpsert,
        },
        chatRoom: { update: roomUpdate },
      }),
    ),
  },
}));
const { createOrGetDirectRoomMock } = vi.hoisted(() => ({
  createOrGetDirectRoomMock: vi.fn(),
}));
vi.mock("@/routes/v1/chats/rooms/helpers", () => ({
  createOrGetDirectRoom: createOrGetDirectRoomMock,
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: publish,
}));

vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn().mockResolvedValue(undefined),
}));

const { persistChatHumanMentionsMock, emitChatHumanMentionNotificationsMock } =
  vi.hoisted(() => ({
    persistChatHumanMentionsMock: vi.fn().mockResolvedValue([]),
    emitChatHumanMentionNotificationsMock: vi.fn().mockResolvedValue(undefined),
  }));
vi.mock("@/helpers/chat-human-mentions", () => ({
  persistChatHumanMentions: persistChatHumanMentionsMock,
  emitChatHumanMentionNotifications: emitChatHumanMentionNotificationsMock,
}));

import { publishChatRoomsChanged } from "@/lib/ably/publish";
import prisma from "@/lib/db/prisma";

import {
  ANSWERED_DIRECTLY,
  introduceSokoBot,
  persistSokoBotChatTurn,
  postSokoBotOwnerNotice,
  publishSokoBotChatProgress,
} from "./soko-bot-chat.service";

function completedTurn(overrides: Record<string, unknown> = {}) {
  return {
    id: "turn-a",
    status: "COMPLETED",
    finalAnswer: "The answer is ready.",
    errorDetail: null,
    startedAt: new Date("2026-09-07T10:00:00Z"),
    createdAt: new Date("2026-09-07T10:00:00Z"),
    completedAt: new Date("2026-09-07T10:01:00Z"),
    chatMentionId: "mention-a",
    chatResponseMessageId: "response-a",
    chainDepth: 0,
    userId: "owner-a",
    requestedByUserId: null,
    chatMention: {
      id: "mention-a",
      messageId: "source-a",
      message: { roomId: "room-a" },
    },
    events: [],
    pendingDecisions: [],
    delegations: [],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  turnFindUnique.mockResolvedValue(completedTurn());
  mentionUpdateMany.mockResolvedValue({ count: 1 });
  messageUpdate.mockResolvedValue({ id: "response-a" });
  messageDelete.mockResolvedValue({ id: "response-a" });
  messageCreate.mockResolvedValue({ id: "msg-new" });
  messageFindFirst.mockResolvedValue(null);
  roomFindFirst.mockResolvedValue({ id: "room-a" });
  sokoBotFindFirst.mockResolvedValue({
    id: "bot-a",
    name: "Eve",
    user: { name: "Ada" },
  });
  roomUpdate.mockResolvedValue({ id: "room-a" });
  publish.mockResolvedValue(undefined);
});

describe("persistSokoBotChatTurn", () => {
  it("persists a successful response once and preserves its completion clock on retry", async () => {
    mentionUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    expect(publishChatRoomsChanged).not.toHaveBeenCalled();
    expect(messageUpdate).toHaveBeenCalledOnce();
    expect(roomUpdate).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(mentionUpdateMany).toHaveBeenCalledWith({
      where: { id: "mention-a", status: { in: ["pending", "sent"] } },
      data: { status: "responded", error: null },
    });
    expect(messageUpdate).toHaveBeenCalledWith({
      where: { id: "response-a" },
      data: { content: "The answer is ready.", metadata: expect.any(Object) },
    });
    expect(messageUpdate.mock.calls[0][0].data).not.toHaveProperty("createdAt");
  });

  it("keeps the reasoning summary and tool steps as the reply's Thought", async () => {
    const events = [
      { type: "actions.requested", toolName: "list_tasks", summary: null },
      {
        type: "reasoning.completed",
        toolName: null,
        summary: "Checked the board for stuck work.",
      },
    ];
    turnFindUnique.mockResolvedValue(completedTurn({ events }));
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    const reasoning = messageUpdate.mock.calls[0][0].data.metadata.reasoning;
    expect(reasoning[0]).toEqual({
      type: "reasoning",
      text: "Checked the board for stuck work.",
    });
    expect(reasoning).toHaveLength(2);
    expect(
      messageUpdate.mock.calls[0][0].data.metadata.thought_timing_ms,
    ).toEqual(expect.objectContaining({ start: expect.any(Number) }));

    // A teammate asking sees the tools used, never the owner-side summary.
    messageUpdate.mockClear();
    turnFindUnique.mockResolvedValue(
      completedTurn({ events, requestedByUserId: "teammate-a" }),
    );
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    const teammateReasoning =
      messageUpdate.mock.calls[0][0].data.metadata.reasoning;
    expect(teammateReasoning).toHaveLength(1);
    expect(JSON.stringify(teammateReasoning)).not.toContain(
      "Checked the board for stuck work.",
    );
  });

  it("gives an answer with no summary and no tools a Thought too", async () => {
    turnFindUnique.mockResolvedValue(completedTurn({ events: [] }));
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    const metadata = messageUpdate.mock.calls[0][0].data.metadata;
    expect(metadata.reasoning).toEqual([
      { type: "reasoning", text: ANSWERED_DIRECTLY },
    ]);
    expect(metadata.thought_timing_ms).toEqual(
      expect.objectContaining({ start: expect.any(Number) }),
    );
  });

  it("leaves human mention activation and notification to audience-checked delivery", async () => {
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    expect(persistChatHumanMentionsMock).not.toHaveBeenCalled();
    expect(emitChatHumanMentionNotificationsMock).not.toHaveBeenCalled();
  });

  it("does not invalidate a completed turn with an empty answer", async () => {
    turnFindUnique.mockResolvedValue(
      completedTurn({ finalAnswer: "", chainDepth: 0 }),
    );
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    expect(mentionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      }),
    );
    expect(publishChatRoomsChanged).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not overwrite a response after another finalizer wins", async () => {
    mentionUpdateMany.mockResolvedValue({ count: 0 });
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    expect(messageUpdate).not.toHaveBeenCalled();
    expect(roomUpdate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not turn a completed answer into a failed shell", async () => {
    turnFindUnique.mockResolvedValue(
      completedTurn({ status: "FAILED", finalAnswer: null }),
    );
    mentionUpdateMany.mockResolvedValue({ count: 0 });
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    expect(messageUpdate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps a failed shell when the failure transition wins", async () => {
    turnFindUnique.mockResolvedValue(
      completedTurn({ status: "FAILED", finalAnswer: null }),
    );
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    expect(messageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "",
          metadata: expect.objectContaining({ mention_failed: true }),
        }),
      }),
    );
    expect(roomUpdate).not.toHaveBeenCalled();
  });

  it("does not delete a reply when a silent finalizer loses its claim", async () => {
    turnFindUnique.mockResolvedValue(
      completedTurn({ chainDepth: 1, finalAnswer: "" }),
    );
    mentionUpdateMany.mockResolvedValue({ count: 0 });
    await prisma.$transaction((tx) => persistSokoBotChatTurn("turn-a", tx));
    expect(messageDelete).not.toHaveBeenCalled();
    expect(messageUpdate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe("introduceSokoBot", () => {
  it("invalidates readers after the introduction is committed", async () => {
    const result = await introduceSokoBot({
      userId: "owner",
      workspaceId: "ws-a",
      roomId: "room-a",
    });
    expect(result).toEqual({ messageId: "msg-new" });
    expect(publishChatRoomsChanged).toHaveBeenCalledExactlyOnceWith({
      userIds: ["reader"],
      roomId: "room-a",
      collections: ["active"],
    });
  });

  it("does not invalidate when the bot already introduced itself", async () => {
    messageFindFirst.mockResolvedValue({ id: "msg-existing" });
    const result = await introduceSokoBot({
      userId: "owner",
      workspaceId: "ws-a",
      roomId: "room-a",
    });
    expect(result).toEqual({ messageId: "msg-existing" });
    expect(messageCreate).not.toHaveBeenCalled();
    expect(publishChatRoomsChanged).not.toHaveBeenCalled();
  });
});

describe("postSokoBotOwnerNotice", () => {
  beforeEach(() => {
    sokoBotFindFirst.mockResolvedValue({
      id: "bot-a",
      userId: "owner",
      workspaceId: "ws-a",
      workspace: { organizationId: "org-a" },
      name: "Joseph",
      user: { name: "Owner" },
    });
    roomFindFirst.mockResolvedValue({ id: "room-a" });
    messageUpsert.mockResolvedValue({ id: "notice-1" });
  });

  it("posts once per key into the owner's chat with the bot", async () => {
    const result = await postSokoBotOwnerNotice({
      sokoBotId: "bot-a",
      content: "I've been updated to version v19.",
      key: "version:run-1:bot-a",
    });
    expect(result).toEqual({ messageId: "notice-1" });
    expect(roomFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          kind: "direct",
          sokoBotMembers: { some: { sokoBotId: "bot-a" } },
          userMembers: { some: { userId: "owner" } },
        },
      }),
    );
    // Keyed, so a retried run cannot post the same notice twice.
    expect(messageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          roomId_clientMessageId: {
            roomId: "room-a",
            clientMessageId: "soko-bot:notice:version:run-1:bot-a",
          },
        },
        update: {},
      }),
    );
    expect(publish).toHaveBeenCalledWith("notice-1", "create");
  });

  it("opens the owner's chat, introduces the bot, then posts", async () => {
    roomFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "room-new" });
    createOrGetDirectRoomMock.mockResolvedValue({
      room: { id: "room-new" },
      created: true,
    });
    const result = await postSokoBotOwnerNotice({
      sokoBotId: "bot-a",
      content: "x",
      key: "k",
    });
    expect(createOrGetDirectRoomMock).toHaveBeenCalledWith({
      organizationId: "org-a",
      currentUserId: "owner",
      memberUserIds: [],
      coworkerIds: [],
      sokoBotIds: ["bot-a"],
    });
    expect(messageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ roomId: "room-new" }),
      }),
    );
    expect(messageUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ roomId: "room-new", content: "x" }),
      }),
    );
    expect(result).toEqual({ messageId: "notice-1" });
  });

  it("posts nothing for a bot that is gone", async () => {
    sokoBotFindFirst.mockResolvedValue(null);
    await expect(
      postSokoBotOwnerNotice({ sokoBotId: "bot-a", content: "x", key: "k" }),
    ).resolves.toBeNull();
    expect(createOrGetDirectRoomMock).not.toHaveBeenCalled();
    expect(messageUpsert).not.toHaveBeenCalled();
  });
});

describe("publishSokoBotChatProgress", () => {
  it("does not restore streaming metadata after the answer is finalized", async () => {
    messageUpdate.mockResolvedValue({ count: 0 });
    await publishSokoBotChatProgress("turn-a");
    expect(messageUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "response-a",
          content: "",
          mentionResponseFor: { status: { in: ["pending", "sent"] } },
        },
      }),
    );
    expect(publish).not.toHaveBeenCalled();
  });
});
