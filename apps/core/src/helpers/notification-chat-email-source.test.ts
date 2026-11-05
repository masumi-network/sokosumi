import { NotificationKind } from "@sokosumi/database";
import { CHAT_ROOM_MESSAGE_MESSAGE_KEY } from "@sokosumi/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  message: null as { deletedAt: Date | null } | null,
}));
vi.mock("@/lib/db/prisma", () => ({
  default: { chatRoomMessage: { findFirst: async () => state.message } },
}));

import { notificationEmailSource } from "./notification-chat-email-source";

function row(messageKey: string, count?: number) {
  return {
    id: "notification-1",
    kind: NotificationKind.CHAT,
    referenceId: "room-1",
    metadata: JSON.stringify({ messageId: "message-1" }),
    messageKey,
    messageParams: JSON.stringify({ authorName: "Ada", count }),
  };
}

describe("notificationEmailSource", () => {
  beforeEach(() => {
    state.message = { deletedAt: new Date() };
  });

  it("speaks for the message while it is in the room", async () => {
    state.message = { deletedAt: null };
    await expect(
      notificationEmailSource(row("Notifications.Chat.mentioned")),
    ).resolves.toBe("message");
  });

  it("speaks for the room alone once a counted row's latest message is deleted", async () => {
    await expect(
      notificationEmailSource(row(CHAT_ROOM_MESSAGE_MESSAGE_KEY, 2)),
    ).resolves.toBe("room");
  });

  it.each([
    ["a single-message room row", row(CHAT_ROOM_MESSAGE_MESSAGE_KEY)],
    ["a mention", row("Notifications.Chat.mentioned", 2)],
  ])(
    "speaks for nothing: %s whose message is deleted",
    async (_name, notification) => {
      await expect(notificationEmailSource(notification)).resolves.toBe("none");
    },
  );

  it("speaks for nothing when the message is not in the room at all", async () => {
    // The room is gone, or the row never pointed at one of its messages.
    state.message = null;
    await expect(
      notificationEmailSource(row(CHAT_ROOM_MESSAGE_MESSAGE_KEY, 2)),
    ).resolves.toBe("none");
  });
});
