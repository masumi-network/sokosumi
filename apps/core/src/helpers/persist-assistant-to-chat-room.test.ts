import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    chatRoom: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: vi.fn().mockResolvedValue(undefined),
}));

import prisma from "@/lib/db/prisma";
import {
  persistAssistantToChatRoom,
  persistUserMessageToChatRoom,
} from "./persist-assistant-to-chat-room";

async function runTransactionCallback<T>(
  callback: (tx: typeof prisma) => Promise<T>,
): Promise<T> {
  return callback(prisma);
}

describe("persistAssistantToChatRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.chatRoomMessage.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.chatRoomMessage.create).mockResolvedValue({
      id: "msg_assistant",
    } as never);
    vi.mocked(prisma.chatRoom.update).mockResolvedValue({} as never);
    vi.mocked(prisma.$transaction).mockImplementation((async (arg: unknown) => {
      if (typeof arg === "function") {
        return runTransactionCallback(
          arg as (tx: typeof prisma) => Promise<unknown>,
        );
      }
      return arg;
    }) as never);
  });

  it("creates chat_room_message with senderCoworkerId and content", async () => {
    const result = await persistAssistantToChatRoom({
      roomId: "room_1",
      senderCoworkerId: "coworker_1",
      contentText: "Hello from coworker",
    });
    expect(result.id).toBe("msg_assistant");
    expect(prisma.chatRoomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: "room_1",
          senderCoworkerId: "coworker_1",
          content: "Hello from coworker",
          senderUserId: null,
          responsesApiResponseId: null,
          parentMessageId: null,
        }),
      }),
    );
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: "room_1" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("persists parentMessageId for thread assistant turns", async () => {
    await persistAssistantToChatRoom({
      roomId: "room_1",
      senderCoworkerId: "coworker_1",
      contentText: "Thread reply",
      parentMessageId: "parent_1",
    });

    expect(prisma.chatRoomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentMessageId: "parent_1",
        }),
      }),
    );
  });

  it("returns existing message id when responsesApiResponseId already persisted", async () => {
    vi.mocked(prisma.chatRoomMessage.findUnique).mockResolvedValue({
      id: "msg_existing",
    } as never);

    const result = await persistAssistantToChatRoom({
      roomId: "room_1",
      senderCoworkerId: "coworker_1",
      contentText: "Duplicate finish",
      responsesApiResponseId: "resp_1",
    });

    expect(result.id).toBe("msg_existing");
    expect(prisma.chatRoomMessage.findUnique).toHaveBeenCalledWith({
      where: {
        roomId_responsesApiResponseId: {
          roomId: "room_1",
          responsesApiResponseId: "resp_1",
        },
      },
      select: { id: true },
    });
    expect(prisma.chatRoomMessage.create).not.toHaveBeenCalled();
  });

  it("returns existing id when concurrent create hits unique (P2002)", async () => {
    vi.mocked(prisma.chatRoomMessage.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "msg_winner" } as never);
    vi.mocked(prisma.$transaction).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await persistAssistantToChatRoom({
      roomId: "room_1",
      senderCoworkerId: "coworker_1",
      contentText: "Race finish",
      responsesApiResponseId: "resp_race",
    });

    expect(result.id).toBe("msg_winner");
    expect(prisma.chatRoomMessage.findUnique).toHaveBeenCalledTimes(2);
  });

  it("rethrows P2002 when race re-read finds nothing", async () => {
    vi.mocked(prisma.chatRoomMessage.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(
      persistAssistantToChatRoom({
        roomId: "room_1",
        senderCoworkerId: "coworker_1",
        contentText: "Hello",
        responsesApiResponseId: "resp_missing",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("trims responsesApiResponseId before persist", async () => {
    await persistAssistantToChatRoom({
      roomId: "room_1",
      senderCoworkerId: "coworker_1",
      contentText: "Hello",
      responsesApiResponseId: "  resp_trim  ",
    });

    expect(prisma.chatRoomMessage.findUnique).toHaveBeenCalledWith({
      where: {
        roomId_responsesApiResponseId: {
          roomId: "room_1",
          responsesApiResponseId: "resp_trim",
        },
      },
      select: { id: true },
    });
    expect(prisma.chatRoomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          responsesApiResponseId: "resp_trim",
        }),
      }),
    );
  });

  it("rethrows non-unique errors after create fails", async () => {
    vi.mocked(prisma.$transaction).mockRejectedValue(new Error("db down"));

    await expect(
      persistAssistantToChatRoom({
        roomId: "room_1",
        senderCoworkerId: "coworker_1",
        contentText: "Hello",
        responsesApiResponseId: "resp_1",
      }),
    ).rejects.toThrow("db down");
  });

  it("throws when assistant payload is empty", async () => {
    await expect(
      persistAssistantToChatRoom({
        roomId: "room_1",
        senderCoworkerId: "coworker_1",
        contentText: "   ",
      }),
    ).rejects.toThrow("Cannot persist empty assistant chat room message");

    expect(prisma.chatRoomMessage.findUnique).not.toHaveBeenCalled();
    expect(prisma.chatRoomMessage.create).not.toHaveBeenCalled();
  });

  it("persists reasoning, thought timing, ui parts, and response id", async () => {
    await persistAssistantToChatRoom({
      roomId: "room_1",
      senderCoworkerId: "coworker_1",
      contentText: "Here's the image.",
      responsesApiResponseId: "resp_img",
      reasoning: [{ type: "reasoning", text: "Thinking..." }],
      thoughtTiming: { startedAtMs: 100, endedAtMs: 500 },
      uiParts: [
        { type: "text", text: "Here's the image." },
        {
          type: "file",
          url: "https://blob.example.com/generated.png",
          mediaType: "image/png",
          filename: "generated.png",
        },
      ],
    });

    expect(prisma.chatRoomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          roomId: "room_1",
          senderCoworkerId: "coworker_1",
          senderUserId: null,
          content: "Here's the image.",
          responsesApiResponseId: "resp_img",
          parentMessageId: null,
          metadata: {
            reasoning: [{ type: "reasoning", text: "Thinking..." }],
            thought_timing_ms: { start: 100, end: 500 },
            ui_message_v1: {
              parts: [
                { type: "text", text: "Here's the image." },
                {
                  type: "file",
                  url: "https://blob.example.com/generated.png",
                  mediaType: "image/png",
                  filename: "generated.png",
                },
              ],
            },
            responses_api_response_id: "resp_img",
          },
        }),
      }),
    );
  });
});

describe("persistUserMessageToChatRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.chatRoomMessage.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.chatRoomMessage.create).mockResolvedValue({
      id: "msg_user",
    } as never);
    vi.mocked(prisma.chatRoom.update).mockResolvedValue({} as never);
    vi.mocked(prisma.$transaction).mockImplementation((async (arg: unknown) => {
      if (typeof arg === "function") {
        return runTransactionCallback(
          arg as (tx: typeof prisma) => Promise<unknown>,
        );
      }
      return arg;
    }) as never);
  });

  it("creates chat_room_message with senderUserId and content", async () => {
    const result = await persistUserMessageToChatRoom({
      roomId: "room_1",
      senderUserId: "user_1",
      contentText: "Hello from user",
    });
    expect(result.id).toBe("msg_user");
    expect(prisma.chatRoomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          roomId: "room_1",
          senderUserId: "user_1",
          senderCoworkerId: null,
          content: "Hello from user",
          metadata: undefined,
          clientMessageId: null,
          parentMessageId: null,
        },
      }),
    );
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: "room_1" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("persists parentMessageId for thread user turns", async () => {
    await persistUserMessageToChatRoom({
      roomId: "room_1",
      senderUserId: "user_1",
      contentText: "Thread reply",
      parentMessageId: "parent_1",
    });

    expect(prisma.chatRoomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          parentMessageId: "parent_1",
        }),
      }),
    );
  });

  it("persists optional metadata", async () => {
    await persistUserMessageToChatRoom({
      roomId: "room_1",
      senderUserId: "user_1",
      contentText: "Make an image",
      metadata: { image_generation: true },
    });

    expect(prisma.chatRoomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          roomId: "room_1",
          senderUserId: "user_1",
          senderCoworkerId: null,
          content: "Make an image",
          metadata: { image_generation: true },
          clientMessageId: null,
          parentMessageId: null,
        },
      }),
    );
  });

  it("skips create when clientMessageId already persisted", async () => {
    vi.mocked(prisma.chatRoomMessage.findUnique).mockResolvedValue({
      id: "msg_existing_user",
    } as never);

    const result = await persistUserMessageToChatRoom({
      roomId: "room_1",
      senderUserId: "user_1",
      contentText: "Hello again",
      clientMessageId: "ui_msg_1",
    });

    expect(result.id).toBe("msg_existing_user");
    expect(prisma.chatRoomMessage.findUnique).toHaveBeenCalledWith({
      where: {
        roomId_clientMessageId: {
          roomId: "room_1",
          clientMessageId: "ui_msg_1",
        },
      },
      select: { id: true },
    });
    expect(prisma.chatRoomMessage.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("returns existing id when concurrent create hits unique (P2002)", async () => {
    vi.mocked(prisma.chatRoomMessage.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: "msg_winner_user" } as never);
    vi.mocked(prisma.$transaction).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    const result = await persistUserMessageToChatRoom({
      roomId: "room_1",
      senderUserId: "user_1",
      contentText: "Hello race",
      clientMessageId: "ui_msg_race",
    });

    expect(result.id).toBe("msg_winner_user");
    expect(prisma.chatRoomMessage.findUnique).toHaveBeenCalledTimes(2);
  });

  it("rethrows P2002 when race re-read finds nothing", async () => {
    vi.mocked(prisma.chatRoomMessage.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.$transaction).mockRejectedValue(
      Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    );

    await expect(
      persistUserMessageToChatRoom({
        roomId: "room_1",
        senderUserId: "user_1",
        contentText: "Hello",
        clientMessageId: "ui_msg_missing",
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("stores client_message_id in metadata and clientMessageId column on create", async () => {
    vi.mocked(prisma.chatRoomMessage.findUnique).mockResolvedValue(null);

    await persistUserMessageToChatRoom({
      roomId: "room_1",
      senderUserId: "user_1",
      contentText: "Hello",
      clientMessageId: "ui_msg_2",
    });

    expect(prisma.chatRoomMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          clientMessageId: "ui_msg_2",
          metadata: { client_message_id: "ui_msg_2" },
        }),
      }),
    );
  });
});
