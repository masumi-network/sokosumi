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
    loadMessage: vi.fn(
      async () => ({ status: "found", message: message() }) as const,
    ),
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
    const d = deps({
      loadMessage: vi.fn(
        async () => ({ status: "found", message: reply }) as const,
      ),
    });

    await performRoomNotificationJump("msg-2", d);

    expect(d.jumpInThread).toHaveBeenCalledExactlyOnceWith(reply);
    expect(d.jumpInRoom).not.toHaveBeenCalled();
  });

  it("leaves the reader in the room when the message cannot be read", async () => {
    const d = deps({
      loadMessage: vi.fn(async () => ({ status: "notReadable" }) as const),
    });

    await performRoomNotificationJump("msg-1", d);

    // Asking the room to scroll to an id the server just refused fails again,
    // and that second failure is the one the reader sees as an error toast.
    // A deleted message does not come through here: it is a tombstone, and a
    // 200.
    expect(d.jumpInRoom).not.toHaveBeenCalled();
    expect(d.jumpInThread).not.toHaveBeenCalled();
  });

  it("still tries the room when the lookup itself failed", async () => {
    const d = deps({
      loadMessage: vi.fn(async () => ({ status: "unavailable" }) as const),
    });

    await performRoomNotificationJump("msg-1", d);

    // The message is probably still there. The room jump loads its own window
    // and may well land it, and its error is one the reader can act on.
    expect(d.jumpInRoom).toHaveBeenCalledExactlyOnceWith("msg-1");
    expect(d.jumpInThread).not.toHaveBeenCalled();
  });

  it("lets a failed lookup reach the caller", async () => {
    const d = deps({
      loadMessage: vi.fn(async () => {
        throw new Error("offline");
      }),
    });

    await expect(performRoomNotificationJump("msg-1", d)).rejects.toThrow(
      "offline",
    );
    expect(d.jumpInRoom).not.toHaveBeenCalled();
    expect(d.jumpInThread).not.toHaveBeenCalled();
  });
});
