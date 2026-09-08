import { beforeEach, describe, expect, it, vi } from "vitest";

const { findMany, shouldEmit, emit, waitUntil } = vi.hoisted(() => ({
  findMany: vi.fn(),
  shouldEmit: vi.fn(),
  emit: vi.fn(),
  waitUntil: vi.fn(),
}));

vi.mock("@/lib/db/prisma", () => ({
  default: { chatRoomUserMember: { findMany } },
}));
vi.mock("@/helpers/chat-direct-message-notifications", () => ({
  shouldEmitChatDirectMessageNotifications: shouldEmit,
  emitChatDirectMessageNotifications: emit,
}));
vi.mock("@vercel/functions", () => ({ waitUntil }));

import { scheduleSokoBotChatNotifications } from "./chat-notifications";

const room = {
  id: "room_1",
  name: "Ada and Eve",
  kind: "direct",
  organizationId: null,
  authorName: "Eve",
};

beforeEach(() => {
  vi.resetAllMocks();
  findMany.mockResolvedValue([{ userId: "user_1" }]);
  shouldEmit.mockReturnValue(true);
  emit.mockResolvedValue(undefined);
});

describe("scheduleSokoBotChatNotifications", () => {
  it("passes the message body to the emitter and retains its background work", async () => {
    await scheduleSokoBotChatNotifications(room, "message_1", "Meet at five");

    expect(findMany).toHaveBeenCalledWith({
      where: { roomId: room.id },
      select: { userId: true },
    });
    expect(shouldEmit).toHaveBeenCalledWith({
      kind: "direct",
      memberUserIds: ["user_1"],
    });
    expect(emit).toHaveBeenCalledWith({
      roomId: room.id,
      roomName: room.name,
      organizationId: null,
      messageId: "message_1",
      content: "Meet at five",
      authorUserId: null,
      authorName: "Eve",
      recipientUserIds: ["user_1"],
    });
    expect(waitUntil).toHaveBeenCalledWith(emit.mock.results[0]?.value);
  });

  it("skips the member lookup for a channel", async () => {
    await scheduleSokoBotChatNotifications(
      { ...room, kind: "channel" },
      "message_1",
      "Hello",
    );

    expect(findMany).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("does not schedule rooms rejected by the shared eligibility rule", async () => {
    shouldEmit.mockReturnValue(false);

    await scheduleSokoBotChatNotifications(room, "message_1", "Hello");

    expect(emit).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("propagates a member lookup failure without scheduling a notification", async () => {
    const error = new Error("Member lookup failed");
    findMany.mockRejectedValue(error);

    await expect(
      scheduleSokoBotChatNotifications(room, "message_1", "Hello"),
    ).rejects.toThrow(error);
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
