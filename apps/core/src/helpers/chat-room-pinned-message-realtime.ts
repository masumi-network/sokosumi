import * as Sentry from "@sentry/node";
import {
  CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME,
  type ChatRoomPinnedMessageAction,
  makeChatRoomChannelName,
} from "@sokosumi/utils";

import { getRestClient } from "@/lib/ably/client";

export interface PublishChatRoomPinnedMessageRealtimeInput {
  action: ChatRoomPinnedMessageAction;
  roomId: string;
  messageId: string;
  pinnedMessageCount: number;
}

export async function publishChatRoomPinnedMessageRealtime(
  input: PublishChatRoomPinnedMessageRealtimeInput,
): Promise<void> {
  try {
    const client = getRestClient();
    const channel = client.channels.get(makeChatRoomChannelName(input.roomId));
    await channel.publish(CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME, {
      action: input.action,
      roomId: input.roomId,
      messageId: input.messageId,
      pinnedMessageCount: input.pinnedMessageCount,
    });
  } catch (error) {
    console.error("Failed to publish pinned-message event over Ably:", error);
    Sentry.captureException(error, {
      extra: {
        roomId: input.roomId,
        messageId: input.messageId,
        action: input.action,
        errorType: "ably-publish-chat-room-pinned-message",
      },
    });
  }
}
