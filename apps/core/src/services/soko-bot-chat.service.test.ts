import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  turnFindUnique,
  mentionUpdateMany,
  messageUpdate,
  messageDelete,
  roomUpdate,
  publish,
} = vi.hoisted(() => ({
  turnFindUnique: vi.fn(),
  mentionUpdateMany: vi.fn(),
  messageUpdate: vi.fn(),
  messageDelete: vi.fn(),
  roomUpdate: vi.fn(),
  publish: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: {
    sokoBotTurn: { findUnique: turnFindUnique },
    chatRoomMessage: { update: messageUpdate, updateMany: messageUpdate },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        chatRoomMention: { updateMany: mentionUpdateMany },
        chatRoomMessage: { update: messageUpdate, delete: messageDelete },
        chatRoom: { update: roomUpdate },
      }),
    ),
  },
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: publish,
}));

import {
  finalizeSokoBotChatTurn,
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
  roomUpdate.mockResolvedValue({ id: "room-a" });
  publish.mockResolvedValue(undefined);
});

describe("finalizeSokoBotChatTurn", () => {
  it("publishes a successful response once and preserves its completion clock on retry", async () => {
    mentionUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    await finalizeSokoBotChatTurn("turn-a");
    await finalizeSokoBotChatTurn("turn-a");
    expect(messageUpdate).toHaveBeenCalledOnce();
    expect(roomUpdate).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledTimes(2);
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

  it("does not overwrite a response after another finalizer wins", async () => {
    mentionUpdateMany.mockResolvedValue({ count: 0 });
    await finalizeSokoBotChatTurn("turn-a");
    expect(messageUpdate).not.toHaveBeenCalled();
    expect(roomUpdate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not turn a completed answer into a failed shell", async () => {
    turnFindUnique.mockResolvedValue(
      completedTurn({ status: "FAILED", finalAnswer: null }),
    );
    mentionUpdateMany.mockResolvedValue({ count: 0 });
    await finalizeSokoBotChatTurn("turn-a");
    expect(messageUpdate).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("keeps a failed shell when the failure transition wins", async () => {
    turnFindUnique.mockResolvedValue(
      completedTurn({ status: "FAILED", finalAnswer: null }),
    );
    await finalizeSokoBotChatTurn("turn-a");
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
    await finalizeSokoBotChatTurn("turn-a");
    expect(messageDelete).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
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
