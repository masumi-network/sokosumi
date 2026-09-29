import * as Sentry from "@sentry/node";
import {
  CHAT_ROOM_READ_EVENT_NAME,
  makeChatRoomChannelName,
} from "@sokosumi/utils";

import { getRestClient } from "@/lib/ably/client";

export interface PublishChatRoomReadRealtimeInput {
  roomId: string;
  userId: string;
  lastReadAt: Date;
}

/**
 * Tell the open room that one member's Room last-read moved. Best effort: the
 * mark-read write has already committed, and the next room payload carries the
 * same fact, so a failed publish costs a moment of staleness and nothing else.
 */
export async function publishChatRoomReadRealtime(
  input: PublishChatRoomReadRealtimeInput,
): Promise<void> {
  try {
    const client = getRestClient();
    const channel = client.channels.get(makeChatRoomChannelName(input.roomId));
    // Ephemeral (ADR-0033's one transferable lesson): a read receipt is
    // derived, and the next room payload carries the same mark. It gains
    // nothing from history, rewind or resume, and a reconnecting client
    // replaying stale reads would only re-assert what its payload just said.
    await channel.publish({
      name: CHAT_ROOM_READ_EVENT_NAME,
      data: {
        roomId: input.roomId,
        userId: input.userId,
        lastReadAt: input.lastReadAt.toISOString(),
      },
      extras: { ephemeral: true },
    });
  } catch (error) {
    console.error("Failed to publish room read event over Ably:", error);
    Sentry.captureException(error, {
      extra: {
        roomId: input.roomId,
        userId: input.userId,
        errorType: "ably-publish-chat-room-read",
      },
    });
  }
}
