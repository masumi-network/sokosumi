import { describe, expect, it, vi } from "vitest";

import { performRoomNotificationJump } from "@/app/chat/utils/room-notification-jump";
import type { ChatRoomMessage } from "@/lib/clients/generated/core";

function message(overrides: Partial<ChatRoomMessage> = {}): ChatRoomMessage {
  return {
    id: "msg-1",
    roomId: "room-1",
    parentMessageId: null,
    content: "Hello",
    createdAt: "2026-08-01T00:00:00.000Z",
    editedAt: null,
    deletedAt: null,
    metadata: null,
    replyCount: 0,
    sender: {
      type: "user",
      user: {
        id: "user_1",
        name: "Ada",
        email: "ada@example.com",
        image: null,
      },
    },
    reactions: [],
    ...overrides,
  } as ChatRoomMessage;
}

function deps(
  overrides: Partial<Parameters<typeof performRoomNotificationJump>[1]> = {},
) {
  return {
    highlight: vi.fn(() => false),
    loadMessage: vi.fn(async () => message()),
    jumpInRoom: vi.fn(async () => {}),
    jumpInThread: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("performRoomNotificationJump", () => {
  it("skips the lookup when the message is already on screen", async () => {
    const d = deps({ highlight: vi.fn(() => true) });

    await performRoomNotificationJump("msg-1", d);

    expect(d.loadMessage).not.toHaveBeenCalled();
    expect(d.jumpInRoom).not.toHaveBeenCalled();
    expect(d.jumpInThread).not.toHaveBeenCalled();
  });

  it("jumps in the room for a top-level message", async () => {
    const d = deps();

    await performRoomNotificationJump("msg-1", d);

    expect(d.loadMessage).toHaveBeenCalledExactlyOnceWith("msg-1");
    expect(d.jumpInRoom).toHaveBeenCalledExactlyOnceWith("msg-1");
    expect(d.jumpInThread).not.toHaveBeenCalled();
  });

  it("opens the thread for a reply, which the room timeline never shows", async () => {
    const reply = message({ id: "msg-2", parentMessageId: "msg-1" });
    const d = deps({ loadMessage: vi.fn(async () => reply) });

    await performRoomNotificationJump("msg-2", d);

    expect(d.jumpInThread).toHaveBeenCalledExactlyOnceWith(reply);
    expect(d.jumpInRoom).not.toHaveBeenCalled();
  });

  it("still opens the room when the message cannot be read", async () => {
    const d = deps({ loadMessage: vi.fn(async () => null) });

    await performRoomNotificationJump("msg-1", d);

    expect(d.jumpInRoom).toHaveBeenCalledExactlyOnceWith("msg-1");
    expect(d.jumpInThread).not.toHaveBeenCalled();
  });
});
