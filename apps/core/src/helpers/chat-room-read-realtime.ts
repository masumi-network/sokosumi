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
    await channel.publish(CHAT_ROOM_READ_EVENT_NAME, {
      roomId: input.roomId,
      userId: input.userId,
      lastReadAt: input.lastReadAt.toISOString(),
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
