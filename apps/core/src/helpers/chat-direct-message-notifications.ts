import { CHAT_DIRECT_MESSAGE_MESSAGE_KEY } from "@/helpers/notification-delivery";

import { fanOutChatNotifications } from "./chat-notification-fanout";

export const MAX_HUMAN_MEMBERS_FOR_DIRECT_MESSAGE_NOTIFICATIONS = 2;

export interface ShouldEmitChatDirectMessageNotificationsParams {
  kind: string;
  memberUserIds: readonly string[];
}

export function shouldEmitChatDirectMessageNotifications(
  params: ShouldEmitChatDirectMessageNotificationsParams,
): boolean {
  return (
    params.kind === "direct" &&
    params.memberUserIds.length <=
      MAX_HUMAN_MEMBERS_FOR_DIRECT_MESSAGE_NOTIFICATIONS
  );
}

export interface EmitChatDirectMessageNotificationsParams {
  roomId: string;
  roomName: string;
  organizationId: string | null;
  messageId: string;
  /** Human author to skip. Null when the author is a coworker. */
  authorUserId: string | null;
  authorName: string;
  recipientUserIds: readonly string[];
}

/** Emit CHAT notifications for other humans in a direct room. Schedule via waitUntil. */
export async function emitChatDirectMessageNotifications(
  params: EmitChatDirectMessageNotificationsParams,
): Promise<void> {
  await fanOutChatNotifications({
    ...params,
    messageKey: CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
    notificationType: "chat-direct-message-notification",
  });
}
