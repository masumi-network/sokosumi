import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createMessage,
  deleteMessage,
  updateMessage,
  updateMention,
  updateRoom,
  publish,
} = vi.hoisted(() => ({
  createMessage: vi.fn(),
  deleteMessage: vi.fn(),
  updateMessage: vi.fn(),
  updateMention: vi.fn(),
  updateRoom: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@/lib/db/prisma", () => ({
  default: {
    chatRoomMessage: {
      update: updateMessage,
      updateMany: updateMessage,
      delete: deleteMessage,
      deleteMany: deleteMessage,
    },
    $transaction: vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        chatRoomMessage: { create: createMessage },
        chatRoomMention: { update: updateMention },
        chatRoom: { update: updateRoom },
      }),
    ),
  },
}));
vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: publish,
}));

import {
  consumeMentionProviderStream,
  failMentionThoughtPlaceholder,
  publishMentionThoughtPlaceholder,
} from "./chat-room-mention-stream";

beforeEach(() => {
  vi.clearAllMocks();
  createMessage.mockResolvedValue({ id: "placeholder-a" });
  updateMessage.mockResolvedValue({ id: "placeholder-a" });
  updateMention.mockResolvedValue({});
  updateRoom.mockResolvedValue({});
  publish.mockResolvedValue(undefined);
});

describe("mention provider stream", () => {
  it("keeps reasoning separate from final content", async () => {
    const onThought = vi.fn();
    // Exercise the public async-iterable shape used by the provider.
    const output = await consumeMentionProviderStream(
      {
        fullStream: (async function* () {
          yield { type: "reasoning-delta", text: "Checking evidence" };
          yield { type: "reasoning-end" };
          yield { type: "text-delta", text: "Final answer" };
        })(),
      },
      onThought,
    );
    expect(output).toEqual({
      text: "Final answer",
      reasoningSteps: [{ type: "reasoning", text: "Checking evidence" }],
    });
    expect(onThought).toHaveBeenCalledWith([
      { type: "reasoning", text: "Checking evidence" },
    ]);
  });
  it("propagates provider stream failure instead of accepting partial content", async () => {
    await expect(
      consumeMentionProviderStream(
        {
          fullStream: (async function* () {
            yield { type: "text-delta", text: "Partial answer" };
            yield { type: "error", error: new Error("provider failed") };
          })(),
        },
        vi.fn(),
      ),
    ).rejects.toThrow("provider failed");
  });
});

describe("Thought placeholder", () => {
  const input = {
    placeholderId: null,
    roomId: "room-a",
    parentMessageId: null,
    sourceMessageId: "source-a",
    mentionId: "mention-a",
    coworkerId: "coworker-a",
    reasoningSteps: [],
    thoughtStartedAtMs: 1000,
  };
  it("creates the placeholder and room activity in the same transaction", async () => {
    await expect(publishMentionThoughtPlaceholder(input)).resolves.toBe(
      "placeholder-a",
    );
    expect(updateRoom).toHaveBeenCalledWith({
      where: { id: "room-a" },
      data: { updatedAt: expect.any(Date) },
    });
    expect(updateMention).toHaveBeenCalledWith({
      where: { id: "mention-a", status: { not: "responded" } },
      data: { responseMessageId: "placeholder-a" },
    });
    expect(publish).toHaveBeenCalledWith("placeholder-a", "create");
  });
  it("updates Thought metadata without changing timeline position", async () => {
    await publishMentionThoughtPlaceholder({
      ...input,
      placeholderId: "placeholder-a",
    });
    expect(updateMessage).toHaveBeenCalledWith({
      where: {
        id: "placeholder-a",
        content: "",
        mentionResponseFor: { status: { in: ["pending", "sent"] } },
      },
      data: { metadata: expect.objectContaining({ streaming: true }) },
    });
    expect(createMessage).not.toHaveBeenCalled();
    expect(updateRoom).not.toHaveBeenCalled();
  });
});

describe("failed Thought cleanup", () => {
  it("preserves an answer completed after the caller read failed status", async () => {
    updateMessage.mockResolvedValue({ count: 0 });
    await failMentionThoughtPlaceholder({
      placeholderId: "placeholder-a",
      sourceMessageId: "source-a",
      mentionId: "mention-a",
      onlyWhenFailed: true,
    });
    expect(updateMessage).toHaveBeenCalledOnce();
    expect(updateMessage).toHaveBeenCalledWith({
      where: {
        id: "placeholder-a",
        content: "",
        mentionResponseFor: { status: "failed" },
      },
      data: {
        content: "",
        metadata: {
          in_reply_to_message_id: "source-a",
          mention_id: "mention-a",
          mention_failed: true,
        },
      },
    });
    expect(deleteMessage).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
  it("uses the same unfinished-shell guard on deletion after repeated write errors", async () => {
    updateMessage.mockRejectedValue(new Error("database unavailable"));
    deleteMessage.mockResolvedValue({ count: 0 });
    await failMentionThoughtPlaceholder({
      placeholderId: "placeholder-a",
      sourceMessageId: "source-a",
      mentionId: "mention-a",
    });
    expect(updateMessage).toHaveBeenCalledTimes(2);
    expect(deleteMessage).toHaveBeenCalledWith({
      where: {
        id: "placeholder-a",
        content: "",
        mentionResponseFor: { status: { not: "responded" } },
      },
    });
    expect(publish).not.toHaveBeenCalled();
  });
});
