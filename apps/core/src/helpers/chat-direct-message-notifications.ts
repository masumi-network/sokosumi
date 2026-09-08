import { CHAT_DIRECT_MESSAGE_MESSAGE_KEY } from "@sokosumi/utils";
import { resolveNotificationDelivery } from "@/helpers/notification-delivery";
import prisma from "@/lib/db/prisma";

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
  /** Named in the message. Skipped only when that mention actually reaches them. */
  mentionedUserIds?: readonly string[];
}

/**
 * Drop recipients whose mention already reaches them.
 *
 * A 1:1 direct room never emits a room-message row, so skipping every named
 * human here used to drop the only remaining notify path. Mentions can be
 * silenced. Keep the direct-message row when the mention would not arrive.
 */
async function recipientsNotCoveredByMention(
  params: EmitChatDirectMessageNotificationsParams,
): Promise<readonly string[]> {
  const mentioned = new Set(params.mentionedUserIds ?? []);
  const mentionedRecipients = params.recipientUserIds.filter((userId) =>
    mentioned.has(userId),
  );
  if (mentionedRecipients.length === 0) {
    return params.recipientUserIds;
  }

  const readers = await prisma.user.findMany({
    where: { id: { in: mentionedRecipients } },
    select: {
      id: true,
      pushOptIn: true,
      notificationPreferences: {
        select: { category: true, channel: true, enabled: true },
      },
    },
  });
  const covered = new Set(
    readers
      .filter((reader) => {
        const delivery = resolveNotificationDelivery({
          category: "CHAT_MENTION",
          preferences: reader.notificationPreferences,
          pushOptIn: reader.pushOptIn,
        });
        return delivery.inApp || delivery.osBanner;
      })
      .map((reader) => reader.id),
  );

  return params.recipientUserIds.filter((userId) => !covered.has(userId));
}

/** Emit CHAT notifications for other humans in a direct room. Schedule via waitUntil. */
export async function emitChatDirectMessageNotifications(
  params: EmitChatDirectMessageNotificationsParams,
): Promise<void> {
  const recipientUserIds = await recipientsNotCoveredByMention(params);

  await fanOutChatNotifications({
    ...params,
    recipientUserIds,
    messageKey: CHAT_DIRECT_MESSAGE_MESSAGE_KEY,
    notificationType: "chat-direct-message-notification",
  });
}
