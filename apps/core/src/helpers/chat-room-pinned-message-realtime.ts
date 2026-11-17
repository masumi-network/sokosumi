import * as Sentry from "@sentry/node";
import {
  CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME,
  type ChatRoomPinnedMessageAction,
  makeChatRoomChannelName,
} from "@sokosumi/utils";
import { getRestClient } from "@/lib/ably/client";
import { getRealtimeChannelEnvironment } from "@/lib/ably/realtime-channel-environment";
import { recordCoreError } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";

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
    const channel = client.channels.get(
      makeChatRoomChannelName(input.roomId, getRealtimeChannelEnvironment()),
    );
    await channel.publish(CHAT_ROOM_PINNED_MESSAGE_EVENT_NAME, {
      action: input.action,
      roomId: input.roomId,
      messageId: input.messageId,
      pinnedMessageCount: input.pinnedMessageCount,
    });
  } catch (error) {
    // Ably's answer is untrusted text: content-free fields only.
    recordCoreError(
      {
        operation: "ably_publish_chat_room_pinned_message",
        roomId: input.roomId,
        messageId: input.messageId,
      },
      {
        message: "A pinned message event was not published over Ably",
        why: "The Ably publish of the pinned message event failed",
        fix: "Open clients catch up on their next refresh. If it repeats, check Ably's status; Sentry has the error.",
      },
      { action: input.action, failure: messageSafeErrorFields(error) },
    );
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
