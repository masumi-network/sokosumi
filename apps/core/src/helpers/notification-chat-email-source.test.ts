import { NotificationKind, type Prisma } from "@sokosumi/database";
import { CHAT_ROOM_MESSAGE_MESSAGE_KEY } from "@sokosumi/utils";
import { describe, expect, it } from "vitest";

import { hasLiveNotificationEmailSource } from "./notification-chat-email-source";

/** A room whose message is gone: deleted or never there. */
const roomWithoutMessage = {
  chatRoomMessage: { findFirst: async () => null },
} as unknown as Pick<Prisma.TransactionClient, "chatRoomMessage">;

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

describe("hasLiveNotificationEmailSource", () => {
  it("keeps a counted room row whose latest message is gone", async () => {
    await expect(
      hasLiveNotificationEmailSource(
        row(CHAT_ROOM_MESSAGE_MESSAGE_KEY, 2),
        roomWithoutMessage,
      ),
    ).resolves.toBe(true);
  });

  it.each([
    ["a single-message room row", row(CHAT_ROOM_MESSAGE_MESSAGE_KEY)],
    ["a mention", row("Notifications.Chat.mentioned", 2)],
  ])("drops %s whose message is gone", async (_name, notification) => {
    await expect(
      hasLiveNotificationEmailSource(notification, roomWithoutMessage),
    ).resolves.toBe(false);
  });
});
