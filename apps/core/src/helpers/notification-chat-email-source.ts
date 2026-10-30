import { createHash } from "node:crypto";
import {
  type Notification,
  NotificationKind,
  type Prisma,
} from "@sokosumi/database";
import { readNotificationRowJson } from "@/helpers/notification-row-json";
import prisma from "@/lib/db/prisma";

type EmailSource = Pick<
  Notification,
  "id" | "kind" | "referenceId" | "metadata"
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

/** A deleted, missing or unverifiable message cannot authorize an email. */
export async function hasLiveNotificationEmailSource(
  notification: EmailSource,
  client: Pick<Prisma.TransactionClient, "chatRoomMessage"> = prisma,
): Promise<boolean> {
  if (notification.kind !== NotificationKind.CHAT) return true;
  const messageId = messageIdOf(notification);
  if (!messageId) return false;
  return (
    (await client.chatRoomMessage.findFirst({
      where: {
        id: messageId,
        roomId: notification.referenceId,
        deletedAt: null,
      },
      select: { id: true },
    })) !== null
  );
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
