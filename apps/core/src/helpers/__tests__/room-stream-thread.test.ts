import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/routes/v1/chats/stream/coworker-conversation", () => ({
  CoworkerConversationError: class CoworkerConversationError extends Error {
    upstreamStatus: number;
    constructor(message: string, upstreamStatus: number) {
      super(message);
      this.upstreamStatus = upstreamStatus;
    }
  },
  createCoworkerConversation: vi.fn(),
}));

vi.mock("ai", () => ({
  convertToModelMessages: vi.fn(async () => [
    { role: "user", content: "converted" },
  ]),
}));

import { convertToModelMessages } from "ai";

import prisma from "@/lib/db/prisma";
import { createCoworkerConversation } from "@/routes/v1/chats/stream/coworker-conversation";

import {
  buildRoomStreamThreadModelMessages,
  ensureThreadProviderConversation,
  THREAD_PROVIDER_CONVERSATION_ID_KEY,
  threadHasPriorAssistantReply,
} from "../room-stream-thread";

describe("threadHasPriorAssistantReply", () => {
  it("ignores coworker root — first thread AI turn still needs embedded context", () => {
    expect(
      threadHasPriorAssistantReply(
        [
          { id: "parent_1", senderCoworkerId: "cow_1" },
          { id: "reply_1", senderCoworkerId: null },
        ],
        "parent_1",
      ),
    ).toBe(false);
  });

  it("detects an assistant reply under the root", () => {
    expect(
      threadHasPriorAssistantReply(
        [
          { id: "parent_1", senderCoworkerId: "cow_1" },
          { id: "asst_1", senderCoworkerId: "cow_1" },
          { id: "reply_2", senderCoworkerId: null },
        ],
        "parent_1",
      ),
    ).toBe(true);
  });
});

describe("ensureThreadProviderConversation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns existing thread provider conversation from parent metadata", async () => {
    vi.mocked(prisma.chatRoomMessage.findFirst).mockResolvedValue({
      id: "parent_1",
      metadata: { [THREAD_PROVIDER_CONVERSATION_ID_KEY]: "conv_existing" },
    } as never);

    const result = await ensureThreadProviderConversation({
      roomId: "room_1",
      parentMessageId: "parent_1",
      userId: "user_1",
      organizationId: null,
      coworkerSlug: "hannah",
      responsesApiBaseUrl: "https://responses.example.com/v1",
    });

    expect(result).toEqual({
      providerConversationId: "conv_existing",
      justCreated: false,
    });
    expect(createCoworkerConversation).not.toHaveBeenCalled();
  });

  it("creates and stores a new thread provider conversation", async () => {
    vi.mocked(prisma.chatRoomMessage.findFirst)
      .mockResolvedValueOnce({
        id: "parent_1",
        metadata: null,
      } as never)
      .mockResolvedValueOnce({
        id: "parent_1",
        metadata: { [THREAD_PROVIDER_CONVERSATION_ID_KEY]: "conv_new" },
      } as never);
    vi.mocked(createCoworkerConversation).mockResolvedValue({
      id: "conv_new",
    } as never);
    vi.mocked(prisma.chatRoomMessage.update).mockResolvedValue({} as never);

    const result = await ensureThreadProviderConversation({
      roomId: "room_1",
      parentMessageId: "parent_1",
      userId: "user_1",
      organizationId: "org_1",
      coworkerSlug: "hannah",
      responsesApiBaseUrl: "https://responses.example.com/v1",
    });

    expect(createCoworkerConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        sokosumiConversationId: "parent_1",
        coworkerSlug: "hannah",
      }),
    );
    expect(prisma.chatRoomMessage.update).toHaveBeenCalledWith({
      where: { id: "parent_1" },
      data: {
        metadata: { [THREAD_PROVIDER_CONVERSATION_ID_KEY]: "conv_new" },
      },
    });
    expect(result).toEqual({
      providerConversationId: "conv_new",
      justCreated: true,
    });
  });
});

describe("buildRoomStreamThreadModelMessages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("embeds thread context on first AI turn under a user root", async () => {
    vi.mocked(prisma.chatRoomMessage.findMany).mockResolvedValue([
      {
        id: "reply_1",
        content: "Follow-up",
        senderUserId: "user_1",
        senderCoworkerId: null,
        metadata: null,
        createdAt: new Date("2026-07-01T12:01:00.000Z"),
        senderUser: { name: "Ada" },
        senderCoworker: null,
      },
      {
        id: "parent_1",
        content: "Root question",
        senderUserId: "user_1",
        senderCoworkerId: null,
        metadata: null,
        createdAt: new Date("2026-07-01T12:00:00.000Z"),
        senderUser: { name: "Ada" },
        senderCoworker: null,
      },
    ] as never);

    const result = await buildRoomStreamThreadModelMessages({
      roomId: "room_1",
      parentMessageId: "parent_1",
      roomName: "Hannah DM",
      senderName: "Ada",
      lastUserMessageText: "Follow-up",
    });

    expect(prisma.chatRoomMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(convertToModelMessages).not.toHaveBeenCalled();
    expect(result.modelMessages).toHaveLength(1);
    expect(result.modelMessages[0]).toMatchObject({ role: "user" });
    expect(String(result.modelMessages[0]?.content)).toContain("Root question");
    expect(String(result.modelMessages[0]?.content)).toContain("Follow-up");
  });

  it("embeds coworker root on first AI thread turn (does not treat root as prior reply)", async () => {
    vi.mocked(prisma.chatRoomMessage.findMany).mockResolvedValue([
      {
        id: "reply_1",
        content: "Was kannst du mir anbieten?",
        senderUserId: "user_1",
        senderCoworkerId: null,
        metadata: null,
        createdAt: new Date("2026-07-01T12:01:00.000Z"),
        senderUser: { name: "Ada" },
        senderCoworker: null,
      },
      {
        id: "parent_1",
        content: "Hallo Andreas! Wie kann ich dir heute helfen?",
        senderUserId: null,
        senderCoworkerId: "cow_1",
        metadata: null,
        createdAt: new Date("2026-07-01T12:00:00.000Z"),
        senderUser: null,
        senderCoworker: { name: "Hannah" },
      },
    ] as never);

    const result = await buildRoomStreamThreadModelMessages({
      roomId: "room_1",
      parentMessageId: "parent_1",
      roomName: "Hannah DM",
      senderName: "Ada",
      lastUserMessageText: "Was kannst du mir anbieten?",
    });

    expect(convertToModelMessages).not.toHaveBeenCalled();
    expect(String(result.modelMessages[0]?.content)).toContain(
      "Hallo Andreas! Wie kann ich dir heute helfen?",
    );
    expect(String(result.modelMessages[0]?.content)).toContain(
      "Was kannst du mir anbieten?",
    );
  });

  it("keeps the newest messages when the thread exceeds the context window", async () => {
    const rows = Array.from({ length: 12 }, (_, index) => {
      const n = 12 - index;
      return {
        id: `msg_${n}`,
        content: `Message ${n}`,
        senderUserId: n === 1 ? null : "user_1",
        senderCoworkerId: n === 1 ? "cow_1" : null,
        metadata: null,
        createdAt: new Date(
          `2026-07-01T12:${String(n).padStart(2, "0")}:00.000Z`,
        ),
        senderUser: n === 1 ? null : { name: "Ada" },
        senderCoworker: n === 1 ? { name: "Hannah" } : null,
      };
    });
    // Newest-first page from Prisma: drop oldest (msg_1 root) from window.
    vi.mocked(prisma.chatRoomMessage.findMany).mockResolvedValue(
      rows.slice(0, 11) as never,
    );

    const result = await buildRoomStreamThreadModelMessages({
      roomId: "room_1",
      parentMessageId: "msg_1",
      roomName: "Hannah DM",
      senderName: "Ada",
      lastUserMessageText: "Message 12",
    });

    // Window is msgs 2..12 (newest 11). Prior assistant under root: none in this
    // synthetic set after dropping root — still embeds prompt with newest context.
    expect(convertToModelMessages).not.toHaveBeenCalled();
    expect(String(result.modelMessages[0]?.content)).toContain("Message 12");
    expect(String(result.modelMessages[0]?.content)).toContain("Message 2");
    expect(String(result.modelMessages[0]?.content)).not.toMatch(
      /Message 1(?!\d)/,
    );
  });

  it("converts full thread history after an assistant reply exists under the root", async () => {
    vi.mocked(prisma.chatRoomMessage.findMany).mockResolvedValue([
      {
        id: "reply_2",
        content: "More",
        senderUserId: "user_1",
        senderCoworkerId: null,
        metadata: null,
        createdAt: new Date("2026-07-01T12:02:00.000Z"),
        senderUser: { name: "Ada" },
        senderCoworker: null,
      },
      {
        id: "asst_1",
        content: "Answer",
        senderUserId: null,
        senderCoworkerId: "cow_1",
        metadata: null,
        createdAt: new Date("2026-07-01T12:01:00.000Z"),
        senderUser: null,
        senderCoworker: { name: "Hannah" },
      },
      {
        id: "parent_1",
        content: "Root",
        senderUserId: "user_1",
        senderCoworkerId: null,
        metadata: null,
        createdAt: new Date("2026-07-01T12:00:00.000Z"),
        senderUser: { name: "Ada" },
        senderCoworker: null,
      },
    ] as never);

    const result = await buildRoomStreamThreadModelMessages({
      roomId: "room_1",
      parentMessageId: "parent_1",
      roomName: "Hannah DM",
      senderName: "Ada",
      lastUserMessageText: "More",
    });

    expect(convertToModelMessages).toHaveBeenCalledOnce();
    expect(result.modelMessages).toEqual([
      { role: "user", content: "converted" },
    ]);
  });
});
