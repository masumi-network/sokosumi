import { CHAT_MENTION_MESSAGE_KEY } from "@sokosumi/utils";

import { fanOutChatNotifications } from "./chat-notification-fanout";

/** The three rooms a mention can land in, which read differently. */
export type ChatMentionRoomShape = "channel" | "group" | "pair";

export interface EmitChatMentionNotificationsParams {
  roomId: string;
  roomName: string;
  /**
   * What the room is, which decides how the reader is told where they were
   * named. A channel has a name of its own. A group is named after who is in
   * it, so each reader is told the name their own screen shows. A pair holds
   * only the reader and the author, so it is named after the author and gets
   * no name at all.
   */
  roomShape: ChatMentionRoomShape;
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
    nameRoomPerReader: params.roomShape === "group",
    isDirectPair: params.roomShape === "pair",
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
