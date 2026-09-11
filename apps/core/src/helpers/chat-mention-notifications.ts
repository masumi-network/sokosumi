import { CHAT_MENTION_MESSAGE_KEY } from "@sokosumi/utils";

import { fanOutChatNotifications } from "./chat-notification-fanout";

export interface EmitChatMentionNotificationsParams {
  roomId: string;
  roomName: string;
  /** Names a direct room per reader, the way that reader's sidebar does. */
  roomKind: string;
  organizationId: string | null;
  messageId: string;
  content: string;
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
    roomKind: params.roomKind,
    organizationId: params.organizationId,
    messageId: params.messageId,
    content: params.content,
    authorUserId: params.authorUserId,
    authorName: params.authorName,
    recipientUserIds: params.mentionedUserIds,
    messageKey: CHAT_MENTION_MESSAGE_KEY,
    notificationType: "chat-mention-notification",
  });
}
