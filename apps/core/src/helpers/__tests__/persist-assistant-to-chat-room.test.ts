import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: { create: vi.fn(), findFirst: vi.fn() },
    chatRoom: { update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import prisma from "@/lib/db/prisma";
import {
  persistAssistantToChatRoom,
  persistUserMessageToChatRoom,
} from "../persist-assistant-to-chat-room";

async function runTransactionCallback<T>(
  callback: (tx: typeof prisma) => Promise<T>,
): Promise<T> {
  return callback(prisma);
}

describe("persistAssistantToChatRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.chatRoomMessage.findFirst).mockResolvedValue(null);
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
        }),
      }),
    );
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: "room_1" },
      data: { updatedAt: expect.any(Date) },
    });
  });

  it("returns existing message id when responsesApiResponseId already persisted", async () => {
    vi.mocked(prisma.chatRoomMessage.findFirst).mockResolvedValue({
      id: "msg_existing",
    } as never);

    const result = await persistAssistantToChatRoom({
      roomId: "room_1",
      senderCoworkerId: "coworker_1",
      contentText: "Duplicate finish",
      responsesApiResponseId: "resp_1",
    });

    expect(result.id).toBe("msg_existing");
    expect(prisma.chatRoomMessage.findFirst).toHaveBeenCalledWith({
      where: {
        roomId: "room_1",
        metadata: {
          path: ["responses_api_response_id"],
          equals: "resp_1",
        },
      },
      select: { id: true },
    });
    expect(prisma.chatRoomMessage.create).not.toHaveBeenCalled();
  });

  it("throws when assistant payload is empty", async () => {
    await expect(
      persistAssistantToChatRoom({
        roomId: "room_1",
        senderCoworkerId: "coworker_1",
        contentText: "   ",
      }),
    ).rejects.toThrow("Cannot persist empty assistant chat room message");

    expect(prisma.chatRoomMessage.findFirst).not.toHaveBeenCalled();
    expect(prisma.chatRoomMessage.create).not.toHaveBeenCalled();
  });

  it("persists reasoning, thought timing, and ui parts in metadata", async () => {
    await persistAssistantToChatRoom({
      roomId: "room_1",
      senderCoworkerId: "coworker_1",
      contentText: "Here's the image.",
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
        data: {
          roomId: "room_1",
          senderCoworkerId: "coworker_1",
          senderUserId: null,
          content: "Here's the image.",
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
          },
        },
      }),
    );
  });
});

describe("persistUserMessageToChatRoom", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
        },
      }),
    );
    expect(prisma.chatRoom.update).toHaveBeenCalledWith({
      where: { id: "room_1" },
      data: { updatedAt: expect.any(Date) },
    });
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
        },
      }),
    );
  });
});
