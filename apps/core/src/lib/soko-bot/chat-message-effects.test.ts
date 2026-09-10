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

vi.mock("@/lib/ably/publish", () => ({
  publishChatRoomsChanged: vi.fn().mockResolvedValue(undefined),
}));

import { publishChatRoomsChanged } from "@/lib/ably/publish";

import { scheduleSokoBotChatMessageEffects } from "./chat-message-effects";

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
  shouldEmit.mockImplementation(({ kind }) => kind === "direct");
  emit.mockResolvedValue(undefined);
});

describe("scheduleSokoBotChatMessageEffects", () => {
  it("passes the message body to the emitter and retains its background work", async () => {
    await scheduleSokoBotChatMessageEffects(room, "message_1", "Meet at five");

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

  it("invalidates channel members without changing notification delivery", async () => {
    await scheduleSokoBotChatMessageEffects(
      { ...room, kind: "channel" },
      "message_1",
      "Hello",
    );

    expect(findMany).toHaveBeenCalledOnce();
    expect(publishChatRoomsChanged).toHaveBeenCalledExactlyOnceWith({
      userIds: ["user_1"],
      roomId: room.id,
      collections: ["active"],
    });
    expect(emit).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("does not schedule rooms rejected by the shared eligibility rule", async () => {
    shouldEmit.mockReturnValue(false);

    await scheduleSokoBotChatMessageEffects(room, "message_1", "Hello");

    expect(emit).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("does not fail a committed send when member lookup fails", async () => {
    const error = new Error("Member lookup failed");
    findMany.mockRejectedValue(error);

    await expect(
      scheduleSokoBotChatMessageEffects(room, "message_1", "Hello"),
    ).resolves.toBeUndefined();
    expect(waitUntil).not.toHaveBeenCalled();
  });
});
