import { beforeEach, describe, expect, it, vi } from "vitest";

const { publishMock } = vi.hoisted(() => ({ publishMock: vi.fn() }));

vi.mock("@/helpers/chat-room-message-realtime", () => ({
  publishChatRoomMessageRealtimeById: publishMock,
}));

import {
  failOpenChatRoomMentions,
  publishChatRoomMentionStatuses,
} from "./chat-room-mention-status";

describe("chat room mention status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    publishMock.mockResolvedValue(undefined);
  });

  it("fails open mentions and returns the affected message ids", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([
        { messageId: "message_1" },
        { messageId: "message_2" },
      ]);
    const updateMany = vi.fn().mockResolvedValue({ count: 2 });
    const tx = { chatRoomMention: { findMany, updateMany } };

    const messageIds = await failOpenChatRoomMentions(
      {
        where: { orchestratorId: "bot_1" },
        error: "Personal assistant is no longer a member of this room",
      },
      tx as never,
    );

    const where = {
      orchestratorId: "bot_1",
      status: { in: ["pending", "sent"] },
    };
    expect(findMany).toHaveBeenCalledWith({
      where,
      select: { messageId: true },
      distinct: ["messageId"],
    });
    expect(updateMany).toHaveBeenCalledWith({
      where,
      data: {
        status: "failed",
        error: "Personal assistant is no longer a member of this room",
      },
    });
    expect(messageIds).toEqual(["message_1", "message_2"]);
  });

  it("publishes one mention-status patch per affected message", async () => {
    await publishChatRoomMentionStatuses([
      "message_1",
      "message_2",
      "message_1",
    ]);

    expect(publishMock).toHaveBeenCalledTimes(2);
    expect(publishMock).toHaveBeenCalledWith("message_1", "mention_status");
    expect(publishMock).toHaveBeenCalledWith("message_2", "mention_status");
  });
});
