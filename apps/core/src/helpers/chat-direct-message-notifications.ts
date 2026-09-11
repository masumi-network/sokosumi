import * as Sentry from "@sentry/node";
import { CHAT_DIRECT_MESSAGE_MESSAGE_KEY } from "@sokosumi/utils";

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
  content: string;
  /** Human author to skip. Null when the author is a coworker. */
  authorUserId: string | null;
  authorName: string;
  recipientUserIds: readonly string[];
}

/**
 * Emit CHAT notifications for other humans in a direct room. Schedule via
 * waitUntil.
 *
 * Reports rather than rejects, for the reason the mention emit beside it
 * does: a caller that has already answered the reader cannot catch this.
 */
export async function emitChatDirectMessageNotifications(
  params: EmitChatDirectMessageNotificationsParams,
): Promise<void> {
  try {
    await emit(params);
  } catch (error) {
    Sentry.captureException(error, {
      tags: { context: "chat_direct_message_notifications" },
      extra: {
        roomId: params.roomId,
        messageId: params.messageId,
        recipientCount: params.recipientUserIds.length,
      },
    });
  }
}

async function emit(
  params: EmitChatDirectMessageNotificationsParams,
): Promise<void> {
  await fanOutChatNotifications({
    ...params,
    // No per-reader name: a one-to-one row reads "Patrick sent you a message",
    // and its banner is titled by the author. The room's name is never shown.
    messageKey: CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
    notificationType: "chat-direct-message-notification",
  });
}
