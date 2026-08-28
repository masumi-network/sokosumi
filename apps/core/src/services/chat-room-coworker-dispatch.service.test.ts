import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoworkerUsableInWorkspaceWhere } from "@/helpers/access-control";

const {
  findUniqueMock,
  findManyMentionMock,
  updateManyMock,
  updateMock,
  findFirstMock,
  findManyMock,
  createMock,
  deleteMock,
  messageFindUniqueMock,
  messageFindFirstMock,
  updateMessageMock,
  streamTextMock,
  createCoworkerConversationMock,
  getSokosumiProviderMock,
  transactionUpdateManyMock,
  coworkerMemberFindUniqueMock,
  workspaceFindUniqueMock,
  coworkerFindFirstMock,
} = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  findManyMentionMock: vi.fn(),
  updateManyMock: vi.fn(),
  updateMock: vi.fn(),
  findFirstMock: vi.fn(),
  findManyMock: vi.fn(),
  createMock: vi.fn(),
  deleteMock: vi.fn(),
  messageFindUniqueMock: vi.fn(),
  messageFindFirstMock: vi.fn(),
  updateMessageMock: vi.fn(),
  streamTextMock: vi.fn(),
  createCoworkerConversationMock: vi.fn(),
  getSokosumiProviderMock: vi.fn(),
  transactionUpdateManyMock: vi.fn(),
  coworkerMemberFindUniqueMock: vi.fn(),
  workspaceFindUniqueMock: vi.fn(),
  coworkerFindFirstMock: vi.fn(),
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
      findUnique: messageFindUniqueMock,
      findFirst: messageFindFirstMock,
      create: createMock,
      update: updateMessageMock,
      delete: deleteMock,
    },
    chatRoomCoworkerMember: {
      findUnique: coworkerMemberFindUniqueMock,
    },
    chatRoom: {
      update: vi.fn(),
    },
    workspace: {
      findUnique: workspaceFindUniqueMock,
    },
    coworker: {
      findFirst: coworkerFindFirstMock,
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        chatRoomMessage: {
          create: createMock,
          delete: deleteMock,
          findUnique: messageFindUniqueMock,
          update: updateMessageMock,
        },
        chatRoomMention: {
          updateMany: transactionUpdateManyMock,
          update: updateMock,
        },
        chatRoomCoworkerMember: { findUnique: coworkerMemberFindUniqueMock },
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
  streamText: streamTextMock,
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: vi.fn().mockResolvedValue(undefined),
}));

import { publishChatRoomMessageRealtimeById } from "@/helpers/chat-room-message-realtime";

import {
  buildRoomMentionPrompt,
  dispatchChatRoomMention,
  listStaleSentChatRoomMentionIds,
  ROOM_COWORKER_CHUNK_MS,
  ROOM_COWORKER_STREAM_TIMEOUT,
  ROOM_COWORKER_TOTAL_MS,
  ROOM_SENT_STALE_MS,
} from "./chat-room-coworker-dispatch.service";

const publishRealtimeMock = vi.mocked(publishChatRoomMessageRealtimeById);

function asyncStreamParts(
  parts: Array<{ type: string; text?: string; error?: unknown }>,
): AsyncIterable<{ type: string; text?: string; error?: unknown }> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const part of parts) {
        yield part;
      }
    },
  };
}

const MENTION_ID = "mention_1";
const ORG_WORKSPACE_ID = "ws_org_1";

function pendingMention(
  overrides: {
    organizationId?: string | null;
    coworker?: Partial<{
      id: string;
      slug: string;
      name: string;
      baseURL: string | null;
    }>;
  } = {},
) {
  return {
    id: MENTION_ID,
    status: "pending",
    providerConversationId: null,
    responseMessageId: null,
    coworkerId: "cow_1",
    coworker: {
      id: "cow_1",
      slug: "hannah",
      name: "Hannah",
      baseURL: "https://coworker.example",
      ...overrides.coworker,
    },
    message: {
      id: "msg_1",
      roomId: "room_1",
      content: "@hannah hi",
      parentMessageId: null,
      senderUserId: "user_1",
      deletedAt: null,
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      senderUser: { id: "user_1", name: "Patrick" },
      room: {
        id: "room_1",
        name: "general",
        organizationId:
          "organizationId" in overrides ? overrides.organizationId : "org_1",
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSokosumiProviderMock.mockReturnValue(() => "mock-model");
  createCoworkerConversationMock.mockResolvedValue({ id: "provider_conv_1" });
  findManyMock.mockResolvedValue([]);
  streamTextMock.mockReturnValue({
    text: Promise.resolve("Hello back"),
    reasoning: Promise.resolve([]),
  });
  createMock.mockResolvedValue({ id: "reply_1" });
  deleteMock.mockResolvedValue({ id: "reply_1" });
  updateMessageMock.mockResolvedValue({ id: "reply_1" });
  messageFindUniqueMock.mockResolvedValue({ deletedAt: null });
  messageFindFirstMock.mockResolvedValue(null);
  updateMock.mockResolvedValue({});
  updateManyMock.mockResolvedValue({ count: 1 });
  transactionUpdateManyMock.mockResolvedValue({ count: 1 });
  coworkerMemberFindUniqueMock.mockResolvedValue({ id: "membership_1" });
  workspaceFindUniqueMock.mockResolvedValue({ id: ORG_WORKSPACE_ID });
  coworkerFindFirstMock.mockResolvedValue({
    id: "cow_1",
    slug: "hannah",
    baseURL: "https://coworker.example",
  });
});

describe("room coworker stream timeout budgets", () => {
  it("omits firstChunkMs so silent think is bounded only by totalMs", () => {
    expect(ROOM_COWORKER_STREAM_TIMEOUT).toEqual({
      totalMs: ROOM_COWORKER_TOTAL_MS,
      chunkMs: ROOM_COWORKER_CHUNK_MS,
    });
    expect(ROOM_COWORKER_STREAM_TIMEOUT).not.toHaveProperty("firstChunkMs");
    expect(ROOM_COWORKER_CHUNK_MS).toBe(90_000);
    expect(ROOM_COWORKER_TOTAL_MS).toBe(240_000);
    expect(ROOM_COWORKER_TOTAL_MS).toBeGreaterThan(ROOM_COWORKER_CHUNK_MS);
    expect(ROOM_SENT_STALE_MS).toBeGreaterThan(ROOM_COWORKER_TOTAL_MS);
  });
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
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(createCoworkerConversationMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("runs provider work when claim wins (updateMany count 1)", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });

    await dispatchChatRoomMention(MENTION_ID);

    expect(streamTextMock).toHaveBeenCalled();
    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        timeout: ROOM_COWORKER_STREAM_TIMEOUT,
        maxRetries: 0,
      }),
    );
    expect(streamTextMock.mock.calls[0]?.[0]).not.toHaveProperty("abortSignal");
    expect(createCoworkerConversationMock).toHaveBeenCalled();
    expect(createMock).toHaveBeenCalled();
    expect(createMock.mock.invocationCallOrder[0]).toBeLessThan(
      createCoworkerConversationMock.mock.invocationCallOrder[0],
    );
    expect(transactionUpdateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: "sent" },
      data: expect.objectContaining({
        status: "responded",
        responseMessageId: "reply_1",
      }),
    });
    expect(deleteMock).not.toHaveBeenCalled();
  });

  it("persists Thought metadata on the reply when provider returns reasoning", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    streamTextMock.mockReturnValue({
      text: Promise.resolve("Hello back"),
      reasoning: Promise.resolve([
        { type: "reasoning", text: "Looked up the room context." },
      ]),
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "",
          metadata: expect.objectContaining({
            mention_id: MENTION_ID,
            streaming: true,
            thought_timing_ms: expect.objectContaining({
              start: expect.any(Number),
            }),
          }),
        }),
      }),
    );
    expect(updateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reply_1" },
        data: expect.objectContaining({
          content: "Hello back",
          metadata: expect.objectContaining({
            mention_id: MENTION_ID,
            reasoning: [
              { type: "reasoning", text: "Looked up the room context." },
            ],
            thought_timing_ms: expect.objectContaining({
              start: expect.any(Number),
              end: expect.any(Number),
            }),
          }),
        }),
      }),
    );
    const finalizeArg = updateMessageMock.mock.calls.find((call) => {
      const data = (call[0] as { data?: { content?: string } })?.data;
      return data?.content === "Hello back";
    })?.[0] as {
      data: { metadata: { thought_timing_ms: { start: number; end: number } } };
    };
    const timing = finalizeArg.data.metadata.thought_timing_ms;
    expect(timing.end).toBeGreaterThanOrEqual(timing.start);
  });

  it("does not overwrite the shared placeholder when finalize loses the claim", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    transactionUpdateManyMock.mockResolvedValue({ count: 0 });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).toHaveBeenCalled();
    expect(transactionUpdateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: "sent" },
      data: expect.objectContaining({ status: "responded" }),
    });
    expect(updateMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "Hello back" }),
      }),
    );
    expect(deleteMock).not.toHaveBeenCalled();
    expect(publishRealtimeMock).not.toHaveBeenCalledWith("reply_1", "delete");
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
    expect(streamTextMock).toHaveBeenCalled();
  });

  it("does not reclaim a fresh sent mention still in flight", async () => {
    findUniqueMock.mockResolvedValue({
      ...pendingMention(),
      status: "sent",
      updatedAt: new Date(),
    });
    updateManyMock.mockResolvedValue({ count: 0 });

    await dispatchChatRoomMention(MENTION_ID);

    expect(streamTextMock).not.toHaveBeenCalled();
    expect(createCoworkerConversationMock).not.toHaveBeenCalled();
  });

  it("fails closed when the coworker is no longer a room member", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    coworkerMemberFindUniqueMock.mockResolvedValue(null);

    await dispatchChatRoomMention(MENTION_ID);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: { not: "responded" } },
      data: {
        status: "failed",
        error: "Coworker is no longer a member of this room",
      },
    });
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalled();
    expect(updateMessageMock).toHaveBeenCalledWith({
      where: { id: "reply_1" },
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: "msg_1",
          mention_id: MENTION_ID,
          mention_failed: true,
        },
      },
    });
  });

  it("reuses the linked placeholder when pre-claim fail already has a shell", async () => {
    findUniqueMock.mockResolvedValue({
      ...pendingMention(),
      status: "sent",
      responseMessageId: "reply_existing",
    });
    coworkerMemberFindUniqueMock.mockResolvedValue(null);
    messageFindUniqueMock.mockResolvedValue({
      id: "reply_existing",
      deletedAt: null,
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).not.toHaveBeenCalled();
    expect(updateMessageMock).toHaveBeenCalledWith({
      where: { id: "reply_existing" },
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: "msg_1",
          mention_id: MENTION_ID,
          mention_failed: true,
        },
      },
    });
    expect(streamTextMock).not.toHaveBeenCalled();
  });

  it("fails closed when membership disappears during streamText", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    coworkerMemberFindUniqueMock
      .mockResolvedValueOnce({ id: "membership_1" })
      .mockResolvedValueOnce(null);

    await dispatchChatRoomMention(MENTION_ID);

    expect(streamTextMock).toHaveBeenCalled();
    expect(createMock).toHaveBeenCalled();
    expect(transactionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: MENTION_ID,
        status: { in: ["pending", "sent"] },
      },
      data: {
        status: "failed",
        error: "Coworker is no longer a member of this room",
      },
    });
  });

  it("fails closed before claim when the source message is soft-deleted", async () => {
    findUniqueMock.mockResolvedValue({
      ...pendingMention(),
      message: {
        ...pendingMention().message,
        content: "",
        deletedAt: new Date("2026-08-02T00:00:00.000Z"),
      },
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: { not: "responded" } },
      data: {
        status: "failed",
        error: "Source message was deleted",
      },
    });
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it("discards the reply when the source message is soft-deleted during streamText", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    messageFindUniqueMock.mockResolvedValue({
      deletedAt: new Date("2026-08-02T00:00:00.000Z"),
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(streamTextMock).toHaveBeenCalled();
    expect(createMock).toHaveBeenCalled();
    expect(transactionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: MENTION_ID,
        status: { in: ["pending", "sent"] },
      },
      data: {
        status: "failed",
        error: "Source message was deleted",
      },
    });
  });

  it("dispatches when coworker is usable via workspace GRANTED access", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    coworkerFindFirstMock.mockResolvedValue({
      id: "cow_1",
      slug: "hannah",
      baseURL: "https://coworker.example",
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(workspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { organizationId: "org_1" },
      select: { id: true },
    });
    expect(coworkerFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "cow_1",
          ...buildCoworkerUsableInWorkspaceWhere(ORG_WORKSPACE_ID),
          capabilities: { has: "chat" },
          AND: [{ baseURL: { not: null } }, { baseURL: { not: "" } }],
        }),
      }),
    );
    expect(streamTextMock).toHaveBeenCalled();
  });

  it("fails closed when coworker is not usable in room workspace", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    coworkerFindFirstMock.mockResolvedValue(null);

    await dispatchChatRoomMention(MENTION_ID);

    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: { not: "responded" } },
      data: {
        status: "failed",
        error: "Coworker chat is not available",
      },
    });
    expect(streamTextMock).not.toHaveBeenCalled();
    expect(createMock).toHaveBeenCalled();
    expect(updateMessageMock).toHaveBeenCalledWith({
      where: { id: "reply_1" },
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: "msg_1",
          mention_id: MENTION_ID,
          mention_failed: true,
        },
      },
    });
  });

  it("resolves personal workspace for personal rooms via message sender", async () => {
    findUniqueMock.mockResolvedValue(pendingMention({ organizationId: null }));
    workspaceFindUniqueMock.mockResolvedValue({ id: "ws_personal_1" });
    updateManyMock.mockResolvedValue({ count: 1 });

    await dispatchChatRoomMention(MENTION_ID);

    expect(workspaceFindUniqueMock).toHaveBeenCalledWith({
      where: { userId: "user_1" },
      select: { id: true },
    });
    expect(coworkerFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining(
          buildCoworkerUsableInWorkspaceWhere("ws_personal_1"),
        ),
      }),
    );
    expect(streamTextMock).toHaveBeenCalled();
  });

  it("reuses an existing streaming placeholder for the same mention", async () => {
    findUniqueMock.mockResolvedValue({
      ...pendingMention(),
      responseMessageId: "reply_existing",
    });
    updateManyMock.mockResolvedValue({ count: 1 });
    updateMessageMock.mockResolvedValue({ id: "reply_existing" });
    streamTextMock.mockReturnValue({
      text: Promise.resolve("Hello back"),
      reasoning: Promise.resolve([
        { type: "reasoning", text: "Looked up the room context." },
      ]),
      fullStream: asyncStreamParts([
        {
          type: "reasoning-delta",
          text: "Looked up the room context.",
        },
        { type: "text-delta", text: "Hello back" },
      ]),
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(messageFindFirstMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reply_existing" },
      }),
    );
    expect(publishRealtimeMock).toHaveBeenCalledWith(
      "reply_existing",
      "update",
    );
    expect(transactionUpdateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: "sent" },
      data: expect.objectContaining({
        status: "responded",
        responseMessageId: "reply_existing",
      }),
    });
  });

  it("creates a new Thought shell when the linked placeholder is soft-deleted", async () => {
    findUniqueMock.mockResolvedValue({
      ...pendingMention(),
      responseMessageId: "reply_existing",
    });
    updateManyMock.mockResolvedValue({ count: 1 });
    messageFindUniqueMock
      .mockResolvedValueOnce({
        id: "reply_existing",
        deletedAt: new Date("2026-08-02T00:00:00.000Z"),
      })
      .mockResolvedValue({ deletedAt: null });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID },
      data: { responseMessageId: "reply_1" },
    });
  });

  it("creates a streaming Thought placeholder and finalizes that row", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    streamTextMock.mockReturnValue({
      text: Promise.resolve("Hello back"),
      reasoning: Promise.resolve([
        { type: "reasoning", text: "Looked up the room context." },
      ]),
      fullStream: asyncStreamParts([
        {
          type: "reasoning-delta",
          text: "Looked up the room context.",
        },
        { type: "text-delta", text: "Hello back" },
      ]),
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          content: "",
          senderCoworkerId: "cow_1",
          metadata: expect.objectContaining({
            mention_id: MENTION_ID,
            streaming: true,
            reasoning: [],
            thought_timing_ms: expect.objectContaining({
              start: expect.any(Number),
            }),
          }),
        }),
      }),
    );
    expect(updateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reply_1" },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            streaming: true,
            reasoning: [
              { type: "reasoning", text: "Looked up the room context." },
            ],
            thought_timing_ms: expect.objectContaining({
              start: expect.any(Number),
            }),
          }),
        }),
      }),
    );
    expect(publishRealtimeMock).toHaveBeenCalledWith("reply_1", "create");
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID },
      data: { responseMessageId: "reply_1" },
    });
    expect(updateMessageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "reply_1" },
        data: expect.objectContaining({
          content: "Hello back",
          metadata: expect.objectContaining({
            mention_id: MENTION_ID,
            reasoning: [
              { type: "reasoning", text: "Looked up the room context." },
            ],
            thought_timing_ms: expect.objectContaining({
              start: expect.any(Number),
              end: expect.any(Number),
            }),
          }),
        }),
      }),
    );
    const finalizeMeta = updateMessageMock.mock.calls.find((call) => {
      const data = (call[0] as { data?: { content?: string } })?.data;
      return data?.content === "Hello back";
    })?.[0] as { data: { metadata: Record<string, unknown> } };
    expect(finalizeMeta.data.metadata.streaming).toBeUndefined();
    expect(transactionUpdateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: "sent" },
      data: expect.objectContaining({
        status: "responded",
        responseMessageId: "reply_1",
      }),
    });
    expect(publishRealtimeMock).toHaveBeenCalledWith("reply_1", "update");
    expect(publishRealtimeMock).toHaveBeenCalledWith("msg_1", "mention_status");
  });

  it("keeps a failed Thought shell when mention dispatch fails after stream", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    coworkerMemberFindUniqueMock
      .mockResolvedValueOnce({ id: "membership_1" })
      .mockResolvedValueOnce(null);
    streamTextMock.mockReturnValue({
      text: Promise.resolve("Hello back"),
      reasoning: Promise.resolve([
        { type: "reasoning", text: "Looked up the room context." },
      ]),
      fullStream: asyncStreamParts([
        {
          type: "reasoning-delta",
          text: "Looked up the room context.",
        },
        { type: "text-delta", text: "Hello back" },
      ]),
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(publishRealtimeMock).not.toHaveBeenCalledWith("reply_1", "delete");
    expect(updateMessageMock).toHaveBeenCalledWith({
      where: { id: "reply_1" },
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: "msg_1",
          mention_id: MENTION_ID,
          mention_failed: true,
        },
      },
    });
    expect(publishRealtimeMock).toHaveBeenCalledWith("reply_1", "update");
    expect(transactionUpdateManyMock).toHaveBeenCalledWith({
      where: {
        id: MENTION_ID,
        status: { in: ["pending", "sent"] },
      },
      data: {
        status: "failed",
        error: "Coworker is no longer a member of this room",
      },
    });
  });

  it("keeps a failed Thought shell when the provider stream throws", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    streamTextMock.mockReturnValue({
      text: Promise.resolve("Hello back"),
      reasoning: Promise.resolve([
        { type: "reasoning", text: "Looked up the room context." },
      ]),
      fullStream: {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "reasoning-delta",
            text: "Looked up the room context.",
          };
          throw new Error("stream aborted");
        },
      },
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(publishRealtimeMock).not.toHaveBeenCalledWith("reply_1", "delete");
    expect(updateMessageMock).toHaveBeenCalledWith({
      where: { id: "reply_1" },
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: "msg_1",
          mention_id: MENTION_ID,
          mention_failed: true,
        },
      },
    });
    expect(publishRealtimeMock).toHaveBeenCalledWith("reply_1", "update");
    expect(updateManyMock).toHaveBeenCalledWith({
      where: { id: MENTION_ID, status: { not: "responded" } },
      data: expect.objectContaining({
        status: "failed",
      }),
    });
  });

  it("fails closed when fullStream emits an error part after Thought", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    streamTextMock.mockReturnValue({
      text: Promise.resolve("partial"),
      reasoning: Promise.resolve([
        { type: "reasoning", text: "Looked up the room context." },
      ]),
      fullStream: asyncStreamParts([
        {
          type: "reasoning-delta",
          text: "Looked up the room context.",
        },
        { type: "error", error: "stream aborted" },
        { type: "text-delta", text: "partial" },
      ]),
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(publishRealtimeMock).not.toHaveBeenCalledWith("reply_1", "delete");
    expect(updateMessageMock).toHaveBeenCalledWith({
      where: { id: "reply_1" },
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: "msg_1",
          mention_id: MENTION_ID,
          mention_failed: true,
        },
      },
    });
    expect(publishRealtimeMock).toHaveBeenCalledWith("reply_1", "update");
    expect(transactionUpdateManyMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "responded" }),
      }),
    );
  });

  it("does not discard a reused placeholder the winning worker already finalized", async () => {
    findUniqueMock
      .mockResolvedValueOnce({
        ...pendingMention(),
        responseMessageId: "reply_existing",
      })
      .mockResolvedValue({
        ...pendingMention(),
        status: "responded",
        responseMessageId: "reply_existing",
      });
    updateManyMock.mockResolvedValue({ count: 1 });
    transactionUpdateManyMock.mockResolvedValue({ count: 0 });
    updateMessageMock.mockResolvedValue({ id: "reply_existing" });
    streamTextMock.mockReturnValue({
      text: Promise.resolve("Hello back"),
      reasoning: Promise.resolve([
        { type: "reasoning", text: "Looked up the room context." },
      ]),
      fullStream: asyncStreamParts([
        {
          type: "reasoning-delta",
          text: "Looked up the room context.",
        },
        { type: "text-delta", text: "Hello back" },
      ]),
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).not.toHaveBeenCalled();
    expect(deleteMock).not.toHaveBeenCalled();
    expect(publishRealtimeMock).not.toHaveBeenCalledWith(
      "reply_existing",
      "delete",
    );
  });

  it("does not discard a streaming placeholder when finalize loses the claim", async () => {
    findUniqueMock.mockResolvedValue(pendingMention());
    updateManyMock.mockResolvedValue({ count: 1 });
    transactionUpdateManyMock.mockResolvedValue({ count: 0 });
    streamTextMock.mockReturnValue({
      text: Promise.resolve("Hello back"),
      reasoning: Promise.resolve([
        { type: "reasoning", text: "Looked up the room context." },
      ]),
      fullStream: asyncStreamParts([
        {
          type: "reasoning-delta",
          text: "Looked up the room context.",
        },
        { type: "text-delta", text: "Hello back" },
      ]),
    });

    await dispatchChatRoomMention(MENTION_ID);

    expect(createMock).toHaveBeenCalled();
    expect(updateMessageMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ content: "Hello back" }),
      }),
    );
    expect(publishRealtimeMock).not.toHaveBeenCalledWith("reply_1", "delete");
    expect(deleteMock).not.toHaveBeenCalled();
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
