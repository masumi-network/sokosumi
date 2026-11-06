import { createHash } from "node:crypto";
import {
  type Notification,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";
import { CHAT_ROOM_MESSAGE_MESSAGE_KEY } from "@sokosumi/utils";
import { roomUnreadCountOf } from "@/helpers/notification-email";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import prisma from "@/lib/db/prisma";

type EmailSource = Pick<
  Notification,
  "id" | "kind" | "referenceId" | "metadata" | "messageKey" | "messageParams"
>;

function messageIdOf(notification: EmailSource): string | null {
  if (notification.kind !== NotificationKind.CHAT || !notification.metadata)
    return null;
  const metadata = readNotificationRowJson(
    notification.metadata,
    notification.id,
    "metadata",
  );
  return typeof metadata?.messageId === "string" &&
    metadata.messageId.length > 0
    ? metadata.messageId
    : null;
}

/** What a row's email may speak for: its message, the room alone, or nothing. */
export type NotificationEmailSource = "message" | "none" | "room";

/**
 * A deleted, missing or unverifiable message cannot authorize an email.
 *
 * A counted room row also represents earlier arrivals. Losing its latest
 * message to deletion must not take their email away: the email then speaks
 * for the room, without that message or its author. A message that is not in
 * the room at all is different: the room is gone, or the row never pointed
 * at it. Deletion follows the publish rule. An absent message does not: the
 * publish path keeps showing a counted row in the app, while no email is
 * sent for a room its row cannot find.
 */
export async function notificationEmailSource(
  notification: EmailSource,
  client: Pick<Prisma.TransactionClient, "chatRoomMessage"> = prisma,
): Promise<NotificationEmailSource> {
  if (notification.kind !== NotificationKind.CHAT) return "message";
  const messageId = messageIdOf(notification);
  if (!messageId) return "none";
  const live = await client.chatRoomMessage.findFirst({
    where: { id: messageId, roomId: notification.referenceId },
    select: { deletedAt: true },
  });
  if (!live) return "none";
  if (!live.deletedAt) return "message";
  return notification.messageKey === CHAT_ROOM_MESSAGE_MESSAGE_KEY &&
    roomUnreadCountOf(
      readNotificationRowJson(
        notification.messageParams,
        notification.id,
        "messageParams",
      ) ?? {},
    ) !== null
    ? "room"
    : "none";
}

/** The row's fields with the lost message and its author left out. */
export function withoutLostMessage(
  messageParams: Record<string, unknown>,
  metadata: Record<string, unknown> | null,
): {
  messageParams: Record<string, unknown>;
  metadata: Record<string, unknown>;
} {
  const {
    authorName: _author,
    messagePreview: _preview,
    ...roomParams
  } = messageParams;
  const { messageId: _message, ...roomMetadata } = metadata ?? {};
  return { messageParams: roomParams, metadata: roomMetadata };
}

/** The post-send write and deletion share a source lock, never held over HTTP. */
export async function lockNotificationEmailSource(
  notification: EmailSource,
  client: Prisma.TransactionClient,
): Promise<void> {
  if (notification.kind !== NotificationKind.CHAT) return;
  const messageId = messageIdOf(notification);
  if (!messageId) return;
  await client.$queryRaw`
    SELECT "id" FROM "chat_room_message"
    WHERE "id" = ${messageId}::uuid AND "roomId" = ${notification.referenceId}::uuid
    FOR UPDATE
  `;
}

export function notificationEmailContentRevision(
  notification: Pick<Notification, "messageParams" | "metadata">,
): string {
  return createHash("sha256")
    .update(JSON.stringify([notification.messageParams, notification.metadata]))
    .digest("hex");
}
