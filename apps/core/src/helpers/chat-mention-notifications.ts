import { CHAT_MENTION_MESSAGE_KEY } from "@/helpers/notification-delivery";

import { fanOutChatNotifications } from "./chat-notification-fanout";

export interface EmitChatMentionNotificationsParams {
  roomId: string;
  roomName: string;
  organizationId: string | null;
  messageId: string;
  authorUserId: string;
  authorName: string;
  mentionedUserIds: readonly string[];
}

/** Emit CHAT notifications for human @mentions. Schedule via waitUntil. */
export async function emitChatMentionNotifications(
  params: EmitChatMentionNotificationsParams,
): Promise<void> {
  await fanOutChatNotifications({
    roomId: params.roomId,
    roomName: params.roomName,
    organizationId: params.organizationId,
    messageId: params.messageId,
    authorUserId: params.authorUserId,
    authorName: params.authorName,
    recipientUserIds: params.mentionedUserIds,
    messageKey: CHAT_MENTION_MESSAGE_KEY,
    notificationType: "chat-mention-notification",
  });
}
